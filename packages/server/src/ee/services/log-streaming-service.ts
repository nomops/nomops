import { createHmac, randomUUID } from 'node:crypto';
import { createSocket } from 'node:dgram';
import { createConnection } from 'node:net';
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

/** 顶层类别。dispatch 时执行事件按 status 派生子类型（execution.success 等）。 */
export type StreamEventType = 'execution' | 'audit';
/** 可订阅事件（细粒度事件树）：顶层类别 + 执行子类型。订阅顶层 = 收其全部子类型。 */
export type StreamEventSubscription =
  | 'execution'
  | 'execution.success'
  | 'execution.error'
  | 'execution.canceled'
  | 'execution.waiting'
  | 'audit';
export type DestinationKind = 'webhook' | 'syslog';

export interface StreamEvent {
  type: StreamEventType;
  at: string;
  projectId?: string | null;
  status?: string;
  [key: string]: unknown;
}

const ALL_SUBSCRIPTIONS: StreamEventSubscription[] = [
  'execution',
  'execution.success',
  'execution.error',
  'execution.canceled',
  'execution.waiting',
  'audit',
];

/** 某事件的完整子类型（执行 → execution.<status>；审计 → audit）。 */
function effectiveType(event: StreamEvent): string {
  if (event.type === 'execution' && typeof event.status === 'string') return `execution.${event.status}`;
  return event.type;
}

/** 订阅是否匹配某事件：顶层 'execution' 匹配所有 execution.*；子类型精确匹配。 */
function subscriptionMatches(subscriptions: StreamEventSubscription[], event: StreamEvent): boolean {
  const eff = effectiveType(event);
  return subscriptions.some((s) => s === eff || (s === event.type && eff.startsWith(`${event.type}`)));
}

/** 存储态目的地（含密钥，仅进程内 / DB，不出 API）。 */
interface Destination {
  id: string;
  name: string;
  kind: DestinationKind;
  url: string;
  secret: string;
  events: StreamEventSubscription[];
  enabled: boolean;
  createdAt: string;
}

/** API 视图：脱敏，绝不含 secret 明文。 */
export interface DestinationView {
  id: string;
  name: string;
  kind: DestinationKind;
  url: string;
  events: StreamEventSubscription[];
  enabled: boolean;
  secretConfigured: boolean;
  createdAt: string;
}

export type PostFn = (
  url: string,
  body: string,
  headers: Record<string, string>,
) => Promise<{ status: number }>;

/** syslog 发送器（可注入测试）：按 RFC 5424 把一行消息送到 udp://host:port 或 tcp://host:port。 */
export type SyslogFn = (target: { protocol: 'udp' | 'tcp'; host: string; port: number; message: string }) => Promise<void>;

const SETTINGS_KEY = 'logStreaming.destinations';

const realPost: PostFn = async (url, body, headers) => {
  const res = await fetch(url, { method: 'POST', headers, body });
  return { status: res.status };
};

const realSyslog: SyslogFn = ({ protocol, host, port, message }) =>
  new Promise((resolve, reject) => {
    const buf = Buffer.from(message, 'utf8');
    if (protocol === 'udp') {
      const sock = createSocket('udp4');
      sock.send(buf, port, host, (err) => {
        sock.close();
        if (err) reject(err);
        else resolve();
      });
    } else {
      const sock = createConnection({ host, port }, () => {
        sock.write(buf.length + ' ' + message, () => {
          sock.end();
          resolve();
        });
      });
      sock.on('error', reject);
      sock.setTimeout(10_000, () => {
        sock.destroy();
        reject(new Error('syslog TCP timeout'));
      });
    }
  });

/** RFC 5424 一行：<PRI>1 TIMESTAMP HOST APP PROCID MSGID - MSG。PRI = facility(16=local0)*8 + severity。 */
function syslog5424(event: StreamEvent): string {
  const severity = event.status === 'error' ? 3 : 6; // error→err(3),其余→info(6)
  const pri = 16 * 8 + severity;
  const app = 'nomops';
  const msgid = effectiveType(event);
  return `<${pri}>1 ${event.at} ${app} ${app} - ${msgid} - ${JSON.stringify(event)}`;
}

export class LogStreamingService {
  constructor(
    private readonly repos: Repositories,
    private readonly post: PostFn = realPost,
    private readonly syslog: SyslogFn = realSyslog,
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
      kind: d.kind ?? 'webhook', // 老数据无 kind → webhook
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
    kind?: DestinationKind;
    secret?: string;
    events?: StreamEventSubscription[];
  }): Promise<DestinationView> {
    const name = input.name?.trim();
    const url = input.url?.trim();
    const kind: DestinationKind = input.kind === 'syslog' ? 'syslog' : 'webhook';
    if (!name) throw new OperationalError('name is required', { status: 400 });
    if (kind === 'webhook') {
      if (!url || !/^https?:\/\//.test(url)) {
        throw new OperationalError('webhook url must be an http(s) address', { status: 400 });
      }
    } else {
      if (!url || !/^(udp|tcp):\/\/[^:]+:\d+$/.test(url)) {
        throw new OperationalError('syslog url must be udp://host:port or tcp://host:port', { status: 400 });
      }
    }
    const events = (input.events?.length ? input.events : ALL_SUBSCRIPTIONS).filter((e) =>
      ALL_SUBSCRIPTIONS.includes(e),
    );
    const dest: Destination = {
      id: randomUUID(),
      name,
      kind,
      url,
      secret: input.secret?.trim() ?? '',
      events: events.length ? events : ALL_SUBSCRIPTIONS,
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

  /** 向单个目的地发送一条测试事件，返回接收方状态（webhook=HTTP 码；syslog=送达即 200）。 */
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
          if (!dest.enabled || !subscriptionMatches(dest.events, event)) continue;
          await this.send(dest, event).catch((err: Error) => {
            console.error(`[nomops] 日志流推送失败 (${dest.name}):`, err.message);
          });
        }
      })
      .catch((err: Error) => console.error('[nomops] 日志流读取失败:', err.message));
  }

  private async send(dest: Destination, event: StreamEvent): Promise<number> {
    if ((dest.kind ?? 'webhook') === 'syslog') {
      const m = /^(udp|tcp):\/\/([^:]+):(\d+)$/.exec(dest.url);
      if (!m) throw new OperationalError('invalid syslog url', { status: 400 });
      await this.syslog({ protocol: m[1] as 'udp' | 'tcp', host: m[2]!, port: Number(m[3]), message: syslog5424(event) });
      return 200; // 送达即视为成功（syslog 无应答语义）
    }
    const body = JSON.stringify(event);
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'x-nomops-event': effectiveType(event),
    };
    if (dest.secret) {
      headers['x-nomops-signature'] = createHmac('sha256', dest.secret).update(body).digest('hex');
    }
    const { status } = await this.post(dest.url, body, headers);
    return status;
  }
}
