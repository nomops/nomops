import type {
  IExecuteContext,
  IHttpRequestOptions,
  INode,
  INodeExecutionData,
  IRunData,
  ITaskDataConnections,
  JsonObject,
  Workflow,
} from '@nomops/workflow';
import { OperationalError, resolveParameterValue } from '@nomops/workflow';

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
}

async function defaultHttpRequest(options: IHttpRequestOptions): Promise<unknown> {
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

    helpers: {
      httpRequest: additionalData.httpRequest ?? defaultHttpRequest,
      ...(additionalData.executeSubWorkflow
        ? { executeSubWorkflow: additionalData.executeSubWorkflow }
        : {}),
    },
  };

  return context;
}
