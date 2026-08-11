import { randomUUID } from 'node:crypto';
import { OperationalError } from '@nomops/workflow';

export interface WebhookTestListener {
  id: string;
  workflowId: string;
  projectId: string;
  nodeName: string;
  method: string;
  path: string;
  expiresAt: Date;
}

/**
 * Webhook 测试监听是编辑期、单次消费的短生命周期状态。
 * 它不写生产 webhook_entities，避免草稿路径污染已发布路由；到期、停止或命中一次即删除。
 */
export class WebhookTestListenerService {
  private readonly listeners = new Map<string, WebhookTestListener>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private readonly ttlMs = 120_000) {}

  private key(path: string, method: string): string {
    return `${method.toUpperCase()}:${path}`;
  }

  register(input: Omit<WebhookTestListener, 'id' | 'expiresAt'>): WebhookTestListener {
    this.stop(input.workflowId, input.nodeName, input.projectId);
    const key = this.key(input.path, input.method);
    const occupied = this.peek(input.path, input.method);
    if (occupied) {
      throw new OperationalError(`Webhook test URL is already listening: ${input.method.toUpperCase()} /webhook-test/${input.path}`, {
        status: 409,
      });
    }

    const listener: WebhookTestListener = {
      ...input,
      id: randomUUID(),
      method: input.method.toUpperCase(),
      expiresAt: new Date(Date.now() + this.ttlMs),
    };
    this.listeners.set(key, listener);
    const timer = setTimeout(() => this.removeByKey(key), this.ttlMs);
    timer.unref?.();
    this.timers.set(key, timer);
    return listener;
  }

  peek(path: string, method: string): WebhookTestListener | null {
    const key = this.key(path, method);
    const listener = this.listeners.get(key);
    if (!listener) return null;
    if (listener.expiresAt.getTime() <= Date.now()) {
      this.removeByKey(key);
      return null;
    }
    return listener;
  }

  consume(path: string, method: string, id: string): WebhookTestListener | null {
    const key = this.key(path, method);
    const listener = this.peek(path, method);
    if (!listener || listener.id !== id) return null;
    this.removeByKey(key);
    return listener;
  }

  stop(workflowId: string, nodeName: string, projectId: string): boolean {
    for (const [key, listener] of this.listeners) {
      if (listener.workflowId === workflowId && listener.nodeName === nodeName && listener.projectId === projectId) {
        this.removeByKey(key);
        return true;
      }
    }
    return false;
  }

  stopAll(): void {
    for (const key of [...this.listeners.keys()]) this.removeByKey(key);
  }

  private removeByKey(key: string): void {
    this.listeners.delete(key);
    const timer = this.timers.get(key);
    if (timer) clearTimeout(timer);
    this.timers.delete(key);
  }
}
