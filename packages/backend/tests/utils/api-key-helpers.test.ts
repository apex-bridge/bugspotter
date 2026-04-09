/**
 * API Key Helpers Tests
 * Tests for API key route helper functions
 */

import { describe, it, expect } from 'vitest';
import { mapUpdateFields, getRateLimitStatus } from '../../src/api/utils/api-key-helpers.js';
import type { ApiKey } from '../../src/db/types.js';
import { PERMISSION_SCOPE } from '../../src/db/types.js';
import type { ApiKeyService } from '../../src/services/api-key/index.js';
import { RATE_LIMITS } from '../../src/api/utils/constants.js';

/**
 * Helper to create a complete mock ApiKey object with all required fields
 */
function createMockApiKey(overrides: Partial<ApiKey> = {}): ApiKey {
  return {
    id: 'test-key-id',
    key_hash: 'mock-hash',
    key_prefix: 'bgs_',
    key_suffix: '1234',
    name: 'Test Key',
    description: null,
    type: 'production',
    status: 'active',
    permission_scope: PERMISSION_SCOPE.FULL,
    permissions: [],
    allowed_projects: null,
    allowed_environments: null,
    rate_limit_per_minute: 100,
    rate_limit_per_hour: 5000,
    rate_limit_per_day: 100000,
    burst_limit: 10,
    per_endpoint_limits: null,
    ip_whitelist: null,
    allowed_origins: null,
    user_agent_pattern: null,
    expires_at: null,
    rotate_at: null,
    grace_period_days: 30,
    rotated_from: null,
    created_by: 'user-id',
    team_id: null,
    tags: null,
    created_at: new Date(),
    updated_at: new Date(),
    last_used_at: null,
    revoked_at: null,
    ...overrides,
  };
}

describe('API Key Helpers', () => {
  describe('mapUpdateFields', () => {
    it('should map simple fields', () => {
      const body = {
        name: 'Updated Key',
        permission_scope: PERMISSION_SCOPE.FULL,
        permissions: ['read', 'write'],
        allowed_projects: ['proj-1', 'proj-2'],
      };

      const result = mapUpdateFields(body);

      expect(result.name).toBe('Updated Key');
      expect(result.permission_scope).toBe(PERMISSION_SCOPE.FULL);
      expect(result.permissions).toEqual(['read', 'write']);
      expect(result.allowed_projects).toEqual(['proj-1', 'proj-2']);
    });

    it('should map allowed_origins', () => {
      const body = {
        allowed_origins: ['example.com', 'test.com'],
      };

      const result = mapUpdateFields(body);

      expect(result.allowed_origins).toEqual(['example.com', 'test.com']);
    });

    it('should convert null rate limits to undefined', () => {
      const body = {
        rate_limit_per_minute: null,
        rate_limit_per_hour: null,
        rate_limit_per_day: null,
      };

      const result = mapUpdateFields(body);

      expect(result.rate_limit_per_minute).toBeUndefined();
      expect(result.rate_limit_per_hour).toBeUndefined();
      expect(result.rate_limit_per_day).toBeUndefined();
    });

    it('should preserve non-null rate limits', () => {
      const body = {
        rate_limit_per_minute: 100,
        rate_limit_per_hour: 5000,
        rate_limit_per_day: 100000,
      };

      const result = mapUpdateFields(body);

      expect(result.rate_limit_per_minute).toBe(100);
      expect(result.rate_limit_per_hour).toBe(5000);
      expect(result.rate_limit_per_day).toBe(100000);
    });

    it('should handle rate limit of 0 (soft disable)', () => {
      const body = {
        rate_limit_per_minute: 0,
        rate_limit_per_hour: 0,
        rate_limit_per_day: 0,
      };

      const result = mapUpdateFields(body);

      expect(result.rate_limit_per_minute).toBe(0);
      expect(result.rate_limit_per_hour).toBe(0);
      expect(result.rate_limit_per_day).toBe(0);
    });

    it('should convert expires_at string to Date', () => {
      const body = {
        expires_at: '2025-12-31T23:59:59.000Z',
      };

      const result = mapUpdateFields(body);

      expect(result.expires_at).toBeInstanceOf(Date);
      expect(result.expires_at?.toISOString()).toBe('2025-12-31T23:59:59.000Z');
    });

    it('should convert null expires_at to null (remove expiration)', () => {
      const body = {
        expires_at: null,
      };

      const result = mapUpdateFields(body);

      expect(result.expires_at).toBeNull();
    });

    it('should ignore undefined fields', () => {
      const body = {
        name: 'Updated',
      };

      const result = mapUpdateFields(body);

      expect(result.name).toBe('Updated');
      expect(result.permission_scope).toBeUndefined();
      expect(result.permissions).toBeUndefined();
      expect(result.allowed_projects).toBeUndefined();
    });

    it('should handle empty body', () => {
      const body = {};

      const result = mapUpdateFields(body);

      expect(Object.keys(result)).toHaveLength(0);
    });

    it('should handle all fields at once', () => {
      const body = {
        name: 'Complete Update',
        permission_scope: PERMISSION_SCOPE.CUSTOM,
        permissions: ['read'],
        allowed_projects: ['proj-1'],
        allowed_origins: ['example.com'],
        rate_limit_per_minute: 50,
        rate_limit_per_hour: 2000,
        rate_limit_per_day: 50000,
        expires_at: '2026-01-01T00:00:00.000Z',
      };

      const result = mapUpdateFields(body);

      expect(result.name).toBe('Complete Update');
      expect(result.permission_scope).toBe(PERMISSION_SCOPE.CUSTOM);
      expect(result.permissions).toEqual(['read']);
      expect(result.allowed_projects).toEqual(['proj-1']);
      expect(result.allowed_origins).toEqual(['example.com']);
      expect(result.rate_limit_per_minute).toBe(50);
      expect(result.rate_limit_per_hour).toBe(2000);
      expect(result.rate_limit_per_day).toBe(50000);
      expect(result.expires_at).toBeInstanceOf(Date);
    });
  });

  describe('getRateLimitStatus', () => {
    it('should return rate limit status for all windows', async () => {
      const mockApiKey = createMockApiKey({
        rate_limit_per_minute: 100,
        rate_limit_per_hour: 5000,
        rate_limit_per_day: 100000,
      });

      const mockService = {
        checkRateLimit: async (_keyId: string, window: string, limit: number) => {
          const resetAt = new Date(Date.now() + 60000);
          return {
            allowed: true,
            remaining: Math.floor(limit * 0.5), // Simulate 50% usage
            resetAt,
            window,
          };
        },
      } as unknown as ApiKeyService;

      const result = await getRateLimitStatus(mockService, 'test-key-id', mockApiKey);

      expect(result.minute.limit).toBe(100);
      expect(result.minute.remaining).toBe(50);
      expect(result.minute.reset_at).toBeDefined();

      expect(result.hour.limit).toBe(5000);
      expect(result.hour.remaining).toBe(2500);
      expect(result.hour.reset_at).toBeDefined();

      expect(result.day.limit).toBe(100000);
      expect(result.day.remaining).toBe(50000);
      expect(result.day.reset_at).toBeDefined();
    });

    it('should use default rate limits when not specified', async () => {
      const mockApiKey = createMockApiKey({
        type: 'development',
        rate_limit_per_minute: 0, // 0 triggers default fallback
        rate_limit_per_hour: 0,
        rate_limit_per_day: 0,
      });

      const mockService = {
        checkRateLimit: async (_keyId: string, window: string, limit: number) => {
          const resetAt = new Date(Date.now() + 60000);
          return {
            allowed: true,
            remaining: limit,
            resetAt,
            window,
          };
        },
      } as unknown as ApiKeyService;

      const result = await getRateLimitStatus(mockService, 'test-key-id', mockApiKey);

      expect(result.minute.limit).toBe(RATE_LIMITS.DEFAULT_PER_MINUTE);
      expect(result.hour.limit).toBe(RATE_LIMITS.DEFAULT_PER_HOUR);
      expect(result.day.limit).toBe(RATE_LIMITS.DEFAULT_PER_DAY);
    });

    it('should handle rate limit exceeded scenario', async () => {
      const mockApiKey = createMockApiKey({
        rate_limit_per_minute: 10,
        rate_limit_per_hour: 100,
        rate_limit_per_day: 1000,
      });

      const mockService = {
        checkRateLimit: async () => {
          const resetAt = new Date(Date.now() + 60000);
          return {
            allowed: false,
            remaining: 0,
            resetAt,
            window: 'minute',
          };
        },
      } as unknown as ApiKeyService;

      const result = await getRateLimitStatus(mockService, 'test-key-id', mockApiKey);

      expect(result.minute.remaining).toBe(0);
      expect(result.hour.remaining).toBe(0);
      expect(result.day.remaining).toBe(0);
    });

    it('should format reset_at as ISO string', async () => {
      const mockApiKey = createMockApiKey({
        rate_limit_per_minute: 100,
        rate_limit_per_hour: 1000,
        rate_limit_per_day: 10000,
      });

      const fixedResetAt = new Date('2025-10-28T12:00:00.000Z');

      const mockService = {
        checkRateLimit: async () => {
          return {
            allowed: true,
            remaining: 50,
            resetAt: fixedResetAt,
            window: 'minute',
          };
        },
      } as unknown as ApiKeyService;

      const result = await getRateLimitStatus(mockService, 'test-key-id', mockApiKey);

      expect(result.minute.reset_at).toBe('2025-10-28T12:00:00.000Z');
      expect(result.hour.reset_at).toBe('2025-10-28T12:00:00.000Z');
      expect(result.day.reset_at).toBe('2025-10-28T12:00:00.000Z');
    });
  });
});
