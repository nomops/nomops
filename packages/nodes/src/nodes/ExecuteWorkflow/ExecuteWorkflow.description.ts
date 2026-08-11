import type { INodeTypeDescription } from '@nomops/workflow';

export const executeWorkflowDescription: INodeTypeDescription = {
  displayName: 'Execute Workflow',
  name: 'executeWorkflow',
  group: ['transform'],
  categories: ['flow', 'core'],
  aliases: ['execute sub-workflow', 'sub-workflow', 'call workflow'],
  version: 1,
  description: 'Execute another workflow',
  defaults: { name: 'Execute Workflow' },
  inputs: ['main'],
  outputs: ['main'],
  properties: [
    {
      displayName: 'Source', name: 'source', type: 'options', default: 'database',
      options: [
        { name: 'Database', value: 'database', description: 'Load the workflow from the database by ID' },
        { name: 'Define Below', value: 'parameter', description: 'Pass the JSON code of a workflow' },
      ],
    },
    {
      displayName: 'Workflow', name: 'workflowId', type: 'resourceLocator',
      default: { mode: 'list', value: '' }, required: true,
      modes: [
        { displayName: 'From list', name: 'list', placeholder: 'Choose...' },
        { displayName: 'By URL', name: 'url', placeholder: 'http://localhost:5678/workflow/...' },
        { displayName: 'By ID', name: 'id', placeholder: 'Workflow ID' },
      ],
      displayOptions: { show: { source: ['database'] } },
    },
    {
      displayName: 'Workflow JSON', name: 'workflowJson', type: 'json', default: '{}',
      typeOptions: { rows: 10, editor: 'code' },
      displayOptions: { show: { source: ['parameter'] } },
    },
    {
      displayName: 'Mode', name: 'mode', type: 'options', default: 'once',
      options: [
        { name: 'Run once with all items', value: 'once', description: 'Pass all items into a single execution of the sub-workflow' },
        { name: 'Run once for each item', value: 'each', description: 'Call the sub-workflow individually for each item' },
      ],
    },
    {
      displayName: 'Options', name: 'options', type: 'collection', default: {}, options: [{
        name: 'Wait For Sub-Workflow Completion', value: 'waitForSubWorkflow', values: [{
          displayName: 'Wait For Sub-Workflow Completion', name: 'waitForSubWorkflow', type: 'boolean', default: true,
        }],
      }],
    },
  ],
};
