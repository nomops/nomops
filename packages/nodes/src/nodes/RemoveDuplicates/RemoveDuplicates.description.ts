import type { INodeTypeDescription } from '@nomops/workflow';

export const removeDuplicatesDescription: INodeTypeDescription = {
  displayName: 'Remove Duplicates',
  name: 'removeDuplicates',
  group: ['transform'],
  categories: ['dataTransformation'],
  aliases: ['deduplicate', 'unique items'],
  version: 1,
  description: 'Delete items with matching field values',
  defaults: { name: 'Remove Duplicates' },
  inputs: ['main'],
  outputs: ['main'],
  properties: [
    {
      displayName: 'Compare',
      name: 'compare',
      type: 'options',
      default: 'allFields',
      options: [
        { name: 'All Fields', value: 'allFields' },
        { name: 'Selected Fields', value: 'selectedFields' },
        { name: 'All Fields Except', value: 'allFieldsExcept' },
      ],
    },
    {
      displayName: 'Fields',
      name: 'fields',
      type: 'string',
      default: '',
      placeholder: 'email, profile.id',
      description: 'Comma-separated fields to include or exclude from comparison',
      displayOptions: { hide: { compare: ['allFields'] } },
    },
    {
      displayName: 'Keep',
      name: 'keep',
      type: 'options',
      default: 'first',
      options: [
        { name: 'First Duplicate', value: 'first' },
        { name: 'Last Duplicate', value: 'last' },
      ],
    },
  ],
};
