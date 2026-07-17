import type { INodeExecutionData, INodeType, IPollContext, JsonObject } from '@nomops/workflow';
import { OperationalError } from '@nomops/workflow';
import { pollingTriggerDescription } from './PollingTrigger.description.js';

/** 按点分路径取值（'data.items' → response.data.items）。 */
function digPath(value: unknown, path: string): unknown {
  if (!path) return value;
  let current: unknown = value;
  for (const segment of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/**
 * 轮询触发器：拉取 HTTP 端点 → 提取 items 数组 → 用 filterNewKeys 去重 →
 * 只把首次出现的 items 吐给调度器（无新数据返回 null，不触发执行）。
 */
export class PollingTrigger implements INodeType {
  description = pollingTriggerDescription;

  async poll(this: IPollContext): Promise<INodeExecutionData[][] | null> {
    const url = String(this.getNodeParameter('url') ?? '');
    if (!url) throw new OperationalError('Polling Trigger is missing the URL parameter');
    const itemsPath = String(this.getNodeParameter('itemsPath') ?? '');
    const idField = String(this.getNodeParameter('idField') ?? 'id');

    const response = await this.helpers.httpRequest({ url, method: 'GET' });
    const raw = digPath(response, itemsPath);
    if (!Array.isArray(raw)) {
      throw new OperationalError(
        `Polling response has no array at path "${itemsPath || '(root)'}"`,
      );
    }

    const items = raw.filter((it): it is JsonObject => it !== null && typeof it === 'object');
    const keyOf = (it: JsonObject) => String(it[idField] ?? JSON.stringify(it));
    const freshKeys = new Set(await this.helpers.filterNewKeys(items.map(keyOf)));
    const freshItems = items.filter((it) => freshKeys.has(keyOf(it)));

    if (freshItems.length === 0) return null;
    return [freshItems.map((json) => ({ json }))];
  }
}
