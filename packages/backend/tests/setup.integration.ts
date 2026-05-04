/**
 * Integration Test Setup
 * Sets up test containers and environment for integration tests
 */

import { PostgreSqlContainer } from '@testcontainers/postgresql';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import { exec } from 'child_process';
import { promisify } from 'util';
import { DatabaseClient } from '../src/db/client.js';

const execAsync = promisify(exec);

let postgresContainer: StartedPostgreSqlContainer;
let redisContainer: StartedTestContainer;

/**
 * Global setup for integration tests
 * Starts PostgreSQL container and runs migrations
 * Note: This runs in a separate context from tests
 */
export async function setup() {
  console.log('🚀 Starting integration test setup...');

  // Start PostgreSQL container
  console.log('Starting PostgreSQL container...');
  postgresContainer = await new PostgreSqlContainer('postgres:16')
    .withDatabase('bugspotter_integration_test')
    .withUsername('postgres')
    .withPassword('testpass')
    .withExposedPorts(5432)
    .start();

  const connectionUri = postgresContainer.getConnectionUri();
  process.env.DATABASE_URL = connectionUri;

  // Start Redis container
  console.log('Starting Redis container...');
  redisContainer = await new GenericContainer('redis:7-alpine').withExposedPorts(6379).start();

  const redisHost = redisContainer.getHost();
  const redisPort = redisContainer.getMappedPort(6379);
  process.env.REDIS_URL = `redis://${redisHost}:${redisPort}`;
  console.log('✅ Redis container started');
  console.log('📍 Redis:', process.env.REDIS_URL);
  process.env.JWT_SECRET = 'test-jwt-secret-for-integration-tests-min-32-chars-required-here';
  process.env.ENCRYPTION_KEY = 'test-encryption-key-for-integration-tests-32chars+';
  process.env.JWT_EXPIRES_IN = '1h';
  process.env.JWT_REFRESH_EXPIRES_IN = '7d';
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'error'; // Reduce log noise in tests
  process.env.RATE_LIMIT_MAX_REQUESTS = '10000'; // Very high limit for tests
  process.env.RATE_LIMIT_WINDOW_MS = '60000'; // 1 minute window
  process.env.ALLOW_REGISTRATION = 'true'; // Enable registration for tests
  // Skip the strict-residency storage validator at server boot. Strict
  // regions (kz, rf) are hardcoded in src/data-residency/types.ts and
  // require per-region S3 endpoints — integration tests use a local
  // testcontainer (postgres/redis/minio) and don't model regional
  // routing, so the validator would always fail. The escape hatch is
  // documented at src/data-residency/config.ts:354-366.
  process.env.DISABLE_STRICT_RESIDENCY_VALIDATION = 'true';

  console.log('✅ PostgreSQL container started');
  console.log('📍 Database:', connectionUri.replace(/:[^:@]+@/, ':***@'));

  // Run migrations
  console.log('🔄 Running migrations...');
  try {
    await execAsync('pnpm migrate', {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: connectionUri },
    });
    console.log('✅ Migrations completed');
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  }

  // Create a temporary client just to verify the connection
  const testDb = DatabaseClient.create({
    connectionString: connectionUri,
  });

  const isConnected = await testDb.testConnection();
  if (!isConnected) {
    await testDb.close();
    throw new Error('Failed to connect to test database');
  }
  await testDb.close();
  console.log('✅ Database connection verified');

  console.log('✅ Integration test setup complete\n');
}

/**
 * Global teardown for integration tests
 * Stops container and closes connections
 */
export async function teardown() {
  console.log('\n🧹 Starting integration test teardown...');

  // Stop Redis container
  if (redisContainer) {
    console.log('Stopping Redis container...');
    try {
      await redisContainer.stop();
      console.log('✅ Redis container stopped');
    } catch (error) {
      console.error('Error stopping Redis container:', error);
    }
  }

  // Stop PostgreSQL container
  if (postgresContainer) {
    console.log('Stopping PostgreSQL container...');
    try {
      await postgresContainer.stop();
      console.log('✅ PostgreSQL container stopped');
    } catch (error) {
      console.error('Error stopping container:', error);
    }
  }

  console.log('✅ Integration test teardown complete');
}

/**
 * Create a fresh database client for testing
 * Each test suite should create its own client
 */
export function createTestDatabase(): DatabaseClient {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL not set. Make sure globalSetup has run.');
  }

  return DatabaseClient.create({
    connectionString: process.env.DATABASE_URL,
  });
}

/**
 * Create test storage service
 */
export async function createTestStorage() {
  const { LocalStorageService } = await import('../src/storage/local-storage.js');
  const storage = new LocalStorageService({
    baseDirectory: './test-storage',
    baseUrl: 'http://localhost:3000/storage',
  });
  await storage.initialize();
  return storage;
}

/**
 * Create a test server with database
 * Returns both server and database for cleanup
 */
export async function createTestServerWithDb() {
  // Verify JWT_SECRET is set before creating server
  if (!process.env.JWT_SECRET) {
    console.warn('⚠️  JWT_SECRET not set when creating test server!');
    console.warn('Setting it now...');
    process.env.JWT_SECRET = 'test-jwt-secret-for-integration-tests-min-32-chars-required-here';
  }

  // Lazy import to avoid loading Fastify until needed after env vars are set
  const { createServer } = await import('../src/api/server.js');
  const { PluginRegistry } = await import('../src/integrations/plugin-registry.js');
  const { loadIntegrationPlugins } = await import('../src/integrations/plugin-loader.js');

  const db = createTestDatabase();

  // Initialize plugin registry
  const storage = await createTestStorage();
  const pluginRegistry = new PluginRegistry(db, storage);
  await loadIntegrationPlugins(pluginRegistry);

  const server = await createServer({ db, storage, pluginRegistry });

  return { server, db };
}
