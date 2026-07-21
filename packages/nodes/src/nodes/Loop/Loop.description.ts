import type { INodeTypeDescription } from '@nomops/workflow';

export const loopDescription: INodeTypeDescription = {
  displayName: 'Loop Over Items',
  name: 'loop',
  group: ['transform'],
  version: 1,
  description: 'Process items in batches — wire the loop branch back into this node to iterate',
  defaults: { name: 'Loop Over Items' },
  inputs: ['main'],
  outputs: ['main', 'main'], // 输出0 = done（全部批次完成后的汇总），输出1 = loop（当前批次）
  outputNames: ['done', 'loop'],
  properties: [
    {
      displayName: 'Batch Size',
      name: 'batchSize',
      type: 'number',
      default: 1,
      description: 'How many items to send down the loop branch per iteration',
    },
  ],
};
