import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Novaryq integration E2E against real Postgres + the Novaryq simulator. Not part of test:ci.
// Run: DATABASE_URL=postgresql://ci@localhost:55432/ci_nq_qa?schema=public npx vitest run --config vitest.novaryq-e2e.config.ts
// globalSetup refuses any DATABASE_URL that is not localhost + a db name starting with "ci", then migrate-resets it.
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/e2e-novaryq/**/*.test.ts'],
    globalSetup: ['tests/db/global-setup.ts'],
    setupFiles: ['tests/e2e-novaryq/setup.ts'],
    pool: 'forks',
    maxWorkers: 1,
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
});
