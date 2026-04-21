import { defineConfig } from 'vitest/config';

/**
 * Vitest configuration for unit tests only
 * - No database/testcontainers setup
 * - No global setup (no PostgreSQL)
 * - Faster execution for isolated unit tests
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [
      'tests/services/**/*.test.ts',
      // Only include pure unit tests from saas/ (no database required)
      'tests/saas/admin-billing-method.test.ts',
      'tests/saas/billing-service.test.ts',
      'tests/saas/deployment-config.test.ts',
      'tests/saas/invitation-email.service.test.ts',
      'tests/saas/plans.test.ts',
      'tests/saas/spam-filter.service.test.ts',
      'tests/saas/subdomain.service.test.ts',
      'tests/saas/signup.service.test.ts',
      'tests/saas/org-retention.service.test.ts',
      'tests/saas/tenant-middleware.test.ts',
      // Integration tests that don't require database
      'tests/integrations/plugin-utils-retry.test.ts',
      'tests/integrations/ssrf-protection.test.ts',
      'tests/integrations/rpc-http-fetch.test.ts',
      'tests/integrations/rpc-bridge-security.test.ts',
      'tests/integrations/base-integration-helpers.test.ts',
      'tests/api/auth-responses.test.ts',
      'tests/api/auth-handlers.test.ts',
      // Only include pure unit tests from middleware (no database/server)
      'tests/api/middleware/authorization.test.ts',
      'tests/api/middleware/require-project-role.test.ts',
      'tests/api/routes/rbac-enforcement.test.ts',
      'tests/api/routes/permissions.test.ts',
      'tests/api/routes/rbac-regression.test.ts',
      'tests/api/routes/signup.route.test.ts',
      'tests/api/services/**/*.test.ts',
      'tests/cache/**/*.test.ts',
      // Only include pure unit tests from tests/db/ (no database required)
      'tests/db/filter-builder.test.ts',
      'tests/db/filter-builder-edge-cases.test.ts',
      'tests/db/query-builder.test.ts',
      'tests/db/pagination-builder.test.ts',
      'tests/db/base-repository-validation.test.ts',
      'tests/db/base-repository-date-filter.test.ts',
      'tests/db/retry.test.ts',
      // Jira config tests (pure unit, mocked repository)
      'tests/integrations/jira/config.test.ts',
      // Jira mapper tests (pure unit, no database)
      'tests/integrations/jira/mapper.test.ts',
      'tests/integrations/jira/mapper-enhanced.test.ts',
      'tests/integrations/jira/mapper-table-and-nested-metadata.test.ts',
      'tests/integrations/jira/template-renderer.test.ts',
      'tests/integrations/jira/formatters/base-formatter.test.ts',
      // Intelligence tests (pure unit, mocked dependencies)
      'tests/api/utils/mitigation-trigger.test.ts',
      'tests/api/utils/resolution-sync-trigger.test.ts',
      'tests/api/utils/enrichment-trigger.test.ts',
      'tests/services/intelligence/dedup-service.test.ts',
      'tests/services/intelligence/self-service.test.ts',
      // Pure env-var / config validation test, no DB.
      'tests/config.test.ts',
    ],
    testTimeout: 10000,
    hookTimeout: 10000,
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: false,
      },
    },
    // Minimal env-var bootstrap. Unit tests mock DB/services, but a handful
    // of modules (e.g. JiraConfigManager) instantiate env-backed
    // dependencies at import time and will refuse to load without
    // ENCRYPTION_KEY / JWT_SECRET. CI provides them via workflow env;
    // locally this file ensures `pnpm test:unit` matches CI behavior out
    // of the box. No services are started here.
    setupFiles: ['./tests/setup-unit-env.ts'],
  },
});
