import type { IExecuteContext, INodeExecutionData, INodeType } from '@nomops/workflow';
import { OperationalError } from '@nomops/workflow';
import { getPath } from '../../lib/object-path.js';
import { parseFieldList, stableStringify, withoutPaths } from '../../lib/data-transform.js';
import { compareDatasetsDescription } from './CompareDatasets.description.js';

interface IMatchField {
  fieldA?: unknown;
  fieldB?: unknown;
}

function matchKey(item: INodeExecutionData, fields: IMatchField[], side: 'A' | 'B'): string {
  return stableStringify(fields.map((field) => getPath(item.json, String(side === 'A' ? field.fieldA : field.fieldB))));
}

export class CompareDatasets implements INodeType {
  description = compareDatasetsDescription;

  async execute(this: IExecuteContext): Promise<INodeExecutionData[][]> {
    const inputA = this.getInputData(0);
    const inputB = this.getInputData(1);
    const configured = this.getNodeParameter('matchFields', 0, { values: [] }) as { values?: IMatchField[] };
    const matchFields = configured.values ?? [];
    if (
      matchFields.length === 0
      || matchFields.some(({ fieldA, fieldB }) => !String(fieldA ?? '').trim() || !String(fieldB ?? '').trim())
    ) {
      throw new OperationalError('Compare Datasets: add at least one complete field pair', {});
    }
    const skipFields = parseFieldList(this.getNodeParameter('skipFields', 0, ''));
    const rightByKey = new Map<string, number[]>();
    inputB.forEach((item, index) => {
      const key = matchKey(item, matchFields, 'B');
      rightByKey.set(key, [...(rightByKey.get(key) ?? []), index]);
    });

    const onlyA: INodeExecutionData[] = [];
    const same: INodeExecutionData[] = [];
    const different: INodeExecutionData[] = [];
    const usedRight = new Set<number>();
    inputA.forEach((left, leftIndex) => {
      const candidates = rightByKey.get(matchKey(left, matchFields, 'A')) ?? [];
      const rightIndex = candidates.find((index) => !usedRight.has(index));
      if (rightIndex === undefined) {
        onlyA.push({ ...left, pairedItem: { item: leftIndex, input: 0 } });
        return;
      }
      usedRight.add(rightIndex);
      const right = inputB[rightIndex]!;
      const pairedItem = [{ item: leftIndex, input: 0 }, { item: rightIndex, input: 1 }];
      if (stableStringify(withoutPaths(left.json, skipFields)) === stableStringify(withoutPaths(right.json, skipFields))) {
        same.push({ json: left.json, pairedItem });
      } else {
        different.push({ json: { inputA: left.json, inputB: right.json }, pairedItem });
      }
    });

    const onlyB = inputB.flatMap((item, index) => usedRight.has(index)
      ? []
      : [{ ...item, pairedItem: { item: index, input: 1 } }]);
    return [onlyA, same, different, onlyB];
  }
}
