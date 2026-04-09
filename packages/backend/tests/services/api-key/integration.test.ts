/**
 * API Key Module Integration Tests
 * Tests for module interactions and end-to-end workflows
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  generatePlaintextKey,
  hashKey,
  verifyKey,
  API_KEY_PREFIX,
} from '../../../src/services/api-key/key-crypto.js';
import {
  isExpired,
  isInGracePeriod,
  isKeyUsable,
  checkPermission,
  checkProjectPermission,
} from '../../../src/services/api-key/key-permissions.js';
import {
  calculateWindowStart,
  calculateResetTime,
  checkRateLimit,
} from '../../../src/services/api-key/rate-limiter.js';
import { RATE_LIMIT_WINDOW } from '../../../src/db/types.js';
import type { ApiKey } from '../../../src/db/types.js';
import type { DatabaseClient } from '../../../src/db/client.js';

// Mock logger
vi.mock('../../../src/logger.js', () => ({
  getLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

/**
 * Helper to create complete ApiKey objects with defaults
 */
function createApiKey(overrides: Partial<ApiKey> = {}): ApiKey {
  return {
    id: 'key-1',
    name: 'Test Key',
    key_hash: 'hash',
    key_prefix: API_KEY_PREFIX,
    key_suffix: 'abc',
    description: null,
    type: 'production',
    status: 'active',
    permission_scope: 'full',
    permissions: [],
    allowed_projects: null,
    allowed_environments: null,
    rate_limit_per_minute: 60,
    rate_limit_per_hour: 1000,
    rate_limit_per_day: 10000,
    burst_limit: 10,
    per_endpoint_limits: null,
    ip_whitelist: null,
    allowed_origins: null,
    user_agent_pattern: null,
    expires_at: null,
    rotate_at: null,
    grace_period_days: 7,
    rotated_from: null,
    created_by: 'user-1',
    team_id: null,
    tags: null,
    created_at: new Date(),
    updated_at: new Date(),
    last_used_at: null,
    revoked_at: null,
    ...overrides,
  };
}

describe('API Key Module Integration', () => {
  let mockDb: any;

  beforeEach(() => {
    mockDb = {
      apiKeys: {
        getRateLimitCount: vi.fn(),
        incrementRateLimit: vi.fn(),
        decrementRateLimit: vi.fn(),
      },
    } as unknown as DatabaseClient;
  });

  // ============================================================================
  // CRYPTO + PERMISSIONS
  // ============================================================================

  describe('Crypto + Permissions Integration', () => {
    it('should create, hash, and verify key with permission check', () => {
      // 1. Generate key
      const plaintext = generatePlaintextKey();
      expect(plaintext).toMatch(/^bgs_/);

      // 2. Hash key
      const hash = hashKey(plaintext);
      expect(hash.length).toBe(64);

      // 3. Create API key object
      const apiKey = createApiKey({
        key_hash: hash,
        key_suffix: plaintext.slice(-4),
      });

      // 4. Verify key
      expect(verifyKey(plaintext, hash)).toBe(true);

      // 5. Check permissions
      expect(isExpired(apiKey)).toBe(false);
      expect(checkPermission(apiKey, 'bugs:read')).toEqual({ allowed: true });
      expect(checkProjectPermission(apiKey, 'any-project')).toEqual({ allowed: true });
    });

    it('should handle rotated key in grace period (not time-expired)', () => {
      const plaintext = generatePlaintextKey();
      const hash = hashKey(plaintext);

      const apiKey = createApiKey({
        name: 'Rotated Key',
        key_hash: hash,
        key_suffix: plaintext.slice(-4),
        status: 'expired', // Marked expired due to rotation
        permission_scope: 'read',
        permissions: ['bugs:read'],
        created_at: new Date(Date.now() - 48 * 60 * 60 * 1000),
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // Still valid for 30 days
        revoked_at: new Date(Date.now() - 60 * 1000), // Revoked 1 minute ago
        rotate_at: new Date(Date.now() - 60 * 1000), // Rotated 1 minute ago
      });

      // Key status is 'expired' but not time-expired
      expect(isExpired(apiKey)).toBe(false);

      // And in grace period due to recent rotation
      const gracePeriod = 24 * 60 * 60 * 1000; // 24 hours
      expect(isInGracePeriod(apiKey, gracePeriod)).toBe(true);

      // So it's still usable
      expect(isKeyUsable(apiKey, gracePeriod)).toBe(true);

      // And verification should work
      expect(verifyKey(plaintext, hash)).toBe(true);
    });
  });

  // ============================================================================
  // PERMISSIONS + RATE LIMITING
  // ============================================================================

  describe('Permissions + Rate Limiting Integration', () => {
    it('should enforce permissions before rate limiting', async () => {
      const apiKey = createApiKey({
        name: 'Limited Key',
        permission_scope: 'custom',
        permissions: ['bugs:read'],
        allowed_projects: ['project-1'],
      });

      // 1. Check project permission (should fail for wrong project)
      const projectCheck = checkProjectPermission(apiKey, 'project-2');
      expect(projectCheck.allowed).toBe(false);

      // If project check fails, don't even check rate limit
      if (!projectCheck.allowed) {
        // Permission denied - stop here
        return;
      }

      // 2. Check permission (this won't execute due to early return)
      const permCheck = checkPermission(apiKey, 'bugs:write');
      expect(permCheck.allowed).toBe(false);
    });

    it('should check rate limit after permissions pass', async () => {
      mockDb.apiKeys.incrementRateLimit.mockResolvedValue(9);

      const apiKey = createApiKey({
        name: 'Valid Key',
        permission_scope: 'read',
        permissions: ['bugs:read'],
      });

      // 1. Check permissions
      expect(checkPermission(apiKey, 'bugs:read')).toEqual({ allowed: true });
      expect(checkProjectPermission(apiKey, 'any-project')).toEqual({ allowed: true });

      // 2. Check rate limit (atomically increments)
      const rateLimit = await checkRateLimit(mockDb, apiKey.id, RATE_LIMIT_WINDOW.MINUTE, 10);
      expect(rateLimit.allowed).toBe(true);
      expect(rateLimit.remaining).toBe(1);
    });

    it('should handle rate limit exceeded scenario', async () => {
      mockDb.apiKeys.incrementRateLimit.mockResolvedValue(11);

      const apiKey = createApiKey({
        name: 'Valid Key',
      });

      // Permissions pass
      expect(checkPermission(apiKey, 'bugs:write')).toEqual({ allowed: true });

      // But rate limit fails
      const rateLimit = await checkRateLimit(mockDb, apiKey.id, RATE_LIMIT_WINDOW.MINUTE, 10);
      expect(rateLimit.allowed).toBe(false);
      expect(rateLimit.remaining).toBe(0);
    });
  });

  // ============================================================================
  // FULL REQUEST LIFECYCLE
  // ============================================================================

  describe('Full Request Lifecycle', () => {
    it('should simulate complete API request validation', async () => {
      mockDb.apiKeys.incrementRateLimit.mockResolvedValue(6);

      // 1. Generate and store key
      const plaintext = generatePlaintextKey();
      const hash = hashKey(plaintext);

      const apiKey = createApiKey({
        name: 'Production Key',
        key_hash: hash,
        key_suffix: plaintext.slice(-4),
        permission_scope: 'custom',
        permissions: ['bugs:read', 'bugs:write'],
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
        allowed_projects: ['project-1', 'project-2'],
      });

      // 2. Incoming request with API key
      const incomingKey = plaintext;

      // 3. Verify key hash
      expect(verifyKey(incomingKey, hash)).toBe(true);

      // 4. Check key is not expired
      expect(isExpired(apiKey)).toBe(false);

      // 5. Check key is usable
      expect(isKeyUsable(apiKey, 24 * 60 * 60 * 1000)).toBe(true);

      // 6. Check project permission
      const projectCheck = checkProjectPermission(apiKey, 'project-1');
      expect(projectCheck.allowed).toBe(true);

      // 7. Check action permission
      const permCheck = checkPermission(apiKey, 'bugs:write');
      expect(permCheck.allowed).toBe(true);

      // 8. Check rate limit
      const rateLimit = await checkRateLimit(mockDb, apiKey.id, RATE_LIMIT_WINDOW.HOUR, 1000);
      expect(rateLimit.allowed).toBe(true);
      expect(rateLimit.remaining).toBe(994); // 1000 - 6 = 994

      // 9. Process request (would happen here)
      // Note: Rate limit counter already incremented atomically by checkRateLimit
    });

    it('should reject request with wrong project', async () => {
      const plaintext = generatePlaintextKey();
      const hash = hashKey(plaintext);

      const apiKey = createApiKey({
        name: 'Scoped Key',
        key_hash: hash,
        key_suffix: plaintext.slice(-4),
        type: 'development',
        allowed_projects: ['project-1'],
      });

      // Verify key
      expect(verifyKey(plaintext, hash)).toBe(true);

      // Check permissions
      expect(checkPermission(apiKey, 'bugs:write')).toEqual({ allowed: true });

      // But project access fails
      const projectCheck = checkProjectPermission(apiKey, 'project-2');
      expect(projectCheck.allowed).toBe(false);
      expect(projectCheck.reason).toContain('project-1');
    });

    it('should handle expired key outside grace period', async () => {
      const plaintext = generatePlaintextKey();
      const hash = hashKey(plaintext);

      const apiKey = createApiKey({
        name: 'Expired Key',
        key_hash: hash,
        key_suffix: plaintext.slice(-4),
        status: 'expired',
        created_at: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000), // 60 days ago
        expires_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 days ago
      });

      // Key hash is valid
      expect(verifyKey(plaintext, hash)).toBe(true);

      // But key is expired
      expect(isExpired(apiKey)).toBe(true);

      // Not in grace period
      const gracePeriod = 24 * 60 * 60 * 1000;
      expect(isInGracePeriod(apiKey, gracePeriod)).toBe(false);

      // So not usable
      expect(isKeyUsable(apiKey, gracePeriod)).toBe(false);
    });
  });

  // ============================================================================
  // MULTI-WINDOW RATE LIMITING
  // ============================================================================

  describe('Multi-Window Rate Limiting', () => {
    it('should check multiple rate limit windows', async () => {
      mockDb.apiKeys.incrementRateLimit.mockImplementation((_keyId: string, window: string) => {
        // Return count after increment
        if (window === RATE_LIMIT_WINDOW.BURST) return Promise.resolve(3);
        if (window === RATE_LIMIT_WINDOW.MINUTE) return Promise.resolve(11);
        if (window === RATE_LIMIT_WINDOW.HOUR) return Promise.resolve(51);
        if (window === RATE_LIMIT_WINDOW.DAY) return Promise.resolve(501);
        return Promise.resolve(1);
      });

      const keyId = 'key-1';

      // Check all windows
      const burstResult = await checkRateLimit(mockDb, keyId, RATE_LIMIT_WINDOW.BURST, 5);
      expect(burstResult.allowed).toBe(true);
      expect(burstResult.remaining).toBe(2); // 5 - 3 = 2

      const minuteResult = await checkRateLimit(mockDb, keyId, RATE_LIMIT_WINDOW.MINUTE, 60);
      expect(minuteResult.allowed).toBe(true);
      expect(minuteResult.remaining).toBe(49); // 60 - 11 = 49

      const hourResult = await checkRateLimit(mockDb, keyId, RATE_LIMIT_WINDOW.HOUR, 1000);
      expect(hourResult.allowed).toBe(true);
      expect(hourResult.remaining).toBe(949); // 1000 - 51 = 949

      const dayResult = await checkRateLimit(mockDb, keyId, RATE_LIMIT_WINDOW.DAY, 10000);
      expect(dayResult.allowed).toBe(true);
      expect(dayResult.remaining).toBe(9499); // 10000 - 501 = 9499
    });

    it('should enforce strictest window limit', async () => {
      mockDb.apiKeys.incrementRateLimit.mockImplementation((_keyId: string, window: string) => {
        // Burst window exceeds limit after increment
        if (window === RATE_LIMIT_WINDOW.BURST) return Promise.resolve(6); // Exceeds limit of 5
        if (window === RATE_LIMIT_WINDOW.MINUTE) return Promise.resolve(11); // Under limit of 60
        return Promise.resolve(1);
      });

      const keyId = 'key-1';

      // Burst window is at limit
      const burstResult = await checkRateLimit(mockDb, keyId, RATE_LIMIT_WINDOW.BURST, 5);
      expect(burstResult.allowed).toBe(false);

      // Even though minute window is fine
      const minuteResult = await checkRateLimit(mockDb, keyId, RATE_LIMIT_WINDOW.MINUTE, 60);
      expect(minuteResult.allowed).toBe(true);

      // Request should be denied due to burst limit
    });
  });

  // ============================================================================
  // TIME WINDOW ALIGNMENT
  // ============================================================================

  describe('Time Window Alignment', () => {
    it('should align all windows consistently', async () => {
      const minuteStart = calculateWindowStart(RATE_LIMIT_WINDOW.MINUTE);
      const minuteReset = calculateResetTime(RATE_LIMIT_WINDOW.MINUTE);

      const hourStart = calculateWindowStart(RATE_LIMIT_WINDOW.HOUR);
      const hourReset = calculateResetTime(RATE_LIMIT_WINDOW.HOUR);

      const dayStart = calculateWindowStart(RATE_LIMIT_WINDOW.DAY);
      const dayReset = calculateResetTime(RATE_LIMIT_WINDOW.DAY);

      // All starts should be in the past
      const now = Date.now();
      expect(minuteStart.getTime()).toBeLessThanOrEqual(now);
      expect(hourStart.getTime()).toBeLessThanOrEqual(now);
      expect(dayStart.getTime()).toBeLessThanOrEqual(now);

      // All resets should be in the future
      expect(minuteReset.getTime()).toBeGreaterThan(now);
      expect(hourReset.getTime()).toBeGreaterThan(now);
      expect(dayReset.getTime()).toBeGreaterThan(now);

      // Reset should be after start
      expect(minuteReset.getTime()).toBeGreaterThan(minuteStart.getTime());
      expect(hourReset.getTime()).toBeGreaterThan(hourStart.getTime());
      expect(dayReset.getTime()).toBeGreaterThan(dayStart.getTime());
    });
  });
});
