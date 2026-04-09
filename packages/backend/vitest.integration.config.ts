import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    exclude: ['tests/integration/load.test.ts'],
    globalSetup: ['./tests/setup.integration.ts'],
    testTimeout: 60000, // 60 seconds for integration tests
    hookTimeout: 60000,
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true, // Run tests serially to avoid conflicts
      },
    },
    // Setup files for polyfills and environment configuration
    setupFiles: ['./tests/setup-file-polyfill.ts', './tests/setup.integration-env.ts'],
  },
});
