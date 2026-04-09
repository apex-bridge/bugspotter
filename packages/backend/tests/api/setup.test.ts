/**
 * Setup Routes Tests
 * Tests for initial system setup and configuration
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../../src/api/server.js';
import { createDatabaseClient } from '../../src/db/client.js';
import type { DatabaseClient } from '../../src/db/client.js';
import { createMockPluginRegistry, createMockStorage } from '../test-helpers.js';

describe('Setup Routes', () => {
  let server: FastifyInstance;
  let db: DatabaseClient;

  beforeAll(async () => {
    const testDbUrl = process.env.DATABASE_URL || 'postgresql://localhost:5432/bugspotter_test';
    db = createDatabaseClient(testDbUrl);
    const pluginRegistry = createMockPluginRegistry();
    const storage = createMockStorage();
    server = await createServer({ db, storage, pluginRegistry });
    await server.ready();
  });

  afterAll(async () => {
    await server.close();
    await db.close();
  });

  beforeEach(async () => {
    // Clean up for fresh state
    await db.query('DELETE FROM system_config');
    await db.query('DELETE FROM users');
  });

  describe('GET /api/v1/setup/status', () => {
    it('should return requiresSetup: true when no admin users exist', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/setup/status',
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.data.initialized).toBe(false);
      expect(json.data.requiresSetup).toBe(true);
    });

    it('should return requiresSetup: false when admin user exists', async () => {
      // Create an admin user
      await db.users.create({
        email: 'admin@example.com',
        password_hash: 'hashed',
        role: 'admin',
      });

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/setup/status',
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.data.initialized).toBe(true);
      expect(json.data.requiresSetup).toBe(false);
    });

    it('should be publicly accessible (no auth required)', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/setup/status',
      });

      expect(response.statusCode).toBe(200);
    });
  });

  describe('POST /api/v1/setup/initialize', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      // Reset environment
      process.env = { ...originalEnv };
      // Set storage env vars for minimal mode tests
      process.env.S3_ACCESS_KEY = 'minioadmin';
      process.env.S3_SECRET_KEY = 'minioadmin';
      process.env.S3_BUCKET = 'bugspotter-test';
      process.env.S3_ENDPOINT = 'http://minio:9000';
      process.env.S3_REGION = 'us-east-1';
    });

    afterAll(() => {
      // Restore original environment
      process.env = originalEnv;
    });

    it('should initialize system and create admin user', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/setup/initialize',
        payload: {
          admin_email: 'admin@test.com',
          admin_password: 'secure-password-123',
          instance_name: 'Test Instance',
          instance_url: 'https://test.bugspotter.dev',
          // Storage from env vars in minimal mode
        },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.data.user.email).toBe('admin@test.com');
      expect(json.data.user.role).toBe('admin');
      expect(json.data.access_token).toBeDefined();
      expect(json.data.token_type).toBe('Bearer');
      expect(json.data.expires_in).toBeGreaterThan(0);

      // Should NOT return refresh_token in body (security)
      expect(json.data.refresh_token).toBeUndefined();

      // Should NOT expose password hash
      expect(json.data.user.password_hash).toBeUndefined();
    });

    it('should set refresh_token as httpOnly cookie', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/setup/initialize',
        payload: {
          admin_email: 'admin@test.com',
          admin_password: 'secure-password-123',
          instance_name: 'Test Instance',
          instance_url: 'https://test.bugspotter.dev',
          // Storage from env vars in minimal mode
        },
      });

      expect(response.statusCode).toBe(200);

      // Check for httpOnly cookie
      const cookies = response.cookies;
      const refreshCookie = cookies.find((c) => c.name === 'refresh_token');

      expect(refreshCookie).toBeDefined();
      expect(refreshCookie?.httpOnly).toBe(true);
      expect(refreshCookie?.sameSite).toBe('Strict');
      expect(refreshCookie?.path).toBe('/');
      expect(refreshCookie?.maxAge).toBeGreaterThan(0);
    });

    it('should store system settings in database', async () => {
      // Override env vars for this test
      process.env.S3_ACCESS_KEY = 'AKIAIOSFODNN7EXAMPLE';
      process.env.S3_SECRET_KEY = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
      process.env.S3_BUCKET = 'my-bugspotter-bucket';
      process.env.S3_REGION = 'us-west-2';
      delete process.env.S3_ENDPOINT; // S3, not MinIO

      await server.inject({
        method: 'POST',
        url: '/api/v1/setup/initialize',
        payload: {
          admin_email: 'admin@test.com',
          admin_password: 'secure-password-123',
          instance_name: 'My Instance',
          instance_url: 'https://bugspotter.example.com',
          // Storage from env vars
        },
      });

      // Verify settings stored in database
      const result = await db.query(
        "SELECT value FROM system_config WHERE key = 'system_settings'",
        []
      );

      expect(result.rows.length).toBe(1);
      const settings = result.rows[0].value;
      expect(settings.instance_name).toBe('My Instance');
      expect(settings.instance_url).toBe('https://bugspotter.example.com');
      expect(settings.storage_type).toBe('s3');
      expect(settings.storage_bucket).toBe('my-bugspotter-bucket');
    });

    it('should reject initialization if already initialized', async () => {
      // Create admin user to mark system as initialized
      await db.users.create({
        email: 'existing@test.com',
        password_hash: 'hashed',
        role: 'admin',
      });

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/setup/initialize',
        payload: {
          admin_email: 'admin@test.com',
          admin_password: 'secure-password-123',
          instance_name: 'Test Instance',
          instance_url: 'https://test.bugspotter.dev',
          storage_type: 'minio',
          storage_endpoint: 'http://minio:9000',
          storage_access_key: 'minioadmin',
          storage_secret_key: 'minioadmin',
          storage_bucket: 'test-bucket',
          storage_region: 'us-east-1',
        },
      });

      expect(response.statusCode).toBe(400);
      const json = response.json();
      expect(json.success).toBe(false);
      expect(json.error).toBe('AlreadyInitialized');
    });

    it('should validate required admin credentials', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/setup/initialize',
        payload: {
          admin_email: '',
          admin_password: '',
          storage_type: 'minio',
          storage_access_key: 'key',
          storage_secret_key: 'secret',
          storage_bucket: 'bucket',
        },
      });

      expect(response.statusCode).toBe(400);
      const json = response.json();
      expect(json.success).toBe(false);
    });

    it('should validate required storage configuration in full mode', async () => {
      // Set to full mode where storage validation is required
      process.env.SETUP_MODE = 'full';
      // Remove storage env vars to force validation of request body only
      delete process.env.S3_ACCESS_KEY;
      delete process.env.S3_SECRET_KEY;
      delete process.env.S3_BUCKET;

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/setup/initialize',
        payload: {
          admin_email: 'admin@test.com',
          admin_password: 'password123',
          instance_name: 'Test',
          instance_url: 'http://localhost',
          storage_type: 'minio',
          storage_access_key: '',
          storage_secret_key: '',
          storage_bucket: '',
        },
      });

      expect(response.statusCode).toBe(400);
      const json = response.json();
      expect(json.success).toBe(false);
    });
    it('should be publicly accessible (no auth required)', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/setup/initialize',
        payload: {
          admin_email: 'admin@test.com',
          admin_password: 'password123',
          instance_name: 'Test',
          instance_url: 'http://localhost',
          storage_type: 'minio',
          storage_access_key: 'key',
          storage_secret_key: 'secret',
          storage_bucket: 'bucket',
        },
      });

      // Should not require authentication
      expect(response.statusCode).not.toBe(401);
    });

    it('should hash admin password before storing', async () => {
      const plainPassword = 'my-secure-password-123';

      await server.inject({
        method: 'POST',
        url: '/api/v1/setup/initialize',
        payload: {
          admin_email: 'admin@test.com',
          admin_password: plainPassword,
          instance_name: 'Test',
          instance_url: 'http://localhost',
          // Storage from env vars in minimal mode
        },
      });

      // Verify password is hashed
      const result = await db.query('SELECT password_hash FROM users WHERE email = $1', [
        'admin@test.com',
      ]);

      expect(result.rows.length).toBe(1);
      const passwordHash = result.rows[0].password_hash;

      // Should be hashed (bcrypt hash starts with $2b$)
      expect(passwordHash).toMatch(/^\$2[aby]\$/);
      // Should NOT be plain text
      expect(passwordHash).not.toBe(plainPassword);
    });
  });

  describe('GET /api/v1/setup/status - Setup Mode', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      // Reset environment
      process.env = { ...originalEnv };
    });

    afterAll(() => {
      // Restore original environment
      process.env = originalEnv;
    });

    it('should return setupMode as minimal by default', async () => {
      delete process.env.SETUP_MODE;

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/setup/status',
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.data.setupMode).toBe('minimal');
    });

    it('should return setupMode as minimal when explicitly set', async () => {
      process.env.SETUP_MODE = 'minimal';

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/setup/status',
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.data.setupMode).toBe('minimal');
    });

    it('should return setupMode as full when explicitly set', async () => {
      process.env.SETUP_MODE = 'full';

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/setup/status',
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.data.setupMode).toBe('full');
    });

    it('should return defaults only in full mode', async () => {
      process.env.SETUP_MODE = 'full';
      process.env.S3_ACCESS_KEY = 'key';
      process.env.S3_SECRET_KEY = 'secret';
      process.env.S3_BUCKET = 'bucket';

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/setup/status',
      });

      const json = response.json();
      expect(json.data.setupMode).toBe('full');
      expect(json.data.defaults).toBeDefined();
    });

    it('should not return defaults in minimal mode', async () => {
      process.env.SETUP_MODE = 'minimal';
      process.env.S3_ACCESS_KEY = 'key';
      process.env.S3_SECRET_KEY = 'secret';
      process.env.S3_BUCKET = 'bucket';

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/setup/status',
      });

      const json = response.json();
      expect(json.data.setupMode).toBe('minimal');
      expect(json.data.defaults).toBeUndefined();
    });
  });

  describe('GET /api/v1/setup/status - Environment Defaults', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      // Reset environment
      process.env = { ...originalEnv };
      // Set full mode to enable defaults
      process.env.SETUP_MODE = 'full';
    });

    afterAll(() => {
      // Restore original environment
      process.env = originalEnv;
    });

    it('should return defaults from environment variables', async () => {
      // Set environment variables
      process.env.INSTANCE_NAME = 'Test Instance';
      process.env.INSTANCE_URL = 'https://test.example.com';
      process.env.S3_ENDPOINT = 'http://minio:9000';
      process.env.S3_FORCE_PATH_STYLE = 'true'; // Required for MinIO detection
      process.env.S3_ACCESS_KEY = 'test-access-key';
      process.env.S3_SECRET_KEY = 'test-secret-key';
      process.env.S3_BUCKET = 'test-bucket';
      process.env.S3_REGION = 'eu-west-1';

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/setup/status',
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.data.defaults).toBeDefined();
      expect(json.data.defaults.instance_name).toBe('Test Instance');
      expect(json.data.defaults.instance_url).toBe('https://test.example.com');
      expect(json.data.defaults.storage_type).toBe('minio');
      expect(json.data.defaults.storage_endpoint).toBe('http://minio:9000');
      expect(json.data.defaults.storage_bucket).toBe('test-bucket');
      expect(json.data.defaults.storage_region).toBe('eu-west-1');
    });

    it('should use explicit STORAGE_BACKEND env var when set', async () => {
      process.env.STORAGE_BACKEND = 'minio';
      process.env.S3_ACCESS_KEY = 'key';
      process.env.S3_SECRET_KEY = 'secret';
      process.env.S3_BUCKET = 'bucket';
      delete process.env.S3_ENDPOINT;
      delete process.env.S3_FORCE_PATH_STYLE;

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/setup/status',
      });

      const json = response.json();
      expect(json.data.defaults?.storage_type).toBe('minio');
    });

    it('should detect minio from endpoint + forcePathStyle', async () => {
      delete process.env.STORAGE_BACKEND;
      process.env.S3_ENDPOINT = 'http://localhost:9000';
      process.env.S3_FORCE_PATH_STYLE = 'true';
      process.env.S3_ACCESS_KEY = 'key';
      process.env.S3_SECRET_KEY = 'secret';
      process.env.S3_BUCKET = 'bucket';

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/setup/status',
      });

      const json = response.json();
      expect(json.data.defaults?.storage_type).toBe('minio');
    });

    it('should detect s3 when endpoint exists but forcePathStyle is false', async () => {
      delete process.env.STORAGE_BACKEND;
      process.env.S3_ENDPOINT = 'https://s3.amazonaws.com';
      process.env.S3_FORCE_PATH_STYLE = 'false';
      process.env.S3_ACCESS_KEY = 'key';
      process.env.S3_SECRET_KEY = 'secret';
      process.env.S3_BUCKET = 'bucket';

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/setup/status',
      });

      const json = response.json();
      expect(json.data.defaults?.storage_type).toBe('s3');
    });

    it('should prefer STORAGE_BACKEND over detection logic', async () => {
      process.env.STORAGE_BACKEND = 's3';
      process.env.S3_ENDPOINT = 'http://localhost:9000';
      process.env.S3_FORCE_PATH_STYLE = 'true';
      process.env.S3_ACCESS_KEY = 'key';
      process.env.S3_SECRET_KEY = 'secret';
      process.env.S3_BUCKET = 'bucket';

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/setup/status',
      });

      const json = response.json();
      // Should use explicit STORAGE_BACKEND, not detected 'minio'
      expect(json.data.defaults?.storage_type).toBe('s3');
    });

    it('should default to s3 when no endpoint specified', async () => {
      delete process.env.S3_ENDPOINT;
      process.env.S3_ACCESS_KEY = 'key';
      process.env.S3_SECRET_KEY = 'secret';
      process.env.S3_BUCKET = 'bucket';

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/setup/status',
      });

      const json = response.json();
      expect(json.data.defaults?.storage_type).toBe('s3');
    });

    it('should not return defaults when storage env vars are missing', async () => {
      delete process.env.S3_ACCESS_KEY;
      delete process.env.S3_SECRET_KEY;
      delete process.env.S3_BUCKET;

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/setup/status',
      });

      const json = response.json();
      expect(json.data.defaults).toBeUndefined();
    });

    it('should use default region when not specified', async () => {
      process.env.S3_ACCESS_KEY = 'key';
      process.env.S3_SECRET_KEY = 'secret';
      process.env.S3_BUCKET = 'bucket';
      delete process.env.S3_REGION;

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/setup/status',
      });

      const json = response.json();
      expect(json.data.defaults?.storage_region).toBe('us-east-1');
    });
  });

  describe('POST /api/v1/setup/initialize - Setup Mode Validation', () => {
    const originalEnv = process.env;

    beforeEach(async () => {
      // Reset environment
      process.env = { ...originalEnv };
      // Clean up for fresh state
      await db.query('DELETE FROM system_config');
      await db.query('DELETE FROM users');
    });

    afterAll(() => {
      // Restore original environment
      process.env = originalEnv;
    });

    it('should accept minimal setup with only admin credentials (storage from env)', async () => {
      process.env.SETUP_MODE = 'minimal';
      process.env.S3_ACCESS_KEY = 'env-key';
      process.env.S3_SECRET_KEY = 'env-secret';
      process.env.S3_BUCKET = 'env-bucket';

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/setup/initialize',
        payload: {
          admin_email: 'admin@test.com',
          admin_password: 'password123',
          // No storage fields - should use env vars in minimal mode
        },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.data.user.email).toBe('admin@test.com');
    });

    it('should fail minimal setup when storage env vars are missing', async () => {
      process.env.SETUP_MODE = 'minimal';
      delete process.env.S3_ACCESS_KEY;
      delete process.env.S3_SECRET_KEY;
      delete process.env.S3_BUCKET;

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/setup/initialize',
        payload: {
          admin_email: 'admin@test.com',
          admin_password: 'password123',
          // No storage fields and no env vars - should fail
        },
      });

      expect(response.statusCode).toBe(400);
      const json = response.json();
      expect(json.success).toBe(false);
    });

    it('should accept full setup with all fields in request body', async () => {
      process.env.SETUP_MODE = 'full';

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/setup/initialize',
        payload: {
          admin_email: 'admin@test.com',
          admin_password: 'password123',
          instance_name: 'Test Instance',
          instance_url: 'http://localhost',
          storage_type: 'minio',
          storage_access_key: 'request-key',
          storage_secret_key: 'request-secret',
          storage_bucket: 'request-bucket',
        },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.success).toBe(true);
    });

    it('should accept full setup with storage from env vars', async () => {
      process.env.SETUP_MODE = 'full';
      process.env.S3_ACCESS_KEY = 'env-key';
      process.env.S3_SECRET_KEY = 'env-secret';
      process.env.S3_BUCKET = 'env-bucket';

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/setup/initialize',
        payload: {
          admin_email: 'admin@test.com',
          admin_password: 'password123',
          instance_name: 'Test Instance',
          instance_url: 'http://localhost',
          // Storage fields omitted - should use env vars
        },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.success).toBe(true);
    });
  });

  describe('POST /api/v1/setup/initialize - Environment Fallbacks', () => {
    const originalEnv = process.env;

    beforeEach(async () => {
      // Reset environment
      process.env = { ...originalEnv };
      // Use full mode for these tests
      process.env.SETUP_MODE = 'full';
      // Clean up for fresh state
      await db.query('DELETE FROM system_config');
      await db.query('DELETE FROM users');
    });

    afterAll(() => {
      // Restore original environment
      process.env = originalEnv;
    });

    it('should use environment variables for storage when not in request body', async () => {
      process.env.S3_ACCESS_KEY = 'env-access-key';
      process.env.S3_SECRET_KEY = 'env-secret-key';
      process.env.S3_BUCKET = 'env-bucket';
      process.env.S3_ENDPOINT = 'http://env-minio:9000';
      process.env.S3_REGION = 'ap-south-1';

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/setup/initialize',
        payload: {
          admin_email: 'admin@test.com',
          admin_password: 'password123',
          instance_name: 'Test',
          instance_url: 'http://localhost',
          // Storage fields omitted - should use env vars
        },
      });

      expect(response.statusCode).toBe(200);

      // Verify settings stored from environment
      const result = await db.query(
        "SELECT value FROM system_config WHERE key = 'system_settings'",
        []
      );

      const settings = result.rows[0].value;
      expect(settings.storage_access_key).toBe('env-access-key');
      expect(settings.storage_secret_key).toBe('env-secret-key');
      expect(settings.storage_bucket).toBe('env-bucket');
      expect(settings.storage_endpoint).toBe('http://env-minio:9000');
      expect(settings.storage_region).toBe('ap-south-1');
    });

    it('should prefer request body over environment variables', async () => {
      process.env.S3_ACCESS_KEY = 'env-key';
      process.env.S3_SECRET_KEY = 'env-secret';
      process.env.S3_BUCKET = 'env-bucket';

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/setup/initialize',
        payload: {
          admin_email: 'admin@test.com',
          admin_password: 'password123',
          instance_name: 'Test',
          instance_url: 'http://localhost',
          storage_type: 'minio',
          storage_access_key: 'request-key',
          storage_secret_key: 'request-secret',
          storage_bucket: 'request-bucket',
        },
      });

      expect(response.statusCode).toBe(200);

      // Verify request body values were used
      const result = await db.query(
        "SELECT value FROM system_config WHERE key = 'system_settings'",
        []
      );

      const settings = result.rows[0].value;
      expect(settings.storage_access_key).toBe('request-key');
      expect(settings.storage_secret_key).toBe('request-secret');
      expect(settings.storage_bucket).toBe('request-bucket');
    });

    it('should use environment variables for admin credentials when not in request body', async () => {
      process.env.ADMIN_EMAIL = 'env-admin@test.com';
      process.env.ADMIN_PASSWORD = 'env-password-123';
      process.env.S3_ACCESS_KEY = 'key';
      process.env.S3_SECRET_KEY = 'secret';
      process.env.S3_BUCKET = 'bucket';

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/setup/initialize',
        payload: {
          // Admin credentials omitted - should use env vars
          instance_name: 'Test',
          instance_url: 'http://localhost',
        },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.data.user.email).toBe('env-admin@test.com');

      // Verify user created with env credentials
      const result = await db.query('SELECT email FROM users WHERE role = $1', ['admin']);
      expect(result.rows[0].email).toBe('env-admin@test.com');
    });

    it('should use environment defaults for instance settings', async () => {
      process.env.INSTANCE_NAME = 'Env Instance Name';
      process.env.INSTANCE_URL = 'https://env.example.com';
      process.env.S3_ACCESS_KEY = 'key';
      process.env.S3_SECRET_KEY = 'secret';
      process.env.S3_BUCKET = 'bucket';

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/setup/initialize',
        payload: {
          admin_email: 'admin@test.com',
          admin_password: 'password123',
          // Instance settings omitted - should use env vars
        },
      });

      expect(response.statusCode).toBe(200);

      const result = await db.query(
        "SELECT value FROM system_config WHERE key = 'system_settings'",
        []
      );

      const settings = result.rows[0].value;
      expect(settings.instance_name).toBe('Env Instance Name');
      expect(settings.instance_url).toBe('https://env.example.com');
    });

    it('should fail when neither request nor env provides required fields', async () => {
      delete process.env.S3_ACCESS_KEY;
      delete process.env.S3_SECRET_KEY;
      delete process.env.S3_BUCKET;

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/setup/initialize',
        payload: {
          admin_email: 'admin@test.com',
          admin_password: 'password123',
          instance_name: 'Test',
          instance_url: 'http://localhost',
          // Storage fields missing and no env vars
        },
      });

      expect(response.statusCode).toBe(400);
      const json = response.json();
      expect(json.success).toBe(false);
    });

    it('should use explicit STORAGE_BACKEND env var when set', async () => {
      process.env.STORAGE_BACKEND = 'minio';
      process.env.S3_ACCESS_KEY = 'key';
      process.env.S3_SECRET_KEY = 'secret';
      process.env.S3_BUCKET = 'bucket';
      delete process.env.S3_ENDPOINT;
      delete process.env.S3_FORCE_PATH_STYLE;

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/setup/initialize',
        payload: {
          admin_email: 'admin@test.com',
          admin_password: 'password123',
          instance_name: 'Test',
          instance_url: 'http://localhost',
          // Storage type omitted - should use STORAGE_BACKEND
        },
      });

      expect(response.statusCode).toBe(200);

      const result = await db.query(
        "SELECT value FROM system_config WHERE key = 'system_settings'",
        []
      );

      const settings = result.rows[0].value;
      expect(settings.storage_type).toBe('minio');
    });

    it('should detect storage type from endpoint + forcePathStyle', async () => {
      delete process.env.STORAGE_BACKEND;
      process.env.S3_ENDPOINT = 'http://minio-server:9000';
      process.env.S3_FORCE_PATH_STYLE = 'true';
      process.env.S3_ACCESS_KEY = 'key';
      process.env.S3_SECRET_KEY = 'secret';
      process.env.S3_BUCKET = 'bucket';

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/setup/initialize',
        payload: {
          admin_email: 'admin@test.com',
          admin_password: 'password123',
          instance_name: 'Test',
          instance_url: 'http://localhost',
          // Storage type omitted - should detect from endpoint + forcePathStyle
        },
      });

      expect(response.statusCode).toBe(200);

      const result = await db.query(
        "SELECT value FROM system_config WHERE key = 'system_settings'",
        []
      );

      const settings = result.rows[0].value;
      expect(settings.storage_type).toBe('minio');
    });

    it('should prefer request body storage_type over detection', async () => {
      process.env.STORAGE_BACKEND = 'minio';
      process.env.S3_ENDPOINT = 'http://minio:9000';
      process.env.S3_FORCE_PATH_STYLE = 'true';
      process.env.S3_ACCESS_KEY = 'key';
      process.env.S3_SECRET_KEY = 'secret';
      process.env.S3_BUCKET = 'bucket';

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/setup/initialize',
        payload: {
          admin_email: 'admin@test.com',
          admin_password: 'password123',
          instance_name: 'Test',
          instance_url: 'http://localhost',
          storage_type: 's3', // Explicit override
        },
      });

      expect(response.statusCode).toBe(200);

      const result = await db.query(
        "SELECT value FROM system_config WHERE key = 'system_settings'",
        []
      );

      const settings = result.rows[0].value;
      // Should use request body value, not env var
      expect(settings.storage_type).toBe('s3');
    });

    it('should default to s3 when no storage type indicators present', async () => {
      delete process.env.STORAGE_BACKEND;
      delete process.env.S3_ENDPOINT;
      delete process.env.S3_FORCE_PATH_STYLE;
      process.env.S3_ACCESS_KEY = 'key';
      process.env.S3_SECRET_KEY = 'secret';
      process.env.S3_BUCKET = 'bucket';

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/setup/initialize',
        payload: {
          admin_email: 'admin@test.com',
          admin_password: 'password123',
          instance_name: 'Test',
          instance_url: 'http://localhost',
          // No storage_type in request, no STORAGE_BACKEND env var
        },
      });

      expect(response.statusCode).toBe(200);

      const result = await db.query(
        "SELECT value FROM system_config WHERE key = 'system_settings'",
        []
      );

      const settings = result.rows[0].value;
      expect(settings.storage_type).toBe('s3');
    });
  });

  describe('POST /api/v1/setup/test-storage', () => {
    it('should test storage connection', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/setup/test-storage',
        payload: {
          storage_type: 'minio',
          storage_endpoint: 'http://minio:9000',
          storage_access_key: 'minioadmin',
          storage_secret_key: 'minioadmin',
          storage_bucket: 'test-bucket',
          storage_region: 'us-east-1',
        },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.success).toBe(true);
      // Will succeed or fail depending on actual storage availability
      expect(json.data.success).toBeDefined();
    });

    it('should return failure for invalid credentials', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/setup/test-storage',
        payload: {
          storage_type: 'minio',
          storage_endpoint: 'http://invalid-host:9000',
          storage_access_key: 'invalid',
          storage_secret_key: 'invalid',
          storage_bucket: 'invalid',
        },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.data.success).toBe(false);
      expect(json.data.error).toBeDefined();
    });

    it('should be publicly accessible (no auth required)', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/setup/test-storage',
        payload: {
          storage_type: 'minio',
          storage_access_key: 'test',
          storage_secret_key: 'test',
          storage_bucket: 'test',
        },
      });

      // Should not require authentication
      expect(response.statusCode).not.toBe(401);
    });
  });
});
