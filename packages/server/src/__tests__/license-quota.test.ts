import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { BootstrapResult } from '../bootstrap.js';
import { bootstrap } from '../bootstrap.js';
import { createApp } from '../app.js';
import { setupOwner, testLicense, TEST_LICENSE_PUBLIC_KEY } from './helpers.js';

/**
 * License 配额的**端到端强制**（B1）。
 *
 * 只登记真正守门的配额，所以这里必须逐个证明它拦得住——
 * 声明了却没人消费的配额，就是 B0 刚清理掉的那种债。
 */
let boot: BootstrapResult | null = null;

afterEach(async () => {
  await boot?.shutdown();
  boot = null;
});

async function start(quotas: Record<string, number>): Promise<{ app: Express; owner: string }> {
  boot = await bootstrap({
    dbConfig: { type: 'sqlite' },
    licenseKey: testLicense({ quotas }),
    licensePublicKey: TEST_LICENSE_PUBLIC_KEY,
  });
  const app = createApp(boot.services);
  const owner = (await setupOwner(app, 'owner@quota.dev')).token;
  return { app, owner };
}

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

const createProject = (app: Express, token: string, name: string) =>
  request(app).post('/api/projects').set(bearer(token)).send({ name });

const invite = (app: Express, token: string, email: string) =>
  request(app).post('/api/instance/users/invite').set(bearer(token)).send({ email, role: 'member' });

describe('teamProjects 配额', () => {
  it('未达上限可建，达到即 402 并带配额详情', async () => {
    const { app, owner } = await start({ teamProjects: 2 });

    await createProject(app, owner, 'A').expect(201);
    await createProject(app, owner, 'B').expect(201);

    const res = await createProject(app, owner, 'C').expect(402);
    expect(res.body.context).toMatchObject({ quota: 'teamProjects', limit: 2, used: 2 });
  });

  it('personal project 不占额度（注册自带的那个不该吃掉席位）', async () => {
    const { app, owner } = await start({ teamProjects: 1 });

    // owner 注册时已自带一个 personal project；team 额度应仍是满的
    await createProject(app, owner, 'A').expect(201);
    await createProject(app, owner, 'B').expect(402);
  });

  it('-1 = 不限', async () => {
    const { app, owner } = await start({ teamProjects: -1 });

    for (const name of ['A', 'B', 'C', 'D']) {
      await createProject(app, owner, name).expect(201);
    }
  });

  it('证书未给该配额 = 不限', async () => {
    const { app, owner } = await start({});

    await createProject(app, owner, 'A').expect(201);
    await createProject(app, owner, 'B').expect(201);
  });
});

describe('users 席位配额', () => {
  it('达到上限后邀请被拒（402）', async () => {
    const { app, owner } = await start({ users: 2 });

    // owner 自己占 1 席
    await invite(app, owner, 'a@quota.dev').expect(201);
    const res = await invite(app, owner, 'b@quota.dev').expect(402);
    expect(res.body.context).toMatchObject({ quota: 'users', limit: 2 });
  });

  it('★待接受的邀请也占席（否则反复邀请就能绕过上限）', async () => {
    const { app, owner } = await start({ users: 3 });

    await invite(app, owner, 'a@quota.dev').expect(201); // owner + 1 pending = 2
    await invite(app, owner, 'b@quota.dev').expect(201); // = 3
    await invite(app, owner, 'c@quota.dev').expect(402); // 已满
  });

  it('-1 = 不限', async () => {
    const { app, owner } = await start({ users: -1 });

    for (const email of ['a@q.dev', 'b@q.dev', 'c@q.dev']) {
      await invite(app, owner, email).expect(201);
    }
  });
});

describe('社区版（无 license）', () => {
  it('配额一律不生效，行为与 B1 之前一致', async () => {
    boot = await bootstrap({
      dbConfig: { type: 'sqlite' },
      licenseKey: null,
      licensePublicKey: TEST_LICENSE_PUBLIC_KEY,
    });
    const app = createApp(boot.services);
    const owner = (await setupOwner(app, 'owner@ce.dev')).token;

    // 团队项目本就需要 rbac 功能位，社区版是 403（功能门），不是 402（配额）
    await createProject(app, owner, 'A').expect(403);
    // 邀请在社区版可用且不限席位
    await invite(app, owner, 'a@ce.dev').expect(201);
    await invite(app, owner, 'b@ce.dev').expect(201);
  });
});
