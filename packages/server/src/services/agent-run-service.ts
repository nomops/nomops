import type { Agent, AgentThread, Repositories } from '@nomops/db';
import type { IConnections, INode, JsonObject } from '@nomops/workflow';
import { OperationalError } from '@nomops/workflow';
import type { ExecutionService } from './execution-service.js';

/**
 * Agent 运行编排（backlog #44 M2）：把 agent 组装成后备工作流(ChatTrigger→AiAgent→ChatModel)
 * 经现有引擎跑 → execution;从 runData 提取 token 用量算成本,记 thread/run/message。
 * 复用引擎 = 复用执行详情/标注/Insights,不另造执行栈（docs/12 决策）。
 */

/** provider → 凭证类型（与 ChatModel 节点 PROVIDERS 对齐）。 */
const PROVIDER_CRED: Record<string, string> = {
  anthropic: 'anthropicApi',
  openai: 'openAiApi',
  deepseek: 'deepseekApi',
  doubao: 'doubaoApi',
  qwen: 'qwenApi',
  kimi: 'kimiApi',
  glm: 'glmApi',
};

/** 计价表：micros/token（$1 = 1e6 micros）。缺省用一档保守价。 */
const PRICE: Record<string, { in: number; out: number }> = {
  'claude-sonnet-5': { in: 3, out: 15 },
  'claude-opus-4-8': { in: 15, out: 75 },
  'claude-haiku-4-5-20251001': { in: 1, out: 5 },
  'gpt-4o': { in: 2.5, out: 10 },
  'gpt-4o-mini': { in: 0.15, out: 0.6 },
  'deepseek-chat': { in: 0.27, out: 1.1 },
};
const DEFAULT_PRICE = { in: 3, out: 15 };

/** 成本(micros) = 输入 token × 输入价 + 输出 token × 输出价。 */
export function computeCost(model: string, inputTokens: number, outputTokens: number): number {
  const p = PRICE[model] ?? DEFAULT_PRICE;
  return Math.round(inputTokens * p.in + outputTokens * p.out);
}

/* ── 分层记忆检索（#44 M3）── */
const EMBED_DIM = 64;

/**
 * 本地哈希词袋 embedding（MVP,可插拔）：docs/12 说「provider embedding」,但并非所有
 * provider 都有 embedding 端点,本地实现让检索可离线测/可活验;生产可注入真 provider embedding。
 */
export function embed(text: string): number[] {
  const v = new Array<number>(EMBED_DIM).fill(0);
  for (const tok of text.toLowerCase().split(/[^a-z0-9]+/i).filter(Boolean)) {
    let h = 2166136261;
    for (let i = 0; i < tok.length; i++) {
      h = (h ^ tok.charCodeAt(i)) >>> 0;
      h = (h * 16777619) >>> 0;
    }
    const idx = h % EMBED_DIM;
    v[idx] = (v[idx] ?? 0) + 1;
  }
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}

/** 余弦相似度（两向量均已归一化 → 点积）。 */
export function cosine(a: number[], b: number[]): number {
  let d = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) d += (a[i] ?? 0) * (b[i] ?? 0);
  return d;
}

/** 按相似度取 top-k（过滤低于阈值的噪声）。 */
export function topKMemories<T extends { embedding: number[] }>(query: number[], items: T[], k = 3, min = 0.05): T[] {
  return items
    .map((m) => ({ m, score: cosine(query, m.embedding) }))
    .filter((x) => x.score > min)
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map((x) => x.m);
}

/** 从 runData 提取 AiAgent 写的 _nmUsage（跨节点累加）。 */
export function extractUsage(runData: Record<string, unknown>): { inputTokens: number; outputTokens: number } {
  let inputTokens = 0;
  let outputTokens = 0;
  for (const tasks of Object.values(runData) as Array<Array<{ data?: Record<string, Array<Array<{ json?: JsonObject } | null> | null>> }>>) {
    for (const task of tasks ?? []) {
      for (const port of Object.values(task.data ?? {})) {
        for (const items of port ?? []) {
          for (const item of items ?? []) {
            const u = item?.json?.['_nmUsage'] as { inputTokens?: number; outputTokens?: number } | undefined;
            if (u) {
              inputTokens += Number(u.inputTokens ?? 0);
              outputTokens += Number(u.outputTokens ?? 0);
            }
          }
        }
      }
    }
  }
  return { inputTokens, outputTokens };
}

export interface AgentChatResult {
  runId: string;
  threadId: string;
  executionId: string | null;
  status: string;
  reply: string;
  error?: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costMicros: number;
}

export class AgentRunService {
  constructor(
    private readonly repos: Repositories,
    private readonly executions: ExecutionService,
    /** embedding 函数（#44 M3；缺省本地哈希词袋,生产可注入 provider embedding）。 */
    private readonly embedImpl: (text: string) => number[] | Promise<number[]> = embed,
  ) {}

  /** 按 agent config 组装后备工作流节点。systemOverride 用于把检索到的记忆注入本轮 system。 */
  private buildBackingNodes(config: JsonObject, systemOverride?: string): { nodes: INode[]; connections: IConnections } {
    const provider = String(config['provider'] ?? 'anthropic');
    const model = String(config['model'] ?? '');
    const credentialId = config['credentialId'] ? String(config['credentialId']) : null;
    const credType = PROVIDER_CRED[provider] ?? 'anthropicApi';
    const modelNode: INode = {
      id: 'model',
      name: 'Model',
      type: 'nomops.chatModel',
      typeVersion: 1,
      position: [260, 180],
      parameters: { provider, model },
      ...(credentialId ? { credentials: { [credType]: { id: credentialId, name: 'Model' } } } : {}),
    };
    return {
      nodes: [
        { id: 'trigger', name: 'Chat', type: 'nomops.chatTrigger', typeVersion: 1, position: [0, 0], parameters: {} },
        {
          id: 'agent',
          name: 'Agent',
          type: 'nomops.aiAgent',
          typeVersion: 1,
          position: [260, 0],
          parameters: { system: systemOverride ?? String(config['system'] ?? ''), prompt: '={{ $json.chatInput }}' },
        },
        modelNode,
      ],
      connections: {
        Chat: { main: [[{ node: 'Agent', type: 'main', index: 0 }]] },
        Model: { ai_languageModel: [[{ node: 'Agent', type: 'ai_languageModel', index: 0 }]] },
      },
    };
  }

  /** 确保 agent 有一份与 config 同步的后备工作流,返回其 id。systemOverride 注入本轮记忆。 */
  private async ensureBacking(agent: Agent, projectId: string, systemOverride?: string): Promise<string> {
    const { nodes, connections } = this.buildBackingNodes(agent.config, systemOverride);
    // 后备工作流可能被手动删除 → update 会抛 "Workflow not found"。先核实存在,不存在则重建。
    if (agent.backingWorkflowId && (await this.repos.workflows.findById(agent.backingWorkflowId, projectId))) {
      await this.repos.workflows.update(agent.backingWorkflowId, { nodes, connections });
      return agent.backingWorkflowId;
    }
    const wf = await this.repos.workflows.create({ name: `⟨agent⟩ ${agent.name}`, nodes, connections }, projectId);
    await this.repos.agents.setBackingWorkflow(agent.id, wf.id);
    return wf.id;
  }

  async ensureThread(agent: Agent, projectId: string, threadId?: string): Promise<AgentThread> {
    if (threadId) {
      const t = await this.repos.agents.findThread(threadId, agent.id);
      if (t) return t;
    }
    return this.repos.agents.createThread({ agentId: agent.id, projectId, channel: 'canvas' });
  }

  /** 对话触发 agent 运行：跑后备工作流 → 记 run(token/成本) + 消息。 */
  async chat(agentId: string, projectId: string, message: string, threadId: string | undefined, _userId: string): Promise<AgentChatResult> {
    const agent = await this.repos.agents.findById(agentId, projectId);
    if (!agent) throw new OperationalError('Agent not found', { status: 404 });
    const thread = await this.ensureThread(agent, projectId, threadId);
    const model = String((agent.config as JsonObject)['model'] ?? '');

    // 分层记忆检索（#44 M3）：embed 本轮消息 → agent 域记忆 top-k → 注入本轮 system。
    const queryVec = await this.embedImpl(message);
    const allMemories = await this.repos.agents.memoriesForAgent(agent.id);
    const recalled = topKMemories(queryVec, allMemories);
    const baseSystem = String((agent.config as JsonObject)['system'] ?? '');
    const systemOverride = recalled.length
      ? `${baseSystem}\n\n[Recalled from earlier conversations with this user]\n${recalled.map((m) => `- ${m.content}`).join('\n')}`.trim()
      : undefined;
    for (const m of recalled) await this.repos.agents.touchMemory(m.id);

    const backingWorkflowId = await this.ensureBacking(agent, projectId, systemOverride);

    await this.repos.agents.addMessage({ threadId: thread.id, role: 'user', content: { text: message } });

    const res = await this.executions.chat(backingWorkflowId, projectId, message, thread.id);
    // 从执行数据提取 token 用量 → 成本
    let inputTokens = 0;
    let outputTokens = 0;
    if (res.executionId) {
      const detail = await this.executions.getById(res.executionId, projectId).catch(() => null);
      const runData = (detail?.data as { resultData?: { runData?: Record<string, unknown> } } | null)?.resultData?.runData ?? {};
      ({ inputTokens, outputTokens } = extractUsage(runData));
    }
    const costMicros = computeCost(model, inputTokens, outputTokens);

    const run = await this.repos.agents.createRun({
      threadId: thread.id,
      agentId: agent.id,
      executionId: res.executionId ?? null,
      status: res.status,
      inputTokens,
      outputTokens,
      costMicros,
      model,
      error: res.error ?? null,
    });
    await this.repos.agents.addMessage({ threadId: thread.id, runId: run.id, role: 'assistant', content: { text: res.error ?? res.reply } });

    // 写记忆 + 证据链（#44 M3）：把本轮用户消息存为 agent 域记忆,并把来源运行记为一条观测。
    // MVP 存全部用户消息（跨线程可召回偏好）;生产可加去重/摘要/重要性打分。
    const entry = await this.repos.agents.addMemory({
      agentId: agent.id,
      threadId: thread.id,
      scope: 'agent',
      kind: 'fact',
      content: message,
      embedding: queryVec,
    });
    await this.repos.agents.addObservation(entry.id, run.id, { source: 'user-message', threadId: thread.id });

    return {
      runId: run.id,
      threadId: thread.id,
      executionId: res.executionId ?? null,
      status: res.status,
      reply: res.reply,
      ...(res.error ? { error: res.error } : {}),
      model,
      inputTokens,
      outputTokens,
      costMicros,
    };
  }
}
