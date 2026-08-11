import type { INodeTypeDescription } from '@nomops/workflow';

export const setDescription: INodeTypeDescription = {
  displayName: 'Edit Fields (Set)',
  name: 'set',
  group: ['transform'],
  categories: ['dataTransformation'],
  aliases: ['edit fields', 'assign'],
  version: 1,
  description: 'Modify, add, or remove item fields',
  defaults: { name: 'Edit Fields' },
  inputs: ['main'],
  outputs: ['main'],
  properties: [
    {
      displayName: 'Mode',
      name: 'mode',
      type: 'options',
      default: 'manual',
      options: [{ name: 'Manual Mapping', value: 'manual' }, { name: 'JSON Output', value: 'raw' }],
      noDataExpression: true,
    },
    {
      displayName: 'Fields to Set',
      name: 'fields',
      type: 'assignmentCollection',
      default: {},
      displayOptions: { show: { mode: ['manual'] } },
    },
    { displayName: 'JSON Output', name: 'jsonOutput', type: 'json', default: {}, displayOptions: { show: { mode: ['raw'] } } },
    { displayName: 'Include Other Input Fields', name: 'includeOtherFields', type: 'boolean', default: true },
    { displayName: 'Options', name: 'options', type: 'collection', default: {}, options: [{
      name: 'Support Dot Notation', value: 'dotNotation', values: [{
        displayName: 'Support Dot Notation', name: 'dotNotation', type: 'boolean', default: true,
        description: 'Treat dots in field names as paths to nested objects',
      }],
    }] },
  ],
};
