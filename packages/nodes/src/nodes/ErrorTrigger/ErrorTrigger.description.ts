import type { INodeTypeDescription } from '@nomops/workflow';

export const errorTriggerDescription: INodeTypeDescription = {
  displayName: 'Error Trigger',
  name: 'errorTrigger',
  group: ['trigger'],
  categories: ['trigger'],
  subcategories: ['Other Triggers'],
  version: 1,
  description: 'Start this workflow when another workflow (whose settings point here) fails',
  defaults: { name: 'Error Trigger' },
  inputs: [],
  outputs: ['main'],
  properties: [],
};
