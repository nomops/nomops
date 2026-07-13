import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type DatabaseHandle } from '../client.js';
import { runMigrations } from '../migrate.js';
import { createRepositories, type Repositories } from '../repositories.js';

const dialects = ['sqlite', 'postgres'] as const;

// 同一套仓储代码跑在两种方言上（Phase 1 验收：迁移 + CRUD + 归属隔离都通过）。
describe.each(dialects)('仓储 @ %s', (type) => {
  let handle: DatabaseHandle;
  let repos: Repositories;

  beforeAll(async () => {
    handle = await createDatabase({ type });
    await runMigrations(handle);
    repos = createRepositories(handle);
  });

  afterAll(async () => {
    await handle.close();
  });

  it('迁移成功并能做 workflow CRUD', async () => {
    const project = await repos.projects.create({ name: 'Acme' });
    const created = await repos.workflows.create(
      { name: 'wf-1', nodes: [], connections: {} },
      project.id,
    );
    expect(created.id).toBeTruthy();
    expect(created.active).toBe(false);

    const found = await repos.workflows.findById(created.id, project.id);
    expect(found?.name).toBe('wf-1');

    const updated = await repos.workflows.update(created.id, { name: 'wf-1-renamed', active: true });
    expect(updated.name).toBe('wf-1-renamed');
    expect(updated.active).toBe(true);

    await repos.workflows.delete(created.id);
    expect(await repos.workflows.findById(created.id, project.id)).toBeNull();
  });

  it('跨 project 查不到别人的 workflow（归属隔离）', async () => {
    const projA = await repos.projects.create({ name: 'A' });
    const projB = await repos.projects.create({ name: 'B' });
    const secret = await repos.workflows.create(
      { name: 'secret', nodes: [], connections: {} },
      projA.id,
    );

    expect(await repos.workflows.findById(secret.id, projB.id)).toBeNull();
    expect(await repos.workflows.findAllByProject(projB.id)).toHaveLength(0);
    expect((await repos.workflows.findAllByProject(projA.id)).map((w) => w.name)).toContain('secret');
  });

  it('凭证也按 project 归属隔离', async () => {
    const projA = await repos.projects.create({ name: 'CA' });
    const projB = await repos.projects.create({ name: 'CB' });
    const cred = await repos.credentials.create(
      { name: 'api-key', type: 'httpHeaderAuth', data: 'cipher-text' },
      projA.id,
    );

    expect(await repos.credentials.findById(cred.id, projB.id)).toBeNull();
    expect((await repos.credentials.findById(cred.id, projA.id))?.name).toBe('api-key');
  });

  it('execution 落库并按 workflow 的 project 归属过滤', async () => {
    const projA = await repos.projects.create({ name: 'EA' });
    const projB = await repos.projects.create({ name: 'EB' });
    const wf = await repos.workflows.create({ name: 'wf-e', nodes: [], connections: {} }, projA.id);

    const exec = await repos.executions.create(
      { workflowId: wf.id, status: 'success', mode: 'manual' },
      { workflowData: { name: 'wf-e' }, data: { resultData: {} } },
    );

    expect((await repos.executions.findById(exec.id, projA.id))?.status).toBe('success');
    expect(await repos.executions.findById(exec.id, projB.id)).toBeNull();
  });

  it('settings KV upsert', async () => {
    await repos.settings.set('instanceId', 'abc');
    expect(await repos.settings.get('instanceId')).toBe('abc');
    await repos.settings.set('instanceId', 'def');
    expect(await repos.settings.get('instanceId')).toBe('def');
  });
});
