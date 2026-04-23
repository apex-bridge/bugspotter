import { defineConfig, devices } from '@playwright/test';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Load environment variables for E2E tests
 * Priority order (first found wins):
 * 1. Admin .env.e2e (E2E test specific config)
 * 2. Admin .env.integration (admin-specific integration config)
 * 3. Backend .env.integration (shared integration test config, including Jira)
 * 4. Root .env (fallback)
 *
 * For CI/CD: Set environment variables directly in GitHub Actions/CI pipeline
 * Local dev: Use .env.integration for credentials
 */
dotenv.config({ path: path.resolve(__dirname, '.env.e2e') });
dotenv.config({ path: path.resolve(__dirname, '.env.integration') });
dotenv.config({ path: path.resolve(__dirname, '../../packages/backend/.env.integration') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// Shared helpers — see `src/tests/e2e/helpers/url-helpers.ts` for
// rationale. Import is relative because `playwright.config.ts` lives
// outside `src/` but TypeScript resolution still works.
import {
  DEFAULT_ADMIN_PORT,
  DEFAULT_API_PORT,
  normalizeOrigin,
} from './src/tests/e2e/helpers/url-helpers';

const ADMIN_BASE_URL = normalizeOrigin(
  process.env.BASE_URL || `http://localhost:${process.env.E2E_ADMIN_PORT || DEFAULT_ADMIN_PORT}`,
  'BASE_URL'
);
const BACKEND_API_URL = normalizeOrigin(
  process.env.API_URL || `http://localhost:${process.env.API_PORT || DEFAULT_API_PORT}`,
  'API_URL'
);

export default defineConfig({
  testDir: './src/tests/e2e',
  fullyParallel: false, // Run tests sequentially (can enable after verification)
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Single worker (can increase after tests are verified working)
  reporter: [['html', { outputFolder: 'e2e-debug/html-report', open: 'never' }], ['list']],
  globalSetup: './src/tests/e2e/global-setup.ts',
  globalTeardown: './src/tests/e2e/global-teardown.ts',
  globalTimeout: 1800000, // 30 minutes for entire test run (increased from 15 mins)
  timeout: 120000, // Increase test timeout to 120s (2 minutes) for testcontainer startup
  outputDir: 'e2e-debug/test-results',
  use: {
    // Port overrides via env so contributors on Windows (where Hyper-V
    // reserves 4000/4001 for its own use via `netsh int ipv4 show
    // excludedportrange`) can pick free ports.
    baseURL: ADMIN_BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
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
        // Use node to run vite directly, bypassing Corepack/pnpm issues
        // This works because vite is installed in node_modules
        command: `node node_modules/vite/bin/vite.js --port ${process.env.E2E_ADMIN_PORT || DEFAULT_ADMIN_PORT}`,
        url: ADMIN_BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 120000,
        stdout: 'pipe',
        stderr: 'pipe',
        env: {
          PORT: process.env.E2E_ADMIN_PORT || DEFAULT_ADMIN_PORT,
          VITE_API_URL: BACKEND_API_URL,
        },
      },
});
