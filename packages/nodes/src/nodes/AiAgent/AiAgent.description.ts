import type { INodeTypeDescription } from '@nomops/workflow';

export const aiAgentDescription: INodeTypeDescription = {
  displayName: 'AI Agent (Claude)',
  name: 'aiAgent',
  group: ['transform'],
  version: 1,
  description: 'Call the Claude API once per item and output the model reply',
  defaults: { name: 'AI Agent' },
  inputs: ['main'],
  outputs: ['main'],
  credentials: [{ name: 'anthropicApi', required: true }],
  properties: [
    {
      displayName: 'Model',
      name: 'model',
      type: 'options',
      default: 'claude-sonnet-5',
      options: [
        { name: 'Claude Sonnet 5', value: 'claude-sonnet-5' },
        { name: 'Claude Opus 4.8', value: 'claude-opus-4-8' },
        { name: 'Claude Haiku 4.5', value: 'claude-haiku-4-5-20251001' },
      ],
      noDataExpression: true,
    },
    {
      displayName: 'Prompt',
      name: 'prompt',
      type: 'string',
      default: '',
      required: true,
      placeholder: 'Supports expressions, e.g. =Summarize this: {{ $json.text }}',
    },
    {
      displayName: 'System Prompt',
      name: 'system',
      type: 'string',
      default: '',
    },
    {
      displayName: 'Max Tokens',
      name: 'maxTokens',
      type: 'number',
      default: 1024,
      noDataExpression: true,
    },
  ],
};
