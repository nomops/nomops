import { getTableColumns } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { pgSchema } from '../schema/pg.js';
import { sqliteSchema } from '../schema/sqlite.js';

// 守护双方言 schema 漂移：表集合与每张表的列集合必须一致。
describe('schema 双方言一致性', () => {
  it('两方言暴露相同的表', () => {
    expect(Object.keys(sqliteSchema).sort()).toEqual(Object.keys(pgSchema).sort());
  });

  it('每张表的列名一致', () => {
    for (const table of Object.keys(sqliteSchema) as Array<keyof typeof sqliteSchema>) {
      const sqliteCols = Object.keys(getTableColumns(sqliteSchema[table])).sort();
      const pgCols = Object.keys(getTableColumns(pgSchema[table])).sort();
      expect(pgCols, `表 ${String(table)} 列不一致`).toEqual(sqliteCols);
    }
  });
});
