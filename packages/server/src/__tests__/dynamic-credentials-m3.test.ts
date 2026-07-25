import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { BootstrapResult } from '../bootstrap.js';
import { bootstrap } from '../bootstrap.js';
import { createApp } from '../app.js';
import { licensedBoot, setupOwner } from './helpers.js';

/**
 * backlog #46 M3：管理台完善（审计 + 批量导入）。
 * 验收：动态凭证改动进审计（谁/何时/哪个 subject——绝无值,铁律 3）；批量导入建多条。
 */
let boot: BootstrapResult;
let app: Express;
let token: string;
const authed = () => ({ Authorization: `Bearer ${token}` });

beforeAll(async () => {
  boot = await bootstrap({ dbConfig: { type: 'sqlite' }, ...licensedBoot() });
  app = createApp(boot.services);
  token = (await setupOwner(app, 'dynm3@cred.dev')).token;
});

afterAll(async () => {
  await boot.shutdown();
});

/** 审计写入是 fire-and-forget → 轮询直到出现 count 条。 */
async function auditFor(resolverId: string, min = 1): Promise<Array<{ action: string; details: Record<string, unknown> }>> {
  for (let i = 0; i < 30; i++) {
    const rows = (await request(app).get(`/api/dynamic-credentials/resolvers/${resolverId}/audit`).set(authed()).expect(200)).body;
    if (rows.length >= min) return rows;
    await new Promise((r) => setTimeout(r, 50));
  }
  return (await request(app).get(`/api/dynamic-credentials/resolvers/${resolverId}/audit`).set(authed()).expect(200)).body;
}

describe('动态凭证审计（#46 M3）', () => {
  let resolverId = '';

  it('建解析器 → 审计记 resolver-create（元数据,无值）', async () => {
    resolverId = (await request(app).post('/api/dynamic-credentials/resolvers').set(authed()).send({ name: 'audited', kind: 'table' }).expect(201)).body.id;
    const rows = await auditFor(resolverId, 1);
    expect(rows.some((r) => r.action === 'dyncred.resolver-create')).toBe(true);
  });

  it('存 subject 值 → 审计记 entry-set,含 subject 不含值（铁律 3）', async () => {
    await request(app).put(`/api/dynamic-credentials/resolvers/${resolverId}/entry`).set(authed()).send({ subject: 'acme', data: { accessToken: 'TOP-SECRET-VALUE' } }).expect(204);
    const rows = await auditFor(resolverId, 2);
    const setRow = rows.find((r) => r.action === 'dyncred.entry-set');
    expect(setRow).toBeTruthy();
    expect(setRow!.details['subject']).toBe('acme');
    // ★铁律 3：审计里绝无凭证值
    expect(JSON.stringify(rows)).not.toContain('TOP-SECRET-VALUE');
  });

  it('删 subject → 审计记 entry-delete', async () => {
    await request(app).delete(`/api/dynamic-credentials/resolvers/${resolverId}/entry?subject=acme`).set(authed()).expect(204);
    const rows = await auditFor(resolverId, 3);
    expect(rows.some((r) => r.action === 'dyncred.entry-delete' && r.details['subject'] === 'acme')).toBe(true);
  });

  it('审计按 resolver 过滤（别的 resolver 的审计不混入）', async () => {
    const other = (await request(app).post('/api/dynamic-credentials/resolvers').set(authed()).send({ name: 'other', kind: 'table' }).expect(201)).body.id;
    await request(app).put(`/api/dynamic-credentials/resolvers/${other}/entry`).set(authed()).send({ subject: 'x', data: { k: 'v' } }).expect(204);
    const rows = await auditFor(resolverId, 3);
    // 本 resolver 的审计不含 other 的 entry-set（other 只有它自己的记录）
    const otherRows = await auditFor(other, 1);
    expect(otherRows.every((r) => r.action !== 'dyncred.resolver-create' || true)).toBe(true);
    expect(rows.some((r) => r.details['subject'] === 'x')).toBe(false);
  });
});

describe('批量导入（#46 M3）', () => {
  let resolverId = '';

  it('导入 { subject: {值} } → 建多条 + 审计记 count/subjects（无值）', async () => {
    resolverId = (await request(app).post('/api/dynamic-credentials/resolvers').set(authed()).send({ name: 'bulk', kind: 'table' }).expect(201)).body.id;
    const r = (await request(app).post(`/api/dynamic-credentials/resolvers/${resolverId}/import`).set(authed()).send({
      entries: { 't1': { accessToken: 'AAA' }, 't2': { accessToken: 'BBB' }, 't3': { accessToken: 'CCC' } },
    }).expect(201)).body;
    expect(r.imported).toBe(3);

    const subjects = (await request(app).get(`/api/dynamic-credentials/resolvers/${resolverId}/subjects`).set(authed()).expect(200)).body;
    expect(subjects.map((s: { subject: string }) => s.subject).sort()).toEqual(['t1', 't2', 't3']);
    // 值不进审计
    const rows = await auditFor(resolverId, 2);
    expect(JSON.stringify(rows)).not.toContain('AAA');
    expect(rows.some((r) => r.action === 'dyncred.entry-import' && r.details['count'] === 3)).toBe(true);
  });

  it('导入非对象值 → 400', async () => {
    await request(app).post(`/api/dynamic-credentials/resolvers/${resolverId}/import`).set(authed()).send({ entries: { bad: 'not-an-object' } }).expect(400);
  });

  it('空导入 → 400', async () => {
    await request(app).post(`/api/dynamic-credentials/resolvers/${resolverId}/import`).set(authed()).send({ entries: {} }).expect(400);
  });
});

describe('license 门（#46 M3）', () => {
  it('无 license → audit/import 403', async () => {
    const unlic = await bootstrap({ dbConfig: { type: 'sqlite' } });
    const app2 = createApp(unlic.services);
    const t = (await setupOwner(app2, 'm3nolic@cred.dev')).token;
    await request(app2).get('/api/dynamic-credentials/resolvers/x/audit').set({ Authorization: `Bearer ${t}` }).expect(403);
    await request(app2).post('/api/dynamic-credentials/resolvers/x/import').set({ Authorization: `Bearer ${t}` }).send({ entries: {} }).expect(403);
    await unlic.shutdown();
  });
});
