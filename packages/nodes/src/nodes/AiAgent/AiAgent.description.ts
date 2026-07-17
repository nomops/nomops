import type { INodeTypeDescription } from '@nomops/workflow';

export const aiAgentDescription: INodeTypeDescription = {
  displayName: 'AI Agent',
  name: 'aiAgent',
  group: ['ai'],
  version: 1,
  description:
    'Compose a model, tools and memory into an agent loop; falls back to direct Claude calls when no model is attached',
  defaults: { name: 'AI Agent' },
  // main 之外是能力输入：模型（不挂则走旧直连模式）/ 工具（可多个）/ 记忆（可选）
  inputs: ['main', 'ai_languageModel', 'ai_tool', 'ai_memory'],
  outputs: ['main'],
  credentials: [{ name: 'anthropicApi' }],
  properties: [
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
      displayName: 'Max Tool Iterations',
      name: 'maxIterations',
      type: 'number',
      default: 5,
      description: 'Upper bound on model→tool round-trips per item',
      noDataExpression: true,
    },
    {
      displayName: 'Session ID',
      name: 'sessionId',
      type: 'string',
      default: 'default',
      description: 'Memory namespace (used when a Memory node is attached); supports expressions',
    },
    // ── 以下参数仅旧直连模式（未挂模型子节点）使用 ──
    {
      displayName: 'Model (Legacy Direct Mode)',
      name: 'model',
      type: 'options',
      default: 'claude-sonnet-5',
      description: 'Used only when no Chat Model node is attached',
      options: [
        { name: 'Claude Sonnet 5', value: 'claude-sonnet-5' },
        { name: 'Claude Opus 4.8', value: 'claude-opus-4-8' },
        { name: 'Claude Haiku 4.5', value: 'claude-haiku-4-5-20251001' },
      ],
      noDataExpression: true,
    },
    {
      displayName: 'Max Tokens (Legacy Direct Mode)',
      name: 'maxTokens',
      type: 'number',
      default: 1024,
      noDataExpression: true,
    },
  ],
};
