import ivm from 'isolated-vm';

const MEMORY_LIMIT_MB = 32;
const TIMEOUT_MS = 5_000;

/** Run the baseline-compatible comparator without Node globals, bounded by heap and CPU time. */
export async function sortIndexesByCode(items: unknown[], code: string): Promise<number[]> {
  const isolate = new ivm.Isolate({ memoryLimit: MEMORY_LIMIT_MB });
  const context = await isolate.createContext();
  try {
    const result = await context.evalClosure(`
      const rows = $0.map((json, index) => ({ json, index }));
      const compare = (a, b) => { ${code} };
      rows.sort((a, b) => {
        const result = Number(compare({ json: a.json }, { json: b.json }));
        if (!Number.isFinite(result)) throw new Error('Sort code must return a finite number');
        return result;
      });
      return rows.map((row) => row.index);
    `, [items], {
      arguments: { copy: true }, result: { copy: true }, timeout: TIMEOUT_MS,
    }) as number[];
    return result;
  } finally {
    context.release();
    isolate.dispose();
  }
}
