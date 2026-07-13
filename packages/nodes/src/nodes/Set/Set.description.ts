import type { INodeTypeDescription } from '@nomops/workflow';

export const setDescription: INodeTypeDescription = {
  displayName: 'Set',
  name: 'set',
  group: ['transform'],
  version: 1,
  description: 'Set or merge fields on each item',
  defaults: { name: 'Set' },
  inputs: ['main'],
  outputs: ['main'],
  properties: [
    {
      displayName: 'Fields',
      name: 'fields',
      type: 'collection',
      default: {},
      description: 'Fields to merge into each item',
    },
  ],
};
