import type { Agent, AgentTaskDefinition, AgentThread, Repositories } from '@nomops/db';
import type { IConnections, INode, JsonObject } from '@nomops/workflow';
import { OperationalError } from '@nomops/workflow';
import type { ExecutionService } from './execution-service.js';
import { computeNextRun } from './scheduler-service.js';
import { embed, cosine, topKMemories } from './embedding.js';

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

/* ── 分层记忆检索（#44 M3）：embedding 已抽到 embedding.ts,与 #45 观察-反思记忆共用（docs/13 决策 4）── */
export { embed, cosine, topKMemories };

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

  /* ── 定时任务（#44 M4）：任务定义 ↔ #38 调度作业(kind=agent-task),触发去重靠租约 ── */

  /** 首次/变更后的 nextRunAt。once 用 fireAt;cron/interval 走 computeNextRun。无效配置抛 400。 */
  private initialNextRun(schedule: JsonObject, timezone: string): Date {
    if (schedule['mode'] === 'once') {
      const at = new Date(String(schedule['fireAt'] ?? ''));
      if (Number.isNaN(at.getTime())) throw new OperationalError('Invalid fireAt', { status: 400 });
      return at;
    }
    try {
      const next = computeNextRun(schedule, timezone, new Date());
      if (!next) throw new Error('no next run');
      return next;
    } catch {
      throw new OperationalError('Invalid schedule config', { status: 400 });
    }
  }

  /** 建任务：task 行 + scheduled_job(kind=agent-task,config.taskId 回链)。 */
  async createTask(
    agentId: string,
    projectId: string,
    input: { name: string; message: string; schedule: JsonObject; timezone?: string },
  ): Promise<AgentTaskDefinition> {
    const agent = await this.repos.agents.findById(agentId, projectId);
    if (!agent) throw new OperationalError('Agent not found', { status: 404 });
    const timezone = input.timezone ?? 'UTC';
    const nextRunAt = this.initialNextRun(input.schedule, timezone); // 先校验,再落库
    const task = await this.repos.agents.createTask({ agentId, projectId, name: input.name, message: input.message, schedule: input.schedule, timezone });
    const job = await this.repos.scheduler.createJob({
      kind: 'agent-task',
      config: { ...input.schedule, taskId: task.id },
      timezone,
      nextRunAt,
    });
    await this.repos.agents.updateTask(task.id, { jobId: job.id });
    return { ...task, jobId: job.id };
  }

  /** 改任务：schedule/timezone 变更重算 nextRunAt;active 开关同步停启作业。 */
  async updateTaskDef(
    agentId: string,
    taskId: string,
    patch: Partial<{ name: string; message: string; schedule: JsonObject; timezone: string; active: boolean }>,
  ): Promise<AgentTaskDefinition> {
    const task = await this.repos.agents.findTask(taskId, agentId);
    if (!task) throw new OperationalError('Task not found', { status: 404 });
    const schedule = patch.schedule ?? task.schedule;
    const timezone = patch.timezone ?? task.timezone;
    const active = patch.active ?? task.active;
    const nextRunAt = active ? this.initialNextRun(schedule, timezone) : null;
    await this.repos.agents.updateTask(taskId, { ...patch });
    if (task.jobId) {
      await this.repos.scheduler.updateJob(task.jobId, { config: { ...schedule, taskId }, timezone, active, nextRunAt });
    }
    return (await this.repos.agents.findTask(taskId, agentId))!;
  }

  /** 删任务：停用对应作业(历史 scheduled_tasks 留痕),删任务行。 */
  async deleteTaskDef(agentId: string, taskId: string): Promise<void> {
    const task = await this.repos.agents.findTask(taskId, agentId);
    if (!task) throw new OperationalError('Task not found', { status: 404 });
    if (task.jobId) await this.repos.scheduler.updateJob(task.jobId, { active: false, nextRunAt: null });
    await this.repos.agents.deleteTask(taskId);
  }

  /** 调度 fire 分派入口：按任务定义触发一次 agent 运行。任务已删/停用 → 静默跳过。 */
  async runTask(taskId: string): Promise<string | null> {
    const task = await this.repos.agents.findTaskById(taskId);
    if (!task || !task.active) return null;
    // 专属线程：历次触发聚在一条线程,渠道标 schedule,可回看
    let threadId = task.threadId;
    if (!threadId || !(await this.repos.agents.findThread(threadId, task.agentId))) {
      const thread = await this.repos.agents.createThread({ agentId: task.agentId, projectId: task.projectId, channel: 'schedule' });
      threadId = thread.id;
      await this.repos.agents.updateTask(task.id, { threadId });
    }
    const res = await this.chat(task.agentId, task.projectId, task.message, threadId, 'scheduler');
    await this.repos.agents.updateTask(task.id, { lastRunAt: new Date() });
    return res.executionId;
  }
}
