import { describe, expect, it, vi } from 'vitest';
import type {
  ILoadableNodeType,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
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

  it('未知节点类型抛 NodeTypeNotFoundError', async () => {
    const loader = new NodeLoader([]);
    await expect(loader.getByNameAndVersion('nomops.missing')).rejects.toBeInstanceOf(
      NodeTypeNotFoundError,
    );
  });
});
