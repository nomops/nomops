import type { INodeTypeDescription } from '@nomops/workflow';

export const executeWorkflowDescription: INodeTypeDescription = {
  displayName: 'Execute Workflow',
  name: 'executeWorkflow',
  group: ['transform'],
  version: 1,
  description: 'Run another workflow in the same project with the current items and return its final node output',
  defaults: { name: 'Execute Workflow' },
  inputs: ['main'],
  outputs: ['main'],
  properties: [
    {
      displayName: 'Workflow ID',
      name: 'workflowId',
      type: 'string',
      default: '',
      required: true,
      placeholder: 'ID of the sub-workflow (same project)',
      noDataExpression: true,
    },
  ],
};
