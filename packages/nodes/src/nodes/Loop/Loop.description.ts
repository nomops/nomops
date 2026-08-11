import type { INodeTypeDescription } from '@nomops/workflow';

export const loopDescription: INodeTypeDescription = {
  displayName: 'Loop Over Items',
  name: 'loop',
  group: ['transform'],
  categories: ['flow'],
  version: 1,
  description: 'Split data into batches and iterate over each batch',
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
    {
      displayName: 'Options',
      name: 'options',
      type: 'collection',
      default: {},
      options: [{
        name: 'Reset',
        value: 'reset',
        values: [{
          displayName: 'Reset',
          name: 'reset',
          type: 'boolean',
          default: false,
          description: 'Whether to treat the current input as a new loop',
        }],
      }],
    },
  ],
};
