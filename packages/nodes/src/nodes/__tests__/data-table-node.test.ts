import { describe, expect, it } from 'vitest';
import type {
  IDataTableOperations,
  IDataTableRow,
  IDataTableView,
  IExecuteContext,
  ILoadOptionsContext,
  INode,
  INodeExecutionData,
  IResourceLocatorContext,
  JsonObject,
} from '@nomops/workflow';
import { DataTable } from '../DataTable/DataTable.node.js';

function memoryDataTables(): IDataTableOperations {
  const tables: IDataTableView[] = [];
  const rows = new Map<string, IDataTableRow[]>();
  let sequence = 0;
  return {
    async list() { return tables; },
    async get(id) {
      const table = tables.find((candidate) => candidate.id === id);
      if (!table) throw new Error('not found');
      return { ...table, rowCount: rows.get(id)?.length ?? 0 };
    },
    async create(input) {
      const now = new Date(1_700_000_000_000 + sequence++ * 1000);
      const table: IDataTableView = {
        id: `table-${sequence}`,
        name: input.name,
        columns: input.columns ?? [],
        rowCount: 0,
        createdAt: now,
        updatedAt: now,
      };
      tables.push(table);
      rows.set(table.id, []);
      return table;
    },
    async rename(id, name) { const table = tables.find((entry) => entry.id === id)!; table.name = name; return table; },
    async delete(id) { const index = tables.findIndex((entry) => entry.id === id); tables.splice(index, 1); rows.delete(id); },
    async clearRows(id) { const count = rows.get(id)?.length ?? 0; rows.set(id, []); return count; },
    async listRows(id) { return rows.get(id) ?? []; },
    async insertRow(id, data) {
      const now = new Date(1_700_000_100_000 + sequence++ * 1000);
      const row: IDataTableRow = { id: `row-${sequence}`, createdAt: now, updatedAt: now, data };
      rows.get(id)!.push(row);
      return row;
    },
    async updateRow(id, rowId, data) {
      const row = rows.get(id)!.find((entry) => entry.id === rowId)!;
      row.data = { ...row.data, ...data };
      row.updatedAt = new Date(row.updatedAt.getTime() + 1000);
      return row;
    },
    async deleteRow(id, rowId) { rows.set(id, rows.get(id)!.filter((entry) => entry.id !== rowId)); },
  };
}

function executeContext(
  parameters: JsonObject,
  input: INodeExecutionData[],
  dataTables: IDataTableOperations,
): IExecuteContext {
  const node: INode = {
    id: 'data-table', name: 'Data table', type: 'nomops.dataTable', typeVersion: 1.1,
    position: [0, 0], parameters,
  };
  return {
    getNode: () => node,
    getInputData: () => input,
    getNodeParameter(name: string, _index: number, fallback?: unknown) {
      return Object.prototype.hasOwnProperty.call(parameters, name) ? parameters[name] : fallback;
    },
    getCredentials: async () => ({}),
    getWorkflowStaticData: () => ({}),
    getContext: () => ({}),
    isResumed: () => false,
    getInputConnectionData: async () => [],
    helpers: {
      httpRequest: async () => ({}),
      binaryToBuffer: async () => new Uint8Array(),
      bufferToBinary: async () => ({ data: '', mimeType: 'application/octet-stream' }),
      dataTables,
    },
  };
}

async function run(parameters: JsonObject, input: INodeExecutionData[], helper: IDataTableOperations) {
  return (await new DataTable().execute!.call(executeContext(parameters, input, helper)))[0]!;
}

describe('Data table node', () => {
  it('supports the complete table resource lifecycle', async () => {
    const helper = memoryDataTables();
    const input = [{ json: {} }];
    const created = await run({
      resource: 'table', operation: 'create', tableName: 'Orders',
      columns: { column: [{ name: 'amount', type: 'number' }] }, options: { createIfNotExists: true },
    }, input, helper);
    expect(created[0]!.json).toMatchObject({ name: 'Orders', rowCount: 0 });
    const id = String(created[0]!.json['id']);
    await helper.insertRow(id, { amount: 10 });
    expect((await run({ resource: 'table', operation: 'clear', dataTableId: { mode: 'id', value: id } }, input, helper))[0]!.json)
      .toEqual({ success: true, deletedCount: 1 });
    expect((await run({ resource: 'table', operation: 'update', dataTableId: { mode: 'id', value: id }, newName: 'Invoices' }, input, helper))[0]!.json)
      .toEqual({ success: true, name: 'Invoices' });
    expect((await run({ resource: 'table', operation: 'list', returnAll: true, options: {} }, input, helper))[0]!.json['name'])
      .toBe('Invoices');
    expect((await run({ resource: 'table', operation: 'delete', dataTableId: { mode: 'id', value: id } }, input, helper))[0]!.json)
      .toEqual({ success: true, deletedTableId: id });
  });

  it('inserts mapped rows and gets filtered, ordered results', async () => {
    const helper = memoryDataTables();
    const table = await helper.create({ name: 'Orders', columns: [{ name: 'amount', type: 'number' }, { name: 'label', type: 'string' }] });
    const selector = { mode: 'id', value: table.id };
    await run({ resource: 'row', operation: 'insert', dataTableId: selector, columns: { mappingMode: 'autoMapInputData' }, options: {} }, [
      { json: { amount: '2', label: 'low', ignored: true } },
      { json: { amount: 9, label: 'high' } },
    ], helper);
    const result = await run({
      resource: 'row', operation: 'get', dataTableId: selector,
      filters: { conditions: [{ keyName: 'amount', condition: 'gte', keyValue: 2 }] },
      matchType: 'allConditions', returnAll: true, orderBy: true, orderByColumn: 'amount', orderByDirection: 'DESC',
    }, [{ json: {} }], helper);
    expect(result.map((entry) => entry.json['amount'])).toEqual([9, 2]);
    expect(result[1]!.json).not.toHaveProperty('ignored');
  });

  it('updates, upserts, checks existence, and dry-runs deletion without mutation', async () => {
    const helper = memoryDataTables();
    const table = await helper.create({ name: 'People', columns: [{ name: 'email', type: 'string' }, { name: 'active', type: 'boolean' }] });
    const selector = { mode: 'id', value: table.id };
    await helper.insertRow(table.id, { email: 'a@example.com', active: false });
    const filter = { conditions: [{ keyName: 'email', condition: 'eq', keyValue: 'a@example.com' }] };
    const updated = await run({
      resource: 'row', operation: 'update', dataTableId: selector, filters: filter, matchType: 'allConditions',
      columns: { mappingMode: 'defineBelow', value: { active: true } }, options: {},
    }, [{ json: {} }], helper);
    expect(updated[0]!.json['active']).toBe(true);
    const exists = await run({ resource: 'row', operation: 'rowExists', dataTableId: selector, filters: filter, matchType: 'allConditions' }, [{ json: { pass: true } }], helper);
    expect(exists[0]!.json).toEqual({ pass: true });
    await run({
      resource: 'row', operation: 'upsert', dataTableId: selector,
      filters: { conditions: [{ keyName: 'email', condition: 'eq', keyValue: 'b@example.com' }] }, matchType: 'allConditions',
      columns: { mappingMode: 'defineBelow', value: { email: 'b@example.com', active: false } }, options: {},
    }, [{ json: {} }], helper);
    const dryRun = await run({
      resource: 'row', operation: 'deleteRows', dataTableId: selector, filters: filter,
      matchType: 'allConditions', options: { dryRun: true },
    }, [{ json: {} }], helper);
    expect(dryRun[0]!.json).toHaveProperty('before');
    expect(await helper.listRows(table.id)).toHaveLength(2);
  });

  it('loads project-scoped table choices, columns, conditions, and mapper schema', async () => {
    const helper = memoryDataTables();
    const table = await helper.create({ name: 'Customers', columns: [{ name: 'score', type: 'number' }] });
    const dynamic = {
      getCurrentNodeParameter: (name: string) => name === 'dataTableId' ? { mode: 'id', value: table.id } : 'score',
      getCredentials: async () => ({}),
      helpers: { httpRequest: async () => ({}), dataTables: helper },
    } satisfies ILoadOptionsContext;
    const node = new DataTable();
    const located = await node.methods.resourceLocator.tableSearch.call({ ...dynamic, filter: 'cust' } satisfies IResourceLocatorContext);
    expect(located.results).toEqual([{ name: 'Customers', value: table.id, description: '0 rows' }]);
    expect(await node.methods.loadOptions.getDataTableColumns.call(dynamic)).toContainEqual({ name: 'score', value: 'score', description: 'number' });
    expect(await node.methods.loadOptions.getConditionsForColumn.call(dynamic)).toContainEqual({ name: 'Greater Than', value: 'gt' });
    expect(await node.methods.resourceMapping.getDataTables.call(dynamic)).toEqual({
      fields: [{ id: 'score', displayName: 'score', type: 'number', required: false, defaultMatch: false, canBeUsedToMatch: true }],
    });
  });
});
