import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Agent B private real-Postgres config, used until Agent C's vitest.db.config.ts
// (npm run test:db) is merged; the b-*.test.ts files need only the Prisma schema.
// Run: DATABASE_URL=postgresql://ci@localhost:55432/ci_b?schema=public npx vitest run --config vitest.db-b.config.ts
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/db/b-*.test.ts'],
    globalSetup: ['tests/db/b-global-setup.ts'],
    pool: 'forks',
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
});
