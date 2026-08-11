import type { INodeProperties, INodeTypeDescription } from '@nomops/workflow';

const nameValueRows: INodeProperties[] = [
  { displayName: 'Name', name: 'name', type: 'string', default: '' },
  { displayName: 'Value', name: 'value', type: 'string', default: '' },
];

export const httpRequestDescription: INodeTypeDescription = {
  displayName: 'HTTP Request',
  name: 'httpRequest',
  group: ['output'],
  categories: ['core'],
  aliases: ['request', 'api', 'curl'],
  version: 1,
  description: 'Makes an HTTP request and returns the response data',
  defaults: { name: 'HTTP Request' },
  inputs: ['main'],
  outputs: ['main'],
  usableAsTool: true,
  credentials: [
    { name: 'httpBasicAuth', required: true, displayOptions: { show: { authentication: ['basic'] } } },
    { name: 'httpHeaderAuth', required: true, displayOptions: { show: { authentication: ['header'] } } },
  ],
  properties: [
    { displayName: 'Method', name: 'method', type: 'options', default: 'GET', options: [
      { name: 'GET', value: 'GET' }, { name: 'POST', value: 'POST' }, { name: 'PUT', value: 'PUT' },
      { name: 'PATCH', value: 'PATCH' }, { name: 'DELETE', value: 'DELETE' }, { name: 'HEAD', value: 'HEAD' },
      { name: 'OPTIONS', value: 'OPTIONS' },
    ] },
    { displayName: 'URL', name: 'url', type: 'string', default: '', required: true, placeholder: 'http://example.com/index.html' },
    { displayName: 'Authentication', name: 'authentication', type: 'options', default: 'none', options: [
      { name: 'None', value: 'none' }, { name: 'Basic Auth', value: 'basic' }, { name: 'Header Auth', value: 'header' },
    ], noDataExpression: true },
    { displayName: 'Send Query Parameters', name: 'sendQuery', type: 'boolean', default: false },
    { displayName: 'Specify Query Parameters', name: 'specifyQuery', type: 'options', default: 'keypair', options: [
      { name: 'Using Fields Below', value: 'keypair' }, { name: 'Using JSON', value: 'json' },
    ], displayOptions: { show: { sendQuery: [true] } } },
    { displayName: 'Query Parameters', name: 'queryParameters', type: 'fixedCollection', default: { parameters: [] },
      typeOptions: { multipleValues: true, sortable: true, fixedCollection: { itemTitle: 'Query Parameter', addButtonLabel: 'Add Query Parameter' } },
      options: [{ name: 'parameters', value: 'parameters', values: nameValueRows }],
      displayOptions: { show: { sendQuery: [true], specifyQuery: ['keypair'] } } },
    { displayName: 'JSON', name: 'queryJson', type: 'json', default: {}, displayOptions: { show: { sendQuery: [true], specifyQuery: ['json'] } } },
    { displayName: 'Send Headers', name: 'sendHeaders', type: 'boolean', default: false },
    { displayName: 'Specify Headers', name: 'specifyHeaders', type: 'options', default: 'keypair', options: [
      { name: 'Using Fields Below', value: 'keypair' }, { name: 'Using JSON', value: 'json' },
    ], displayOptions: { show: { sendHeaders: [true] } } },
    { displayName: 'Headers', name: 'headerParameters', type: 'fixedCollection', default: { parameters: [] },
      typeOptions: { multipleValues: true, sortable: true, fixedCollection: { itemTitle: 'Header', addButtonLabel: 'Add Header' } },
      options: [{ name: 'parameters', value: 'parameters', values: nameValueRows }],
      displayOptions: { show: { sendHeaders: [true], specifyHeaders: ['keypair'] } } },
    { displayName: 'JSON', name: 'headerJson', type: 'json', default: {}, displayOptions: { show: { sendHeaders: [true], specifyHeaders: ['json'] } } },
    { displayName: 'Send Body', name: 'sendBody', type: 'boolean', default: false },
    { displayName: 'Body Content Type', name: 'contentType', type: 'options', default: 'json', options: [
      { name: 'JSON', value: 'json' }, { name: 'Form URLencoded', value: 'form-urlencoded' }, { name: 'Raw', value: 'raw' },
    ], displayOptions: { show: { sendBody: [true] } } },
    { displayName: 'Specify Body', name: 'specifyBody', type: 'options', default: 'keypair', options: [
      { name: 'Using Fields Below', value: 'keypair' }, { name: 'Using JSON', value: 'json' },
    ], displayOptions: { show: { sendBody: [true], contentType: ['json', 'form-urlencoded'] } } },
    { displayName: 'Body Parameters', name: 'bodyParameters', type: 'fixedCollection', default: { parameters: [] },
      typeOptions: { multipleValues: true, sortable: true, fixedCollection: { itemTitle: 'Body Field', addButtonLabel: 'Add Body Field' } },
      options: [{ name: 'parameters', value: 'parameters', values: nameValueRows }],
      displayOptions: { show: { sendBody: [true], specifyBody: ['keypair'] } } },
    { displayName: 'JSON Body', name: 'jsonBody', type: 'json', default: {}, displayOptions: { show: { sendBody: [true], specifyBody: ['json'] } } },
    { displayName: 'Body', name: 'rawBody', type: 'string', default: '', typeOptions: { rows: 6 }, displayOptions: { show: { sendBody: [true], contentType: ['raw'] } } },
    { displayName: 'Options', name: 'options', type: 'collection', default: {}, options: [{
      name: 'Response Format', value: 'responseFormat', values: [{
        displayName: 'Response Format', name: 'responseFormat', type: 'options', default: 'auto', options: [
          { name: 'Autodetect', value: 'auto' }, { name: 'Text', value: 'text' }, { name: 'File', value: 'binary' },
        ],
      }],
    }] },
  ],
};
