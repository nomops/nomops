import { describe, expect, it } from 'vitest';
import type { IExecuteContext, INodeExecutionData } from '@nomops/workflow';
import { SetMetadata, META_KEY } from '../SetMetadata/SetMetadata.node.js';

/** backlog #35b：Set Metadata 节点把 KV 合并进 item.json 保留键,值统一转字符串。 */
function ctx(items: INodeExecutionData[], params: Record<string, unknown>): IExecuteContext {
  return {
    getInputData: () => items,
    getNodeParameter: (name: string, _i: number, fallback?: unknown) => (name in params ? params[name] : fallback),
  } as unknown as IExecuteContext;
}

describe('Set Metadata 节点（backlog #35b）', () => {
  it('把 metadata KV 挂到 _nmMetadata，透传 json，值转字符串', async () => {
    const out = await new SetMetadata().execute!.call(
      ctx([{ json: { a: 1 } }], { metadata: { customerId: 'c-42', count: 7, flag: true } }),
    );
    const item = out[0]![0]!;
    expect(item.json['a']).toBe(1); // 原字段透传
    expect(item.json[META_KEY]).toEqual({ customerId: 'c-42', count: '7', flag: 'true' });
    expect(item.pairedItem).toEqual({ item: 0 });
  });

  it('合并已存在的 _nmMetadata（跨节点累积）', async () => {
    const out = await new SetMetadata().execute!.call(
      ctx([{ json: { [META_KEY]: { first: 'x' } } }], { metadata: { second: 'y' } }),
    );
    expect(out[0]![0]!.json[META_KEY]).toEqual({ first: 'x', second: 'y' });
  });

  it('空 metadata → 保留键为空对象，不报错', async () => {
    const out = await new SetMetadata().execute!.call(ctx([{ json: {} }], {}));
    expect(out[0]![0]!.json[META_KEY]).toEqual({});
  });
});
