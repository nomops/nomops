import type { INodeTypeDescription } from '@nomops/workflow';

export const filterDescription: INodeTypeDescription = {
  displayName: 'Filter',
  name: 'filter',
  group: ['transform'],
  version: 1,
  description: 'Keep only the items matching the conditions; the rest are discarded',
  defaults: { name: 'Filter' },
  inputs: ['main'],
  outputs: ['main'],
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
