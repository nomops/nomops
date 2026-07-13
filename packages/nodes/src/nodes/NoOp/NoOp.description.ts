import type { INodeTypeDescription } from '@nomops/workflow';

export const noOpDescription: INodeTypeDescription = {
  displayName: 'No Operation',
  name: 'noOp',
  group: ['transform'],
  version: 1,
  description: 'Pass input through unchanged (placeholder / debugging)',
  defaults: { name: 'No Operation' },
  inputs: ['main'],
  outputs: ['main'],
  properties: [],
};
