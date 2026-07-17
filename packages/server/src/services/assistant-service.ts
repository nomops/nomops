import type { Repositories } from '@nomops/db';
import type { INodeLoader } from '@nomops/core';
import type { IConnections, INode } from '@nomops/workflow';
import { OperationalError, Workflow } from '@nomops/workflow';
import type { CredentialService } from './credential-service.js';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** 注入的 Claude 调用（默认真实 HTTP；测试注入假实现）。 */
export type CallClaude = (opts: {
  apiKey: string;
  model: string;
  system: string;
  messages: ChatMessage[];
  maxTokens: number;
}) => Promise<string>;

export interface ChatResult {
  reply: string;
  /** 若回复含合法 workflow JSON 建议，解析并结构校验后附上。 */
  workflow: { name: string; nodes: INode[]; connections: IConnections } | null;
}

const DEFAULT_MODEL = 'claude-sonnet-5';

/** Chat provider 注册表（Chat 页 Select model 的单一事实源；/assistant/providers 暴露给前端）。 */
export interface ChatProviderInfo {
  id: string;
  label: string;
  credentialType: string;
  /** 调用协议：anthropic = Messages API；openai = Chat Completions 兼容。 */
  kind: 'anthropic' | 'openai';
  baseUrl: string;
  models: string[];
  /** 模型名前缀（归属判定）。 */
  prefixes: string[];
}

export const CHAT_PROVIDERS: ChatProviderInfo[] = [
  {
    id: 'anthropic',
    label: 'Anthropic',
    credentialType: 'anthropicApi',
    kind: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1/messages',
    models: ['claude-sonnet-5', 'claude-opus-4-8', 'claude-haiku-4-5'],
    prefixes: ['claude-'],
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    credentialType: 'deepseekApi',
    kind: 'openai',
    baseUrl: 'https://api.deepseek.com/chat/completions',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    prefixes: ['deepseek-'],
  },
  {
    id: 'doubao',
    label: 'Doubao 豆包',
    credentialType: 'doubaoApi',
    kind: 'openai',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
    models: ['doubao-seed-1-6-250615', 'doubao-seed-1-6-flash-250615', 'doubao-1-5-pro-32k-250115'],
    prefixes: ['doubao-'],
  },
  {
    id: 'qwen',
    label: 'Qwen 千问',
    credentialType: 'qwenApi',
    kind: 'openai',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    models: ['qwen-max', 'qwen-plus', 'qwen-turbo'],
    prefixes: ['qwen-'],
  },
  {
    id: 'kimi',
    label: 'Kimi (Moonshot)',
    credentialType: 'kimiApi',
    kind: 'openai',
    baseUrl: 'https://api.moonshot.cn/v1/chat/completions',
    models: ['kimi-k2-turbo-preview', 'moonshot-v1-32k', 'moonshot-v1-8k'],
    prefixes: ['kimi-', 'moonshot-'],
  },
  {
    id: 'glm',
    label: 'GLM 智谱',
    credentialType: 'glmApi',
    kind: 'openai',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    models: ['glm-4.6', 'glm-4-plus', 'glm-4-flash'],
    prefixes: ['glm-'],
  },
];

export function providerForModel(model: string): ChatProviderInfo | undefined {
  return CHAT_PROVIDERS.find((p) => p.prefixes.some((prefix) => model.startsWith(prefix)));
}

/** 注入的 OpenAI 兼容调用（DeepSeek/豆包/千问/Kimi/GLM；测试注入假实现）。 */
export type CallOpenAI = (opts: {
  apiKey: string;
  baseUrl: string;
  model: string;
  system: string;
  messages: ChatMessage[];
  maxTokens: number;
}) => Promise<string>;

/** 默认 OpenAI 兼容调用：POST {baseUrl} chat/completions。 */
const realCallOpenAI: CallOpenAI = async ({ apiKey, baseUrl, model, system, messages, maxTokens }) => {
  const res = await fetch(baseUrl, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [{ role: 'system', content: system }, ...messages],
    }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message?: string };
  };
  if (!res.ok) {
    throw new OperationalError(`Chat API 错误 (${model}): ${body.error?.message ?? res.status}`, { status: 502 });
  }
  return body.choices?.[0]?.message?.content ?? '';
};

/** 默认 Claude 调用：POST Anthropic Messages API。 */
const realCallClaude: CallClaude = async ({ apiKey, model, system, messages, maxTokens }) => {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ model, max_tokens: maxTokens, system, messages }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    content?: Array<{ type: string; text?: string }>;
    error?: { message?: string };
  };
  if (!res.ok) {
    throw new OperationalError(`Claude API 错误: ${body.error?.message ?? res.status}`, { status: 502 });
  }
  return (body.content ?? [])
    .filter((c) => c.type === 'text')
    .map((c) => c.text ?? '')
    .join('');
};

/**
 * AI 助手（docs/10 B2）：调用户配置的 Anthropic 凭证跑 Claude，
 * system prompt 注入 nomops 节点知识；能生成可导入的 workflow JSON。
 * ★铁律 3：解密后的 apiKey 只在本次调用内使用，绝不回传/落库/记日志。
 */
export class AssistantService {
  constructor(
    private readonly repos: Repositories,
    private readonly credentialService: CredentialService,
    private readonly nodeLoader: INodeLoader,
    private readonly callClaude: CallClaude = realCallClaude,
    private readonly callOpenAI: CallOpenAI = realCallOpenAI,
  ) {}

  /** 用节点 description 构造系统提示（教 Claude 用 nomops 节点搭流）。 */
  private buildSystemPrompt(): string {
    const nodes = this.nodeLoader
      .getAllDescriptions()
      .map((d) => `- nomops.${d.name}（${d.displayName}）：${d.description} 参数：${d.properties.map((p) => p.name).join(', ') || '无'}`)
      .join('\n');
    return [
      '你是 nomops 工作流自动化平台的 AI 助手。用简体中文、简洁作答。',
      'nomops 是节点式工作流工具。可用节点如下：',
      nodes,
      '',
      '当用户要求“搭一个/生成/构建工作流”时，除了简短说明外，追加一个 ```json 代码块，内容为：',
      '{ "name": "流程名", "nodes": [ { "id":"a", "name":"节点名(唯一)", "type":"nomops.xxx", "typeVersion":1, "position":[x,y], "parameters":{} } ], "connections": { "源节点名": { "main": [[ { "node":"目标节点名","type":"main","index":0 } ]] } } }',
      'connections 的 key 用节点 name；IF 节点有两个输出端口（外层数组第0项=true、第1项=false）。触发器节点（manualTrigger/webhook/schedule）inputs 为空，放在最左作为起点。',
      '只用上面列出的节点类型。不确定就先问，不要编造不存在的节点。',
    ].join('\n');
  }

  /** 从回复里抽取并校验 workflow JSON（结构非法则返回 null）。 */
  private extractWorkflow(reply: string): ChatResult['workflow'] {
    const match = /```json\s*([\s\S]+?)```/.exec(reply);
    if (!match) return null;
    let parsed: { name?: string; nodes?: INode[]; connections?: IConnections };
    try {
      parsed = JSON.parse(match[1]!.trim());
    } catch {
      return null;
    }
    if (!Array.isArray(parsed.nodes) || parsed.nodes.length === 0 || typeof parsed.connections !== 'object') {
      return null;
    }
    try {
      // 结构校验：连接引用存在 + 节点名唯一
      new Workflow({ nodes: parsed.nodes, connections: parsed.connections ?? {} });
      // 节点类型必须已注册
      const known = new Set(this.nodeLoader.getAllDescriptions().map((d) => `nomops.${d.name}`));
      for (const n of parsed.nodes) if (!known.has(n.type)) return null;
    } catch {
      return null;
    }
    return {
      name: typeof parsed.name === 'string' && parsed.name ? parsed.name : 'AI 生成的工作流',
      nodes: parsed.nodes,
      connections: parsed.connections ?? {},
    };
  }

  async chat(
    projectId: string,
    messages: ChatMessage[],
    credentialId?: string,
    system?: string,
    model?: string,
  ): Promise<ChatResult> {
    if (messages.length === 0) throw new OperationalError('messages 不能为空', { status: 400 });

    // 会话级模型优先（Chat 页 Select model）；否则 Settings → Chat 配置（chat.model）
    const resolvedModel = model ?? (await this.repos.settings.get('chat.model')) ?? DEFAULT_MODEL;
    // 按模型前缀路由 provider（DeepSeek/豆包/千问/Kimi/GLM 走 OpenAI 兼容协议）
    const provider = providerForModel(resolvedModel);
    if (!provider) {
      throw new OperationalError(`Unknown chat model: ${resolvedModel}`, { status: 400 });
    }

    // Configure provider（Settings → Chat）：启停 / 默认凭证 / 上下文窗口
    const rawConfig = await this.repos.settings.get(`chat.provider.${provider.id}`);
    const config = rawConfig
      ? (JSON.parse(rawConfig) as { enabled?: boolean; credentialId?: string | null; contextWindow?: number })
      : {};
    if (config.enabled === false) {
      throw new OperationalError(`${provider.label} is disabled — enable it under Settings → Chat.`, { status: 400 });
    }
    // 上下文窗口：只带最近 N 组往返（含当前这条 user 消息）
    const contextWindow = config.contextWindow ?? 20;
    const trimmedMessages = messages.slice(-(contextWindow * 2 + 1));

    // 凭证：调用指定 > provider 默认凭证（校验归属）> 项目内第一个该类型凭证
    let credId = credentialId;
    if (!credId && config.credentialId) {
      const configured = await this.repos.credentials.findById(config.credentialId, projectId);
      if (configured?.type === provider.credentialType) credId = configured.id;
    }
    if (!credId) {
      const creds = await this.repos.credentials.findAllByProject(projectId);
      credId = creds.find((c) => c.type === provider.credentialType)?.id;
    }
    if (!credId) {
      throw new OperationalError(
        `No ${provider.label} credential configured — add a “${provider.credentialType}” credential under Credentials first.`,
        { status: 400 },
      );
    }
    const data = await this.credentialService.getDecryptedData(credId, projectId);
    const apiKey = String(data['apiKey'] ?? '');
    if (!apiKey) throw new OperationalError('该凭证缺少 apiKey', { status: 400 });

    // Personal agents（Chat 页）：自定义 system prompt 覆盖内置工作流助手
    const systemPrompt = system?.trim() ? system.trim() : this.buildSystemPrompt();
    const reply =
      provider.kind === 'anthropic'
        ? await this.callClaude({
            apiKey,
            model: resolvedModel,
            system: systemPrompt,
            messages: trimmedMessages,
            maxTokens: 2048,
          })
        : await this.callOpenAI({
            apiKey,
            baseUrl: provider.baseUrl,
            model: resolvedModel,
            system: systemPrompt,
            messages: trimmedMessages,
            maxTokens: 2048,
          });
    return { reply, workflow: this.extractWorkflow(reply) };
  }
}
