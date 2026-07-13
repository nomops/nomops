import type { Repositories } from '@nomops/db';
import type { JsonObject } from '@nomops/workflow';
import { OperationalError } from '@nomops/workflow';

export type DataTableColumnType = 'string' | 'number' | 'boolean' | 'date';

export interface IDataTableColumn {
  name: string;
  type: DataTableColumnType;
}

/** 数据表 API 视图（列表用，含行数）。 */
export interface IDataTableView {
  id: string;
  name: string;
  columns: IDataTableColumn[];
  rowCount: number;
  createdAt: Date;
}

/** 单行视图：系统字段（id/createdAt/updatedAt）+ 用户列数据。 */
export interface IDataTableRowView {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  data: JsonObject;
}

/** 列名合法性：字母/下划线开头，仅字母数字下划线。 */
const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const COLUMN_TYPES: DataTableColumnType[] = ['string', 'number', 'boolean', 'date'];
/** 系统保留列名，用户列不能占用。 */
const RESERVED = new Set(['id', 'createdAt', 'updatedAt']);

/**
 * Data tables（对标 n8n）：项目维度的结构化表，跨工作流持久化执行结果。
 * 归属经带 projectId 的 repository（铁律 2）。
 */
export class DataTableService {
  constructor(private readonly repos: Repositories) {}

  async list(projectId: string): Promise<IDataTableView[]> {
    const tables = await this.repos.dataTables.findAllByProject(projectId);
    const views = await Promise.all(
      tables.map(async (t) => {
        const rows = await this.repos.dataTables.findRows(t.id);
        return {
          id: t.id,
          name: t.name,
          columns: (t.columns ?? []) as IDataTableColumn[],
          rowCount: rows.length,
          createdAt: t.createdAt,
        };
      }),
    );
    return views.sort((a, b) => a.name.localeCompare(b.name));
  }

  async get(id: string, projectId: string): Promise<IDataTableView> {
    const table = await this.requireTable(id, projectId);
    const rows = await this.repos.dataTables.findRows(id);
    return {
      id: table.id,
      name: table.name,
      columns: (table.columns ?? []) as IDataTableColumn[],
      rowCount: rows.length,
      createdAt: table.createdAt,
    };
  }

  async create(
    input: { name: string; columns?: IDataTableColumn[] },
    projectId: string,
  ): Promise<IDataTableView> {
    const name = (input.name ?? '').trim();
    if (!name) throw new OperationalError('Data table name is required', { status: 400 });
    const existing = await this.repos.dataTables.findAllByProject(projectId);
    if (existing.some((t) => t.name.toLowerCase() === name.toLowerCase())) {
      throw new OperationalError(`A data table named “${name}” already exists`, { status: 409 });
    }
    const columns = this.normalizeColumns(input.columns ?? []);
    const table = await this.repos.dataTables.createTable({ projectId, name, columns });
    return { id: table.id, name: table.name, columns, rowCount: 0, createdAt: table.createdAt };
  }

  async rename(id: string, name: string, projectId: string): Promise<IDataTableView> {
    await this.requireTable(id, projectId);
    const trimmed = (name ?? '').trim();
    if (!trimmed) throw new OperationalError('Data table name is required', { status: 400 });
    const existing = await this.repos.dataTables.findAllByProject(projectId);
    if (existing.some((t) => t.id !== id && t.name.toLowerCase() === trimmed.toLowerCase())) {
      throw new OperationalError(`A data table named “${trimmed}” already exists`, { status: 409 });
    }
    await this.repos.dataTables.updateTable(id, { name: trimmed });
    return this.get(id, projectId);
  }

  async delete(id: string, projectId: string): Promise<void> {
    await this.requireTable(id, projectId);
    await this.repos.dataTables.deleteTable(id);
  }

  async addColumn(id: string, column: IDataTableColumn, projectId: string): Promise<IDataTableView> {
    const table = await this.requireTable(id, projectId);
    const normalized = this.normalizeColumns([column])[0]!;
    const columns = (table.columns ?? []) as IDataTableColumn[];
    if (columns.some((c) => c.name === normalized.name)) {
      throw new OperationalError(`A column named “${normalized.name}” already exists`, { status: 409 });
    }
    await this.repos.dataTables.updateTable(id, { columns: [...columns, normalized] });
    return this.get(id, projectId);
  }

  async deleteColumn(id: string, columnName: string, projectId: string): Promise<IDataTableView> {
    const table = await this.requireTable(id, projectId);
    const columns = (table.columns ?? []) as IDataTableColumn[];
    if (!columns.some((c) => c.name === columnName)) {
      throw new OperationalError('Column not found', { status: 404 });
    }
    await this.repos.dataTables.updateTable(id, {
      columns: columns.filter((c) => c.name !== columnName),
    });
    return this.get(id, projectId);
  }

  async listRows(id: string, projectId: string): Promise<IDataTableRowView[]> {
    await this.requireTable(id, projectId);
    const rows = await this.repos.dataTables.findRows(id);
    return rows
      .map((r) => ({ id: r.id, createdAt: r.createdAt, updatedAt: r.updatedAt, data: (r.data ?? {}) as JsonObject }))
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  async insertRow(id: string, data: JsonObject, projectId: string): Promise<IDataTableRowView> {
    const table = await this.requireTable(id, projectId);
    const clean = this.projectData(table.columns as IDataTableColumn[], data);
    const row = await this.repos.dataTables.insertRow(id, clean);
    return { id: row.id, createdAt: row.createdAt, updatedAt: row.updatedAt, data: (row.data ?? {}) as JsonObject };
  }

  async updateRow(
    id: string,
    rowId: string,
    data: JsonObject,
    projectId: string,
  ): Promise<IDataTableRowView> {
    const table = await this.requireTable(id, projectId);
    const row = await this.repos.dataTables.findRow(rowId, id);
    if (!row) throw new OperationalError('Row not found', { status: 404 });
    const merged = { ...(row.data ?? {}), ...this.projectData(table.columns as IDataTableColumn[], data) };
    await this.repos.dataTables.updateRow(rowId, merged);
    return { id: rowId, createdAt: row.createdAt, updatedAt: new Date(), data: merged };
  }

  async deleteRow(id: string, rowId: string, projectId: string): Promise<void> {
    await this.requireTable(id, projectId);
    const row = await this.repos.dataTables.findRow(rowId, id);
    if (!row) throw new OperationalError('Row not found', { status: 404 });
    await this.repos.dataTables.deleteRow(rowId);
  }

  private async requireTable(id: string, projectId: string) {
    const table = await this.repos.dataTables.findById(id, projectId);
    if (!table) throw new OperationalError('Data table not found', { status: 404 });
    return table;
  }

  /** 只保留已声明列的键（未知键丢弃），避免行数据漂移出 schema。 */
  private projectData(columns: IDataTableColumn[], data: JsonObject): JsonObject {
    const allowed = new Set(columns.map((c) => c.name));
    const out: JsonObject = {};
    for (const [k, v] of Object.entries(data ?? {})) {
      if (allowed.has(k)) out[k] = v as JsonObject[string];
    }
    return out;
  }

  private normalizeColumns(columns: IDataTableColumn[]): IDataTableColumn[] {
    const seen = new Set<string>();
    return columns.map((c) => {
      const name = (c.name ?? '').trim();
      if (!name || !NAME_RE.test(name)) {
        throw new OperationalError(
          'Column name must start with a letter or underscore and contain only letters, numbers and underscores',
          { status: 400 },
        );
      }
      if (RESERVED.has(name)) {
        throw new OperationalError(`“${name}” is a reserved column name`, { status: 400 });
      }
      if (seen.has(name)) {
        throw new OperationalError(`Duplicate column name “${name}”`, { status: 400 });
      }
      seen.add(name);
      const type = COLUMN_TYPES.includes(c.type) ? c.type : 'string';
      return { name, type };
    });
  }
}
