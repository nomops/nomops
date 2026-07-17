import type { INodeTypeDescription } from '@nomops/workflow';

export const pollingTriggerDescription: INodeTypeDescription = {
  displayName: 'Polling Trigger',
  name: 'pollingTrigger',
  group: ['trigger'],
  version: 1,
  description: 'Poll an HTTP endpoint on an interval and fire only for new items',
  defaults: { name: 'Polling Trigger' },
  inputs: [],
  outputs: ['main'],
  polling: true,
  properties: [
    {
      displayName: 'URL',
      name: 'url',
      type: 'string',
      default: '',
      required: true,
      placeholder: 'https://api.example.com/items',
      description: 'Endpoint to poll',
    },
    {
      displayName: 'Items Path',
      name: 'itemsPath',
      type: 'string',
      default: '',
      placeholder: 'data.items',
      description: 'Dot path to the array in the response; empty = response itself is the array',
    },
    {
      displayName: 'ID Field',
      name: 'idField',
      type: 'string',
      default: 'id',
      description: 'Field that uniquely identifies an item (used to skip items already seen)',
    },
    {
      displayName: 'Poll Interval (Seconds)',
      name: 'pollInterval',
      type: 'number',
      default: 60,
      description: 'How often to check for new items',
    },
  ],
};
