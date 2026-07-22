import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { IExecuteContext, ILoadableNodeType, INodeType, INodeExecutionData } from '@nomops/workflow';
import { Workflow } from '@nomops/workflow';
import { NodeLoader } from '../nodes-loader/node-loader.js';
import { WorkflowExecute } from '../execution-engine/workflow-execute.js';
import { FileSystemBinaryStore, InMemoryBinaryStore } from './binary-store.js';

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'nomops-bin-'));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('binary store', () => {
  it('文件系统存取往返；引用轻量可序列化（铁律 4）', async () => {
    const store = new FileSystemBinaryStore(dir);
    const payload = Buffer.from('hello nomops binary');
    const ref = await store.put(payload, { mimeType: 'text/plain', fileName: 'a.txt' });

    expect(ref.id).toBeTruthy();
    expect(ref.data).toBeUndefined(); // 引用形态不内嵌字节
    expect(ref.fileSize).toBe(payload.byteLength);
    expect(() => JSON.stringify(ref)).not.toThrow();

    const back = await store.get(ref.id!);
    expect(Buffer.from(back).toString()).toBe('hello nomops binary');
    await expect(store.get('not-a-valid-uuid')).rejects.toThrow();
  });

  it('引擎 helpers：有 store 落引用；无 store 退化内联 base64', async () => {
    const binNode = (name: string): ILoadableNodeType => {
      const description = {
        displayName: name, name, group: ['transform'], version: 1, description: '',
        defaults: { name }, inputs: ['main'], outputs: ['main'], properties: [],
      };
      return {
        type: name,
        description,
        load: async () =>
          class implements INodeType {
            description = description;
            async execute(this: IExecuteContext): Promise<INodeExecutionData[][]> {
              const binary = await this.helpers.bufferToBinary(Buffer.from('BYTES'), { mimeType: 'text/plain' });
              const round = await this.helpers.binaryToBuffer(binary);
              return [[{ json: { roundtrip: Buffer.from(round).toString(), hasId: Boolean(binary.id) }, binary: { file: binary } }]];
            }
          },
      };
    };

    const wf = new Workflow({
      name: 'bin',
      nodes: [{ id: 'a', name: 'B', type: 't.bin', typeVersion: 1, position: [0, 0], parameters: {} }],
      connections: {},
    });

    // 有 store：引用形态
    const withStore = await new WorkflowExecute(new NodeLoader([binNode('t.bin')]), {
      additionalData: { binaryStore: new InMemoryBinaryStore() },
    }).run(wf);
    const item = withStore.data.resultData.runData['B']![0]!.data!['main']![0]![0]!;
    expect(item.json['roundtrip']).toBe('BYTES');
    expect(item.json['hasId']).toBe(true);
    expect(item.binary!['file']!.data).toBeUndefined();

    // 无 store：内联退化
    const inline = await new WorkflowExecute(new NodeLoader([binNode('t.bin')])).run(wf);
    const inlineItem = inline.data.resultData.runData['B']![0]!.data!['main']![0]![0]!;
    expect(inlineItem.json['roundtrip']).toBe('BYTES');
    expect(inlineItem.json['hasId']).toBe(false);
    expect(inlineItem.binary!['file']!.data).toBe(Buffer.from('BYTES').toString('base64'));
  });
});

describe('collectBinaryIds（#22 引用扫描）', () => {
  const id1 = '11111111-1111-4111-8111-111111111111';
  const id2 = '22222222-2222-4222-8222-222222222222';

  it('深扫执行数据里的所有 IBinaryData 引用;区别于普通业务 id', async () => {
    const { collectBinaryIds } = await import('./binary-store.js');
    const item1 = { json: { userId: 'not-a-binary' }, binary: { file: { id: id1, mimeType: 'application/pdf', fileName: 'a.pdf' } } };
    const item2 = { json: { id: 'plain-id-no-mime' }, binary: { img: { id: id2, mimeType: 'image/png' } } };
    const data = { resultData: { runData: { A: [{ data: { main: [[item1]] } }], B: [{ data: { main: [[item2]] } }] } } };

    const ids = collectBinaryIds(data);
    expect([...ids].sort()).toEqual([id1, id2].sort());
    expect(ids.has('plain-id-no-mime')).toBe(false); // 无 mimeType/非 uuid → 不当作 binary
  });

  it('空/无引用 → 空集', async () => {
    const { collectBinaryIds } = await import('./binary-store.js');
    expect(collectBinaryIds(null).size).toBe(0);
    expect(collectBinaryIds({ a: 1, b: [{ c: 'x' }] }).size).toBe(0);
  });
});
