import type { INodeTypeDescription } from '@nomops/workflow';

export const limitDescription: INodeTypeDescription = {
  displayName: 'Limit',
  name: 'limit',
  group: ['transform'],
  categories: ['dataTransformation'],
  aliases: ['take items', 'truncate'],
  version: 1,
  description: 'Restrict the number of items',
  defaults: { name: 'Limit' },
  inputs: ['main'],
  outputs: ['main'],
  properties: [
    {
      displayName: 'Max Items',
      name: 'maxItems',
      type: 'number',
      default: 1,
      required: true,
      description: 'Maximum number of items to keep',
    },
    {
      displayName: 'Keep',
      name: 'keep',
      type: 'options',
      default: 'firstItems',
      options: [
        { name: 'First Items', value: 'firstItems' },
        { name: 'Last Items', value: 'lastItems' },
      ],
    },
  ],
};
