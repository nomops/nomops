import type { INodeTypeDescription } from '@nomops/workflow';

export const httpRequestDescription: INodeTypeDescription = {
  displayName: 'HTTP Request',
  name: 'httpRequest',
  group: ['output'],
  version: 1,
  description: 'Make an HTTP request, once per item',
  defaults: { name: 'HTTP Request' },
  inputs: ['main'],
  outputs: ['main'],
  properties: [
    {
      displayName: 'URL',
      name: 'url',
      type: 'string',
      default: '',
      required: true,
      placeholder: 'https://api.example.com/…',
    },
    {
      displayName: 'Method',
      name: 'method',
      type: 'options',
      default: 'GET',
      options: [
        { name: 'GET', value: 'GET' },
        { name: 'POST', value: 'POST' },
        { name: 'PUT', value: 'PUT' },
        { name: 'PATCH', value: 'PATCH' },
        { name: 'DELETE', value: 'DELETE' },
      ],
    },
    {
      displayName: 'Headers',
      name: 'headers',
      type: 'json',
      default: {},
    },
    {
      displayName: 'Body',
      name: 'body',
      type: 'json',
      default: {},
      displayOptions: { hide: { method: ['GET'] } },
    },
  ],
};
