import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BootstrapResult } from '../bootstrap.js';
import { bootstrap } from '../bootstrap.js';

/**
 * docs/11 Phase 2：控制平面开实例时注入 NOMOPS_OWNER_EMAIL，实例首启预置该 owner。
 */

let boot: BootstrapResult | null = null;
const OWNER = 'NOMOPS_OWNER_EMAIL';
const PLAN = 'NOMOPS_PLAN';
const QUOTA = 'NOMOPS_PLAN_QUOTA';

beforeEach(() => {
  for (const k of [OWNER, PLAN, QUOTA]) delete process.env[k];
});
afterEach(async () => {
  for (const k of [OWNER, PLAN, QUOTA]) delete process.env[k];
  await boot?.shutdown();
  boot = null;
});

describe('NOMOPS_OWNER_EMAIL 首启预置 owner', () => {
  it('设置后：首启建 owner 用户（role=owner）+ 个人空间', async () => {
    process.env[OWNER] = 'boss@corp.com';
    boot = await bootstrap({ dbConfig: { type: 'sqlite' } });
    const user = await boot.services.repos.users.findByEmail('boss@corp.com');
    expect(user).not.toBeNull();
    expect(user!.role).toBe('owner');
    const projects = await boot.services.repos.projects.findAllByUser(user!.id);
    expect(projects.length).toBeGreaterThanOrEqual(1);
  });

  it('已有用户则幂等跳过（不重复建 owner）', async () => {
    // 先起一次建立 owner，再用同库重启带同 env，应无新增
    process.env[OWNER] = 'boss@corp.com';
    const file = join(tmpdir(), `nomops-owner-test-${Date.now()}.db`);
    boot = await bootstrap({ dbConfig: { type: 'sqlite', filename: file } });
    const before = await boot.services.repos.users.count();
    await boot.shutdown();

    boot = await bootstrap({ dbConfig: { type: 'sqlite', filename: file } });
    const after = await boot.services.repos.users.count();
    expect(after).toBe(before); // 幂等
  });

  it('未设置 env：不预置任何用户', async () => {
    boot = await bootstrap({ dbConfig: { type: 'sqlite' } });
    expect(await boot.services.repos.users.count()).toBe(0);
  });
});

describe('NOMOPS_PLAN_QUOTA plan 下发（docs/11 Phase 3）', () => {
  it('下发有限配额 → owner 项目配额落地为该值', async () => {
    process.env[OWNER] = 'boss@corp.com';
    process.env[PLAN] = 'pro';
    process.env[QUOTA] = '10000';
    boot = await bootstrap({ dbConfig: { type: 'sqlite' } });
    const owner = await boot.services.repos.users.findByEmail('boss@corp.com');
    const projects = await boot.services.repos.projects.findAllByUser(owner!.id);
    const q = await boot.services.repos.quotas.getQuota(projects[0]!.id);
    expect(q).not.toBeNull();
    expect(q!.plan).toBe('pro');
    expect(q!.monthlyExecutions).toBe(10000);
  });

  it('下发 unlimited → 配额上限为 null（不限）', async () => {
    process.env[OWNER] = 'boss@corp.com';
    process.env[PLAN] = 'enterprise';
    process.env[QUOTA] = 'unlimited';
    boot = await bootstrap({ dbConfig: { type: 'sqlite' } });
    const owner = await boot.services.repos.users.findByEmail('boss@corp.com');
    const projects = await boot.services.repos.projects.findAllByUser(owner!.id);
    const q = await boot.services.repos.quotas.getQuota(projects[0]!.id);
    expect(q!.monthlyExecutions).toBeNull();
  });
});
