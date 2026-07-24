import type { InstanceAiCheckpoint, InstanceAiMessage, InstanceAiThread, Repositories } from '@nomops/db';
import type { JsonObject } from '@nomops/workflow';
import { OperationalError } from '@nomops/workflow';
import type { AssistantService, ChatMessage } from './assistant-service.js';

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

export class InstanceAiService {
  constructor(
    private readonly repos: Repositories,
    private readonly assistant: AssistantService,
  ) {}

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
}
