import type { INodeTypeDescription } from '@nomops/workflow';

export const codeDescription: INodeTypeDescription = {
  displayName: 'Code',
  name: 'code',
  group: ['transform'],
  version: 1,
  description: 'Run JavaScript over the items (return a new items array)',
  defaults: { name: 'Code' },
  inputs: ['main'],
  outputs: ['main'],
  properties: [
    {
      displayName: 'JavaScript',
      name: 'code',
      type: 'string',
      default: 'return items;',
      noDataExpression: true, // 代码本体不做 {{ }} 求值
      description: 'Has access to items (the input array); must return an items array',
    },
  ],
};
