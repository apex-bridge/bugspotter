/**
 * Integration Test Environment Setup
 * This file runs in the test worker process and ensures environment variables are set
 * It must run BEFORE any application code is imported
 *
 * Note: DATABASE_URL is set by globalSetup and should be available here
 */

// Ensure JWT secret is available (may have been set by globalSetup)
if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = 'test-jwt-secret-for-integration-tests-min-32-chars-required-here';
}

if (!process.env.JWT_EXPIRES_IN) {
  process.env.JWT_EXPIRES_IN = '1h';
}

if (!process.env.JWT_REFRESH_EXPIRES_IN) {
  process.env.JWT_REFRESH_EXPIRES_IN = '7d';
}

if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = 'test';
}

if (!process.env.LOG_LEVEL) {
  process.env.LOG_LEVEL = 'error';
}

// Verify DATABASE_URL is set (should come from globalSetup)
if (!process.env.DATABASE_URL) {
  console.warn('⚠️  DATABASE_URL not set - globalSetup may not have run yet');
}

console.log('✅ Integration test environment configured');
