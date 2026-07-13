import type { INodeTypeDescription } from '@nomops/workflow';

export const ifDescription: INodeTypeDescription = {
  displayName: 'IF',
  name: 'if',
  group: ['transform'],
  version: 1,
  description: 'Route items to the true / false output by condition',
  defaults: { name: 'IF' },
  inputs: ['main'],
  outputs: ['main', 'main'], // 输出0 = true，输出1 = false
  properties: [
    {
      displayName: 'Conditions',
      name: 'conditions',
      type: 'collection',
      default: [],
      description: 'List of conditions [{ left, op, right }]; left/right support expressions',
    },
    {
      displayName: 'Combine',
      name: 'combine',
      type: 'options',
      default: 'and',
      options: [
        { name: 'AND (all match)', value: 'and' },
        { name: 'OR (any match)', value: 'or' },
      ],
    },
  ],
};
