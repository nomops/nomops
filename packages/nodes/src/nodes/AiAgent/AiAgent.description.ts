import type { INodeTypeDescription } from '@nomops/workflow';

export const aiAgentDescription: INodeTypeDescription = {
  displayName: 'AI Agent',
  name: 'aiAgent',
  group: ['ai'],
  categories: ['ai'],
  subcategories: ['Agents'],
  version: 1,
  description: 'Generates an action plan and executes it. Can use external tools.',
  defaults: { name: 'AI Agent' },
  // 与对标基线一致：模型必接，Memory / Tool 可选；厂商凭证配置在 Chat Model 子节点。
  inputs: ['main', 'ai_languageModel', 'ai_memory', 'ai_tool'],
  outputs: ['main'],
  properties: [
    {
      displayName: 'AI Agent Tip',
      name: 'agentTip',
      type: 'notice',
      default: '',
      description: 'Tip: Get a feel for agents with a quick tutorial or see an example of how this node works',
    },
    {
      displayName: 'Source for Prompt (User Message)',
      name: 'promptType',
      type: 'options',
      default: 'auto',
      options: [
        { name: 'Connected Chat Trigger Node', value: 'auto' },
        { name: 'Define below', value: 'define' },
      ],
    },
    {
      displayName: 'Prompt (User Message)',
      name: 'text',
      type: 'string',
      default: '={{ $json.chatInput }}',
      required: true,
      placeholder: 'e.g. Hello, how can you help me?',
    },
    {
      displayName: 'Require Specific Output Format',
      name: 'hasOutputParser',
      type: 'boolean',
      default: false,
    },
    {
      displayName: 'Enable Fallback Model',
      name: 'needsFallback',
      type: 'boolean',
      default: false,
    },
    {
      displayName: 'Options',
      name: 'options',
      type: 'collection',
      default: {},
      placeholder: 'Add Option',
      options: [
        {
          name: 'System Message',
          value: 'systemMessage',
          values: [{ displayName: 'System Message', name: 'systemMessage', type: 'string', default: '', typeOptions: { rows: 4 } }],
        },
        {
          name: 'Max Iterations',
          value: 'maxIterations',
          values: [{ displayName: 'Max Iterations', name: 'maxIterations', type: 'number', default: 10, noDataExpression: true }],
        },
        {
          name: 'Session ID',
          value: 'sessionId',
          values: [{ displayName: 'Session ID', name: 'sessionId', type: 'string', default: 'default' }],
        },
      ],
    },
  ],
};
