import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { InMemoryBinaryStore, NodeLoader, WorkflowExecute } from '@nomops/core';
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

  it('Compare Datasets 等待双输入并把结果分发到四个输出', async () => {
    const wf = new Workflow({
      name: 'integration-compare-datasets',
      nodes: [
        node('Start', 'nomops.manualTrigger'),
        node('Input A', 'nomops.noOp'),
        node('Input B', 'nomops.noOp'),
        node('Compare', 'nomops.compareDatasets', {
          matchFields: { values: [{ fieldA: 'id', fieldB: 'id' }] },
        }),
        node('Only A', 'nomops.noOp'),
        node('Same', 'nomops.noOp'),
        node('Different', 'nomops.noOp'),
        node('Only B', 'nomops.noOp'),
      ],
      connections: {
        Start: { main: [[to('Input A'), to('Input B')]] },
        'Input A': { main: [[to('Compare', 0)]] },
        'Input B': { main: [[to('Compare', 1)]] },
        Compare: { main: [[to('Only A')], [to('Same')], [to('Different')], [to('Only B')]] },
      },
      pinData: {
        'Input A': [
          { json: { id: 1, value: 'same' } },
          { json: { id: 2, value: 'before' } },
          { json: { id: 3, value: 'left' } },
        ],
        'Input B': [
          { json: { id: 1, value: 'same' } },
          { json: { id: 2, value: 'after' } },
          { json: { id: 4, value: 'right' } },
        ],
      },
    });

    const run = await new WorkflowExecute(new NodeLoader(builtinNodeManifest)).run(wf);
    expect(run.status).toBe('success');
    const runData = run.data.resultData.runData;
    expect(runData['Compare']).toHaveLength(1);
    expect(runData['Only A']![0]!.data!['main']![0]!.map((item) => item.json)).toEqual([{ id: 3, value: 'left' }]);
    expect(runData['Same']![0]!.data!['main']![0]!.map((item) => item.json)).toEqual([{ id: 1, value: 'same' }]);
    expect(runData['Different']![0]!.data!['main']![0]!.map((item) => item.json)).toEqual([
      { inputA: { id: 2, value: 'before' }, inputB: { id: 2, value: 'after' } },
    ]);
    expect(runData['Only B']![0]!.data!['main']![0]!.map((item) => item.json)).toEqual([{ id: 4, value: 'right' }]);
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

  it('items → JSON 文件 → 磁盘写读 → items 二进制全回环', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nomops-file-engine-'));
    process.env['NOMOPS_FILES_ROOT'] = root;
    try {
      const wf = new Workflow({
        name: 'integration-file-roundtrip',
        nodes: [
          node('Start', 'nomops.manualTrigger'),
          node('Seed', 'nomops.code', { code: 'return [{ json: { id: 1, name: "一" } }, { json: { id: 2, name: "二" } }];' }),
          node('Convert', 'nomops.convertToFile', { operation: 'json', fileName: 'items.json', binaryPropertyName: 'data' }),
          node('Write', 'nomops.readWriteFile', { operation: 'write', filePath: 'roundtrip/items.json', binaryPropertyName: 'data' }),
          node('Read', 'nomops.readWriteFile', { operation: 'read', filePath: 'roundtrip/items.json', binaryPropertyName: 'data' }),
          node('Extract', 'nomops.extractFromFile', { operation: 'json', binaryPropertyName: 'data' }),
        ],
        connections: {
          Start: { main: [[to('Seed')]] },
          Seed: { main: [[to('Convert')]] },
          Convert: { main: [[to('Write')]] },
          Write: { main: [[to('Read')]] },
          Read: { main: [[to('Extract')]] },
        },
      });
      const store = new InMemoryBinaryStore();
      const run = await new WorkflowExecute(new NodeLoader(builtinNodeManifest), { additionalData: { binaryStore: store } }).run(wf);
      expect(run.status).toBe('success');
      expect(run.data.resultData.runData['Extract']![0]!.data!['main']![0]!.map((item) => item.json)).toEqual([
        { id: 1, name: '一' },
        { id: 2, name: '二' },
      ]);
      expect(() => JSON.stringify(run.data)).not.toThrow();
    } finally {
      delete process.env['NOMOPS_FILES_ROOT'];
      await rm(root, { recursive: true, force: true });
    }
  });
});
