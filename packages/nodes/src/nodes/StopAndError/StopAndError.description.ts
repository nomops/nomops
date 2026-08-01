import type { INodeTypeDescription } from '@nomops/workflow';

export const stopAndErrorDescription: INodeTypeDescription = {
  displayName: 'Stop and Error',
  name: 'stopAndError',
  group: ['output'],
  categories: ['flow'],
  aliases: ['throw', 'fail', 'terminate', 'error'],
  version: 1,
  description: 'Stop the workflow and report a controlled error',
  defaults: { name: 'Stop and Error' },
  inputs: ['main'],
  outputs: [],
  properties: [
    {
      displayName: 'Error Message',
      name: 'errorMessage',
      type: 'string',
      default: 'Workflow stopped with an error',
      required: true,
      typeOptions: { rows: 3 },
    },
    {
      displayName: 'Error Description',
      name: 'errorDescription',
      type: 'string',
      default: '',
      typeOptions: { rows: 3 },
    },
  ],
};
