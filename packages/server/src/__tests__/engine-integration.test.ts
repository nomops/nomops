import { describe, expect, it } from 'vitest';
import { NodeLoader, WorkflowExecute } from '@nomops/core';
import { builtinNodeManifest } from '@nomops/nodes';
import type { INode } from '@nomops/workflow';
import { Workflow } from '@nomops/workflow';

/**
 * 三层解耦验证（docs/01）：不起 HTTP、不连 DB，
 * 真实节点（@nomops/nodes）+ 真实引擎（@nomops/core）直接跑完一个工作流。
 */

function node(name: string, type: string, parameters: Record<string, unknown> = {}, extra: Partial<INode> = {}): INode {
  return { id: name, name, type, typeVersion: 1, position: [0, 0], parameters, ...extra };
}

const to = (n: string, index = 0) => ({ node: n, type: 'main', index });

describe('引擎 × 真实内置节点 集成', () => {
  it('ManualTrigger → Set → Code 线性流（docs/02 示例风格）', async () => {
    const wf = new Workflow({
      name: 'integration-linear',
      nodes: [
        node('Start', 'nomops.manualTrigger'),
        node('Set', 'nomops.set', { fields: { amount: 150, user: 'alice' } }),
        node('Code', 'nomops.code', {
          code: 'return items.map(it => ({ json: { ...it.json, doubled: it.json.amount * 2 } }));',
        }),
      ],
      connections: {
        Start: { main: [[to('Set')]] },
        Set: { main: [[to('Code')]] },
      },
    });

    const engine = new WorkflowExecute(new NodeLoader(builtinNodeManifest));
    const run = await engine.run(wf);

    expect(run.status).toBe('success');
    const codeOut = run.data.resultData.runData['Code']![0]!.data!['main']![0]!;
    expect(codeOut[0]!.json).toEqual({ amount: 150, user: 'alice', doubled: 300 });
  });

  it('IF 用表达式条件分流，两分支 Set 后 Merge 汇合', async () => {
    const wf = new Workflow({
      name: 'integration-branch-merge',
      nodes: [
        node('Start', 'nomops.manualTrigger'),
        node('Seed', 'nomops.code', {
          code: 'return [{ json: { amount: 150 } }, { json: { amount: 50 } }];',
        }),
        node('IF', 'nomops.if', {
          conditions: [{ left: '={{ $json.amount }}', op: 'gt', right: 100 }],
        }),
        node('Big', 'nomops.set', { fields: { size: 'big' } }),
        node('Small', 'nomops.set', { fields: { size: 'small' } }),
        node('Merge', 'nomops.merge', {}),
      ],
      connections: {
        Start: { main: [[to('Seed')]] },
        Seed: { main: [[to('IF')]] },
        IF: { main: [[to('Big')], [to('Small')]] },
        Big: { main: [[to('Merge', 0)]] },
        Small: { main: [[to('Merge', 1)]] },
      },
    });

    const engine = new WorkflowExecute(new NodeLoader(builtinNodeManifest));
    const run = await engine.run(wf);

    expect(run.status).toBe('success');
    const merged = run.data.resultData.runData['Merge']![0]!.data!['main']![0]!.map((it) => it.json);
    expect(merged).toEqual([
      { amount: 150, size: 'big' },
      { amount: 50, size: 'small' },
    ]);
  });

  it('执行状态整体 JSON 序列化安全（铁律4）', async () => {
    const wf = new Workflow({
      name: 'integration-serializable',
      nodes: [node('Start', 'nomops.manualTrigger'), node('Set', 'nomops.set', { fields: { a: 1 } })],
      connections: { Start: { main: [[to('Set')]] } },
    });

    const run = await new WorkflowExecute(new NodeLoader(builtinNodeManifest)).run(wf);
    const roundTripped = JSON.parse(JSON.stringify(run.data));
    expect(roundTripped).toEqual(run.data);
  });
});
