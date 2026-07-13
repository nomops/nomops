import { defineConfig } from 'drizzle-kit';

// PostgreSQL 迁移生成。运行：pnpm --filter @nomops/db generate
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/pg.ts',
  out: './migrations/pg',
});
