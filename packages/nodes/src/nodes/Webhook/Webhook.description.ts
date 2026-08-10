import type { INodeTypeDescription } from '@nomops/workflow';

export const webhookDescription: INodeTypeDescription = {
  displayName: 'Webhook',
  name: 'webhook',
  group: ['trigger'],
  categories: ['trigger', 'core'],
  version: 1,
  description: 'Trigger the workflow from an inbound HTTP request',
  defaults: { name: 'Webhook' },
  inputs: [],
  outputs: ['main'],
  credentials: [
    {
      name: 'httpBasicAuth',
      required: true,
      displayOptions: { show: { authentication: ['basic'] } },
    },
    {
      name: 'httpHeaderAuth',
      required: true,
      displayOptions: { show: { authentication: ['header'] } },
    },
    {
      name: 'webhookJwtAuth',
      required: true,
      displayOptions: { show: { authentication: ['jwt'] } },
    },
  ],
  // 声明式注册：激活时按 (method, path) 写入 webhook_entities 路由表
  webhooks: [{ httpMethod: { parameter: 'method' }, path: { parameter: 'path' } }],
  properties: [
    {
      displayName: 'Path',
      name: 'path',
      type: 'string',
      default: '',
      required: true,
      placeholder: 'my-hook',
      description: 'Externally reachable at /webhook/<path>',
      noDataExpression: true,
    },
    {
      displayName: 'Method',
      name: 'method',
      type: 'options',
      default: 'POST',
      options: [
        { name: 'GET', value: 'GET' },
        { name: 'POST', value: 'POST' },
        { name: 'PUT', value: 'PUT' },
        { name: 'DELETE', value: 'DELETE' },
      ],
      noDataExpression: true,
    },
    {
      displayName: 'Authentication',
      name: 'authentication',
      type: 'options',
      default: 'none',
      options: [
        { name: 'None', value: 'none' },
        { name: 'Basic Auth', value: 'basic' },
        { name: 'Header Auth', value: 'header' },
        { name: 'JWT (HS256)', value: 'jwt' },
      ],
      description: 'Protect this production webhook with an encrypted credential',
      noDataExpression: true,
    },
    {
      displayName: 'Response Mode',
      name: 'responseMode',
      type: 'options',
      default: 'executionSummary',
      options: [
        { name: 'Execution Summary', value: 'executionSummary' },
        { name: 'Last Node Output', value: 'lastNode' },
      ],
      description: 'RespondToWebhook takes precedence when present',
      noDataExpression: true,
    },
    {
      displayName: 'Ignore Bots and Link Previews',
      name: 'ignoreBots',
      type: 'boolean',
      default: false,
      description: 'Return 204 without starting an execution for known crawler and link-preview user agents',
      noDataExpression: true,
    },
  ],
};
