import type {
  DataTableColumnType,
  IDataTableColumn,
  IDataTableOperations,
  IDataTableRow,
  IDataTableView,
  IExecuteContext,
  ILoadOptionsContext,
  INodeExecutionData,
  INodePropertyOption,
  INodeType,
  IResourceLocatorContext,
  IResourceLocatorResult,
  IResourceLocatorValue,
  IResourceMapperFields,
  JsonObject,
} from '@nomops/workflow';
import { OperationalError } from '@nomops/workflow';
import { dataTableDescription } from './DataTable.description.js';

const SYSTEM_COLUMNS: IDataTableColumn[] = [
  { name: 'id', type: 'string' },
  { name: 'createdAt', type: 'date' },
  { name: 'updatedAt', type: 'date' },
];

type FilterCondition = {
  keyName: string;
  condition?: string;
  keyValue?: unknown;
};

function operations(context: IExecuteContext): IDataTableOperations {
  if (!context.helpers.dataTables) {
    throw new OperationalError('Data table service is not available in this execution environment', {});
  }
  return context.helpers.dataTables;
}

function locator(value: unknown): IResourceLocatorValue {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const entry = value as Partial<IResourceLocatorValue>;
    if (typeof entry.value === 'string' && ['list', 'name', 'id'].includes(String(entry.mode))) {
      return { mode: entry.mode!, value: entry.value };
    }
  }
  if (typeof value === 'string') return { mode: 'id', value };
  return { mode: 'list', value: '' };
}

async function resolveTable(
  helper: Pick<IDataTableOperations, 'list' | 'get'>,
  raw: unknown,
): Promise<IDataTableView> {
  const selected = locator(raw);
  if (!selected.value) throw new OperationalError('Select a data table', {});
  if (selected.mode === 'name') {
    const table = (await helper.list()).find((candidate) => candidate.name === selected.value);
    if (!table) throw new OperationalError(`Data table "${selected.value}" was not found`, {});
    return table;
  }
  return helper.get(selected.value);
}

function tableJson(table: IDataTableView): JsonObject {
  return {
    id: table.id,
    name: table.name,
    columns: table.columns,
    rowCount: table.rowCount,
    createdAt: table.createdAt.toISOString(),
    updatedAt: table.updatedAt.toISOString(),
  };
}

function rowJson(row: IDataTableRow): JsonObject {
  return {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    ...row.data,
  };
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function conditions(value: unknown): FilterCondition[] {
  const raw = objectValue(value)['conditions'];
  if (!Array.isArray(raw)) return [];
  return raw.filter((entry): entry is FilterCondition => {
    return !!entry && typeof entry === 'object' && !Array.isArray(entry)
      && typeof (entry as FilterCondition).keyName === 'string';
  });
}

function columnTypes(table: IDataTableView): Map<string, DataTableColumnType> {
  return new Map([...SYSTEM_COLUMNS, ...table.columns].map((column) => [column.name, column.type]));
}

function comparable(value: unknown, type: DataTableColumnType): unknown {
  if (value === null || value === undefined) return value;
  if (type === 'number') {
    const number = Number(value);
    return Number.isFinite(number) ? number : Number.NaN;
  }
  if (type === 'boolean') return value === true || value === 'true' || value === 1 || value === '1';
  if (type === 'date') {
    const time = value instanceof Date ? value.getTime() : Date.parse(String(value));
    return Number.isFinite(time) ? time : Number.NaN;
  }
  return String(value);
}

function compare(actual: unknown, condition: FilterCondition, type: DataTableColumnType): boolean {
  const operation = condition.condition ?? 'eq';
  if (operation === 'isEmpty') return actual === null || actual === undefined || actual === '';
  if (operation === 'isNotEmpty') return actual !== null && actual !== undefined && actual !== '';
  if (operation === 'isTrue') return comparable(actual, 'boolean') === true;
  if (operation === 'isFalse') return comparable(actual, 'boolean') === false;
  const left = comparable(actual, type);
  const right = comparable(condition.keyValue, type);
  if (operation === 'eq') return left === right;
  if (operation === 'neq') return left !== right;
  if (operation === 'gt') return (left as string | number) > (right as string | number);
  if (operation === 'gte') return (left as string | number) >= (right as string | number);
  if (operation === 'lt') return (left as string | number) < (right as string | number);
  if (operation === 'lte') return (left as string | number) <= (right as string | number);
  const text = String(actual ?? '');
  const query = String(condition.keyValue ?? '');
  if (operation === 'like' || operation === 'contains') return text.includes(query);
  if (operation === 'ilike') return text.toLowerCase().includes(query.toLowerCase());
  if (operation === 'notContains') return !text.includes(query);
  if (operation === 'startsWith') return text.startsWith(query);
  if (operation === 'endsWith') return text.endsWith(query);
  return false;
}

function matchingRows(
  rows: IDataTableRow[],
  table: IDataTableView,
  filters: FilterCondition[],
  matchType: unknown,
): IDataTableRow[] {
  const types = columnTypes(table);
  for (const filter of filters) {
    if (!types.has(filter.keyName)) {
      throw new OperationalError(`Column "${filter.keyName}" does not exist in the selected table`, {});
    }
  }
  if (filters.length === 0) return rows;
  return rows.filter((row) => {
    const json = rowJson(row);
    const hits = filters.map((filter) => compare(json[filter.keyName], filter, types.get(filter.keyName)!));
    return matchType === 'allConditions' ? hits.every(Boolean) : hits.some(Boolean);
  });
}

function coerce(value: unknown, column: IDataTableColumn): unknown {
  if (value === null || value === undefined) return value;
  if (column.type === 'string') return String(value);
  if (column.type === 'number') {
    const number = Number(value);
    if (!Number.isFinite(number)) throw new OperationalError(`Column "${column.name}" expects a number`, {});
    return number;
  }
  if (column.type === 'boolean') {
    if (value === true || value === false) return value;
    if (value === 'true' || value === '1' || value === 1) return true;
    if (value === 'false' || value === '0' || value === 0) return false;
    throw new OperationalError(`Column "${column.name}" expects a boolean`, {});
  }
  const date = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(date.getTime())) throw new OperationalError(`Column "${column.name}" expects a date`, {});
  return date.toISOString();
}

function mappedData(raw: unknown, input: JsonObject, table: IDataTableView): JsonObject {
  const mapping = objectValue(raw);
  const source = mapping['mappingMode'] === 'autoMapInputData' ? input : objectValue(mapping['value']);
  const columns = new Map(table.columns.map((column) => [column.name, column]));
  const output: JsonObject = {};
  for (const [key, value] of Object.entries(source)) {
    const column = columns.get(key);
    if (column) output[key] = coerce(value, column);
  }
  return output;
}

function booleanOption(context: IExecuteContext, index: number, name: string): boolean {
  return objectValue(context.getNodeParameter('options', index, {}))[name] === true;
}

export class DataTable implements INodeType {
  description = dataTableDescription;

  methods = {
    resourceLocator: {
      tableSearch: async function (this: IResourceLocatorContext): Promise<IResourceLocatorResult> {
        if (!this.helpers.dataTables) throw new OperationalError('Data table service is unavailable', {});
        const filter = (this.filter ?? '').toLowerCase();
        const results = (await this.helpers.dataTables.list())
          .filter((table) => !filter || table.name.toLowerCase().includes(filter))
          .map((table) => ({ name: table.name, value: table.id, description: `${table.rowCount} rows` }));
        return { results };
      },
    },
    loadOptions: {
      getDataTableColumns: async function (this: ILoadOptionsContext): Promise<INodePropertyOption[]> {
        if (!this.helpers.dataTables) throw new OperationalError('Data table service is unavailable', {});
        const table = await resolveTable(this.helpers.dataTables, this.getCurrentNodeParameter('dataTableId'));
        return [...SYSTEM_COLUMNS, ...table.columns].map((column) => ({
          name: column.name,
          value: column.name,
          description: column.type,
        }));
      },
      getConditionsForColumn: async function (this: ILoadOptionsContext): Promise<INodePropertyOption[]> {
        const key = String(this.getCurrentNodeParameter('keyName') ?? '');
        let type: DataTableColumnType = SYSTEM_COLUMNS.find((column) => column.name === key)?.type ?? 'string';
        if (this.helpers.dataTables) {
          const table = await resolveTable(this.helpers.dataTables, this.getCurrentNodeParameter('dataTableId'));
          type = table.columns.find((column) => column.name === key)?.type ?? type;
        }
        const common = [
          { name: 'Is Empty', value: 'isEmpty' },
          { name: 'Is Not Empty', value: 'isNotEmpty' },
        ];
        if (type === 'boolean') return [
          { name: 'Is True', value: 'isTrue' },
          { name: 'Is False', value: 'isFalse' },
          ...common,
        ];
        const comparisons = [
          { name: 'Equals', value: 'eq' },
          { name: 'Does Not Equal', value: 'neq' },
          { name: 'Greater Than', value: 'gt' },
          { name: 'Greater Than or Equal', value: 'gte' },
          { name: 'Less Than', value: 'lt' },
          { name: 'Less Than or Equal', value: 'lte' },
        ];
        if (type !== 'string') return [...comparisons, ...common];
        return [
          { name: 'Equals', value: 'eq' },
          { name: 'Does Not Equal', value: 'neq' },
          { name: 'Contains', value: 'contains' },
          { name: 'Does Not Contain', value: 'notContains' },
          { name: 'Starts With', value: 'startsWith' },
          { name: 'Ends With', value: 'endsWith' },
          ...common,
        ];
      },
    },
    resourceMapping: {
      getDataTables: async function (this: ILoadOptionsContext): Promise<IResourceMapperFields> {
        if (!this.helpers.dataTables) throw new OperationalError('Data table service is unavailable', {});
        const table = await resolveTable(this.helpers.dataTables, this.getCurrentNodeParameter('dataTableId'));
        return {
          fields: table.columns.map((column) => ({
            id: column.name,
            displayName: column.name,
            type: column.type,
            required: false,
            defaultMatch: false,
            canBeUsedToMatch: true,
          })),
        };
      },
    },
  };

  async execute(this: IExecuteContext): Promise<INodeExecutionData[][]> {
    const helper = operations(this);
    const input = this.getInputData();
    const output: INodeExecutionData[] = [];
    const resource = String(this.getNodeParameter('resource', 0, 'row'));
    const operation = String(this.getNodeParameter('operation', 0, resource === 'table' ? 'list' : 'insert'));

    for (const [index, item] of input.entries()) {
      if (resource === 'table') {
        if (operation === 'list') {
          const options = objectValue(this.getNodeParameter('options', index, {}));
          const filter = String(options['filterName'] ?? '').toLowerCase();
          const field = String(options['sortField'] ?? 'name') as 'name' | 'createdAt' | 'updatedAt';
          const direction = options['sortDirection'] === 'desc' ? -1 : 1;
          let tables = (await helper.list()).filter((table) => !filter || table.name.toLowerCase().includes(filter));
          tables = tables.sort((a, b) => {
            const left = field === 'name' ? a.name.toLowerCase() : a[field].getTime();
            const right = field === 'name' ? b.name.toLowerCase() : b[field].getTime();
            return (left < right ? -1 : left > right ? 1 : 0) * direction;
          });
          const returnAll = this.getNodeParameter('returnAll', index, true) === true;
          const limit = Math.max(1, Number(this.getNodeParameter('limit', index, 50)) || 50);
          for (const table of returnAll ? tables : tables.slice(0, limit)) {
            output.push({ json: tableJson(table), pairedItem: { item: index } });
          }
          continue;
        }
        if (operation === 'create') {
          const name = String(this.getNodeParameter('tableName', index, '')).trim();
          const rawColumns = objectValue(this.getNodeParameter('columns', index, {}))['column'];
          const columns = Array.isArray(rawColumns)
            ? rawColumns.map((entry) => {
                const column = objectValue(entry);
                return { name: String(column['name'] ?? ''), type: String(column['type'] ?? 'string') as DataTableColumnType };
              })
            : [];
          if (objectValue(this.getNodeParameter('options', index, {}))['createIfNotExists'] !== false) {
            const existing = (await helper.list()).find((table) => table.name === name);
            if (existing) {
              output.push({ json: tableJson(existing), pairedItem: { item: index } });
              continue;
            }
          }
          output.push({ json: tableJson(await helper.create({ name, columns })), pairedItem: { item: index } });
          continue;
        }
        const table = await resolveTable(helper, this.getNodeParameter('dataTableId', index));
        if (operation === 'clear') {
          output.push({ json: { success: true, deletedCount: await helper.clearRows(table.id) }, pairedItem: { item: index } });
        } else if (operation === 'delete') {
          await helper.delete(table.id);
          output.push({ json: { success: true, deletedTableId: table.id }, pairedItem: { item: index } });
        } else if (operation === 'update') {
          const name = String(this.getNodeParameter('newName', index, '')).trim();
          await helper.rename(table.id, name);
          output.push({ json: { success: true, name }, pairedItem: { item: index } });
        } else {
          throw new OperationalError(`Unsupported Data table operation: ${operation}`, {});
        }
        continue;
      }

      const table = await resolveTable(helper, this.getNodeParameter('dataTableId', index));
      if (operation === 'insert') {
        const inserted = await helper.insertRow(table.id, mappedData(this.getNodeParameter('columns', index, {}), item.json, table));
        if (!booleanOption(this, index, 'optimizeBulk')) {
          output.push({ json: rowJson(inserted), pairedItem: { item: index } });
        }
        continue;
      }
      const selectedConditions = conditions(this.getNodeParameter('filters', index, {}));
      const selected = matchingRows(
        await helper.listRows(table.id),
        table,
        selectedConditions,
        this.getNodeParameter('matchType', index, 'anyCondition'),
      );
      if (operation === 'get') {
        let rows = selected;
        if (this.getNodeParameter('orderBy', index, false) === true) {
          const key = String(this.getNodeParameter('orderByColumn', index, 'createdAt'));
          if (!columnTypes(table).has(key)) throw new OperationalError(`Column "${key}" does not exist`, {});
          const direction = this.getNodeParameter('orderByDirection', index, 'DESC') === 'ASC' ? 1 : -1;
          rows = [...rows].sort((a, b) => {
            const left = rowJson(a)[key];
            const right = rowJson(b)[key];
            return (left! < right! ? -1 : left! > right! ? 1 : 0) * direction;
          });
        }
        const returnAll = this.getNodeParameter('returnAll', index, false) === true;
        const limit = Math.max(1, Number(this.getNodeParameter('limit', index, 50)) || 50);
        for (const row of returnAll ? rows : rows.slice(0, limit)) {
          output.push({ json: rowJson(row), pairedItem: { item: index } });
        }
        continue;
      }
      if (operation === 'rowExists' || operation === 'rowNotExists') {
        const exists = selected.length > 0;
        if ((operation === 'rowExists' && exists) || (operation === 'rowNotExists' && !exists)) output.push(item);
        continue;
      }
      if (selectedConditions.length === 0) {
        throw new OperationalError('At least one condition is required', {});
      }
      const dryRun = booleanOption(this, index, 'dryRun');
      if (operation === 'deleteRows') {
        for (const row of selected) {
          if (!dryRun) await helper.deleteRow(table.id, row.id);
          output.push({
            json: dryRun ? { before: rowJson(row), after: null } : rowJson(row),
            pairedItem: { item: index },
          });
        }
        continue;
      }
      if (operation === 'update' || operation === 'upsert') {
        const patch = mappedData(this.getNodeParameter('columns', index, {}), item.json, table);
        if (operation === 'upsert' && selected.length === 0) {
          if (dryRun) output.push({ json: { before: null, after: patch }, pairedItem: { item: index } });
          else output.push({ json: rowJson(await helper.insertRow(table.id, patch)), pairedItem: { item: index } });
          continue;
        }
        for (const row of selected) {
          const after = dryRun ? { ...rowJson(row), ...patch } : rowJson(await helper.updateRow(table.id, row.id, patch));
          output.push({
            json: dryRun ? { before: rowJson(row), after } : after,
            pairedItem: { item: index },
          });
        }
        continue;
      }
      throw new OperationalError(`Unsupported Data table operation: ${operation}`, {});
    }

    if (resource === 'row' && operation === 'insert' && input.length > 0 && booleanOption(this, 0, 'optimizeBulk')) {
      output.push({ json: { insertedCount: input.length } });
    }
    return [output];
  }
}
