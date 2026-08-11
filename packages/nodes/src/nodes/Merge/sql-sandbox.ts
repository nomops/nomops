import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import ivm from 'isolated-vm';

const require = createRequire(import.meta.url);
const MEMORY_LIMIT_MB = 64;
const TIMEOUT_MS = 30_000;

let isolate: ivm.Isolate | null = null;
let bootstrap: ivm.Script | null = null;

function isMemoryError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /isolate.*dispos|memory limit|exhausted/i.test(message);
}

function reset(): void {
  bootstrap = null;
  if (isolate && !isolate.isDisposed) isolate.dispose();
  isolate = null;
}

async function ensureSandbox(): Promise<{ isolate: ivm.Isolate; bootstrap: ivm.Script }> {
  if (isolate && !isolate.isDisposed && bootstrap) return { isolate, bootstrap };
  isolate = new ivm.Isolate({ memoryLimit: MEMORY_LIMIT_MB });
  const source = await readFile(require.resolve('alasql/dist/alasql.min.js'), 'utf8');
  bootstrap = await isolate.compileScript(`
    function blockedExternalSource() {
      throw new Error('Network and file system access is disabled in the SQL sandbox');
    }
    Object.defineProperty(globalThis, 'fetch', { value: blockedExternalSource, writable: false, configurable: false });
    Object.defineProperty(globalThis, 'XMLHttpRequest', { value: blockedExternalSource, writable: false, configurable: false });
    ${source}
    ['FILE','JSON','JSONL','NDJSON','TXT','TSV','TAB','CSV','XLS','XLSX','ODS','XML','HTML','GEXF','METEOR','TABLETOP']
      .forEach((name) => { alasql.from[name] = blockedExternalSource; });
    Object.keys(alasql.into).forEach((name) => { alasql.into[name] = blockedExternalSource; });
    Object.freeze(alasql.from);
    Object.freeze(alasql.into);
    Object.freeze(alasql.fn);
  `);
  return { isolate, bootstrap };
}

async function execute(tableData: unknown[][], query: string): Promise<unknown[]> {
  const sandbox = await ensureSandbox();
  const context = await sandbox.isolate.createContext();
  try {
    await sandbox.bootstrap.run(context);
    const result = await context.evalClosure(`
      const rows = $0, dbId = $1, query = $2;
      const db = new alasql.Database(dbId);
      try {
        for (let index = 0; index < rows.length; index++) {
          db.exec('CREATE TABLE input' + (index + 1));
          db.tables['input' + (index + 1)].data = rows[index];
        }
        return JSON.stringify(db.exec(query));
      } finally {
        delete alasql.databases[dbId];
      }
    `, [tableData, randomUUID(), query], {
      arguments: { copy: true },
      result: { copy: true },
      timeout: TIMEOUT_MS,
    }) as string;
    const parsed = JSON.parse(result) as unknown;
    if (!Array.isArray(parsed)) throw new Error('SQL query did not return a result set');
    return parsed;
  } finally {
    context.release();
  }
}

/** AlaSQL runs without Node globals, with fixed heap and CPU limits. */
export async function runSqlQuery(tableData: unknown[][], query: string): Promise<unknown[]> {
  try {
    return await execute(tableData, query);
  } catch (error) {
    if (!isMemoryError(error)) throw error;
    reset();
    return execute(tableData, query);
  }
}
