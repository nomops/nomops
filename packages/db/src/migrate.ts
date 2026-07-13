import { fileURLToPath } from 'node:url';
import type { DatabaseHandle } from './client.js';

/** 迁移目录（相对包根 ./migrations/<dialect>，src 与 dist 下同一相对位置）。 */
function migrationsDir(dialect: DatabaseHandle['dialect']): string {
  const sub = dialect === 'sqlite' ? 'sqlite' : 'pg';
  return fileURLToPath(new URL(`../migrations/${sub}`, import.meta.url));
}

/** 对给定连接跑迁移（drizzle-kit 生成的 SQL）。按驱动选 migrator。 */
export async function runMigrations(handle: DatabaseHandle): Promise<void> {
  const migrationsFolder = migrationsDir(handle.dialect);
  switch (handle.driver) {
    case 'better-sqlite3': {
      const { migrate } = await import('drizzle-orm/better-sqlite3/migrator');
      migrate(handle.db, { migrationsFolder });
      return;
    }
    case 'node-postgres': {
      const { migrate } = await import('drizzle-orm/node-postgres/migrator');
      await migrate(handle.db, { migrationsFolder });
      return;
    }
    case 'pglite': {
      const { migrate } = await import('drizzle-orm/pglite/migrator');
      await migrate(handle.db, { migrationsFolder });
      return;
    }
  }
}
