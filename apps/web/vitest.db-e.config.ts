import { defineConfig } from 'vitest/config';
import path from 'node:path';

// PRIVATE Agent E real-Postgres config, used only because the shared
// vitest.db.config.ts (Agent C) is not on this branch yet. At integration the
// lead should run tests/db/e-*.test.ts under C's harness and delete this file.
// Run: DATABASE_URL=postgresql://ci@localhost:55432/ci_e?schema=public npx vitest run --config vitest.db-e.config.ts
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/db/e-*.test.ts'],
    globalSetup: ['tests/db/e-global-setup.ts'],
    pool: 'forks',
    maxWorkers: 1,
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') }
  }
});
