import { describe, expect, it, vi } from 'vitest';
import type {
  IAiTool,
  IBinaryData,
  ILoadableNodeType,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
  ISupplyDataContext,
} from '@nomops/workflow';
import { NodeLoader, NodeTypeNotFoundError } from './node-loader.js';

function description(name: string, version = 1): INodeTypeDescription {
  return {
    displayName: name,
    name,
    group: ['transform'],
    version,
    description: '',
    defaults: { name },
    inputs: ['main'],
    outputs: ['main'],
    properties: [],
  };
}

function fakeNode(type: string, version = 1): { entry: ILoadableNodeType; load: ReturnType<typeof vi.fn> } {
  const load = vi.fn(async () => {
    return class implements INodeType {
      description = description(type, version);
      async execute(): Promise<INodeExecutionData[][]> {
        return [[{ json: { loaded: type } }]];
      }
    };
  });
  return { entry: { type, description: description(type, version), load }, load };
}

describe('NodeLoader', () => {
  it('getAllDescriptions 返回描述且不触发类加载（懒加载）', async () => {
    const set = fakeNode('nomops.set');
    const loader = new NodeLoader([set.entry]);
    await loader.loadAll();

    expect(loader.getAllDescriptions().map((d) => d.name)).toEqual(['nomops.set']);
    expect(set.load).not.toHaveBeenCalled();
  });

  it('getByNameAndVersion 懒加载并缓存实例', async () => {
    const set = fakeNode('nomops.set');
    const loader = new NodeLoader([set.entry]);

    const instance = await loader.getByNameAndVersion('nomops.set', 1);
    expect(set.load).toHaveBeenCalledTimes(1);
    expect(instance.description.name).toBe('nomops.set');
    expect(typeof instance.execute).toBe('function');

    await loader.getByNameAndVersion('nomops.set', 1);
    expect(set.load).toHaveBeenCalledTimes(1); // 命中缓存，不重复加载
  });

  it('省略版本时解析到最新版本', async () => {
    const v1 = fakeNode('nomops.thing', 1);
    const v2 = fakeNode('nomops.thing', 2);
    const loader = new NodeLoader([v1.entry, v2.entry]);

    await loader.getByNameAndVersion('nomops.thing');
    expect(v2.load).toHaveBeenCalledTimes(1);
    expect(v1.load).not.toHaveBeenCalled();
  });

  it('单一节点声明多个兼容版本时，存量 typeVersion 仍能加载', async () => {
    const multiVersionDescription = { ...description('removeDuplicates'), version: [1, 2] };
    const load = vi.fn(async () => class implements INodeType {
      description = multiVersionDescription;
      async execute(): Promise<INodeExecutionData[][]> { return [[]]; }
    });
    const loader = new NodeLoader([{
      type: 'nomops.removeDuplicates',
      description: multiVersionDescription,
      load,
    }]);

    await expect(loader.getByNameAndVersion('nomops.removeDuplicates', 1)).resolves.toBeDefined();
    await expect(loader.getByNameAndVersion('nomops.removeDuplicates', 2)).resolves.toBeDefined();
    await expect(loader.getByNameAndVersion('nomops.removeDuplicates', 3)).rejects.toBeInstanceOf(NodeTypeNotFoundError);
  });

  it('未知节点类型抛 NodeTypeNotFoundError', async () => {
    const loader = new NodeLoader([]);
    await expect(loader.getByNameAndVersion('nomops.missing')).rejects.toBeInstanceOf(
      NodeTypeNotFoundError,
    );
  });

  it('usableAsTool 在 loader 层自动派生并复用原节点 execute', async () => {
    const baseDescription: INodeTypeDescription = {
      ...description('echo'),
      name: 'echo',
      displayName: 'Echo',
      description: 'Echo configured text',
      usableAsTool: true,
      properties: [{
        displayName: 'Text', name: 'text', type: 'string', default: "={{ $fromAI('text','Text to echo','string') }}",
      }],
    };
    const source: ILoadableNodeType = {
      type: 'nomops.echo',
      description: baseDescription,
      load: async () => class implements INodeType {
        description = baseDescription;
        async execute(this: import('@nomops/workflow').IExecuteContext): Promise<INodeExecutionData[][]> {
          return [[{ json: { echoed: this.getNodeParameter('text', 0) } }]];
        }
      },
    };
    const loader = new NodeLoader([source]);
    expect(loader.getAllTypes()).toEqual(['nomops.echo', 'nomops.echoTool']);
    expect(loader.describeAll().find((item) => item.type === 'nomops.echoTool')).toMatchObject({
      name: 'echoTool', inputs: [], outputs: ['ai_tool'], categories: ['ai'],
    });

    const derived = await loader.getByNameAndVersion('nomops.echoTool', 1);
    const raw: Record<string, unknown> = {
      toolName: 'echo_text',
      toolDescription: 'Echo text',
      text: "={{ $fromAI('text','Text to echo','string') }}",
    };
    const supply: ISupplyDataContext = {
      getNodeParameter(name: string, fallback?: unknown) { return raw[name] ?? fallback; },
      getRawNodeParameter(name: string) { return raw[name]; },
      getCredentials: async () => ({}),
      getWorkflowStaticData: () => ({}),
      getInputConnectionData: async () => [],
      helpers: {
        httpRequest: async () => ({}),
        binaryToBuffer: async (binary: IBinaryData) => Buffer.from(binary.data ?? '', 'base64'),
        bufferToBinary: async (buffer, meta) => ({ data: Buffer.from(buffer).toString('base64'), ...meta }),
      },
    };
    const tool = await derived.supplyData!.call(supply) as IAiTool;
    expect(tool.spec).toMatchObject({
      name: 'echo_text',
      parameters: { type: 'object', required: ['text'] },
    });
    await expect(tool.invoke({ text: 'hello' })).resolves.toBe('{"echoed":"hello"}');
  });
});
