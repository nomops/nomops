import type { AiBuilderTemporaryWorkflow, Repositories, WorkflowBuilderSession } from '@nomops/db';
import type { JsonObject } from '@nomops/workflow';
import { OperationalError } from '@nomops/workflow';
import type { AssistantService, ChatMessage } from './assistant-service.js';
import type { WorkflowService } from './workflow-service.js';

/**
 * AI 建流会话（backlog #45 M1，docs/13 组 A）：用户自然语言多轮迭代出一个工作流。
 * 复用 assistant-service 生成 + 结构校验（extractWorkflow）;每产出一版草稿建一条临时流
 * revision（不进 workflows 表,防列表污染+误激活）。满意时 Apply → 走 WorkflowService.create
 * 物化为正式 workflow（初始版本 v1，复用 #40 发布经验）。
 */

export interface BuilderChatResult {
  reply: string;
  /** 本轮若产出合法草稿,附新 revision（否则 null,例如助手在追问澄清）。 */
  revision: BuilderRevisionView | null;
}

export interface BuilderRevisionView {
  id: string;
  revision: number;
  name: string;
  summary: string;
  createdAt: Date;
}

export interface BuilderSessionDetail {
  session: WorkflowBuilderSession;
  revisions: BuilderRevisionView[];
}

function revView(r: AiBuilderTemporaryWorkflow): BuilderRevisionView {
  return { id: r.id, revision: r.revision, name: r.name, summary: r.summary, createdAt: r.createdAt };
}

export class WorkflowBuilderService {
  constructor(
    private readonly repos: Repositories,
    private readonly assistant: AssistantService,
    private readonly workflows: WorkflowService,
  ) {}

  async createSession(userId: string, projectId: string, goal: string): Promise<WorkflowBuilderSession> {
    const trimmed = goal.trim();
    if (!trimmed) throw new OperationalError('goal is required', { status: 400 });
    // 标题取目标首行前 60 字,便于列表辨识
    const title = trimmed.split('\n')[0]!.slice(0, 60);
    return this.repos.workflowBuilder.createSession({ userId, projectId, title, goal: trimmed });
  }

  async listSessions(projectId: string): Promise<WorkflowBuilderSession[]> {
    return this.repos.workflowBuilder.listSessions(projectId);
  }

  async getSession(id: string, projectId: string): Promise<BuilderSessionDetail> {
    const session = await this.repos.workflowBuilder.findSession(id, projectId);
    if (!session) throw new OperationalError('Builder session not found', { status: 404 });
    const revisions = (await this.repos.workflowBuilder.listRevisions(id)).map(revView);
    return { session, revisions };
  }

  /** 一轮迭代：喂累计对话给助手 → 有合法草稿则建新 revision（服务端权威记消息,不信客户端回传）。 */
  async chat(sessionId: string, projectId: string, message: string, credentialId?: string, model?: string): Promise<BuilderChatResult> {
    const text = message.trim();
    if (!text) throw new OperationalError('message is required', { status: 400 });
    const session = await this.repos.workflowBuilder.findSession(sessionId, projectId);
    if (!session) throw new OperationalError('Builder session not found', { status: 404 });
    if (session.status !== 'active') throw new OperationalError(`Session is ${session.status}, cannot chat`, { status: 409 });

    const history = (session.messages as unknown as ChatMessage[]) ?? [];
    const messages: ChatMessage[] = [...history, { role: 'user', content: text }];

    const result = await this.assistant.chat(projectId, messages, credentialId, undefined, model);
    const nextMessages: ChatMessage[] = [...messages, { role: 'assistant', content: result.reply }];

    let revision: BuilderRevisionView | null = null;
    let currentRevisionId = session.currentRevisionId;
    if (result.workflow) {
      const existing = await this.repos.workflowBuilder.listRevisions(sessionId);
      const nextNum = existing.reduce((max, r) => Math.max(max, r.revision), 0) + 1;
      // summary 取助手回复首行（去掉 json 代码块前的说明句），fallback 到流程名
      const firstLine = result.reply.split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('```'));
      const created = await this.repos.workflowBuilder.addRevision({
        sessionId,
        revision: nextNum,
        name: result.workflow.name,
        nodes: result.workflow.nodes,
        connections: result.workflow.connections,
        summary: (firstLine ?? result.workflow.name).slice(0, 200),
      });
      currentRevisionId = created.id; // 新草稿成为当前预览版
      revision = revView(created);
    }

    await this.repos.workflowBuilder.updateSession(sessionId, {
      messages: nextMessages as unknown as JsonObject[],
      currentRevisionId,
    });
    return { reply: result.reply, revision };
  }

  /** 取某版草稿的完整 nodes/connections（预览走前端 ReadOnlyCanvas）。 */
  async getRevision(sessionId: string, projectId: string, revisionId: string): Promise<AiBuilderTemporaryWorkflow> {
    const session = await this.repos.workflowBuilder.findSession(sessionId, projectId);
    if (!session) throw new OperationalError('Builder session not found', { status: 404 });
    const rev = await this.repos.workflowBuilder.findRevision(revisionId, sessionId);
    if (!rev) throw new OperationalError('Revision not found', { status: 404 });
    return rev;
  }

  /** 回退到某版草稿：把它设为当前预览版（不删后来的版本,只移动指针）。 */
  async rollback(sessionId: string, projectId: string, revisionId: string): Promise<BuilderSessionDetail> {
    const rev = await this.getRevision(sessionId, projectId, revisionId);
    await this.repos.workflowBuilder.updateSession(sessionId, { currentRevisionId: rev.id });
    return this.getSession(sessionId, projectId);
  }

  /**
   * Apply：把某版草稿物化为正式 workflow（默认当前预览版）。会话置 applied,记 appliedWorkflowId。
   * 走 WorkflowService.create → 结构校验 + 初始版本 v1 + 凭证依赖索引（#40b）。
   */
  async apply(
    sessionId: string,
    projectId: string,
    userId: string,
    revisionId?: string,
  ): Promise<{ workflowId: string; name: string }> {
    const session = await this.repos.workflowBuilder.findSession(sessionId, projectId);
    if (!session) throw new OperationalError('Builder session not found', { status: 404 });
    if (session.status !== 'active') throw new OperationalError(`Session already ${session.status}`, { status: 409 });
    const targetId = revisionId ?? session.currentRevisionId;
    if (!targetId) throw new OperationalError('No draft to apply yet', { status: 400 });
    const rev = await this.repos.workflowBuilder.findRevision(targetId, sessionId);
    if (!rev) throw new OperationalError('Revision not found', { status: 404 });

    const wf = await this.workflows.create({ name: rev.name, nodes: rev.nodes, connections: rev.connections }, projectId, userId);
    await this.repos.workflowBuilder.updateSession(sessionId, { status: 'applied', appliedWorkflowId: wf.id });
    return { workflowId: wf.id, name: wf.name };
  }

  async discard(sessionId: string, projectId: string): Promise<void> {
    const session = await this.repos.workflowBuilder.findSession(sessionId, projectId);
    if (!session) throw new OperationalError('Builder session not found', { status: 404 });
    if (session.status === 'active') await this.repos.workflowBuilder.updateSession(sessionId, { status: 'discarded' });
  }
}
