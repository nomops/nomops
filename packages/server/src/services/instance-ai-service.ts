import type { InstanceAiCheckpoint, InstanceAiMemory, InstanceAiMessage, InstanceAiPendingAction, InstanceAiRunNode, InstanceAiThread, Repositories } from '@nomops/db';
import type { JsonObject } from '@nomops/workflow';
import { OperationalError } from '@nomops/workflow';
import type { AssistantService, ChatMessage } from './assistant-service.js';
import { buildDefaultToolExecutor, classifyRisk, type ToolContext, type ToolExecutor } from './instance-ai-tools.js';
import { embed, topKMemories } from './embedding.js';

/**
 * 有检查点的 AI 线程底座（backlog #45 M2，docs/13 组 B）：实例助手的可回滚线程。
 * - state：线程当前可序列化工作态（铁律 4，JSON.stringify 安全）。
 * - checkpoint：某步的完整状态快照（state + 消息条数）——同引擎 RunExecutionData 的哲学。
 * - restore：还原 state + 截断检查点之后的消息 → 线程回到该步,状态一致,可续跑。
 * chat 复用 assistant-service（真·AI 线程,provider 中立）;检查点/回滚与 LLM 解耦（纯底座）。
 */

export interface ThreadDetail {
  thread: InstanceAiThread;
  messages: InstanceAiMessage[];
  checkpoints: InstanceAiCheckpoint[];
}

/** propose 结果：安全动作直接执行,危险动作挂 pending 等确认。 */
export type ProposeResult =
  | { status: 'executed'; result: JsonObject }
  | { status: 'pending'; action: InstanceAiPendingAction };

export class InstanceAiService {
  private readonly toolExecutor: ToolExecutor;

  constructor(
    private readonly repos: Repositories,
    private readonly assistant: AssistantService,
    /** 工具执行器（#45 M3；缺省内置,可注入 MCP/假实现）。 */
    toolExecutor?: ToolExecutor,
  ) {
    this.toolExecutor = toolExecutor ?? buildDefaultToolExecutor(repos);
  }

  async createThread(userId: string, input: { kind?: string; title?: string }): Promise<InstanceAiThread> {
    const kind = input.kind === 'builder' ? 'builder' : 'ops';
    return this.repos.instanceAi.createThread({ userId, kind, title: input.title?.trim() || 'New thread' });
  }

  listThreads(userId: string): Promise<InstanceAiThread[]> {
    return this.repos.instanceAi.listThreads(userId);
  }

  private async requireThread(id: string, userId: string): Promise<InstanceAiThread> {
    const t = await this.repos.instanceAi.findThread(id, userId);
    if (!t) throw new OperationalError('Thread not found', { status: 404 });
    return t;
  }

  async getThread(id: string, userId: string): Promise<ThreadDetail> {
    const thread = await this.requireThread(id, userId);
    return {
      thread,
      messages: await this.repos.instanceAi.listMessages(id),
      checkpoints: await this.repos.instanceAi.listCheckpoints(id),
    };
  }

  async deleteThread(id: string, userId: string): Promise<void> {
    await this.requireThread(id, userId);
    await this.repos.instanceAi.deleteThread(id);
  }

  /** 追加一条消息（role 任意：user/assistant/tool/system）,seq 自增。 */
  async append(id: string, userId: string, role: string, content: JsonObject): Promise<InstanceAiMessage> {
    await this.requireThread(id, userId);
    const seq = (await this.repos.instanceAi.countMessages(id)) + 1;
    return this.repos.instanceAi.appendMessage(id, seq, role, content);
  }

  /** 设置线程工作态（整体替换,确保回滚可确定复原）。 */
  async setState(id: string, userId: string, state: JsonObject): Promise<InstanceAiThread> {
    await this.requireThread(id, userId);
    await this.repos.instanceAi.setThreadState(id, state);
    return (await this.repos.instanceAi.findThread(id, userId))!;
  }

  /** 存检查点：快照当前 state + 消息条数。seq 自增。 */
  async checkpoint(id: string, userId: string, label: string): Promise<InstanceAiCheckpoint> {
    const thread = await this.requireThread(id, userId);
    const seq = (await this.repos.instanceAi.countCheckpoints(id)) + 1;
    const messageCount = await this.repos.instanceAi.countMessages(id);
    return this.repos.instanceAi.addCheckpoint({ threadId: id, seq, label: label.trim(), state: thread.state, messageCount });
  }

  /**
   * 回滚到某检查点：还原 state + 截断其后的消息 + 作废其后的检查点 → 线程回到该步,状态一致。
   * 返回还原后的线程详情（可继续对话/续跑）。
   */
  async restore(id: string, userId: string, checkpointId: string): Promise<ThreadDetail> {
    await this.requireThread(id, userId);
    const cp = await this.repos.instanceAi.findCheckpoint(checkpointId, id);
    if (!cp) throw new OperationalError('Checkpoint not found', { status: 404 });
    await this.repos.instanceAi.truncateMessagesAfter(id, cp.messageCount);
    await this.repos.instanceAi.truncateCheckpointsAfter(id, cp.seq);
    await this.repos.instanceAi.setThreadState(id, cp.state);
    return this.getThread(id, userId);
  }

  /**
   * 对话一轮（真·AI 线程）：追加 user 消息 → 喂全量历史给助手 → 追加 assistant 回复。
   * 复用 assistant-service（provider 中立）。凭证/模型经 projectId 解析（同 M1 建流会话）。
   */
  async chat(id: string, userId: string, projectId: string, message: string, model?: string, credentialId?: string): Promise<{ reply: string; message: InstanceAiMessage }> {
    const text = message.trim();
    if (!text) throw new OperationalError('message is required', { status: 400 });
    await this.requireThread(id, userId);
    await this.append(id, userId, 'user', { text });

    const history: ChatMessage[] = (await this.repos.instanceAi.listMessages(id))
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: String((m.content as { text?: unknown })['text'] ?? '') }));

    const result = await this.assistant.chat(projectId, history, credentialId, undefined, model);
    const assistantMsg = await this.append(id, userId, 'assistant', { text: result.reply });
    return { reply: result.reply, message: assistantMsg };
  }

  /* ── HITL 待确认（#45 M3）：危险动作先挂 pending,人确认后才执行 ── */

  /**
   * 提议一个动作：安全(只读)直接执行并记 tool 消息;危险则挂 pending 等确认（不执行）。
   * 助手工具调用应走此入口——把「外发/不可逆先确认」的安全边界内建进助手。
   */
  /** 在运行树里执行工具（#45 M4）：建根节点 → 执行(ctx.span 记子调用) → 收尾。供「观察」。 */
  private async execToolWithTree(threadId: string, userId: string, projectId: string, tool: string, args: JsonObject): Promise<JsonObject> {
    const root = await this.repos.instanceAi.addRunNode({ threadId, parentId: null, label: tool, nodeInput: args });
    const span: ToolContext['span'] = async (label, input, fn) => {
      const child = await this.repos.instanceAi.addRunNode({ threadId, parentId: root.id, label, nodeInput: input });
      try {
        const out = await fn();
        await this.repos.instanceAi.finishRunNode(child.id, 'success', out);
        return out;
      } catch (e) {
        await this.repos.instanceAi.finishRunNode(child.id, 'error', { error: (e as Error).message });
        throw e;
      }
    };
    try {
      const result = await this.toolExecutor(tool, args, { threadId, userId, projectId, span });
      await this.repos.instanceAi.finishRunNode(root.id, 'success', result);
      return result;
    } catch (e) {
      await this.repos.instanceAi.finishRunNode(root.id, 'error', { error: (e as Error).message });
      throw e;
    }
  }

  async proposeAction(threadId: string, userId: string, projectId: string, tool: string, args: JsonObject): Promise<ProposeResult> {
    await this.requireThread(threadId, userId);
    const verdict = classifyRisk(tool);
    if (verdict.risk === 'safe') {
      const result = await this.execToolWithTree(threadId, userId, projectId, tool, args);
      await this.append(threadId, userId, 'tool', { tool, args, result, risk: 'safe' });
      return { status: 'executed', result };
    }
    const action = await this.repos.instanceAi.addPendingAction({ threadId, tool, args, reason: verdict.reason });
    await this.append(threadId, userId, 'tool', { tool, args, status: 'pending', reason: verdict.reason, pendingActionId: action.id });
    return { status: 'pending', action };
  }

  async listActions(threadId: string, userId: string): Promise<InstanceAiPendingAction[]> {
    await this.requireThread(threadId, userId);
    return this.repos.instanceAi.listPendingActions(threadId);
  }

  /** 归属校验：动作 → 线程 → userId 必须匹配;返回 {action, thread}。 */
  private async requireAction(actionId: string, userId: string): Promise<InstanceAiPendingAction> {
    const action = await this.repos.instanceAi.findPendingAction(actionId);
    if (!action) throw new OperationalError('Action not found', { status: 404 });
    await this.requireThread(action.threadId, userId); // 归属经线程校验（铁律 2）
    return action;
  }

  /** 批准：执行工具 → 记结果 + tool 消息。只有 pending 可批准。 */
  async approveAction(actionId: string, userId: string, projectId: string): Promise<InstanceAiPendingAction> {
    const action = await this.requireAction(actionId, userId);
    if (action.status !== 'pending') throw new OperationalError(`Action already ${action.status}`, { status: 409 });
    const result = await this.execToolWithTree(action.threadId, userId, projectId, action.tool, action.args);
    await this.repos.instanceAi.decidePendingAction(actionId, { status: 'approved', result, decidedBy: userId });
    await this.append(action.threadId, userId, 'tool', { tool: action.tool, args: action.args, result, status: 'approved' });
    return (await this.repos.instanceAi.findPendingAction(actionId))!;
  }

  /** 拒绝：不执行,只记状态 + tool 消息。 */
  async rejectAction(actionId: string, userId: string): Promise<InstanceAiPendingAction> {
    const action = await this.requireAction(actionId, userId);
    if (action.status !== 'pending') throw new OperationalError(`Action already ${action.status}`, { status: 409 });
    await this.repos.instanceAi.decidePendingAction(actionId, { status: 'rejected', result: null, decidedBy: userId });
    await this.append(action.threadId, userId, 'tool', { tool: action.tool, args: action.args, status: 'rejected' });
    return (await this.repos.instanceAi.findPendingAction(actionId))!;
  }

  /* ── 运行树（#45 M4）：助手动作的调用树,供「观察」 ── */
  async listRuns(threadId: string, userId: string): Promise<InstanceAiRunNode[]> {
    await this.requireThread(threadId, userId);
    return this.repos.instanceAi.listRunNodes(threadId);
  }

  /* ── 观察-反思记忆（#45 M4）：embedding 检索,scope=instance 跨线程 ── */
  /** 记一条经验：embed 内容 → 落库。scope=instance 跨线程可召回;kind=observation|reflection。 */
  async remember(threadId: string, userId: string, input: { scope?: string; kind?: string; content: string }): Promise<InstanceAiMemory> {
    await this.requireThread(threadId, userId);
    const content = input.content.trim();
    if (!content) throw new OperationalError('content is required', { status: 400 });
    const scope = input.scope === 'thread' ? 'thread' : 'instance';
    const kind = input.kind === 'reflection' ? 'reflection' : 'observation';
    return this.repos.instanceAi.addMemory({ userId, threadId, scope, kind, content, embedding: embed(content) });
  }

  /** 召回相关经验：embed query → 候选(instance 跨线程 + 本线程 thread) top-k。 */
  async recall(userId: string, query: string, threadId: string | null, limit = 5): Promise<InstanceAiMemory[]> {
    const q = embed(query);
    const candidates = await this.repos.instanceAi.memoriesForRecall(userId, threadId);
    return topKMemories(q, candidates, limit);
  }

  listMemories(userId: string): Promise<InstanceAiMemory[]> {
    return this.repos.instanceAi.listMemories(userId);
  }
}
