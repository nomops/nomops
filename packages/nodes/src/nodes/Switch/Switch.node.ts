import type { IExecuteContext, INodeExecutionData, INodeType } from '@nomops/workflow';
import { OperationalError } from '@nomops/workflow';
import { compareCondition, type ICondition } from '../../lib/conditions.js';
import { switchDescription } from './Switch.description.js';

const OUTPUT_COUNT = 4;

/** 多路分流：规则 i 命中 → 输出 i（首中即停）；全不中走 fallbackOutput（默认丢弃）。 */
export class Switch implements INodeType {
  description = switchDescription;

  async execute(this: IExecuteContext): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const outputs: INodeExecutionData[][] = Array.from({ length: OUTPUT_COUNT }, () => []);

    for (const [i, item] of items.entries()) {
      const rules = (this.getNodeParameter('rules', i, []) ?? []) as ICondition[];
      if (rules.length > OUTPUT_COUNT) {
        throw new OperationalError(`Switch supports at most ${OUTPUT_COUNT} rules (one per output)`, {
          rules: rules.length,
        });
      }
      const fallback = String(this.getNodeParameter('fallbackOutput', i, 'none') ?? 'none');

      const hit = rules.findIndex(compareCondition);
      if (hit >= 0) {
        outputs[hit]!.push({ json: item.json, pairedItem: { item: i } });
      } else if (fallback !== 'none') {
        const idx = Number(fallback);
        if (!Number.isInteger(idx) || idx < 0 || idx >= OUTPUT_COUNT) {
          throw new OperationalError(`Switch: invalid fallback output "${fallback}"`, { fallback });
        }
        outputs[idx]!.push({ json: item.json, pairedItem: { item: i } });
      }
    }

    return outputs;
  }
}
