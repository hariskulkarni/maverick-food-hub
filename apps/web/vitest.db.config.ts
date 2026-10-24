import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Real-Postgres tests (money-critical invariants: unique allocation, row locks, triggers).
// Run: DATABASE_URL=postgresql://ci@localhost:55432/ci_x?schema=public npm run test:db
// globalSetup refuses any DATABASE_URL that is not localhost + a db name starting with "ci".
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/db/**/*.test.ts'],
    globalSetup: ['tests/db/global-setup.ts'],
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
