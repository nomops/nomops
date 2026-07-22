import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { BootstrapResult } from '../bootstrap.js';
import { bootstrap } from '../bootstrap.js';
import { createApp } from '../app.js';
import { OtelService } from '../ee/services/otel-service.js';

/**
 * OpenTelemetry 追踪导出（backlog #27）：
 * 配置持久化 + 端点 admin 门 + OTLP/HTTP span 载荷（禁用不发、抽样、节点 span、错误状态）。
 */
let boot: BootstrapResult;
let app: Express;
let token: string;

async function setup() {
  boot = await bootstrap({ dbConfig: { type: 'sqlite' } });
  app = createApp(boot.services);
  const reg = await request(app).post('/auth/register').send({ email: 'otel@dev.dev', password: 'password-123' }).expect(201);
  token = reg.body.token;
}
const authed = () => ({ Authorization: `Bearer ${token}` });

afterEach(async () => {
  await boot.shutdown();
});

describe('OTel 配置端点', () => {
  it('GET 默认 disabled;PUT 存 + 回读', async () => {
    await setup();
    const def = await request(app).get('/api/otel').set(authed()).expect(200);
    expect(def.body.enabled).toBe(false);
    expect(def.body.tracePath).toBe('/v1/traces');

    const saved = await request(app)
      .put('/api/otel')
      .set(authed())
      .send({ enabled: true, endpoint: 'http://collector:4318', serviceName: 'my-nomops', sampleRate: 0.5, includeNodeSpans: true })
      .expect(200);
    expect(saved.body).toMatchObject({ enabled: true, endpoint: 'http://collector:4318', serviceName: 'my-nomops', sampleRate: 0.5, includeNodeSpans: true });

    const read = await request(app).get('/api/otel').set(authed()).expect(200);
    expect(read.body.enabled).toBe(true);
  });
});

describe('OTLP span 导出器', () => {
  const trace = {
    executionId: 'exec-1',
    workflowId: 'wf-1',
    workflowName: 'Ping',
    status: 'success',
    mode: 'manual',
    startedAtMs: 1_700_000_000_000,
    endedAtMs: 1_700_000_000_120,
    nodes: [
      { name: 'Start', startedAtMs: 1_700_000_000_000, endedAtMs: 1_700_000_000_010 },
      { name: 'Boom', startedAtMs: 1_700_000_000_010, endedAtMs: 1_700_000_000_020, error: 'kaboom' },
    ],
  };

  async function exporter(cfg: Record<string, unknown>, random = 0) {
    await setup();
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200 }) as unknown as Response);
    const svc = new OtelService(boot.services.repos, fetchImpl as unknown as typeof fetch, () => random);
    await svc.setConfig(cfg);
    svc.exportExecution(trace);
    await new Promise((r) => setTimeout(r, 20)); // fire-and-forget 落定
    return fetchImpl;
  }

  it('禁用 → 不发', async () => {
    const f = await exporter({ enabled: false, endpoint: 'http://c:4318' });
    expect(f).not.toHaveBeenCalled();
  });

  it('启用 → POST OTLP 到 endpoint+tracePath,root span 属性齐,状态 OK', async () => {
    const f = await exporter({ enabled: true, endpoint: 'http://collector:4318/', tracePath: '/v1/traces' });
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe('http://collector:4318/v1/traces');
    const body = JSON.parse((init as { body: string }).body);
    const span = body.resourceSpans[0].scopeSpans[0].spans[0];
    expect(span.name).toBe('workflow.execute');
    expect(span.status.code).toBe(1); // OK
    const attrs = Object.fromEntries(span.attributes.map((a: { key: string; value: { stringValue: string } }) => [a.key, a.value.stringValue]));
    expect(attrs['nomops.execution.id']).toBe('exec-1');
    expect(attrs['nomops.execution.status']).toBe('success');
    // 默认 includeNodeSpans=false → 只有 root span
    expect(body.resourceSpans[0].scopeSpans[0].spans).toHaveLength(1);
  });

  it('includeNodeSpans → 逐节点 child span,错误节点 status ERROR', async () => {
    const f = await exporter({ enabled: true, endpoint: 'http://c:4318', includeNodeSpans: true });
    const spans = JSON.parse((f.mock.calls[0]![1] as { body: string }).body).resourceSpans[0].scopeSpans[0].spans;
    expect(spans).toHaveLength(3); // root + 2 nodes
    const boom = spans.find((s: { name: string }) => s.name === 'node.Boom');
    expect(boom.status.code).toBe(2); // ERROR
    expect(boom.parentSpanId).toBe(spans[0].spanId);
  });

  it('抽样:random > sampleRate → 丢弃', async () => {
    const f = await exporter({ enabled: true, endpoint: 'http://c:4318', sampleRate: 0.3 }, 0.9);
    expect(f).not.toHaveBeenCalled();
  });
});
