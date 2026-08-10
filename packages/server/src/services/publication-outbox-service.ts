import { randomUUID } from 'node:crypto';
import type { Repositories, Workflow } from '@nomops/db';
import type { ActiveWorkflowManager } from '../triggers/active-workflow-manager.js';

/** 发布后的触发器重注册采用持久化 outbox；失败/重启后由 leader 重放。 */
export class PublicationOutboxService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private readonly owner = randomUUID();

  constructor(
    private readonly repos: Repositories,
    private readonly activeWorkflows: ActiveWorkflowManager,
    private readonly isLeader: () => boolean,
    private readonly intervalMs = 1_000,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      if (this.isLeader()) void this.tick();
    }, this.intervalMs);
    this.timer.unref?.();
    if (this.isLeader()) void this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async publish(row: Workflow): Promise<void> {
    if (!row.publishedVersionId) return;
    // 事件已由 WorkflowRepository.markPublished 与生产指针同事务写入；这里只做低延迟投递。
    await this.tick(true);
  }

  async tick(force = false): Promise<number> {
    if (this.running || (!force && !this.isLeader())) return 0;
    this.running = true;
    let delivered = 0;
    try {
      const entries = await this.repos.publishPipeline.claimPublications(this.owner);
      for (const entry of entries) {
        try {
          const row = await this.repos.workflows.findByIdUnscoped(entry.workflowId);
          if (row?.active) await this.activeWorkflows.add(row);
          await this.repos.publishPipeline.completePublication(entry.id, this.owner);
          delivered++;
        } catch (error) {
          console.error(`[nomops] 发布 outbox 重放失败 ${entry.workflowId}:`, (error as Error).message);
          await this.repos.publishPipeline.retryPublication(entry.id, this.owner, entry.attempts);
        }
      }
      return delivered;
    } finally {
      this.running = false;
    }
  }
}
