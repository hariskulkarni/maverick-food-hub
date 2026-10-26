import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Novaryq partner-API simulator contract tests (no DB). Not part of test:ci.
// Run: npx vitest run --config vitest.novaryq-sim.config.ts
// Against a real Novaryq apps/api: NQ_BASE_URL=… NQ_CLIENT_ID=… NQ_SECRET=… NQ_LOCATION_ID=… NQ_ITEM_CODE=… (same command)
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/novaryq-sim/**/*.test.ts'],
    testTimeout: 30_000,
  },
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
});
