import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/integration/load.test.ts'],
    globalSetup: ['./tests/setup.integration.ts'],
    testTimeout: 120000, // 2 minutes for load tests
    hookTimeout: 60000,
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    // Setup files for polyfills
    setupFiles: ['./tests/setup-file-polyfill.ts'],
  },
});
