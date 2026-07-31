import type { INodeTypeDescription } from '@nomops/workflow';

export const setDescription: INodeTypeDescription = {
  displayName: 'Set',
  name: 'set',
  group: ['transform'],
  categories: ['dataTransformation'],
  aliases: ['edit fields', 'assign'],
  version: 1,
  description: 'Set or merge fields on each item',
  defaults: { name: 'Set' },
  inputs: ['main'],
  outputs: ['main'],
  properties: [
    {
      displayName: 'Fields',
      name: 'fields',
      type: 'assignmentCollection',
      default: {},
      description: 'Fields to merge into each item',
    },
  ],
};
