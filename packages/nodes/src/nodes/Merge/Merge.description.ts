import type { INodeTypeDescription } from '@nomops/workflow';

export const mergeDescription: INodeTypeDescription = {
  displayName: 'Merge',
  name: 'merge',
  group: ['transform'],
  version: 1,
  description: 'Wait for both inputs, then merge them',
  defaults: { name: 'Merge' },
  inputs: ['main', 'main'],
  outputs: ['main'],
  properties: [
    {
      displayName: 'Mode',
      name: 'mode',
      type: 'options',
      default: 'append',
      options: [
        { name: 'Append', value: 'append' },
        { name: 'Combine by position', value: 'combineByPosition' },
      ],
    },
  ],
};
