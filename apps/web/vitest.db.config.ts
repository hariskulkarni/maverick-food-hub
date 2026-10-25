/**
 * Real-database test harness (rider audit r3). Opt-in — NOT part of test:ci:
 *
 *   TEST_DATABASE_URL=postgresql://ci@localhost:55432/ci_rider_r3 npm run test:db
 *
 * Global setup resets the target database to the current Prisma schema
 * (`prisma db push --force-reset`) and refuses anything that is not a local
 * `ci_*` database, so it can never touch dev/prod data. Files run serially.
 */
import { defineConfig } from 'vitest/config';
import path from 'node:path';

const url = process.env.TEST_DATABASE_URL ?? 'postgresql://ci@localhost:55432/ci_rider_r3?schema=public';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/db/**/*.db.test.ts'],
    globalSetup: ['tests/db/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
    env: { DATABASE_URL: url, TEST_DATABASE_URL: url, NEXTAUTH_SECRET: 'db-test-secret-not-for-prod-0123456789' }
  },
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } }
});
