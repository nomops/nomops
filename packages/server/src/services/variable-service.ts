import type { Repositories } from '@nomops/db';
import { OperationalError } from '@nomops/workflow';

/** 变量 API 视图。 */
export interface IVariableView {
  id: string;
  key: string;
  value: string;
  createdAt: Date;
}

/** 变量名合法性：字母/下划线开头，仅字母数字下划线（可作 $vars.KEY 引用）。 */
const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * 变量（docs/02）：项目维度的键值对，工作流里用 `{{ $vars.KEY }}` 引用。
 * 归属经带 projectId 的 repository（铁律 2）。
 */
export class VariableService {
  constructor(private readonly repos: Repositories) {}

  async list(projectId: string): Promise<IVariableView[]> {
    const rows = await this.repos.variables.findAllByProject(projectId);
    return rows
      .map((r) => ({ id: r.id, key: r.key, value: r.value, createdAt: r.createdAt }))
      .sort((a, b) => a.key.localeCompare(b.key));
  }

  async create(input: { key: string; value?: string }, projectId: string): Promise<IVariableView> {
    this.validateKey(input.key);
    const existing = await this.repos.variables.findAllByProject(projectId);
    if (existing.some((v) => v.key === input.key)) {
      throw new OperationalError(`A variable named “${input.key}” already exists`, { status: 409 });
    }
    const row = await this.repos.variables.create({ projectId, key: input.key, value: input.value ?? '' });
    return { id: row.id, key: row.key, value: row.value, createdAt: row.createdAt };
  }

  async update(id: string, input: { key: string; value?: string }, projectId: string): Promise<IVariableView> {
    const row = await this.repos.variables.findById(id, projectId);
    if (!row) throw new OperationalError('Variable not found', { status: 404 });
    this.validateKey(input.key);
    const existing = await this.repos.variables.findAllByProject(projectId);
    if (existing.some((v) => v.key === input.key && v.id !== id)) {
      throw new OperationalError(`A variable named “${input.key}” already exists`, { status: 409 });
    }
    await this.repos.variables.update(id, { key: input.key, value: input.value ?? '' });
    return { id, key: input.key, value: input.value ?? '', createdAt: row.createdAt };
  }

  async delete(id: string, projectId: string): Promise<void> {
    const row = await this.repos.variables.findById(id, projectId);
    if (!row) throw new OperationalError('Variable not found', { status: 404 });
    await this.repos.variables.delete(id);
  }

  /** 执行时注入表达式上下文（$vars）：项目维度的 key→value 映射。 */
  async mapForProject(projectId: string): Promise<Record<string, string>> {
    const rows = await this.repos.variables.findAllByProject(projectId);
    const map: Record<string, string> = {};
    for (const r of rows) map[r.key] = r.value;
    return map;
  }

  private validateKey(key: string): void {
    if (!key || !KEY_RE.test(key)) {
      throw new OperationalError(
        'Variable name must start with a letter or underscore and contain only letters, numbers and underscores',
        { status: 400 },
      );
    }
  }
}
