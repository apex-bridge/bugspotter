/**
 * Test setup file with Testcontainers
 * Automatically starts and manages PostgreSQL container for tests
 */

// Suppress excessive DEBUG/INFO logs in tests (only show errors)
process.env.LOG_LEVEL = 'error';

// Set deployment mode to selfhosted for tests (disables tenant middleware)
process.env.DEPLOYMENT_MODE = 'selfhosted';

// CRITICAL: Polyfill File/Blob BEFORE importing testcontainers/undici
// This MUST be the first import to avoid "File is not defined" errors
import './setup-file-polyfill.js';

import { PostgreSqlContainer } from '@testcontainers/postgresql';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { exec } from 'child_process';
import { promisify } from 'util';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Load .env.integration for integration test credentials
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '..', '.env.integration') });

const execAsync = promisify(exec);

let postgresContainer: StartedPostgreSqlContainer;

/**
 * Global setup - starts PostgreSQL container before all tests
 */
export async function setup() {
  // Reset deployment config cache to ensure DEPLOYMENT_MODE env var is read
  const { resetDeploymentConfig } = await import('../src/saas/config.js');
  resetDeploymentConfig();

  console.log('🚀 Starting PostgreSQL container...');

  postgresContainer = await new PostgreSqlContainer('postgres:16')
    .withDatabase('bugspotter_test')
    .withUsername('postgres')
    .withPassword('testpass')
    .withExposedPorts(5432)
    .start();

  const connectionUri = postgresContainer.getConnectionUri();
  // Force search_path to application to match production behavior
  process.env.DATABASE_URL = `${connectionUri}?options=-c%20search_path%3Dapplication`;
  process.env.JWT_SECRET = 'test-jwt-secret-for-testing-only-not-production';
  process.env.JWT_EXPIRES_IN = '1h';
  process.env.JWT_REFRESH_EXPIRES_IN = '7d';
  process.env.ALLOW_REGISTRATION = 'true'; // Enable registration for tests
  process.env.REQUIRE_INVITATION_TO_REGISTER = 'false'; // Disable for existing tests (tested explicitly in auth.test.ts)
  process.env.ENCRYPTION_KEY = 'test-encryption-key-32-bytes-min'; // Required for Jira integration tests

  console.log('✅ PostgreSQL container started');
  console.log('📍 Database:', connectionUri.replace(/:[^:@]+@/, ':***@'));

  // Run migrations
  console.log('🔄 Running migrations...');
  try {
    await execAsync('npx tsx src/cli/migrate.ts', {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: connectionUri },
    });
    console.log('✅ Migrations completed');
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  }
}

/**
 * Global teardown - stops PostgreSQL container after all tests
 */
export async function teardown() {
  if (postgresContainer) {
    console.log('🧹 Stopping PostgreSQL container...');
    await postgresContainer.stop();
    console.log('✅ Container stopped');
  }
}
