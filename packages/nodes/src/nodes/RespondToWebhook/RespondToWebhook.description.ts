import type { INodeTypeDescription } from '@nomops/workflow';

export const respondToWebhookDescription: INodeTypeDescription = {
  displayName: 'Respond to Webhook',
  name: 'respondToWebhook',
  group: ['transform'],
  categories: ['core'],
  version: 1,
  description: 'Returns data for a Webhook',
  defaults: { name: 'Respond to Webhook' },
  inputs: ['main'],
  outputs: ['main'],
  credentials: [{ name: 'webhookJwtAuth', required: true, displayOptions: { show: { respondWith: ['jwt'] } } }],
  properties: [
    {
      displayName: 'Verify that the Webhook node Respond parameter is set to Using Respond to Webhook Node.',
      name: 'webhookNotice', type: 'notice', default: '', typeOptions: { noticeStyle: 'info' },
    },
    {
      displayName: 'Respond With', name: 'respondWith', type: 'options', default: 'firstIncomingItem',
      options: [
        { name: 'All Incoming Items', value: 'allIncomingItems', description: 'Respond with all input JSON items' },
        { name: 'Binary File', value: 'binary', description: 'Respond with incoming file binary data' },
        { name: 'First Incoming Item', value: 'firstIncomingItem', description: 'Respond with the first input JSON item' },
        { name: 'JSON', value: 'json', description: 'Respond with a custom JSON body' },
        { name: 'JWT Token', value: 'jwt', description: 'Respond with a JWT token' },
        { name: 'No Data', value: 'noData', description: 'Respond with an empty body' },
        { name: 'Redirect', value: 'redirect', description: 'Respond with a redirect to a given URL' },
        { name: 'Text', value: 'text', description: 'Respond with a simple text message body' },
      ],
    },
    {
      displayName: 'Response Data Source', name: 'responseDataSource', type: 'options', default: 'automatically',
      displayOptions: { show: { respondWith: ['binary'] } },
      options: [
        { name: 'Choose Automatically From Input', value: 'automatically' },
        { name: 'Specify Myself', value: 'set' },
      ],
    },
    { displayName: 'Input Binary Field', name: 'inputDataFieldName', type: 'string', default: 'data', displayOptions: { show: { respondWith: ['binary'], responseDataSource: ['set'] } } },
    {
      displayName: 'Response Body', name: 'responseBody', type: 'json', default: '{\n  "myField": "value"\n}',
      typeOptions: { rows: 5, editor: 'code' }, displayOptions: { show: { respondWith: ['json'] } },
    },
    {
      displayName: 'Payload', name: 'payload', type: 'json', default: '{\n  "myField": "value"\n}',
      typeOptions: { rows: 5, editor: 'code' }, displayOptions: { show: { respondWith: ['jwt'] } },
    },
    { displayName: 'Redirect URL', name: 'redirectURL', type: 'string', default: '', placeholder: 'e.g. http://www.n8n.io', displayOptions: { show: { respondWith: ['redirect'] } } },
    { displayName: 'Response Body', name: 'responseBody', type: 'string', default: '', placeholder: 'e.g. Workflow completed', typeOptions: { rows: 4 }, displayOptions: { show: { respondWith: ['text'] } } },
    {
      displayName: 'Options', name: 'options', type: 'collection', default: {}, options: [
        { name: 'Response Code', value: 'responseCode', values: [{ displayName: 'Response Code', name: 'responseCode', type: 'number', default: 200 }] },
        { name: 'Response Headers', value: 'responseHeaders', values: [{
          displayName: 'Response Headers', name: 'responseHeaders', type: 'fixedCollection', default: { entries: [] },
          typeOptions: { multipleValues: true }, options: [{ name: 'entries', value: 'entries', values: [
            { displayName: 'Name', name: 'name', type: 'string', default: '' },
            { displayName: 'Value', name: 'value', type: 'string', default: '' },
          ] }],
        }] },
        { name: 'Enable Streaming', value: 'enableStreaming', values: [{ displayName: 'Enable Streaming', name: 'enableStreaming', type: 'boolean', default: false }] },
      ],
    },
    { displayName: 'Response Code', name: 'responseCode', type: 'number', default: 200, description: 'Legacy workflow compatibility', displayOptions: { hide: { respondWith: ['allIncomingItems', 'binary', 'firstIncomingItem', 'json', 'jwt', 'noData', 'redirect', 'text'] } } },
  ],
};
