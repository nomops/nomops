import type { INodeTypeDescription } from '@nomops/workflow';

export const webhookDescription: INodeTypeDescription = {
  displayName: 'Webhook',
  name: 'webhook',
  group: ['trigger'],
  version: 1,
  description: 'Trigger the workflow from an inbound HTTP request',
  defaults: { name: 'Webhook' },
  inputs: [],
  outputs: ['main'],
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
  ],
};
