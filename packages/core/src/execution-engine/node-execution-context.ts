import type {
  IBinaryData,
  IExecuteContext,
  IHttpRequestOptions,
  INode,
  INodeExecutionData,
  INodeType,
  IRunData,
  ISupplyDataContext,
  ITaskDataConnections,
  JsonObject,
  Workflow,
} from '@nomops/workflow';
import { OperationalError, resolveParameterValue } from '@nomops/workflow';
import type { IBinaryDataStore } from '../binary-data/binary-store.js';

/** 子节点解析所需的最小加载器切面（避免与 NodeLoader 具体类耦合）。 */
export interface INodeTypeResolver {
  getByNameAndVersion(type: string, version: number): Promise<INodeType>;
}

/** 组合嵌套深度上限（模型挂在工具上、工具挂在 Agent 上……防环）。 */
const MAX_SUPPLY_DEPTH = 8;

/**
 * 解析挂在 host 节点某 ai_* 输入上的子节点能力：
 * 找到该类型的全部入向连接 → 逐个加载子节点类型 → 调 supplyData 收集能力对象。
 * 能力对象只存活于本次节点执行，不进执行状态（铁律 4 不受影响）。
 */
async function resolveInputConnectionData(args: {
  workflow: Workflow;
  hostNode: INode;
  connectionType: string;
  staticData: JsonObject;
  additionalData: IWorkflowExecuteAdditionalData;
  resolver: INodeTypeResolver | undefined;
  depth: number;
}): Promise<unknown[]> {
  const { workflow, hostNode, connectionType, staticData, additionalData, resolver, depth } = args;
  if (connectionType === 'main') {
    throw new OperationalError('getInputConnectionData 不用于 main 数据流（用 getInputData）', {
      node: hostNode.name,
    });
  }
  if (depth >= MAX_SUPPLY_DEPTH) {
    throw new OperationalError(`能力子节点嵌套超过 ${MAX_SUPPLY_DEPTH} 层（疑似循环挂载）`, {
      node: hostNode.name,
    });
  }
  if (!resolver) {
    throw new OperationalError('节点加载器未注入，无法解析能力子节点', { node: hostNode.name });
  }

  const supplied: unknown[] = [];
  for (const conn of workflow.getIncomingConnections(hostNode.name, connectionType)) {
    const subNode = workflow.getNode(conn.sourceNode);
    if (subNode.disabled) continue;
    const subType = await resolver.getByNameAndVersion(subNode.type, subNode.typeVersion);
    if (!subType.supplyData) {
      throw new OperationalError(
        `节点 ${subNode.name}（${subNode.type}）不提供 supplyData，不能挂在 ${connectionType} 输入上`,
        { node: subNode.name },
      );
    }
    const subContext = createSupplyContext({
      workflow,
      node: subNode,
      staticData,
      additionalData,
      resolver,
      depth: depth + 1,
    });
    supplied.push(await subType.supplyData.call(subContext));
  }
  return supplied;
}

/** 构造子节点 supplyData 的 `this`。参数按无 item 上下文求值（子节点不在数据流里）。 */
export function createSupplyContext(args: {
  workflow: Workflow;
  node: INode;
  staticData: JsonObject;
  additionalData: IWorkflowExecuteAdditionalData;
  resolver: INodeTypeResolver | undefined;
  depth?: number;
}): ISupplyDataContext {
  const { workflow, node, staticData, additionalData, resolver } = args;
  const depth = args.depth ?? 0;

  return {
    getNodeParameter(name: string, fallback?: unknown): unknown {
      const raw = name in node.parameters ? node.parameters[name] : fallback;
      try {
        return resolveParameterValue(raw, {
          json: {},
          itemIndex: 0,
          items: [],
          runData: {},
          workflow: { id: workflow.id, name: workflow.name },
          vars: additionalData.variables ?? {},
        });
      } catch (error) {
        throw new OperationalError(
          `参数 "${name}" 求值失败（子节点 ${node.name}）: ${(error as Error).message}`,
          { node: node.name, parameter: name },
        );
      }
    },

    async getCredentials(type: string): Promise<JsonObject> {
      if (!additionalData.getCredentials) {
        throw new OperationalError(`凭证服务未注入，无法获取凭证 "${type}"`, {
          node: node.name,
          credentialType: type,
        });
      }
      return additionalData.getCredentials(type, node);
    },

    getWorkflowStaticData(type: string): JsonObject {
      const key = type === 'global' ? 'global' : `node:${node.name}`;
      let data = staticData[key];
      if (data === undefined || data === null || typeof data !== 'object') {
        data = {};
        staticData[key] = data;
      }
      return data as JsonObject;
    },

    getInputConnectionData(connectionType: string): Promise<unknown[]> {
      return resolveInputConnectionData({
        workflow,
        hostNode: node,
        connectionType,
        staticData,
        additionalData,
        resolver,
        depth,
      });
    },

    helpers: {
      httpRequest: additionalData.httpRequest ?? defaultHttpRequest,
    },
  };
}

/** 引擎的外部依赖注入（server 层组装；引擎本身不知道 DB/WS 的存在）。 */
export interface IWorkflowExecuteAdditionalData {
  /** 解密凭证的回调（Phase 3 由凭证服务实现；引擎只调接口）。 */
  getCredentials?: (type: string, node: INode) => Promise<JsonObject>;
  /** 项目维度变量（表达式里 $vars.KEY）。 */
  variables?: Record<string, string>;
  /** HTTP 工具实现（默认用全局 fetch）。 */
  httpRequest?: (options: IHttpRequestOptions) => Promise<unknown>;
  /** 子工作流执行回调（服务层实现：归属校验 + 深度限制）。 */
  executeSubWorkflow?: (workflowId: string, items: INodeExecutionData[]) => Promise<INodeExecutionData[]>;
  /** 二进制存储（server 注入文件系统/S3 实现；缺省内联 base64 退化模式）。 */
  binaryStore?: IBinaryDataStore;
}

export async function defaultHttpRequest(options: IHttpRequestOptions): Promise<unknown> {
  const url = new URL(options.url);
  for (const [k, v] of Object.entries(options.qs ?? {})) {
    url.searchParams.set(k, String(v));
  }
  const hasBody = options.body !== undefined && options.method !== 'GET';
  const response = await fetch(url, {
    method: options.method ?? 'GET',
    headers: {
      ...(hasBody ? { 'content-type': 'application/json' } : {}),
      ...options.headers,
    },
    body: hasBody ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // 非 JSON 响应原样返回文本
  }
  if (!response.ok) {
    throw new OperationalError(`HTTP ${response.status} ${response.statusText}`, {
      url: options.url,
      status: response.status,
      body,
    });
  }
  return body;
}

/**
 * 构造节点 execute() 的 this 上下文。
 * getNodeParameter 自动对 `={{ }}` 表达式求值（按 itemIndex 绑定当前 item）。
 */
export function createExecuteContext(args: {
  workflow: Workflow;
  node: INode;
  inputData: ITaskDataConnections;
  runData: IRunData;
  staticData: JsonObject;
  additionalData: IWorkflowExecuteAdditionalData;
  /** true = waiting 恢复后的续跑帧。 */
  resumed?: boolean;
  /** 子节点能力解析用的加载器（引擎注入）。 */
  resolver?: INodeTypeResolver;
}): IExecuteContext {
  const { workflow, node, inputData, runData, staticData, additionalData } = args;
  const items = inputData['main']?.[0] ?? [];

  const context: IExecuteContext = {
    getInputData(inputIndex = 0): INodeExecutionData[] {
      return inputData['main']?.[inputIndex] ?? [];
    },

    getNodeParameter(name: string, itemIndex: number, fallback?: unknown): unknown {
      const raw = name in node.parameters ? node.parameters[name] : fallback;
      try {
        return resolveParameterValue(raw, {
          json: items[itemIndex]?.json ?? {},
          itemIndex,
          items,
          runData,
          workflow: { id: workflow.id, name: workflow.name },
          vars: additionalData.variables ?? {},
          parameters: node.parameters,
        });
      } catch (error) {
        // 补充定位信息：哪个节点、哪个参数、哪个 item
        throw new OperationalError(
          `参数 "${name}" 求值失败（节点 ${node.name}, item ${itemIndex}）: ${(error as Error).message}`,
          { node: node.name, parameter: name, itemIndex },
        );
      }
    },

    async getCredentials(type: string): Promise<JsonObject> {
      if (!additionalData.getCredentials) {
        throw new OperationalError(`凭证服务未注入，无法获取凭证 "${type}"`, {
          node: node.name,
          credentialType: type,
        });
      }
      return additionalData.getCredentials(type, node);
    },

    getWorkflowStaticData(type: string): JsonObject {
      const key = type === 'global' ? 'global' : `node:${node.name}`;
      let data = staticData[key];
      if (data === undefined || data === null || typeof data !== 'object') {
        data = {};
        staticData[key] = data;
      }
      return data as JsonObject;
    },

    isResumed(): boolean {
      return args.resumed === true;
    },

    getInputConnectionData(connectionType: string): Promise<unknown[]> {
      return resolveInputConnectionData({
        workflow,
        hostNode: node,
        connectionType,
        staticData,
        additionalData,
        resolver: args.resolver,
        depth: 0,
      });
    },

    /**
     * 求值任意声明值（routing 执行器用）：与参数求值同一作用域
     * （$json/$itemIndex/$parameter/$vars/$node…）。不属于公开 IExecuteContext 契约。
     */
    // @ts-expect-error 引擎内部扩展成员
    resolveValue(value: unknown, itemIndex: number): unknown {
      return resolveParameterValue(value, {
        json: items[itemIndex]?.json ?? {},
        itemIndex,
        items,
        runData,
        workflow: { id: workflow.id, name: workflow.name },
        vars: additionalData.variables ?? {},
        parameters: node.parameters,
      });
    },

    helpers: {
      httpRequest: additionalData.httpRequest ?? defaultHttpRequest,
      ...(additionalData.executeSubWorkflow
        ? { executeSubWorkflow: additionalData.executeSubWorkflow }
        : {}),

      async binaryToBuffer(binary: IBinaryData): Promise<Uint8Array> {
        if (binary.id) {
          if (!additionalData.binaryStore) {
            throw new OperationalError('二进制存储未注入，无法读取引用形态的 binary 数据', { node: node.name });
          }
          return additionalData.binaryStore.get(binary.id);
        }
        return Buffer.from(binary.data ?? '', 'base64');
      },

      async bufferToBinary(buffer: Uint8Array, meta: { mimeType: string; fileName?: string }): Promise<IBinaryData> {
        if (additionalData.binaryStore) {
          return additionalData.binaryStore.put(Buffer.from(buffer), meta);
        }
        // 无 store（纯引擎单测）：内联退化
        return {
          data: Buffer.from(buffer).toString('base64'),
          mimeType: meta.mimeType,
          ...(meta.fileName ? { fileName: meta.fileName } : {}),
          fileSize: buffer.byteLength,
        };
      },
    },
  };

  return context;
}
