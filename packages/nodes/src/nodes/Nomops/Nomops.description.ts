import type { IDisplayOptions, INodeProperties, INodeTypeDescription } from '@nomops/workflow';

const forOperation = (resource: 'workflow' | 'execution', operations: string[]): IDisplayOptions => ({
  show: { resource: [resource], operation: operations },
});

const resourceId = (resource: 'workflow' | 'execution', operations: string[]): INodeProperties => ({
  displayName: resource === 'workflow' ? 'Workflow ID' : 'Execution ID',
  name: 'resourceId',
  type: 'string',
  default: '',
  required: true,
  description: `ID of the ${resource} in the current project`,
  displayOptions: forOperation(resource, operations),
});

export const nomopsDescription: INodeTypeDescription = {
  displayName: 'Nomops',
  name: 'nomops',
  group: ['input', 'transform'],
  categories: ['core'],
  aliases: ['self API', 'instance API', 'workflow API', 'execution API'],
  version: 1,
  description: 'Read and operate workflows or executions on this Nomops instance',
  defaults: { name: 'Nomops' },
  inputs: ['main'],
  outputs: ['main'],
  credentials: [{ name: 'nomopsApi', required: true }],
  properties: [
    {
      displayName: 'This node only calls the current Nomops instance. Access is limited by the selected API key, its scopes, and the current project role.',
      name: 'securityNotice',
      type: 'notice',
      default: '',
    },
    {
      displayName: 'Resource',
      name: 'resource',
      type: 'options',
      default: 'workflow',
      noDataExpression: true,
      options: [
        { name: 'Workflow', value: 'workflow' },
        { name: 'Execution', value: 'execution' },
      ],
    },
    {
      displayName: 'Operation',
      name: 'operation',
      type: 'options',
      default: 'list',
      noDataExpression: true,
      displayOptions: { show: { resource: ['workflow'] } },
      options: [
        { name: 'Activate', value: 'activate', description: 'Activate a workflow in the current project' },
        { name: 'Deactivate', value: 'deactivate', description: 'Deactivate a workflow in the current project' },
        { name: 'Get', value: 'get', description: 'Get one workflow' },
        { name: 'List', value: 'list', description: 'List workflows in the current project' },
      ],
    },
    resourceId('workflow', ['get', 'activate', 'deactivate']),
    {
      displayName: 'Operation',
      name: 'operation',
      type: 'options',
      default: 'list',
      noDataExpression: true,
      displayOptions: { show: { resource: ['execution'] } },
      options: [
        { name: 'Get', value: 'get', description: 'Get one execution' },
        { name: 'List', value: 'list', description: 'List executions in the current project' },
        { name: 'Retry', value: 'retry', description: 'Retry an execution' },
        { name: 'Stop', value: 'stop', description: 'Stop a running or waiting execution' },
      ],
    },
    resourceId('execution', ['get', 'retry', 'stop']),
    {
      displayName: 'Use Original Workflow',
      name: 'useOriginal',
      type: 'boolean',
      default: false,
      description: 'Whether to retry using the workflow snapshot stored with the original execution',
      displayOptions: forOperation('execution', ['retry']),
    },
    {
      displayName: 'Return All',
      name: 'returnAll',
      type: 'boolean',
      default: true,
      displayOptions: { show: { operation: ['list'] } },
    },
    {
      displayName: 'Limit',
      name: 'limit',
      type: 'number',
      default: 50,
      typeOptions: { minValue: 1, maxValue: 500 },
      displayOptions: { show: { operation: ['list'], returnAll: [false] } },
    },
  ],
};
