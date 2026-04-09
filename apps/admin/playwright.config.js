import { defineConfig, devices } from '@playwright/test';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { fileURLToPath } from 'url';
// Load E2E test environment variables
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, '.env.e2e');
dotenv.config({ path: envPath });
export default defineConfig({
  testDir: './src/tests/e2e',
  fullyParallel: false, // Run tests sequentially to avoid login conflicts
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Single worker for sequential execution
  reporter: [['html', { open: 'never' }], ['list']],
  globalSetup: './src/tests/e2e/global-setup.ts',
  timeout: 60000, // Increase test timeout to 60s
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:4001',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    actionTimeout: 15000, // Increase action timeout to 15s
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: process.env.BASE_URL
    ? undefined
    : {
        command: 'pnpm dev',
        url: 'http://localhost:4001',
        reuseExistingServer: !process.env.CI,
        timeout: 120000,
        env: {
          PORT: '4001',
          VITE_API_URL: 'http://localhost:4000',
        },
      },
});
