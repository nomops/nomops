import { pgSchema } from './schema/pg.js';
import { sqliteSchema } from './schema/sqlite.js';

/**
 * 数据库客户端工厂 —— 唯一感知方言的地方。
 *
 * Phase 1 支持两种后端：
 *   - 'sqlite'   → better-sqlite3（默认，单机零依赖）
 *   - 'postgres' → PGlite（进程内 Postgres，用于验证 PG 方言/迁移/仓储）
 * 生产环境的网络化 Postgres（node-postgres）在具备部署形态时（Phase 5）接入，
 * schema 与仓储代码不变。
 */

export type DbDialect = 'sqlite' | 'postgres';

/** 规范 schema 形态（两方言结构一致，以 sqlite 为准）。 */
export type NomopsSchema = typeof sqliteSchema;

export type DbDriver = 'better-sqlite3' | 'pglite' | 'node-postgres';

export interface DatabaseHandle {
  dialect: DbDialect;
  driver: DbDriver;
  // drizzle 实例在两方言下类型不同，此处宽松持有；仓储公共方法保持精确领域类型。
  db: any;
  schema: NomopsSchema;
  close(): Promise<void>;
}

export interface SqliteConfig {
  type: 'sqlite';
  filename?: string; // 省略 = 内存库 ':memory:'
}

export interface PostgresConfig {
  type: 'postgres';
  /** 连接串（postgres://…）→ 走 node-postgres（生产）；省略则用 PGlite。 */
  url?: string;
  /** PGlite 数据目录；连 url 一起省略 = 内存库（测试）。 */
  dataDir?: string;
}

export type DatabaseConfig = SqliteConfig | PostgresConfig;

export async function createDatabase(config: DatabaseConfig): Promise<DatabaseHandle> {
  if (config.type === 'sqlite') {
    const { default: BetterSqlite3 } = await import('better-sqlite3');
    const { drizzle } = await import('drizzle-orm/better-sqlite3');
    const sqlite = new BetterSqlite3(config.filename ?? ':memory:');
    sqlite.pragma('foreign_keys = ON');
    const db = drizzle(sqlite, { schema: sqliteSchema });
    return {
      dialect: 'sqlite',
      driver: 'better-sqlite3',
      db,
      schema: sqliteSchema,
      close: async () => {
        sqlite.close();
      },
    };
  }

  if (config.url) {
    // 生产：网络化 PostgreSQL（node-postgres 连接池）
    const { default: pg } = await import('pg');
    const { drizzle } = await import('drizzle-orm/node-postgres');
    const pool = new pg.Pool({ connectionString: config.url });
    const db = drizzle(pool, { schema: pgSchema });
    return {
      dialect: 'postgres',
      driver: 'node-postgres',
      db,
      schema: pgSchema as unknown as NomopsSchema,
      close: async () => {
        await pool.end();
      },
    };
  }

  // 开发/测试：PGlite（进程内 Postgres）
  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle } = await import('drizzle-orm/pglite');
  const client = new PGlite(config.dataDir);
  const db = drizzle(client, { schema: pgSchema });
  return {
    dialect: 'postgres',
    driver: 'pglite',
    db,
    // pg schema 与 sqlite schema 结构一致，供仓储以规范形态使用。
    schema: pgSchema as unknown as NomopsSchema,
    close: async () => {
      await client.close();
    },
  };
}
