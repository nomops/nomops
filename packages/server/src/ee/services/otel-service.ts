import { randomBytes } from 'node:crypto';
import type { Repositories } from '@nomops/db';

/**
 * OpenTelemetry 追踪导出（backlog #27）。
 *
 * 零依赖手搓 OTLP/HTTP(JSON) 导出器（同 /metrics、SMTP、Vault 的取舍——不引 SDK）：
 * 每次执行收尾发一个 span（workflow.execute）到配置的 collector 的 traces endpoint。
 * 配置存 settings；未启用/未配 endpoint → 静默不发（无副作用）。
 * fire-and-forget：导出失败只告警，绝不阻断执行主流程。fetchImpl 可注入测试。
 */
export interface IOtelConfig {
  enabled: boolean;
  endpoint: string; // http://collector:4318
  tracePath: string; // /v1/traces
  serviceName: string;
  sampleRate: number; // 0..1
  includeNodeSpans: boolean;
}

const SETTINGS_KEY = 'otel.config';
const DEFAULTS: IOtelConfig = {
  enabled: false,
  endpoint: 'http://localhost:4318',
  tracePath: '/v1/traces',
  serviceName: 'nomops',
  sampleRate: 1,
  includeNodeSpans: false,
};

/** 一次执行的追踪数据（server 收尾时喂给导出器）。 */
export interface IExecutionTrace {
  executionId: string;
  workflowId: string;
  workflowName?: string;
  status: string;
  mode: string;
  startedAtMs: number;
  endedAtMs: number;
  /** 逐节点 span（includeNodeSpans 时导出）。 */
  nodes?: Array<{ name: string; startedAtMs: number; endedAtMs: number; error?: string }>;
}

/** 16 字节 traceId / 8 字节 spanId（hex）。 */
function traceId(): string {
  return randomBytes(16).toString('hex');
}
function spanId(): string {
  return randomBytes(8).toString('hex');
}
const nano = (ms: number) => String(Math.round(ms) * 1_000_000);

export class OtelService {
  private cache: IOtelConfig | null = null;

  constructor(
    private readonly repos: Repositories,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly randomImpl: () => number = Math.random,
  ) {}

  async getConfig(): Promise<IOtelConfig> {
    const raw = await this.repos.settings.get(SETTINGS_KEY);
    if (!raw) return { ...DEFAULTS };
    try {
      return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<IOtelConfig>) };
    } catch {
      return { ...DEFAULTS };
    }
  }

  async setConfig(input: Partial<IOtelConfig>): Promise<IOtelConfig> {
    const current = await this.getConfig();
    const next: IOtelConfig = {
      enabled: typeof input.enabled === 'boolean' ? input.enabled : current.enabled,
      endpoint: typeof input.endpoint === 'string' ? input.endpoint.trim() : current.endpoint,
      tracePath: typeof input.tracePath === 'string' ? input.tracePath.trim() || '/v1/traces' : current.tracePath,
      serviceName: typeof input.serviceName === 'string' ? input.serviceName.trim() || 'nomops' : current.serviceName,
      sampleRate:
        typeof input.sampleRate === 'number' ? Math.max(0, Math.min(1, input.sampleRate)) : current.sampleRate,
      includeNodeSpans:
        typeof input.includeNodeSpans === 'boolean' ? input.includeNodeSpans : current.includeNodeSpans,
    };
    await this.repos.settings.set(SETTINGS_KEY, JSON.stringify(next));
    this.cache = next;
    return next;
  }

  /** 执行收尾导出一个 span（fire-and-forget，供 execution-service 旁路调用）。 */
  exportExecution(trace: IExecutionTrace): void {
    void this.doExport(trace).catch((e: Error) => console.error('[nomops] OTLP 导出失败:', e.message));
  }

  private async doExport(trace: IExecutionTrace): Promise<void> {
    const cfg = this.cache ?? (await this.getConfig());
    this.cache = cfg;
    if (!cfg.enabled || !cfg.endpoint) return;
    if (this.randomImpl() > cfg.sampleRate) return; // 抽样

    const tid = traceId();
    const rootId = spanId();
    const rootErr = trace.status === 'error';
    const spans: unknown[] = [
      {
        traceId: tid,
        spanId: rootId,
        name: 'workflow.execute',
        kind: 1,
        startTimeUnixNano: nano(trace.startedAtMs),
        endTimeUnixNano: nano(trace.endedAtMs),
        attributes: [
          attr('nomops.execution.id', trace.executionId),
          attr('nomops.workflow.id', trace.workflowId),
          ...(trace.workflowName ? [attr('nomops.workflow.name', trace.workflowName)] : []),
          attr('nomops.execution.mode', trace.mode),
          attr('nomops.execution.status', trace.status),
        ],
        status: { code: rootErr ? 2 : 1 }, // ERROR=2, OK=1
      },
    ];
    if (cfg.includeNodeSpans) {
      for (const n of trace.nodes ?? []) {
        spans.push({
          traceId: tid,
          spanId: spanId(),
          parentSpanId: rootId,
          name: `node.${n.name}`,
          kind: 1,
          startTimeUnixNano: nano(n.startedAtMs),
          endTimeUnixNano: nano(n.endedAtMs),
          attributes: [attr('nomops.node.name', n.name), ...(n.error ? [attr('nomops.node.error', n.error)] : [])],
          status: { code: n.error ? 2 : 1 },
        });
      }
    }

    const payload = {
      resourceSpans: [
        {
          resource: { attributes: [attr('service.name', cfg.serviceName)] },
          scopeSpans: [{ scope: { name: 'nomops' }, spans }],
        },
      ],
    };
    const url = `${cfg.endpoint.replace(/\/+$/, '')}${cfg.tracePath.startsWith('/') ? '' : '/'}${cfg.tracePath}`;
    await this.fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }
}

function attr(key: string, value: string): { key: string; value: { stringValue: string } } {
  return { key, value: { stringValue: value } };
}
