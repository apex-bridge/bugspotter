import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/integration/**', 'tests/load/**'],
    globalSetup: ['./tests/setup.ts'],
    testTimeout: 60000, // 60s for CI (testcontainers can be slow)
    hookTimeout: 120000, // 2 min for beforeAll with testcontainers
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    // Workaround for undici "File is not defined" error in Node 18
    // https://github.com/nodejs/undici/issues/1650
    setupFiles: [
      './tests/setup-file-polyfill.ts',
      './tests/setup-redis-mock.ts',
      './tests/integrations/setup.ts',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'json'],
      reportsDirectory: './coverage',
      exclude: [
        'coverage/**',
        'dist/**',
        '**/node_modules/**',
        '**/tests/**',
        '**/*.test.ts',
        '**/*.spec.ts',
        '**/*.config.ts',
        '**/types.ts',
        '**/*.d.ts',
      ],
    },
  },
});
