import type { INodeTypeDescription } from '@nomops/workflow';

export const splitOutDescription: INodeTypeDescription = {
  displayName: 'Split Out',
  name: 'splitOut',
  group: ['transform'],
  categories: ['dataTransformation'],
  version: 1,
  description: 'Turn a list field inside each item into separate items',
  defaults: { name: 'Split Out' },
  inputs: ['main'],
  outputs: ['main'],
  properties: [
    {
      displayName: 'Field To Split Out',
      name: 'fieldToSplitOut',
      type: 'string',
      default: '',
      required: true,
      description: 'Dot path of the list field (e.g. data.items)',
    },
    {
      displayName: 'Include',
      name: 'include',
      type: 'options',
      default: 'noOtherFields',
      options: [
        { name: 'No Other Fields', value: 'noOtherFields' },
        { name: 'All Other Fields', value: 'allOtherFields' },
      ],
      description: 'Whether to copy the remaining fields of the source item onto each new item',
    },
    {
      displayName: 'Destination Field Name',
      name: 'destinationFieldName',
      type: 'string',
      default: '',
      description: 'Field to put each element under; empty = spread object elements / use the source field name',
    },
  ],
};
