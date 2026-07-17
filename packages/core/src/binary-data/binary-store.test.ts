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
