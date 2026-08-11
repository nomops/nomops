import type { IExecuteContext, INodeExecutionData, INodeType, JsonObject } from '@nomops/workflow';
import { OperationalError } from '@nomops/workflow';
import { mergeDescription } from './Merge.description.js';
import { runSqlQuery } from './sql-sandbox.js';

function fields(value: unknown): string[] {
  return String(value ?? '').split(',').map((field) => field.trim()).filter(Boolean);
}

function valueAt(source: JsonObject, path: string): unknown {
  return path.split('.').reduce<unknown>((value, part) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    return (value as JsonObject)[part];
  }, source);
}

function same(left: unknown, right: unknown, fuzzy: boolean): boolean {
  return fuzzy ? String(left ?? '') === String(right ?? '') : Object.is(left, right);
}

function merged(left: INodeExecutionData | undefined, right: INodeExecutionData | undefined, output = 'both'): INodeExecutionData {
  const json = output === 'input1' ? { ...(left?.json ?? {}) }
    : output === 'input2' ? { ...(right?.json ?? {}) }
      : { ...(left?.json ?? {}), ...(right?.json ?? {}) };
  const binary = { ...(left?.binary ?? {}), ...(right?.binary ?? {}) };
  return {
    json,
    ...(Object.keys(binary).length > 0 ? { binary } : {}),
    pairedItem: { item: 0 },
  };
}

function withPairedItem(query: string, inputCount: number): string {
  const match = query.match(/SELECT\s+(.+?)\s+FROM/i);
  if (!match || match[1]?.trim() === '*') return query;
  const columns = Array.from({ length: inputCount }, (_, index) => index + 1)
    .filter((index) => new RegExp(`\\binput${index}\\b`, 'i').test(query))
    .map((index) => `input${index}.pairedItem AS pairedItem${index}`);
  if (columns.length === 0) return query;
  return query.replace(match[0], `SELECT ${match[1]}, ${columns.join(', ')} FROM`);
}

function sqlItem(row: unknown): INodeExecutionData | null {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  const json: JsonObject = {};
  const pairedItem: Array<{ item: number; input?: number }> = [];
  for (const [key, value] of Object.entries(row)) {
    if (key.startsWith('pairedItem')) {
      if (Array.isArray(value)) pairedItem.push(...value as Array<{ item: number; input?: number }>);
      else if (typeof value === 'number') pairedItem.push({ item: value });
      else if (value && typeof value === 'object') pairedItem.push(value as { item: number; input?: number });
    } else {
      json[key] = value as JsonObject[string];
    }
  }
  return { json, ...(pairedItem.length > 0 ? { pairedItem } : {}) };
}

export class Merge implements INodeType {
  description = mergeDescription;

  async execute(this: IExecuteContext): Promise<INodeExecutionData[][]> {
    const inputCount = Math.max(2, Math.min(10, Number(this.getNodeParameter('numberInputs', 0, 2)) || 2));
    const inputs = Array.from({ length: inputCount }, (_, index) => this.getInputData(index));
    const input0 = inputs[0] ?? [];
    const input1 = inputs[1] ?? [];
    const rawMode = String(this.getNodeParameter('mode', 0, 'append') ?? 'append');
    const mode = rawMode === 'combineByPosition' ? 'combine' : rawMode;
    const combineBy = rawMode === 'combineByPosition'
      ? 'position'
      : String(this.getNodeParameter('combineBy', 0, 'matchingFields') ?? 'matchingFields');

    if (mode === 'append') return [[...input0, ...input1]];

    if (mode === 'chooseBranch') {
      const output = String(this.getNodeParameter('output', 0, 'specifiedInput'));
      if (output === 'empty') return [[{ json: {} }]];
      const useInput = Math.max(1, Math.min(2, Number(this.getNodeParameter('useDataOfInput', 0, 1)) || 1));
      return [useInput === 1 ? input0 : input1];
    }

    if (mode === 'combineBySql') {
      const query = String(this.getNodeParameter('query', 0, '')).trim();
      if (!query) throw new OperationalError('Merge SQL Query requires a query', { parameter: 'query' });
      const tables = inputs.map((input, inputIndex) => input.map((item, itemIndex) => ({
        ...item.json,
        pairedItem: item.pairedItem ?? { item: itemIndex, input: inputIndex },
      })));
      try {
        const result = await runSqlQuery(tables, withPairedItem(query, inputs.length));
        const output = result.flatMap((entry) => Array.isArray(entry) ? entry : [entry])
          .map(sqlItem)
          .filter((item): item is INodeExecutionData => item !== null);
        const options = this.getNodeParameter('options', 0, {}) as JsonObject;
        if (output.length === 0 && options['emptyQueryResult'] === 'success') return [[{ json: { success: true } }]];
        return [output];
      } catch (error) {
        const raw = error instanceof Error ? error.message : String(error);
        const message = /isolate.*dispos|memory limit|exhausted/i.test(raw)
          ? 'Dataset too large for the SQL sandbox'
          : /script execution timed out/i.test(raw)
            ? 'SQL query exceeded the 30 second execution limit'
            : `Issue while executing query: ${raw}`;
        throw new OperationalError(message, { parameter: 'query' });
      }
    }

    if (combineBy === 'position') {
      const length = Math.max(input0.length, input1.length);
      return [Array.from({ length }, (_, index) => ({ ...merged(input0[index], input1[index]), pairedItem: { item: index } }))];
    }
    if (combineBy === 'all') {
      return [input0.flatMap((left, leftIndex) => input1.map((right) => ({
        ...merged(left, right), pairedItem: { item: leftIndex },
      })) )];
    }

    const different = this.getNodeParameter('differentFields', 0, false) === true;
    const leftFields = fields(this.getNodeParameter(different ? 'fieldsToMatchStringInput1' : 'fieldsToMatchString', 0, ''));
    const rightFields = fields(this.getNodeParameter(different ? 'fieldsToMatchStringInput2' : 'fieldsToMatchString', 0, ''));
    if (leftFields.length === 0 || leftFields.length !== rightFields.length) {
      throw new OperationalError('Merge requires the same number of matching fields for both inputs');
    }
    const options = this.getNodeParameter('options', 0, {}) as JsonObject;
    const fuzzy = options['fuzzyCompare'] === true;
    const matches = (left: INodeExecutionData, right: INodeExecutionData) => leftFields.every(
      (field, index) => same(valueAt(left.json, field), valueAt(right.json, rightFields[index]!), fuzzy),
    );
    const joinMode = String(this.getNodeParameter('joinMode', 0, 'keepMatches'));
    const outputFrom = String(this.getNodeParameter('outputDataFrom', 0, 'both'));
    const out: INodeExecutionData[] = [];
    const matchedRight = new Set<number>();
    input0.forEach((left, leftIndex) => {
      const rightMatches = input1.map((right, index) => ({ right, index })).filter(({ right }) => matches(left, right));
      rightMatches.forEach(({ right, index }) => matchedRight.add(index));
      const includeMatches = !['keepNonMatches'].includes(joinMode);
      if (includeMatches) rightMatches.forEach(({ right }) => out.push({ ...merged(left, right, outputFrom), pairedItem: { item: leftIndex } }));
      const includeUnmatchedLeft = ['keepNonMatches', 'keepEverything', 'enrichInput1'].includes(joinMode);
      if (rightMatches.length === 0 && includeUnmatchedLeft) out.push({ ...merged(left, undefined), pairedItem: { item: leftIndex } });
    });
    if (['keepNonMatches', 'keepEverything', 'enrichInput2'].includes(joinMode)) {
      input1.forEach((right, index) => {
        if (!matchedRight.has(index)) out.push({ ...merged(undefined, right), pairedItem: { item: index } });
      });
    }
    return [out];
  }
}
