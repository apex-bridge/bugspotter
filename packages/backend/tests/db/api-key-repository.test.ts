/**
 * API Key Repository Tests
 * Comprehensive tests for API key management operations
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { DatabaseClient } from '../../src/db/client.js';
import { createHash } from 'crypto';
import type { ApiKey, User, Project } from '../../src/db/types.js';
import { API_KEY_STATUS, API_KEY_TYPE, PERMISSION_SCOPE } from '../../src/db/types.js';

const TEST_DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/test';

describe('ApiKeyRepository', () => {
  let db: DatabaseClient;
  let testUser: User;
  let testProject1: Project;
  let testProject2: Project;
  let createdApiKeys: string[] = [];

  beforeAll(async () => {
    db = DatabaseClient.create({
      connectionString: TEST_DATABASE_URL,
    });

    const isConnected = await db.testConnection();
    if (!isConnected) {
      throw new Error('Failed to connect to test database');
    }

    // Create test user
    testUser = await db.users.create({
      email: `apikey-test-${Date.now()}@test.com`,
      password_hash: 'hash123',
      role: 'admin',
    });

    // Create test projects
    testProject1 = await db.projects.create({
      name: 'API Key Test Project 1',
      created_by: testUser.id,
    });

    testProject2 = await db.projects.create({
      name: 'API Key Test Project 2',
      created_by: testUser.id,
    });
  });

  afterAll(async () => {
    // Cleanup created API keys
    for (const id of createdApiKeys) {
      try {
        await db.apiKeys.delete(id);
      } catch (error) {
        // Ignore errors during cleanup
      }
    }

    // Cleanup test data
    if (testProject1?.id) await db.projects.delete(testProject1.id);
    if (testProject2?.id) await db.projects.delete(testProject2.id);
    if (testUser?.id) await db.users.delete(testUser.id);

    await db.close();
  });

  // Helper function to create test API key
  function createTestApiKey(name: string, overrides = {}) {
    const rawKey = `bs_prod_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const keyHash = createHash('sha256').update(rawKey).digest('hex');

    return {
      key_hash: keyHash,
      key_prefix: rawKey.substring(0, 10),
      key_suffix: rawKey.substring(rawKey.length - 4),
      name,
      description: `Test API key: ${name}`,
      type: 'production' as const,
      status: 'active' as const,
      permission_scope: 'full' as const,
      permissions: ['bugs:read', 'bugs:write', 'replays:read'],
      allowed_projects: [testProject1.id],
      rate_limit_per_minute: 500,
      rate_limit_per_hour: 10000,
      rate_limit_per_day: 100000,
      burst_limit: 1000,
      created_by: testUser.id,
      ...overrides,
    };
  }

  describe('CRUD Operations', () => {
    it('should create an API key', async () => {
      const keyData = createTestApiKey('Test Create Key');
      const apiKey = await db.apiKeys.create(keyData);

      expect(apiKey).toBeDefined();
      expect(apiKey.id).toBeDefined();
      expect(apiKey.name).toBe('Test Create Key');
      expect(apiKey.status).toBe(API_KEY_STATUS.ACTIVE);
      expect(apiKey.type).toBe(API_KEY_TYPE.PRODUCTION);
      expect(apiKey.permission_scope).toBe(PERMISSION_SCOPE.FULL);
      expect(apiKey.permissions).toEqual(['bugs:read', 'bugs:write', 'replays:read']);

      createdApiKeys.push(apiKey.id);
    });

    it('should create API key with minimal required fields', async () => {
      const rawKey = `bs_test_${Date.now()}`;
      const keyHash = createHash('sha256').update(rawKey).digest('hex');

      const apiKey = await db.apiKeys.create({
        key_hash: keyHash,
        key_prefix: 'bs_test',
        key_suffix: rawKey.substring(rawKey.length - 4),
        name: 'Minimal Key',
      });

      expect(apiKey).toBeDefined();
      expect(apiKey.id).toBeDefined();
      expect(apiKey.name).toBe('Minimal Key');
      expect(apiKey.type).toBe(API_KEY_TYPE.PRODUCTION); // Default
      expect(apiKey.status).toBe(API_KEY_STATUS.ACTIVE); // Default
      expect(apiKey.grace_period_days).toBe(7); // Default

      createdApiKeys.push(apiKey.id);
    });

    it('should find API key by ID', async () => {
      const keyData = createTestApiKey('Test Find Key');
      const created = await db.apiKeys.create(keyData);
      createdApiKeys.push(created.id);

      const found = await db.apiKeys.findById(created.id);

      expect(found).toBeDefined();
      expect(found?.id).toBe(created.id);
      expect(found?.name).toBe('Test Find Key');
    });

    it('should find API key by hash', async () => {
      const rawKey = `bs_prod_${Date.now()}_hash_test`;
      const keyHash = createHash('sha256').update(rawKey).digest('hex');

      const created = await db.apiKeys.create({
        key_hash: keyHash,
        key_prefix: rawKey.substring(0, 10),
        key_suffix: rawKey.substring(rawKey.length - 4),
        name: 'Hash Lookup Test',
      });
      createdApiKeys.push(created.id);

      const found = await db.apiKeys.findByHash(keyHash);

      expect(found).toBeDefined();
      expect(found?.id).toBe(created.id);
      expect(found?.key_hash).toBe(keyHash);
    });

    it('should update API key', async () => {
      const keyData = createTestApiKey('Test Update Key');
      const created = await db.apiKeys.create(keyData);
      createdApiKeys.push(created.id);

      const updated = await db.apiKeys.update(created.id, {
        name: 'Updated Name',
        description: 'Updated description',
        rate_limit_per_minute: 1000,
      });

      expect(updated).toBeDefined();
      expect(updated?.name).toBe('Updated Name');
      expect(updated?.description).toBe('Updated description');
      expect(updated?.rate_limit_per_minute).toBe(1000);
    });

    it('should delete API key', async () => {
      const keyData = createTestApiKey('Test Delete Key');
      const created = await db.apiKeys.create(keyData);

      await db.apiKeys.delete(created.id);

      const found = await db.apiKeys.findById(created.id);
      expect(found).toBeNull();
    });

    it('should return null for non-existent API key', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';
      const found = await db.apiKeys.findById(fakeId);
      expect(found).toBeNull();
    });

    it('should return null when finding by non-existent hash', async () => {
      const fakeHash = createHash('sha256').update('nonexistent').digest('hex');
      const found = await db.apiKeys.findByHash(fakeHash);
      expect(found).toBeNull();
    });
  });

  describe('List and Filter Operations', () => {
    beforeEach(async () => {
      // Create test keys for filtering
      const keys = [
        createTestApiKey('Production Key 1', { type: 'production', status: 'active' }),
        createTestApiKey('Production Key 2', { type: 'production', status: 'expiring' }),
        createTestApiKey('Development Key', { type: 'development', status: 'active' }),
        createTestApiKey('Test Key', { type: 'test', status: 'active', tags: ['test', 'qa'] }),
      ];

      for (const keyData of keys) {
        const created = await db.apiKeys.create(keyData);
        createdApiKeys.push(created.id);
      }
    });

    it('should list all API keys with pagination', async () => {
      const result = await db.apiKeys.list({}, {}, { page: 1, limit: 10 });

      expect(result.data).toBeDefined();
      expect(Array.isArray(result.data)).toBe(true);
      expect(result.data.length).toBeGreaterThan(0);
      expect(result.pagination).toBeDefined();
      expect(result.pagination.page).toBe(1);
      expect(result.pagination.limit).toBe(10);
      expect(result.pagination.total).toBeGreaterThanOrEqual(result.data.length);
    });

    it('should filter by status', async () => {
      const result = await db.apiKeys.list({ status: 'active' });

      expect(result.data.length).toBeGreaterThan(0);
      result.data.forEach((key) => {
        expect(key.status).toBe('active');
      });
    });

    it('should filter by type', async () => {
      const result = await db.apiKeys.list({ type: 'development' });

      expect(result.data.length).toBeGreaterThan(0);
      result.data.forEach((key) => {
        expect(key.type).toBe('development');
      });
    });

    it('should filter by created_by', async () => {
      const result = await db.apiKeys.list({ created_by: testUser.id });

      expect(result.data.length).toBeGreaterThan(0);
      result.data.forEach((key) => {
        expect(key.created_by).toBe(testUser.id);
      });
    });

    it('should filter by tag', async () => {
      const result = await db.apiKeys.list({ tag: 'test' });

      expect(result.data.length).toBeGreaterThan(0);
      result.data.forEach((key) => {
        expect(key.tags).toContain('test');
      });
    });

    it('should search by name', async () => {
      const result = await db.apiKeys.list({ search: 'Development' });

      expect(result.data.length).toBeGreaterThan(0);
      result.data.forEach((key) => {
        expect(key.name.toLowerCase()).toContain('development');
      });
    });

    it('should sort by created_at descending', async () => {
      const result = await db.apiKeys.list({}, { sort_by: 'created_at', order: 'desc' });

      expect(result.data.length).toBeGreaterThan(1);
      for (let i = 0; i < result.data.length - 1; i++) {
        expect(result.data[i].created_at.getTime()).toBeGreaterThanOrEqual(
          result.data[i + 1].created_at.getTime()
        );
      }
    });

    it('should sort by name ascending', async () => {
      const result = await db.apiKeys.list({}, { sort_by: 'name', order: 'asc' });

      expect(result.data.length).toBeGreaterThan(1);
      for (let i = 0; i < result.data.length - 1; i++) {
        const name1 = result.data[i].name.toLowerCase();
        const name2 = result.data[i + 1].name.toLowerCase();
        expect(name1.localeCompare(name2)).toBeLessThanOrEqual(0);
      }
    });

    it('should paginate results correctly', async () => {
      const page1 = await db.apiKeys.list({}, {}, { page: 1, limit: 2 });
      const page2 = await db.apiKeys.list({}, {}, { page: 2, limit: 2 });

      expect(page1.data.length).toBeLessThanOrEqual(2);
      expect(page2.data.length).toBeLessThanOrEqual(2);

      // Ensure pages don't overlap
      if (page1.data.length > 0 && page2.data.length > 0) {
        expect(page1.data[0].id).not.toBe(page2.data[0].id);
      }
    });
  });

  describe('Lifecycle Management', () => {
    it('should revoke an API key', async () => {
      const keyData = createTestApiKey('Test Revoke Key');
      const created = await db.apiKeys.create(keyData);
      createdApiKeys.push(created.id);

      const revoked = await db.apiKeys.revoke(created.id);

      expect(revoked).toBeDefined();
      expect(revoked?.status).toBe(API_KEY_STATUS.REVOKED);
      expect(revoked?.revoked_at).toBeDefined();
    });

    it('should update last_used_at timestamp', async () => {
      const keyData = createTestApiKey('Test Last Used Key');
      const created = await db.apiKeys.create(keyData);
      createdApiKeys.push(created.id);

      expect(created.last_used_at).toBeNull();

      await db.apiKeys.updateLastUsed(created.id);

      const updated = await db.apiKeys.findById(created.id);
      expect(updated?.last_used_at).toBeDefined();
      expect(updated?.last_used_at).toBeInstanceOf(Date);
    });

    it('should mark expired keys', async () => {
      const keyData = createTestApiKey('Test Expired Key', {
        expires_at: new Date(Date.now() - 86400000), // Expired yesterday
        status: 'active',
      });
      const created = await db.apiKeys.create(keyData);
      createdApiKeys.push(created.id);

      const count = await db.apiKeys.checkAndUpdateExpired();

      expect(count).toBeGreaterThan(0);

      const updated = await db.apiKeys.findById(created.id);
      expect(updated?.status).toBe(API_KEY_STATUS.EXPIRED);
    });

    it('should mark expiring keys', async () => {
      const keyData = createTestApiKey('Test Expiring Key', {
        expires_at: new Date(Date.now() + 3 * 86400000), // Expires in 3 days
        status: 'active',
      });
      const created = await db.apiKeys.create(keyData);
      createdApiKeys.push(created.id);

      const count = await db.apiKeys.markExpiring(7); // Mark if expiring within 7 days

      expect(count).toBeGreaterThan(0);

      const updated = await db.apiKeys.findById(created.id);
      expect(updated?.status).toBe(API_KEY_STATUS.EXPIRING);
    });

    it('should not mark keys that are far from expiration', async () => {
      const keyData = createTestApiKey('Test Non-Expiring Key', {
        expires_at: new Date(Date.now() + 30 * 86400000), // Expires in 30 days
        status: 'active',
      });
      const created = await db.apiKeys.create(keyData);
      createdApiKeys.push(created.id);

      const originalStatus = created.status;

      await db.apiKeys.markExpiring(7); // Mark if expiring within 7 days

      const updated = await db.apiKeys.findById(created.id);
      expect(updated?.status).toBe(originalStatus); // Should remain unchanged
    });
  });

  describe('Usage Tracking', () => {
    let testKey: ApiKey;

    beforeEach(async () => {
      const keyData = createTestApiKey('Usage Tracking Test Key');
      testKey = await db.apiKeys.create(keyData);
      createdApiKeys.push(testKey.id);
    });

    it('should track API key usage', async () => {
      await db.apiKeys.trackUsage({
        api_key_id: testKey.id,
        endpoint: '/api/bugs',
        method: 'POST',
        status_code: 201,
        response_time_ms: 150,
        ip_address: '192.168.1.1',
        user_agent: 'BugSpotter SDK/1.0',
      });

      const logs = await db.apiKeys.getUsageLogs(testKey.id, 10);

      expect(logs.length).toBeGreaterThan(0);
      expect(logs[0].endpoint).toBe('/api/bugs');
      expect(logs[0].method).toBe('POST');
      expect(logs[0].status_code).toBe(201);
    });

    it('should track usage with error information', async () => {
      await db.apiKeys.trackUsage({
        api_key_id: testKey.id,
        endpoint: '/api/bugs',
        method: 'POST',
        status_code: 500,
        response_time_ms: 250,
        error_message: 'Internal server error',
        error_type: 'InternalServerError',
      });

      const logs = await db.apiKeys.getUsageLogs(testKey.id, 10);

      expect(logs.length).toBeGreaterThan(0);
      const errorLog = logs.find((log) => log.status_code === 500);
      expect(errorLog).toBeDefined();
      expect(errorLog?.error_message).toBe('Internal server error');
      expect(errorLog?.error_type).toBe('InternalServerError');
    });

    it('should get usage logs with pagination', async () => {
      // Create multiple usage entries
      for (let i = 0; i < 5; i++) {
        await db.apiKeys.trackUsage({
          api_key_id: testKey.id,
          endpoint: `/api/endpoint${i}`,
          method: 'GET',
          status_code: 200,
        });
      }

      const page1 = await db.apiKeys.getUsageLogs(testKey.id, 2, 0);
      const page2 = await db.apiKeys.getUsageLogs(testKey.id, 2, 2);

      expect(page1.length).toBe(2);
      expect(page2.length).toBeGreaterThan(0);
      expect(page1[0].id).not.toBe(page2[0].id);
    });

    it('should get top endpoints', async () => {
      // Create usage for different endpoints
      await db.apiKeys.trackUsage({
        api_key_id: testKey.id,
        endpoint: '/api/bugs',
        method: 'POST',
        status_code: 201,
        response_time_ms: 100,
      });

      await db.apiKeys.trackUsage({
        api_key_id: testKey.id,
        endpoint: '/api/bugs',
        method: 'GET',
        status_code: 200,
        response_time_ms: 50,
      });

      await db.apiKeys.trackUsage({
        api_key_id: testKey.id,
        endpoint: '/api/replays',
        method: 'POST',
        status_code: 201,
        response_time_ms: 200,
      });

      const topEndpoints = await db.apiKeys.getTopEndpoints(testKey.id, 10);

      expect(topEndpoints.length).toBeGreaterThan(0);
      expect(topEndpoints[0].endpoint).toBe('/api/bugs');
      expect(topEndpoints[0].count).toBe(2);
      expect(topEndpoints[0].avg_response_time).toBeGreaterThan(0);
    });

    it('should get API key with usage stats', async () => {
      // Track some usage
      await db.apiKeys.trackUsage({
        api_key_id: testKey.id,
        endpoint: '/api/bugs',
        method: 'POST',
        status_code: 201,
        ip_address: '192.168.1.1',
      });

      await db.apiKeys.trackUsage({
        api_key_id: testKey.id,
        endpoint: '/api/bugs',
        method: 'GET',
        status_code: 200,
        ip_address: '192.168.1.2',
      });

      const keyWithStats = await db.apiKeys.findByIdWithStats(testKey.id);

      expect(keyWithStats).toBeDefined();
      expect(keyWithStats?.usage_stats).toBeDefined();
      expect(keyWithStats?.usage_stats.total_requests).toBeGreaterThanOrEqual(2);
      expect(keyWithStats?.usage_stats.unique_ips).toBeGreaterThanOrEqual(2);
    });

    it('should calculate client error rate (4xx) correctly', async () => {
      const keyData = createTestApiKey('Error Rate Test Key');
      const testKey = await db.apiKeys.create(keyData);
      createdApiKeys.push(testKey.id);

      // Track successful requests
      await db.apiKeys.trackUsage({
        api_key_id: testKey.id,
        endpoint: '/api/bugs',
        method: 'GET',
        status_code: 200,
      });

      await db.apiKeys.trackUsage({
        api_key_id: testKey.id,
        endpoint: '/api/bugs',
        method: 'POST',
        status_code: 201,
      });

      // Track client errors (4xx)
      await db.apiKeys.trackUsage({
        api_key_id: testKey.id,
        endpoint: '/api/bugs',
        method: 'GET',
        status_code: 404,
        error_message: 'Not found',
      });

      await db.apiKeys.trackUsage({
        api_key_id: testKey.id,
        endpoint: '/api/bugs',
        method: 'POST',
        status_code: 401,
        error_message: 'Unauthorized',
      });

      const keyWithStats = await db.apiKeys.findByIdWithStats(testKey.id);

      expect(keyWithStats).toBeDefined();
      expect(keyWithStats?.usage_stats.total_requests).toBe(4);
      expect(keyWithStats?.usage_stats.client_error_rate).toBe(50.0); // 2 out of 4 = 50%
    });

    it('should calculate server error rate (5xx) correctly', async () => {
      const keyData = createTestApiKey('Server Error Test Key');
      const testKey = await db.apiKeys.create(keyData);
      createdApiKeys.push(testKey.id);

      // Track successful requests
      await db.apiKeys.trackUsage({
        api_key_id: testKey.id,
        endpoint: '/api/bugs',
        method: 'GET',
        status_code: 200,
      });

      await db.apiKeys.trackUsage({
        api_key_id: testKey.id,
        endpoint: '/api/bugs',
        method: 'POST',
        status_code: 201,
      });

      // Track server errors (5xx)
      await db.apiKeys.trackUsage({
        api_key_id: testKey.id,
        endpoint: '/api/bugs',
        method: 'GET',
        status_code: 500,
        error_message: 'Internal server error',
      });

      const keyWithStats = await db.apiKeys.findByIdWithStats(testKey.id);

      expect(keyWithStats).toBeDefined();
      expect(keyWithStats?.usage_stats.total_requests).toBe(3);
      expect(keyWithStats?.usage_stats.server_error_rate).toBe(33.33); // 1 out of 3 = 33.33%
    });

    it('should handle mixed error types correctly', async () => {
      const keyData = createTestApiKey('Mixed Errors Test Key');
      const testKey = await db.apiKeys.create(keyData);
      createdApiKeys.push(testKey.id);

      // 2 successful
      await db.apiKeys.trackUsage({
        api_key_id: testKey.id,
        endpoint: '/api/bugs',
        method: 'GET',
        status_code: 200,
      });

      await db.apiKeys.trackUsage({
        api_key_id: testKey.id,
        endpoint: '/api/bugs',
        method: 'GET',
        status_code: 200,
      });

      // 2 client errors
      await db.apiKeys.trackUsage({
        api_key_id: testKey.id,
        endpoint: '/api/bugs',
        method: 'POST',
        status_code: 400,
        error_message: 'Bad request',
      });

      await db.apiKeys.trackUsage({
        api_key_id: testKey.id,
        endpoint: '/api/bugs',
        method: 'POST',
        status_code: 403,
        error_message: 'Forbidden',
      });

      // 1 server error
      await db.apiKeys.trackUsage({
        api_key_id: testKey.id,
        endpoint: '/api/bugs',
        method: 'GET',
        status_code: 503,
        error_message: 'Service unavailable',
      });

      const keyWithStats = await db.apiKeys.findByIdWithStats(testKey.id);

      expect(keyWithStats).toBeDefined();
      expect(keyWithStats?.usage_stats.total_requests).toBe(5);
      expect(keyWithStats?.usage_stats.client_error_rate).toBe(40.0); // 2 out of 5 = 40%
      expect(keyWithStats?.usage_stats.server_error_rate).toBe(20.0); // 1 out of 5 = 20%
    });

    it('should return 0% error rates when all requests succeed', async () => {
      const keyData = createTestApiKey('All Success Test Key');
      const testKey = await db.apiKeys.create(keyData);
      createdApiKeys.push(testKey.id);

      // Track only successful requests
      for (let i = 0; i < 5; i++) {
        await db.apiKeys.trackUsage({
          api_key_id: testKey.id,
          endpoint: '/api/bugs',
          method: 'GET',
          status_code: 200,
        });
      }

      const keyWithStats = await db.apiKeys.findByIdWithStats(testKey.id);

      expect(keyWithStats).toBeDefined();
      expect(keyWithStats?.usage_stats.total_requests).toBe(5);
      expect(keyWithStats?.usage_stats.client_error_rate).toBe(0);
      expect(keyWithStats?.usage_stats.server_error_rate).toBe(0);
    });
  });

  describe('Rate Limiting', () => {
    let testKey: ApiKey;

    beforeEach(async () => {
      const keyData = createTestApiKey('Rate Limit Test Key');
      testKey = await db.apiKeys.create(keyData);
      createdApiKeys.push(testKey.id);
    });

    it('should get rate limit count (zero initially)', async () => {
      const windowStart = new Date();
      windowStart.setSeconds(0, 0); // Start of current minute

      const count = await db.apiKeys.getRateLimitCount(testKey.id, 'minute', windowStart);

      expect(count).toBe(0);
    });

    it('should increment rate limit counter', async () => {
      const windowStart = new Date();
      windowStart.setSeconds(0, 0);

      const count1 = await db.apiKeys.incrementRateLimit(testKey.id, 'minute', windowStart);
      expect(count1).toBe(1);

      const count2 = await db.apiKeys.incrementRateLimit(testKey.id, 'minute', windowStart);
      expect(count2).toBe(2);

      const count3 = await db.apiKeys.incrementRateLimit(testKey.id, 'minute', windowStart);
      expect(count3).toBe(3);
    });

    it('should handle different window types independently', async () => {
      const windowStart = new Date();
      windowStart.setSeconds(0, 0);

      await db.apiKeys.incrementRateLimit(testKey.id, 'minute', windowStart);
      await db.apiKeys.incrementRateLimit(testKey.id, 'minute', windowStart);

      await db.apiKeys.incrementRateLimit(testKey.id, 'hour', windowStart);

      const minuteCount = await db.apiKeys.getRateLimitCount(testKey.id, 'minute', windowStart);
      const hourCount = await db.apiKeys.getRateLimitCount(testKey.id, 'hour', windowStart);

      expect(minuteCount).toBe(2);
      expect(hourCount).toBe(1);
    });

    it('should handle different time windows independently', async () => {
      const window1 = new Date();
      window1.setSeconds(0, 0);

      const window2 = new Date(window1.getTime() + 60000); // Next minute

      await db.apiKeys.incrementRateLimit(testKey.id, 'minute', window1);
      await db.apiKeys.incrementRateLimit(testKey.id, 'minute', window2);

      const count1 = await db.apiKeys.getRateLimitCount(testKey.id, 'minute', window1);
      const count2 = await db.apiKeys.getRateLimitCount(testKey.id, 'minute', window2);

      expect(count1).toBe(1);
      expect(count2).toBe(1);
    });
  });

  describe('Audit Logging', () => {
    let testKey: ApiKey;

    beforeEach(async () => {
      const keyData = createTestApiKey('Audit Log Test Key');
      testKey = await db.apiKeys.create(keyData);
      createdApiKeys.push(testKey.id);
    });

    it('should log audit event', async () => {
      await db.apiKeys.logAudit({
        api_key_id: testKey.id,
        action: 'created',
        performed_by: testUser.id,
        ip_address: '192.168.1.1',
        changes: { name: 'Created new API key' },
      });

      const logs = await db.apiKeys.getAuditLogs(testKey.id, 10);

      expect(logs.length).toBeGreaterThan(0);
      expect(logs[0].action).toBe('created');
      expect(logs[0].performed_by).toBe(testUser.id);
    });

    it('should log multiple audit events', async () => {
      await db.apiKeys.logAudit({
        api_key_id: testKey.id,
        action: 'created',
        performed_by: testUser.id,
      });

      await db.apiKeys.logAudit({
        api_key_id: testKey.id,
        action: 'updated',
        performed_by: testUser.id,
        changes: { rate_limit_per_minute: { old: 500, new: 1000 } },
      });

      await db.apiKeys.logAudit({
        api_key_id: testKey.id,
        action: 'permissions_changed',
        performed_by: testUser.id,
      });

      const logs = await db.apiKeys.getAuditLogs(testKey.id, 10);

      expect(logs.length).toBe(3);
      expect(logs[0].action).toBe('permissions_changed'); // Most recent
      expect(logs[1].action).toBe('updated');
      expect(logs[2].action).toBe('created');
    });

    it('should get audit logs with pagination', async () => {
      // Create multiple audit entries
      for (let i = 0; i < 5; i++) {
        await db.apiKeys.logAudit({
          api_key_id: testKey.id,
          action: 'accessed',
          performed_by: testUser.id,
        });
      }

      const page1 = await db.apiKeys.getAuditLogs(testKey.id, 2, 0);
      const page2 = await db.apiKeys.getAuditLogs(testKey.id, 2, 2);

      expect(page1.length).toBe(2);
      expect(page2.length).toBeGreaterThan(0);
      expect(page1[0].id).not.toBe(page2[0].id);
    });
  });

  describe('Edge Cases and Validation', () => {
    it('should handle API key with all optional fields', async () => {
      const rawKey = `bs_prod_${Date.now()}_full_key`;
      const keyHash = createHash('sha256').update(rawKey).digest('hex');

      const apiKey = await db.apiKeys.create({
        key_hash: keyHash,
        key_prefix: rawKey.substring(0, 10),
        key_suffix: rawKey.substring(rawKey.length - 4),
        name: 'Full Featured Key',
        description: 'Key with all fields populated',
        type: 'production',
        status: 'active',
        permission_scope: 'custom',
        permissions: ['bugs:read', 'bugs:write', 'replays:read', 'screenshots:read'],
        allowed_projects: [testProject1.id, testProject2.id],
        allowed_environments: ['production', 'staging'],
        rate_limit_per_minute: 1000,
        rate_limit_per_hour: 50000,
        rate_limit_per_day: 500000,
        burst_limit: 2000,
        per_endpoint_limits: {
          '/api/bugs': 100,
          '/api/replays': 50,
        },
        ip_whitelist: ['192.168.1.0/24', '10.0.0.0/8'],
        allowed_origins: ['https://app.example.com', 'https://admin.example.com'],
        user_agent_pattern: '^BugSpotter SDK',
        expires_at: new Date(Date.now() + 90 * 86400000),
        rotate_at: new Date(Date.now() + 30 * 86400000),
        grace_period_days: 14,
        created_by: testUser.id,
        tags: ['production', 'critical', 'monitored'],
      });

      expect(apiKey).toBeDefined();
      expect(apiKey.permissions.length).toBe(4);
      expect(apiKey.allowed_projects?.length).toBe(2);
      expect(apiKey.allowed_environments?.length).toBe(2);
      expect(apiKey.ip_whitelist?.length).toBe(2);
      expect(apiKey.per_endpoint_limits).toBeDefined();
      expect(apiKey.tags?.length).toBe(3);

      createdApiKeys.push(apiKey.id);
    });

    it('should handle empty arrays and null values correctly', async () => {
      const rawKey = `bs_test_${Date.now()}_minimal`;
      const keyHash = createHash('sha256').update(rawKey).digest('hex');

      const apiKey = await db.apiKeys.create({
        key_hash: keyHash,
        key_prefix: 'bs_test',
        key_suffix: rawKey.substring(rawKey.length - 4),
        name: 'Minimal Key',
        permissions: [],
        allowed_projects: null,
        allowed_environments: null,
      });

      expect(apiKey.permissions).toEqual([]);
      expect(apiKey.allowed_projects).toBeNull();
      expect(apiKey.allowed_environments).toBeNull();

      createdApiKeys.push(apiKey.id);
    });

    it('should handle concurrent rate limit increments', async () => {
      const keyData = createTestApiKey('Concurrent Rate Limit Test');
      const testKey = await db.apiKeys.create(keyData);
      createdApiKeys.push(testKey.id);

      const windowStart = new Date();
      windowStart.setSeconds(0, 0);

      // Simulate concurrent requests
      const increments = await Promise.all([
        db.apiKeys.incrementRateLimit(testKey.id, 'minute', windowStart),
        db.apiKeys.incrementRateLimit(testKey.id, 'minute', windowStart),
        db.apiKeys.incrementRateLimit(testKey.id, 'minute', windowStart),
        db.apiKeys.incrementRateLimit(testKey.id, 'minute', windowStart),
        db.apiKeys.incrementRateLimit(testKey.id, 'minute', windowStart),
      ]);

      // All increments should succeed with different counts
      expect(new Set(increments).size).toBe(5); // All counts should be unique
      expect(Math.max(...increments)).toBe(5); // Final count should be 5
    });
  });
});
