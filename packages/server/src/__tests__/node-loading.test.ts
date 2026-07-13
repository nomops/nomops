import { describe, expect, it } from 'vitest';
import { NodeLoader } from '@nomops/core';
import { builtinNodeManifest } from '@nomops/nodes';
import type { IExecuteContext, INodeExecutionData } from '@nomops/workflow';

/**
 * Phase 1 验收（跨包，server 是唯一同时依赖 core + nodes 的组合根）：
 * 加载器 + 内置节点清单接上后，能拿到可执行的 Set 类并跑出正确结果。
 */
describe('内置节点通过加载器可用', () => {
  it('getAllDescriptions 含全部内置节点', async () => {
    const loader = new NodeLoader(builtinNodeManifest);
    await loader.loadAll();

    const names = loader.getAllDescriptions().map((d) => d.name).sort();
    expect(names).toEqual([
      'aiAgent',
      'code',
      'executeWorkflow',
      'httpRequest',
      'if',
      'manualTrigger',
      'merge',
      'noOp',
      'schedule',
      'set',
      'webhook',
    ]);
  });

  it('getByNameAndVersion("nomops.set", 1) 返回可执行的 Set 类', async () => {
    const loader = new NodeLoader(builtinNodeManifest);
    const setNode = await loader.getByNameAndVersion('nomops.set', 1);
    expect(typeof setNode.execute).toBe('function');

    const items: INodeExecutionData[] = [{ json: { a: 1 } }];
    const context = {
      getInputData: () => items,
      getNodeParameter: () => ({ b: 2 }),
      getCredentials: async () => ({}),
      getWorkflowStaticData: () => ({}),
      helpers: { httpRequest: async () => ({}) },
    } as unknown as IExecuteContext;

    const output = await setNode.execute!.call(context);
    expect(output).toEqual([[{ json: { a: 1, b: 2 }, pairedItem: { item: 0 } }]]);
  });
});
