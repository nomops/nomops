import { defineConfig } from 'drizzle-kit';

// SQLite 迁移生成。运行：pnpm --filter @nomops/db generate
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/schema/sqlite.ts',
  out: './migrations/sqlite',
});
