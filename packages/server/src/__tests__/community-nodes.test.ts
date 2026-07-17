import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import type { Express } from 'express';
import { NodeLoader, WorkflowExecute } from '@nomops/core';
import { Workflow } from '@nomops/workflow';
import type { BootstrapResult } from '../bootstrap.js';
import { bootstrap } from '../bootstrap.js';
import { createApp } from '../app.js';
import { inviteUser, setupOwner } from './helpers.js';
import type { INodeInstaller } from '../services/community-node-service.js';

/**
 * 社区节点：安装/列出/卸载 + 注册进加载器 + 可执行 + 重载 + 归属(实例 admin) + 错误。
 * 用假安装器把包名映射到本地 fixture（.mjs），无需联网、无 npm 调用。
 */

const fixture = (dir: string) => fileURLToPath(new URL(`./fixtures/${dir}/index.mjs`, import.meta.url));

const GREET_PKG = 'nomops-node-greet';
const BAD_PKG = 'nomops-node-bad';

/** 假安装器：包名 → fixture 入口路径。install/resolveEntry 都查这张表。 */
class FakeInstaller implements INodeInstaller {
  private readonly map: Record<string, string> = {
    [GREET_PKG]: fixture('community-node-greet'),
    [BAD_PKG]: fixture('community-node-bad'),
  };
  async install(pkg: string) {
    const entryPath = this.map[pkg];
    if (!entryPath) throw new Error(`no fixture for ${pkg}`);
    return { version: '1.0.0', entryPath };
  }
  async uninstall() {
    /* fixture 无需真正删除 */
  }
  async resolveEntry(pkg: string) {
    const entryPath = this.map[pkg];
    if (!entryPath) throw new Error(`not resolvable: ${pkg}`);
    return entryPath;
  }
}

let boot: BootstrapResult;
let app: Express;
let ownerToken: string;
let memberToken: string;

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
const node = (name: string, type: string, extra: Record<string, unknown> = {}) => ({
  id: name,
  name,
  type,
  typeVersion: 1,
  position: [0, 0] as [number, number],
  parameters: {},
  ...extra,
});

beforeAll(async () => {
  boot = await bootstrap({ dbConfig: { type: 'sqlite' }, nodeInstaller: new FakeInstaller() });
  app = createApp(boot.services);
  ownerToken = (await setupOwner(app, 'owner@cn.dev')).token;
  memberToken = (await inviteUser(app, ownerToken, 'member@cn.dev')).token;
});

afterAll(async () => {
  await boot.shutdown();
});

describe('归属：仅实例 admin(owner) 可管理', () => {
  it('member 对三个接口都 403', async () => {
    await request(app).get('/api/community-nodes').set(bearer(memberToken)).expect(403);
    await request(app).post('/api/community-nodes').set(bearer(memberToken)).send({ name: GREET_PKG }).expect(403);
    await request(app).delete('/api/community-nodes').query({ name: GREET_PKG }).set(bearer(memberToken)).expect(403);
  });
});

describe('安装 → 注册 → 可执行 → 列表', () => {
  it('owner 安装 greet 包 → 201，节点类型归一到 <pkg>.greet', async () => {
    const res = await request(app).post('/api/community-nodes').set(bearer(ownerToken)).send({ name: GREET_PKG }).expect(201);
    expect(res.body.packageName).toBe(GREET_PKG);
    expect(res.body.version).toBe('1.0.0');
    expect(res.body.nodeTypes).toEqual([`${GREET_PKG}.greet`]);
  });

  it('/api/node-types 带出社区节点的全名 type', async () => {
    const types = await request(app).get('/api/node-types').set(bearer(ownerToken)).expect(200);
    const greet = types.body.find((t: { type: string }) => t.type === `${GREET_PKG}.greet`);
    expect(greet).toBeTruthy();
    expect(greet.displayName).toBe('Greet');
  });

  it('能用社区节点建工作流（校验放行），且引擎能真正执行它', async () => {
    const wf = await request(app)
      .post('/api/workflows')
      .set(bearer(ownerToken))
      .send({
        name: 'uses-community-node',
        nodes: [node('Start', 'nomops.manualTrigger'), node('Greet', `${GREET_PKG}.greet`)],
        connections: { Start: { main: [[{ node: 'Greet', type: 'main', index: 0 }]] } },
      })
      .expect(201);
    expect(wf.body.id).toBeTruthy();

    // 直接用 boot 的加载器跑一遍，证明注册的社区节点可加载可执行
    const engine = new WorkflowExecute(boot.services.nodeLoader);
    const run = await engine.run(
      new Workflow({
        name: 'run-community',
        nodes: [node('Start', 'nomops.manualTrigger'), node('Greet', `${GREET_PKG}.greet`)],
        connections: { Start: { main: [[{ node: 'Greet', type: 'main', index: 0 }]] } },
      }),
    );
    expect(run.status).toBe('success');
    const out = run.data.resultData.runData['Greet']![0]!.data!['main']![0]!;
    expect(out[0]!.json).toMatchObject({ greeting: 'hello' });
  });

  it('列表含已装包', async () => {
    const list = await request(app).get('/api/community-nodes').set(bearer(ownerToken)).expect(200);
    expect(list.body.map((p: { packageName: string }) => p.packageName)).toContain(GREET_PKG);
  });
});

describe('重载（模拟重启）+ 卸载', () => {
  it('unregister 后 loadInstalled 能从 DB 重新注册', async () => {
    boot.services.nodeLoader.unregister(GREET_PKG);
    expect(boot.services.nodeLoader.getAllTypes()).not.toContain(`${GREET_PKG}.greet`);
    await boot.services.communityNodes.loadInstalled();
    expect(boot.services.nodeLoader.getAllTypes()).toContain(`${GREET_PKG}.greet`);
  });

  it('卸载 → 204，类型摘除，且此后不能再用该节点建工作流(400)', async () => {
    await request(app).delete('/api/community-nodes').query({ name: GREET_PKG }).set(bearer(ownerToken)).expect(204);
    expect(boot.services.nodeLoader.getAllTypes()).not.toContain(`${GREET_PKG}.greet`);
    const list = await request(app).get('/api/community-nodes').set(bearer(ownerToken)).expect(200);
    expect(list.body).toHaveLength(0);
    await request(app)
      .post('/api/workflows')
      .set(bearer(ownerToken))
      .send({ name: 'orphan', nodes: [node('G', `${GREET_PKG}.greet`)], connections: {} })
      .expect(400);
  });

  it('卸载不存在的包 → 404', async () => {
    await request(app).delete('/api/community-nodes').query({ name: 'nomops-node-nope' }).set(bearer(ownerToken)).expect(404);
  });
});

describe('错误处理', () => {
  it('非法包名 → 400（未触达安装器）', async () => {
    await request(app).post('/api/community-nodes').set(bearer(ownerToken)).send({ name: 'Bad Name!!' }).expect(400);
  });

  it('包未导出 nomopsNodes → 400', async () => {
    await request(app).post('/api/community-nodes').set(bearer(ownerToken)).send({ name: BAD_PKG }).expect(400);
    // 装失败不留痕
    const list = await request(app).get('/api/community-nodes').set(bearer(ownerToken)).expect(200);
    expect(list.body.map((p: { packageName: string }) => p.packageName)).not.toContain(BAD_PKG);
  });
});
