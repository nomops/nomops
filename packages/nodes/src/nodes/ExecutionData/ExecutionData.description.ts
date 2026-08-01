import type { INodeTypeDescription } from '@nomops/workflow';

export const executionDataDescription: INodeTypeDescription = {
  displayName: 'Execution Data',
  name: 'executionData',
  group: ['transform'],
  categories: ['core', 'dataTransformation'],
  aliases: ['metadata', 'custom data', 'execution metadata'],
  version: 1,
  description: 'Read or write searchable key/value metadata for this execution',
  defaults: { name: 'Execution Data' },
  inputs: ['main'],
  outputs: ['main'],
  properties: [
    {
      displayName: 'Operation',
      name: 'operation',
      type: 'options',
      default: 'set',
      noDataExpression: true,
      options: [
        { name: 'Get All', value: 'getAll' },
        { name: 'Get One', value: 'get' },
        { name: 'Set', value: 'set' },
      ],
    },
    {
      displayName: 'Metadata',
      name: 'metadata',
      type: 'assignmentCollection',
      default: {},
      displayOptions: { show: { operation: ['set'] } },
      description: 'Values are stored as strings and shown in execution details',
    },
    {
      displayName: 'Key',
      name: 'key',
      type: 'string',
      default: '',
      required: true,
      displayOptions: { show: { operation: ['get'] } },
    },
    {
      displayName: 'Put Result in Field',
      name: 'outputField',
      type: 'string',
      default: 'executionData',
      required: true,
      displayOptions: { show: { operation: ['get', 'getAll'] } },
    },
  ],
};
