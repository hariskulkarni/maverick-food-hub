import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts', '__tests__/**/*.test.ts'],
    setupFiles: []
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') }
  }
});
