import type {
  IAiTool,
  IExecuteContext,
  ILoadableNodeType,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
  ISupplyDataContext,
  JsonObject,
} from '@nomops/workflow';
import {
  collectFromAiParams,
  fromAiSchema,
  OperationalError,
  resolveParameterValue,
} from '@nomops/workflow';
import { executeRoutingNode, hasRoutingDeclarations } from '../execution-engine/routing-executor.js';

function safeToolName(value: string): string {
  const cleaned = value.trim().replace(/[^a-zA-Z0-9_]/g, '_').replace(/_+/g, '_');
  if (!cleaned) return 'workflow_tool';
  return /^\d/.test(cleaned) ? `tool_${cleaned}` : cleaned;
}

function toolDescription(base: INodeTypeDescription): INodeTypeDescription {
  return {
    ...base,
    displayName: `${base.displayName} Tool`,
    name: `${base.name}Tool`,
    group: ['ai'],
    categories: ['ai'],
    subcategories: ['Tools'],
    aliases: [...(base.aliases ?? []), base.displayName, 'tool'],
    defaults: { name: `${base.defaults.name} Tool` },
    inputs: [],
    outputs: ['ai_tool'],
    outputNames: undefined,
    usableAsTool: undefined,
    polling: undefined,
    webhooks: undefined,
    properties: [
      {
        displayName: 'Tool Name',
        name: 'toolName',
        type: 'string',
        default: safeToolName(base.name),
        required: true,
        description: 'Identifier exposed to the AI model',
      },
      {
        displayName: 'Tool Description',
        name: 'toolDescription',
        type: 'string',
        default: base.description,
        description: 'Tell the model when it should call this tool',
      },
      ...base.properties,
    ],
  };
}

function outputPayload(output: INodeExecutionData[][]): unknown {
  const values = output.flat().map((item) => {
    if (!item.binary) return item.json;
    const binary = Object.fromEntries(
      Object.entries(item.binary).map(([key, value]) => [key, {
        mimeType: value.mimeType,
        fileName: value.fileName,
        fileSize: value.fileSize,
      }]),
    );
    return { ...item.json, $binary: binary };
  });
  return values.length === 1 ? values[0] : values;
}

function createToolExecuteContext(
  supply: ISupplyDataContext,
  base: INodeTypeDescription,
  args: JsonObject,
): IExecuteContext & {
  resolveValue(value: unknown, itemIndex: number, overrides?: { json?: JsonObject }): unknown;
} {
  const resolve = (value: unknown, json: JsonObject = args, parameters?: JsonObject): unknown =>
    resolveParameterValue(value, {
      json,
      itemIndex: 0,
      items: [{ json: args }],
      runData: {},
      workflow: {},
      parameters,
      fromAI: { provided: args },
    });
  const parameters: JsonObject = {};
  for (const property of base.properties) {
    const raw = supply.getRawNodeParameter(property.name);
    parameters[property.name] = resolve(raw === undefined ? property.default : raw);
  }
  const contextData: JsonObject = {};

  return {
    getInputData: () => [{ json: args }],
    getNodeParameter(name: string, _itemIndex: number, fallback?: unknown): unknown {
      return name in parameters ? parameters[name] : fallback;
    },
    getCredentials: (type: string) => supply.getCredentials(type),
    getWorkflowStaticData: (type: string) => supply.getWorkflowStaticData(type),
    getContext: () => contextData,
    isResumed: () => false,
    getInputConnectionData: (connectionType: string) => supply.getInputConnectionData(connectionType),
    resolveValue(value: unknown, _itemIndex: number, overrides?: { json?: JsonObject }): unknown {
      return resolve(value, overrides?.json ?? args, parameters);
    },
    helpers: supply.helpers,
  };
}

/**
 * 把 usableAsTool 节点在 loader 层派生为 *Tool。原节点类仍是唯一执行实现；
 * 派生工具只适配 supplyData/AI 参数，不复制 provider 逻辑或凭证认证。
 */
export function convertNodeToAiTool(source: ILoadableNodeType): ILoadableNodeType {
  const description = toolDescription(source.description);
  return {
    type: `${source.type}Tool`,
    description,
    load: async () => {
      const BaseNode = await source.load();
      return class implements INodeType {
        description = description;

        async supplyData(this: ISupplyDataContext): Promise<IAiTool> {
          const baseNode = new BaseNode();
          const rawValues = source.description.properties.map((property) => {
            const raw = this.getRawNodeParameter(property.name);
            return raw === undefined ? property.default : raw;
          });
          const aiParameters = collectFromAiParams(rawValues);
          const name = safeToolName(String(this.getNodeParameter('toolName', source.description.name)));
          const details = String(this.getNodeParameter('toolDescription', source.description.description));

          return {
            spec: {
              name,
              description: details || source.description.description,
              parameters: aiParameters.length > 0
                ? fromAiSchema(aiParameters)
                : { type: 'object', properties: {} },
            },
            invoke: async (args: JsonObject): Promise<string> => {
              const context = createToolExecuteContext(this, source.description, args);
              let output: INodeExecutionData[][];
              if (baseNode.execute) output = await baseNode.execute.call(context);
              else if (hasRoutingDeclarations(source.description)) {
                output = await executeRoutingNode(
                  context,
                  source.description,
                  baseNode.authenticate?.bind(baseNode),
                );
              } else {
                throw new OperationalError(`节点 ${source.type} 不能派生为工具：没有 execute 或 routing`);
              }
              const payload = outputPayload(output);
              return typeof payload === 'string' ? payload : JSON.stringify(payload);
            },
          };
        }
      };
    },
  };
}
