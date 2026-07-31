import type { INodeTypeDescription } from '@nomops/workflow';

export const respondToWebhookDescription: INodeTypeDescription = {
  displayName: 'Respond to Webhook',
  name: 'respondToWebhook',
  group: ['transform'],
  categories: ['core'],
  version: 1,
  description: 'Set the HTTP response the Webhook trigger returns to the caller',
  defaults: { name: 'Respond to Webhook' },
  inputs: ['main'],
  outputs: ['main'],
  properties: [
    {
      displayName: 'Respond With',
      name: 'respondWith',
      type: 'options',
      default: 'firstIncomingItem',
      options: [
        { name: 'First Incoming Item', value: 'firstIncomingItem' },
        { name: 'JSON', value: 'json' },
        { name: 'Text', value: 'text' },
        { name: 'No Data', value: 'noData' },
      ],
    },
    {
      displayName: 'Response Body',
      name: 'responseBody',
      type: 'string',
      default: '',
      typeOptions: { rows: 4 },
      description: 'JSON document or plain text to return',
      displayOptions: { show: { respondWith: ['json', 'text'] } },
    },
    {
      displayName: 'Response Code',
      name: 'responseCode',
      type: 'number',
      default: 200,
    },
  ],
};
