import { createHmac, randomUUID } from 'node:crypto';
import type { Repositories } from '@nomops/db';
import { OperationalError } from '@nomops/workflow';

/**
 * 日志/事件流（docs/10 B3，企业功能 `logStreaming`）：把执行与审计事件推到外部 webhook sink。
 *
 * 设计要点：
 * - 目的地存 settings（JSON），密钥（签名用）**绝不经 API 返回**——对齐铁律 3 的精神
 *   （凭证/密钥类明文不出 API）。列表只回 `secretConfigured` 布尔。
 * - 每条事件用 HMAC-SHA256(secret, body) 签名，放到 `x-nomops-signature` 头，接收方可验真。
 * - dispatch 为 fire-and-forget：推送失败只告警，绝不阻断执行/审计主流程。
 * - post 函数可注入，测试用进程内接收器，不打真实网络。
 */

export type StreamEventType = 'execution' | 'audit';

export interface StreamEvent {
  type: StreamEventType;
  at: string;
  projectId?: string | null;
  [key: string]: unknown;
}

/** 存储态目的地（含密钥，仅进程内 / DB，不出 API）。 */
interface Destination {
  id: string;
  name: string;
  url: string;
  secret: string;
  events: StreamEventType[];
  enabled: boolean;
  createdAt: string;
}

/** API 视图：脱敏，绝不含 secret 明文。 */
export interface DestinationView {
  id: string;
  name: string;
  url: string;
  events: StreamEventType[];
  enabled: boolean;
  secretConfigured: boolean;
  createdAt: string;
}

export type PostFn = (
  url: string,
  body: string,
  headers: Record<string, string>,
) => Promise<{ status: number }>;

const SETTINGS_KEY = 'logStreaming.destinations';
const ALL_TYPES: StreamEventType[] = ['execution', 'audit'];

const realPost: PostFn = async (url, body, headers) => {
  const res = await fetch(url, { method: 'POST', headers, body });
  return { status: res.status };
};

export class LogStreamingService {
  constructor(
    private readonly repos: Repositories,
    private readonly post: PostFn = realPost,
  ) {}

  private async load(): Promise<Destination[]> {
    const raw = await this.repos.settings.get(SETTINGS_KEY);
    if (!raw) return [];
    try {
      return JSON.parse(raw) as Destination[];
    } catch {
      return [];
    }
  }

  private async save(list: Destination[]): Promise<void> {
    await this.repos.settings.set(SETTINGS_KEY, JSON.stringify(list));
  }

  private view(d: Destination): DestinationView {
    return {
      id: d.id,
      name: d.name,
      url: d.url,
      events: d.events,
      enabled: d.enabled,
      secretConfigured: d.secret.length > 0,
      createdAt: d.createdAt,
    };
  }

  async list(): Promise<DestinationView[]> {
    return (await this.load()).map((d) => this.view(d));
  }

  async create(input: {
    name: string;
    url: string;
    secret?: string;
    events?: StreamEventType[];
  }): Promise<DestinationView> {
    const name = input.name?.trim();
    const url = input.url?.trim();
    if (!name) throw new OperationalError('name is required', { status: 400 });
    if (!url || !/^https?:\/\//.test(url)) {
      throw new OperationalError('url must be an http(s) address', { status: 400 });
    }
    const events = (input.events?.length ? input.events : ALL_TYPES).filter((e) =>
      ALL_TYPES.includes(e),
    );
    const dest: Destination = {
      id: randomUUID(),
      name,
      url,
      secret: input.secret?.trim() ?? '',
      events: events.length ? events : ALL_TYPES,
      enabled: true,
      createdAt: new Date().toISOString(),
    };
    const list = await this.load();
    list.push(dest);
    await this.save(list);
    return this.view(dest);
  }

  async remove(id: string): Promise<void> {
    const list = await this.load();
    const next = list.filter((d) => d.id !== id);
    if (next.length === list.length) throw new OperationalError('Destination not found', { status: 404 });
    await this.save(next);
  }

  /** 向单个目的地发送一条测试事件，返回接收方 HTTP 状态（用于 UI「测试发送」）。 */
  async test(id: string): Promise<{ ok: boolean; status: number }> {
    const dest = (await this.load()).find((d) => d.id === id);
    if (!dest) throw new OperationalError('Destination not found', { status: 404 });
    const status = await this.send(dest, {
      type: 'audit',
      at: new Date().toISOString(),
      action: 'logStreaming.test',
      message: 'nomops log streaming test event',
    });
    return { ok: status >= 200 && status < 300, status };
  }

  /** 广播事件到所有匹配且启用的目的地。fire-and-forget，不 await、不抛。 */
  dispatch(event: StreamEvent): void {
    void this.load()
      .then(async (list) => {
        for (const dest of list) {
          if (!dest.enabled || !dest.events.includes(event.type)) continue;
          await this.send(dest, event).catch((err: Error) => {
            console.error(`[nomops] 日志流推送失败 (${dest.name}):`, err.message);
          });
        }
      })
      .catch((err: Error) => console.error('[nomops] 日志流读取失败:', err.message));
  }

  private async send(dest: Destination, event: StreamEvent): Promise<number> {
    const body = JSON.stringify(event);
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'x-nomops-event': event.type,
    };
    if (dest.secret) {
      headers['x-nomops-signature'] = createHmac('sha256', dest.secret).update(body).digest('hex');
    }
    const { status } = await this.post(dest.url, body, headers);
    return status;
  }
}
