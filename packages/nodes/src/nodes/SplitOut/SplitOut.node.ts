import type { IExecuteContext, INodeExecutionData, INodeType, JsonObject } from '@nomops/workflow';
import { OperationalError } from '@nomops/workflow';
import { getPath } from '../../lib/object-path.js';
import { splitOutDescription } from './SplitOut.description.js';

const isPlainObject = (v: unknown): v is JsonObject =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

/** 把 item 里的数组字段拆成逐元素的独立 item（对标基线 Split Out 语义子集）。 */
export class SplitOut implements INodeType {
  description = splitOutDescription;

  async execute(this: IExecuteContext): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const out: INodeExecutionData[] = [];

    for (const [i, item] of items.entries()) {
      const path = String(this.getNodeParameter('fieldToSplitOut', i, '') ?? '').trim();
      if (!path) throw new OperationalError('Split Out: "Field To Split Out" is required', {});
      const include = (this.getNodeParameter('include', i, 'noOtherFields') ?? 'noOtherFields') as string;
      const destParam = String(this.getNodeParameter('destinationFieldName', i, '') ?? '').trim();
      const leaf = path.split('.').at(-1)!;

      const raw = getPath(item.json, path);
      if (raw === undefined || raw === null) continue; // 无该字段的 item 跳过（不视为错误）
      const elements = Array.isArray(raw) ? raw : [raw]; // 单个对象按一元素列表处理

      for (const el of elements) {
        let json: JsonObject;
        if (include === 'allOtherFields') {
          json = { ...(item.json as JsonObject) };
          // 摘掉被拆字段本身（仅顶层键可摘;深路径保留原结构）
          if (!path.includes('.')) delete json[path];
          if (isPlainObject(el) && !destParam) Object.assign(json, el);
          else json[destParam || leaf] = el as JsonObject[keyof JsonObject];
        } else if (isPlainObject(el) && !destParam) {
          json = el;
        } else {
          json = { [destParam || leaf]: el as JsonObject[keyof JsonObject] };
        }
        out.push({ json, pairedItem: { item: i } });
      }
    }

    return [out];
  }
}
