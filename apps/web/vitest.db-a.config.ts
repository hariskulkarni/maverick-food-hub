import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Agent A private real-Postgres harness (until the shared vitest.db.config.ts lands on this branch).
// Run: DATABASE_URL=postgresql://ci@localhost:55432/ci_a?schema=public npx vitest run --config vitest.db-a.config.ts
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/db/a-*.test.ts'],
    globalSetup: ['tests/db/a-global-setup.ts'],
    pool: 'forks',
    maxWorkers: 1,
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
});
