import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import request from 'supertest';
import type { Express } from 'express';
import type { BootstrapResult } from '../bootstrap.js';
import { bootstrap } from '../bootstrap.js';
import { createApp } from '../app.js';
import { setupOwner, inviteUser, licensedBoot } from './helpers.js';

/**
 * 源码同步：连接 → push → 另一实例 pull 往返，走真实 git
 * （本地 bare 仓库当远端，无网络）。企业版 + 实例 admin 门控。
 */

const exec = promisify(execFile);
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
const emptyWf = (name: string) => ({ name, nodes: [], connections: {} });

let root: string;
let bareRepo: string;
let bootA: BootstrapResult;
let appA: Express;
let ownerA: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'nomops-sc-'));
  bareRepo = join(root, 'remote.git');
  await exec('git', ['init', '--bare', '-b', 'main', bareRepo]);

  bootA = await bootstrap({ dbConfig: { type: 'sqlite' }, ...licensedBoot(), sourceControlDir: join(root, 'workA') });
  appA = createApp(bootA.services);
  ownerA = (await setupOwner(appA, 'owner@sc.dev')).token;
});

afterAll(async () => {
  await bootA.shutdown();
  await rm(root, { recursive: true, force: true });
});

describe('门控', () => {
  it('社区版（无 license）→ 403 feature', async () => {
    const boot = await bootstrap({ dbConfig: { type: 'sqlite' }, licenseKey: null, sourceControlDir: join(root, 'workCE') });
    const app = createApp(boot.services);
    const t = (await setupOwner(app, 'ce@sc.dev')).token;
    const res = await request(app).get('/api/source-control').set(bearer(t)).expect(403);
    expect(res.body.feature).toBe('sourceControl');
    await boot.shutdown();
  });

  it('企业版但非 admin → 403', async () => {
    const memberToken = (await inviteUser(appA, ownerA, 'member@sc.dev')).token;
    await request(appA).get('/api/source-control').set(bearer(memberToken)).expect(403);
  });
});

describe('连接 → push → pull 往返', () => {
  let wf1: string;
  let wf2: string;

  it('未连接时 config.connected=false', async () => {
    const res = await request(appA).get('/api/source-control').set(bearer(ownerA)).expect(200);
    expect(res.body.connected).toBe(false);
  });

  it('连接仓库 → clone 成功，配置落地', async () => {
    const res = await request(appA).put('/api/source-control').set(bearer(ownerA)).send({ repoUrl: bareRepo, branch: 'main' }).expect(200);
    expect(res.body.connected).toBe(true);
    expect(res.body.branch).toBe('main');
  });

  it('建工作流 → status 列出待提交改动', async () => {
    wf1 = (await request(appA).post('/api/workflows').set(bearer(ownerA)).send(emptyWf('Alpha')).expect(201)).body.id;
    wf2 = (await request(appA).post('/api/workflows').set(bearer(ownerA)).send(emptyWf('Beta')).expect(201)).body.id;
    const status = await request(appA).get('/api/source-control/status').set(bearer(ownerA)).expect(200);
    expect(status.body.files.length).toBeGreaterThan(0);
    expect(status.body.files.some((f: { path: string }) => f.path.includes(wf1))).toBe(true);
  });

  it('push → committed=true，导出两个工作流文件', async () => {
    const res = await request(appA).post('/api/source-control/push').set(bearer(ownerA)).send({ message: 'initial' }).expect(200);
    expect(res.body.committed).toBe(true);
    expect(res.body.pushed).toBe(true);
    expect(res.body.files).toHaveLength(2);
  });

  it('无改动再 push → committed=false', async () => {
    const res = await request(appA).post('/api/source-control/push').set(bearer(ownerA)).send({}).expect(200);
    expect(res.body.committed).toBe(false);
  });

  it('另一实例连同一远端 → pull 导入两个工作流（保持同一 id）', async () => {
    const bootB = await bootstrap({ dbConfig: { type: 'sqlite' }, ...licensedBoot(), sourceControlDir: join(root, 'workB') });
    const appB = createApp(bootB.services);
    const ownerB = (await setupOwner(appB, 'owner-b@sc.dev')).token;
    await request(appB).put('/api/source-control').set(bearer(ownerB)).send({ repoUrl: bareRepo, branch: 'main' }).expect(200);

    const pull = await request(appB).post('/api/source-control/pull').set(bearer(ownerB)).expect(200);
    expect(pull.body.created).toBe(2);
    expect(pull.body.updated).toBe(0);

    // 同一 id 落地，名称一致
    const a = await request(appB).get(`/api/workflows/${wf1}`).set(bearer(ownerB)).expect(200);
    expect(a.body.name).toBe('Alpha');
    const b = await request(appB).get(`/api/workflows/${wf2}`).set(bearer(ownerB)).expect(200);
    expect(b.body.name).toBe('Beta');

    // 再 pull（无远端变化）→ 全部 updated（幂等，不重复创建）
    const again = await request(appB).post('/api/source-control/pull').set(bearer(ownerB)).expect(200);
    expect(again.body.created).toBe(0);
    expect(again.body.updated).toBe(2);
    await bootB.shutdown();
  });

  it('A 改工作流并 push → B pull 看到更新', async () => {
    await request(appA).patch(`/api/workflows/${wf1}`).set(bearer(ownerA)).send({ name: 'Alpha v2' }).expect(200);
    await request(appA).post('/api/source-control/push').set(bearer(ownerA)).send({ message: 'rename alpha' }).expect(200);

    const bootB = await bootstrap({ dbConfig: { type: 'sqlite' }, ...licensedBoot(), sourceControlDir: join(root, 'workB2') });
    const appB = createApp(bootB.services);
    const ownerB = (await setupOwner(appB, 'owner-b2@sc.dev')).token;
    await request(appB).put('/api/source-control').set(bearer(ownerB)).send({ repoUrl: bareRepo, branch: 'main' }).expect(200);
    await request(appB).post('/api/source-control/pull').set(bearer(ownerB)).expect(200);
    const a = await request(appB).get(`/api/workflows/${wf1}`).set(bearer(ownerB)).expect(200);
    expect(a.body.name).toBe('Alpha v2');
    await bootB.shutdown();
  });

  it('断开连接 → connected=false', async () => {
    await request(appA).delete('/api/source-control').set(bearer(ownerA)).expect(204);
    const res = await request(appA).get('/api/source-control').set(bearer(ownerA)).expect(200);
    expect(res.body.connected).toBe(false);
  });
});

describe('SSH 部署密钥', () => {
  it('GET /key → 生成有效 ED25519 公钥，重复取稳定', async () => {
    const first = await request(appA).get('/api/source-control/key').set(bearer(ownerA)).expect(200);
    expect(first.body.publicKey).toMatch(/^ssh-ed25519 [A-Za-z0-9+/=]+ nomops-deploy-key$/);
    const second = await request(appA).get('/api/source-control/key').set(bearer(ownerA)).expect(200);
    expect(second.body.publicKey).toBe(first.body.publicKey); // 不重生成
  });

  it('POST /key/refresh → 换新公钥', async () => {
    const before = (await request(appA).get('/api/source-control/key').set(bearer(ownerA)).expect(200)).body.publicKey;
    const refreshed = await request(appA).post('/api/source-control/key/refresh').set(bearer(ownerA)).expect(200);
    expect(refreshed.body.publicKey).toMatch(/^ssh-ed25519 /);
    expect(refreshed.body.publicKey).not.toBe(before);
  });

  it('SSH 连接 → config 带 connectionType=ssh + 公钥', async () => {
    const res = await request(appA)
      .put('/api/source-control')
      .set(bearer(ownerA))
      .send({ repoUrl: bareRepo, branch: 'main', connectionType: 'ssh' })
      .expect(200);
    expect(res.body.connectionType).toBe('ssh');
    expect(res.body.sshPublicKey).toMatch(/^ssh-ed25519 /);
    await request(appA).delete('/api/source-control').set(bearer(ownerA)).expect(204);
  });

  it('HTTPS 连接 → config.connectionType=https，公钥不外露', async () => {
    const res = await request(appA)
      .put('/api/source-control')
      .set(bearer(ownerA))
      .send({ repoUrl: bareRepo, branch: 'main', connectionType: 'https' })
      .expect(200);
    expect(res.body.connectionType).toBe('https');
    expect(res.body.sshPublicKey).toBe('');
    await request(appA).delete('/api/source-control').set(bearer(ownerA)).expect(204);
  });

  it('私钥加密落库，绝不出 API/config', async () => {
    await request(appA).get('/api/source-control/key').set(bearer(ownerA)).expect(200);
    const cfg = await request(appA).get('/api/source-control').set(bearer(ownerA)).expect(200);
    expect(JSON.stringify(cfg.body)).not.toContain('PRIVATE KEY');
    expect(JSON.stringify(cfg.body)).not.toContain('BEGIN OPENSSH');
  });
});

describe('选择性 push + pull 预览', () => {
  it('push 只传部分文件 → 只提交所选，其余仍在待提交', async () => {
    await request(appA).put('/api/source-control').set(bearer(ownerA)).send({ repoUrl: bareRepo, branch: 'main' }).expect(200);
    // 先全推一次做基线
    await request(appA).post('/api/source-control/push').set(bearer(ownerA)).send({ message: 'base' }).expect(200);
    // 建两个新工作流
    const a = (await request(appA).post('/api/workflows').set(bearer(ownerA)).send(emptyWf('sel-A')).expect(201)).body.id;
    (await request(appA).post('/api/workflows').set(bearer(ownerA)).send(emptyWf('sel-B')).expect(201));
    const st = await request(appA).get('/api/source-control/status').set(bearer(ownerA)).expect(200);
    const aPath = st.body.files.find((f: { path: string }) => f.path.includes(a)).path;
    // 只推 A
    const pushed = await request(appA).post('/api/source-control/push').set(bearer(ownerA)).send({ message: 'only A', files: [aPath] }).expect(200);
    expect(pushed.body.committed).toBe(true);
    expect(pushed.body.files).toEqual([aPath]);
    // B 仍待提交
    const after = await request(appA).get('/api/source-control/status').set(bearer(ownerA)).expect(200);
    expect(after.body.files.some((f: { path: string }) => f.path.includes('sel-B') || f.path.endsWith('.json'))).toBe(true);
    await request(appA).delete('/api/source-control').set(bearer(ownerA)).expect(204);
  });

  it('pull-preview → 列远端工作流并标 new/existing，不落库', async () => {
    await request(appA).put('/api/source-control').set(bearer(ownerA)).send({ repoUrl: bareRepo, branch: 'main' }).expect(200);
    const prev = await request(appA).get('/api/source-control/pull-preview').set(bearer(ownerA)).expect(200);
    expect(Array.isArray(prev.body.items)).toBe(true);
    // 之前推过的工作流应被标为 existing（同实例已有）
    expect(prev.body.items.every((i: { kind: string }) => i.kind === 'new' || i.kind === 'existing')).toBe(true);
    await request(appA).delete('/api/source-control').set(bearer(ownerA)).expect(204);
  });
});

describe('分支下拉 + 切换', () => {
  it('连接 push 后 → listBranches 含 main；切到新分支 dev', async () => {
    await request(appA).put('/api/source-control').set(bearer(ownerA)).send({ repoUrl: bareRepo, branch: 'main' }).expect(200);
    await request(appA).post('/api/source-control/push').set(bearer(ownerA)).send({ message: 'seed branches' }).expect(200);

    const list = await request(appA).get('/api/source-control/branches').set(bearer(ownerA)).expect(200);
    expect(list.body.branches).toContain('main');
    expect(list.body.current).toBe('main');

    const sw = await request(appA).post('/api/source-control/branch').set(bearer(ownerA)).send({ branch: 'dev' }).expect(200);
    expect(sw.body.branch).toBe('dev');
    const cfg = await request(appA).get('/api/source-control').set(bearer(ownerA)).expect(200);
    expect(cfg.body.branch).toBe('dev');

    await request(appA).delete('/api/source-control').set(bearer(ownerA)).expect(204);
  });
});
