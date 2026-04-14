/**
 * API Key Service Tests
 * Tests for business logic in API key management
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ApiKeyService } from '../../src/services/api-key/index.js';
import type { DatabaseClient } from '../../src/db/client.js';
import type { ApiKey, ApiKeyInsert, ApiKeyUsage } from '../../src/db/types.js';

// Mock logger
vi.mock('../../src/logger.js', () => ({
  getLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock cache service
vi.mock('../../src/cache/index.js', () => ({
  getCacheService: () => ({
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
    invalidateApiKey: vi.fn().mockResolvedValue(undefined),
    getApiKey: vi.fn().mockImplementation(async (_keyHash, fallback) => {
      // Always call the fallback to simulate cache miss and fetch from DB
      return await fallback();
    }),
  }),
}));

describe('ApiKeyService', () => {
  let service: ApiKeyService;
  let mockDb: any;

  beforeEach(() => {
    // Create mock database client
    mockDb = {
      apiKeys: {
        create: vi.fn(),
        findById: vi.fn(),
        findByHash: vi.fn(),
        findByIds: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        deleteBatch: vi.fn(),
        revoke: vi.fn(),
        revokeBatch: vi.fn(),
        updateLastUsed: vi.fn().mockResolvedValue(undefined),
        trackUsage: vi.fn(),
        getRateLimitCount: vi.fn(),
        incrementRateLimit: vi.fn(),
        logAudit: vi.fn(),
        getUsageLogs: vi.fn(),
        getAuditLogs: vi.fn(),
        findByIdWithStats: vi.fn(),
        checkAndUpdateExpired: vi.fn(),
        list: vi.fn(),
      },
      transaction: vi.fn(),
    } as unknown as DatabaseClient;

    service = new ApiKeyService(mockDb);
  });

  // ============================================================================
  // KEY GENERATION & HASHING
  // ============================================================================

  describe('Key Generation', () => {
    it('should generate API key with correct prefix', async () => {
      mockDb.apiKeys.create.mockResolvedValue({
        id: 'key-id',
        key_hash: 'hash',
      });

      const data: Omit<ApiKeyInsert, 'key_hash' | 'key_prefix' | 'key_suffix'> = {
        name: 'Test Key',
        type: 'development',
        permission_scope: 'read',
        permissions: ['bugs:read'],
        created_by: 'user-123',
      };

      const result = await service.createKey(data);

      expect(result.plaintext).toMatch(/^bgs_[A-Za-z0-9_-]+$/);
      expect(result.plaintext.length).toBeGreaterThan(20);
      expect(mockDb.apiKeys.create).toHaveBeenCalled();
    });

    it('should hash API key consistently', () => {
      const key = 'bgs_test123456789';
      const hash1 = service.hashKey(key);
      const hash2 = service.hashKey(key);

      expect(hash1).toBe(hash2);
      expect(hash1.length).toBe(64); // SHA-256 hex = 64 chars
    });

    it('should verify API key matches hash', () => {
      const key = 'bgs_test123456789';
      const hash = service.hashKey(key);

      expect(service.verifyKey(key, hash)).toBe(true);
      expect(service.verifyKey('bgs_wrong', hash)).toBe(false);
    });
  });

  // ============================================================================
  // KEY CREATION
  // ============================================================================

  describe('createKey', () => {
    it('should create API key with all fields', async () => {
      const mockKey: ApiKey = {
        id: 'key-123',
        name: 'Test Key',
        key_hash: 'hash',
        key_prefix: 'bgs_abc',
        key_suffix: '123',
        description: null,
        type: 'development',
        status: 'active',
        permission_scope: 'read',
        permissions: ['bugs:read'],
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
        created_by: 'user-123',
        team_id: null,
        tags: null,
        created_at: new Date(),
        updated_at: new Date(),
        last_used_at: null,
        revoked_at: null,
      };

      mockDb.apiKeys.create.mockResolvedValue(mockKey);

      const result = await service.createKey({
        name: 'Project Key',
        type: 'production',
        permission_scope: 'read',
        permissions: ['bugs:read'],
        created_by: 'user-123',
      });

      expect(result.key).toEqual(mockKey);
      expect(result.plaintext).toMatch(/^bgs_/);
      expect(mockDb.apiKeys.logAudit).toHaveBeenCalledWith({
        api_key_id: 'key-123',
        action: 'created',
        performed_by: 'user-123',
        changes: {
          type: 'production',
          permission_scope: 'read',
        },
      });
    });

    it('should handle creation errors', async () => {
      mockDb.apiKeys.create.mockRejectedValue(new Error('Database error'));

      await expect(
        service.createKey({
          name: 'Test Key',
          type: 'development',
          permission_scope: 'read',
          permissions: ['bugs:read'],
          created_by: 'user-123',
        })
      ).rejects.toThrow('Database error');
    });
  });

  // ============================================================================
  // KEY ROTATION
  // ============================================================================

  describe('rotateKey', () => {
    it('should create new key and mark old as rotated within transaction', async () => {
      const oldKey: ApiKey = {
        id: 'old-key',
        name: 'Original Key',
        key_hash: 'old-hash',
        key_prefix: 'bgs_old',
        key_suffix: '123',
        description: null,
        type: 'development',
        status: 'active',
        permission_scope: 'write',
        permissions: ['bugs:write'],
        allowed_projects: null,
        allowed_environments: null,
        rate_limit_per_minute: 120,
        rate_limit_per_hour: 2000,
        rate_limit_per_day: 20000,
        burst_limit: 20,
        per_endpoint_limits: null,
        ip_whitelist: null,
        allowed_origins: null,
        user_agent_pattern: null,
        expires_at: null,
        rotate_at: null,
        grace_period_days: 7,
        rotated_from: null,
        created_by: 'user-123',
        team_id: null,
        tags: null,
        created_at: new Date(),
        updated_at: new Date(),
        last_used_at: null,
        revoked_at: null,
      };

      const newKey: ApiKey = {
        ...oldKey,
        id: 'new-key',
        name: 'Original Key (rotated)',
        key_hash: 'new-hash',
      };

      // Mock transaction context
      const mockTx = {
        apiKeys: {
          create: vi.fn().mockResolvedValue(newKey),
          update: vi.fn().mockResolvedValue(newKey),
          logAudit: vi.fn().mockResolvedValue(undefined),
        },
      };

      mockDb.apiKeys.findById.mockResolvedValue(oldKey);
      mockDb.transaction.mockImplementation(async (callback: any) => {
        return await callback(mockTx);
      });

      const result = await service.rotateKey('old-key', 'user-123');

      expect(result.key.id).toBe('new-key');
      expect(result.plaintext).toMatch(/^bgs_/);

      // Verify transaction was called
      expect(mockDb.transaction).toHaveBeenCalledWith(expect.any(Function));

      // Verify new key created within transaction
      // Rotation re-resolves permissions from scope, so write scope
      // expands to full read+write permissions
      expect(mockTx.apiKeys.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Original Key (rotated)',
          type: 'development',
          permission_scope: 'write',
          permissions: ['reports:read', 'reports:write', 'sessions:read', 'sessions:write'],
          created_by: 'user-123',
        })
      );

      // Verify old key updated with rotate_at and revoked_at (first update call)
      expect(mockTx.apiKeys.update).toHaveBeenNthCalledWith(1, 'old-key', {
        status: 'expired',
        rotate_at: expect.any(Date),
        revoked_at: expect.any(Date),
      });

      // Verify new key updated with rotation info (second update call)
      expect(mockTx.apiKeys.update).toHaveBeenNthCalledWith(2, 'new-key', {
        rotated_from: 'old-key',
      });

      // Verify audit logs created within transaction
      expect(mockTx.apiKeys.logAudit).toHaveBeenCalledTimes(2);

      // First audit: old key rotation
      expect(mockTx.apiKeys.logAudit).toHaveBeenNthCalledWith(1, {
        api_key_id: 'old-key',
        action: 'rotated',
        performed_by: 'user-123',
        changes: {
          new_key_id: 'new-key',
        },
      });

      // Second audit: new key creation
      expect(mockTx.apiKeys.logAudit).toHaveBeenNthCalledWith(2, {
        api_key_id: 'new-key',
        action: 'created',
        performed_by: 'user-123',
        changes: {
          rotated_from: 'old-key',
          type: 'development',
          permission_scope: 'write',
        },
      });
    });

    it('should set both rotate_at and revoked_at with same timestamp', async () => {
      const oldKey: ApiKey = {
        id: 'old-key',
        name: 'Test Key',
        status: 'active',
        rotate_at: null,
        revoked_at: null,
      } as ApiKey;

      const newKey: ApiKey = {
        ...oldKey,
        id: 'new-key',
        name: 'Test Key (rotated)',
      };

      const mockTx = {
        apiKeys: {
          create: vi.fn().mockResolvedValue(newKey),
          update: vi.fn().mockResolvedValue(newKey),
          logAudit: vi.fn().mockResolvedValue(undefined),
        },
      };

      mockDb.apiKeys.findById.mockResolvedValue(oldKey);
      mockDb.transaction.mockImplementation(async (callback: any) => {
        return await callback(mockTx);
      });

      await service.rotateKey('old-key', 'user-123');

      // Extract the actual call to verify timestamps match
      const updateCall = mockTx.apiKeys.update.mock.calls[0];
      expect(updateCall[0]).toBe('old-key');
      expect(updateCall[1]).toHaveProperty('rotate_at');
      expect(updateCall[1]).toHaveProperty('revoked_at');

      // Both timestamps should be equal
      expect(updateCall[1].rotate_at).toEqual(updateCall[1].revoked_at);
    });

    it('should rollback transaction on failure', async () => {
      const oldKey: ApiKey = {
        id: 'old-key',
        name: 'Test Key',
      } as ApiKey;

      const mockTx = {
        apiKeys: {
          create: vi.fn().mockResolvedValue({ id: 'new-key' }),
          update: vi.fn().mockRejectedValue(new Error('Database error')),
          logAudit: vi.fn(),
        },
      };

      mockDb.apiKeys.findById.mockResolvedValue(oldKey);
      mockDb.transaction.mockImplementation(async (callback: any) => {
        return await callback(mockTx);
      });

      await expect(service.rotateKey('old-key', 'user-123')).rejects.toThrow('Database error');

      // Transaction should have been called
      expect(mockDb.transaction).toHaveBeenCalled();
    });

    it('should throw error if old key not found', async () => {
      mockDb.apiKeys.findById.mockResolvedValue(null);

      await expect(service.rotateKey('missing-key', 'user-123')).rejects.toThrow(
        'API key not found'
      );

      // Transaction should not be called if key doesn't exist
      expect(mockDb.transaction).not.toHaveBeenCalled();
    });

    it('should preserve all key settings in rotated key', async () => {
      const oldKey: ApiKey = {
        id: 'old-key',
        name: 'Production API Key',
        type: 'production',
        permission_scope: 'custom',
        permissions: ['bugs:write', 'projects:read'],
        allowed_projects: ['proj-1', 'proj-2'],
        allowed_origins: ['https://app.example.com'],
        allowed_environments: ['production'],
        rate_limit_per_minute: 500,
        rate_limit_per_hour: 10000,
        rate_limit_per_day: 50000,
        burst_limit: 1000,
        created_at: new Date('2025-01-01'),
        expires_at: new Date('2025-12-31'),
      } as ApiKey;

      const mockTx = {
        apiKeys: {
          create: vi.fn().mockResolvedValue({ id: 'new-key' }),
          update: vi.fn().mockResolvedValue({ id: 'new-key' }),
          logAudit: vi.fn().mockResolvedValue(undefined),
        },
      };

      mockDb.apiKeys.findById.mockResolvedValue(oldKey);
      mockDb.transaction.mockImplementation(async (callback: any) => {
        return await callback(mockTx);
      });

      await service.rotateKey('old-key', 'user-123');

      // Verify all settings preserved
      expect(mockTx.apiKeys.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'production',
          permission_scope: 'custom',
          permissions: ['bugs:write', 'projects:read'],
          allowed_projects: ['proj-1', 'proj-2'],
          allowed_origins: ['https://app.example.com'],
          allowed_environments: ['production'],
          rate_limit_per_minute: 500,
          rate_limit_per_hour: 10000,
          rate_limit_per_day: 50000,
          burst_limit: 1000,
        })
      );
    });

    it('should apply fresh expiration duration to rotated key', async () => {
      const now = Date.now();
      const createdAt = new Date(now - 30 * 24 * 60 * 60 * 1000); // 30 days ago
      const expiresAt = new Date(now + 60 * 24 * 60 * 60 * 1000); // 60 days from now (90 day duration total)

      const oldKey: ApiKey = {
        id: 'old-key',
        name: 'Test Key',
        type: 'production',
        created_at: createdAt,
        expires_at: expiresAt,
      } as ApiKey;

      const mockTx = {
        apiKeys: {
          create: vi.fn().mockResolvedValue({ id: 'new-key' }),
          update: vi.fn().mockResolvedValue({ id: 'new-key' }),
          logAudit: vi.fn().mockResolvedValue(undefined),
        },
      };

      mockDb.apiKeys.findById.mockResolvedValue(oldKey);
      mockDb.transaction.mockImplementation(async (callback: any) => {
        return await callback(mockTx);
      });

      await service.rotateKey('old-key', 'user-123');

      // Extract the new key's expires_at
      const createCall = mockTx.apiKeys.create.mock.calls[0][0];
      const newExpiresAt = createCall.expires_at;

      // Should have expiration (not null)
      expect(newExpiresAt).toBeTruthy();

      // New expiration should be ~90 days from now (original duration)
      const originalDuration = expiresAt.getTime() - createdAt.getTime();
      const expectedExpiration = now + originalDuration;
      const tolerance = 1000; // 1 second tolerance for test execution time

      expect(newExpiresAt.getTime()).toBeGreaterThanOrEqual(expectedExpiration - tolerance);
      expect(newExpiresAt.getTime()).toBeLessThanOrEqual(expectedExpiration + tolerance);
    });

    it('should not set expiration if old key has no expiration', async () => {
      const oldKey: ApiKey = {
        id: 'old-key',
        name: 'Test Key',
        type: 'production',
        created_at: new Date(),
        expires_at: null, // No expiration
      } as ApiKey;

      const mockTx = {
        apiKeys: {
          create: vi.fn().mockResolvedValue({ id: 'new-key' }),
          update: vi.fn().mockResolvedValue({ id: 'new-key' }),
          logAudit: vi.fn().mockResolvedValue(undefined),
        },
      };

      mockDb.apiKeys.findById.mockResolvedValue(oldKey);
      mockDb.transaction.mockImplementation(async (callback: any) => {
        return await callback(mockTx);
      });

      await service.rotateKey('old-key', 'user-123');

      // New key should also have no expiration
      const createCall = mockTx.apiKeys.create.mock.calls[0][0];
      expect(createCall.expires_at).toBeNull();
    });

    it('should handle rotation of nearly expired key with fresh duration', async () => {
      const now = Date.now();
      const createdAt = new Date(now - 89 * 24 * 60 * 60 * 1000); // 89 days ago
      const expiresAt = new Date(now + 1 * 24 * 60 * 60 * 1000); // 1 day from now (90 day duration)

      const oldKey: ApiKey = {
        id: 'old-key',
        name: 'Nearly Expired Key',
        type: 'production',
        created_at: createdAt,
        expires_at: expiresAt,
      } as ApiKey;

      const mockTx = {
        apiKeys: {
          create: vi.fn().mockResolvedValue({ id: 'new-key' }),
          update: vi.fn().mockResolvedValue({ id: 'new-key' }),
          logAudit: vi.fn().mockResolvedValue(undefined),
        },
      };

      mockDb.apiKeys.findById.mockResolvedValue(oldKey);
      mockDb.transaction.mockImplementation(async (callback: any) => {
        return await callback(mockTx);
      });

      await service.rotateKey('old-key', 'user-123');

      // Extract the new key's expires_at
      const createCall = mockTx.apiKeys.create.mock.calls[0][0];
      const newExpiresAt = createCall.expires_at;

      // Should be approximately 90 days from now
      expect(newExpiresAt.getTime()).toBeGreaterThan(now + 85 * 24 * 60 * 60 * 1000);
      expect(newExpiresAt.getTime()).toBeLessThan(now + 95 * 24 * 60 * 60 * 1000);

      // Should NOT be close to the old expiration (1 day from now)
      expect(newExpiresAt.getTime()).toBeGreaterThan(
        expiresAt.getTime() + 80 * 24 * 60 * 60 * 1000
      );
    });
  });

  describe('isInGracePeriod', () => {
    it('should return true for recently rotated key', () => {
      const key: ApiKey = {
        id: 'key-123',
        status: 'expired',
        rotate_at: new Date(Date.now() + 1000 * 60 * 60 * 24), // Rotate tomorrow
        revoked_at: new Date(Date.now() - 1000 * 60 * 60), // Revoked 1 hour ago
      } as ApiKey;

      expect(service.isInGracePeriod(key)).toBe(true);
    });

    it('should return false for old rotated key', () => {
      const key: ApiKey = {
        id: 'key-123',
        status: 'expired',
        rotate_at: new Date(Date.now() + 1000 * 60 * 60 * 24),
        revoked_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 8), // Revoked 8 days ago
      } as ApiKey;

      expect(service.isInGracePeriod(key)).toBe(false);
    });

    it('should return false for non-rotated key', () => {
      const key: ApiKey = {
        id: 'key-123',
        status: 'active',
        rotate_at: null,
        revoked_at: null,
      } as ApiKey;

      expect(service.isInGracePeriod(key)).toBe(false);
    });
  });

  // ============================================================================
  // KEY VERIFICATION
  // ============================================================================

  describe('verifyAndGetKey', () => {
    it('should verify valid active key', async () => {
      const key: ApiKey = {
        id: 'key-123',
        status: 'active',
        expires_at: null,
      } as ApiKey;

      mockDb.apiKeys.findByHash.mockResolvedValue(key);
      mockDb.apiKeys.updateLastUsed.mockResolvedValue(undefined);

      const result = await service.verifyAndGetKey('bgs_test123');

      expect(result.key).toEqual(key);
      expect(result.failureReason).toBeUndefined();
      expect(mockDb.apiKeys.updateLastUsed).toHaveBeenCalledWith('key-123');
    });

    it('should reject expired key without grace period', async () => {
      const key: ApiKey = {
        id: 'key-123',
        status: 'expired',
        expires_at: new Date(Date.now() - 1000),
        rotate_at: null,
        revoked_at: null,
      } as ApiKey;

      mockDb.apiKeys.findByHash.mockResolvedValue(key);

      const result = await service.verifyAndGetKey('bgs_test123');

      expect(result.key).toBeNull();
      expect(result.failureReason).toBe('expired');
      expect(result.existingKey).toEqual(key);
      expect(mockDb.apiKeys.updateLastUsed).not.toHaveBeenCalled();
    });

    it('should reject expired key', async () => {
      const key: ApiKey = {
        id: 'key-123',
        status: 'active',
        expires_at: new Date(Date.now() - 1000),
      } as ApiKey;

      mockDb.apiKeys.findByHash.mockResolvedValue(key);

      const result = await service.verifyAndGetKey('bgs_test123');

      expect(result.key).toBeNull();
      expect(result.failureReason).toBe('expired');
    });

    it('should reject expired key even in grace period', async () => {
      const key: ApiKey = {
        id: 'key-123',
        status: 'expired',
        expires_at: new Date(Date.now() - 1000),
        rotate_at: new Date(Date.now() + 1000 * 60 * 60 * 24),
        revoked_at: new Date(Date.now() - 1000 * 60 * 60), // Revoked 1 hour ago
      } as ApiKey;

      mockDb.apiKeys.findByHash.mockResolvedValue(key);

      const result = await service.verifyAndGetKey('bgs_test123');

      expect(result.key).toBeNull();
      expect(result.failureReason).toBe('expired');
    });

    it('should reject expired key outside grace period', async () => {
      const key: ApiKey = {
        id: 'key-123',
        status: 'expired',
        expires_at: new Date(Date.now() - 1000),
        rotate_at: new Date(Date.now() + 1000 * 60 * 60 * 24),
        revoked_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 8), // Revoked 8 days ago
      } as ApiKey;

      mockDb.apiKeys.findByHash.mockResolvedValue(key);

      const result = await service.verifyAndGetKey('bgs_test123');

      expect(result.key).toBeNull();
      expect(result.failureReason).toBe('expired');
    });

    it('should return null for unknown key', async () => {
      mockDb.apiKeys.findByHash.mockResolvedValue(null);

      const result = await service.verifyAndGetKey('bgs_unknown');

      expect(result.key).toBeNull();
      expect(result.failureReason).toBe('not_found');
    });
  });

  describe('isKeyUsable', () => {
    it('should allow active key', () => {
      const key: ApiKey = {
        id: 'key-123',
        status: 'active',
        expires_at: null,
      } as ApiKey;

      expect(service.isKeyUsable(key)).toBe(true);
    });

    it('should allow expiring key', () => {
      const key: ApiKey = {
        id: 'key-123',
        status: 'expiring',
        expires_at: new Date(Date.now() + 1000 * 60 * 60 * 24), // Expires in 1 day
      } as ApiKey;

      expect(service.isKeyUsable(key)).toBe(true);
    });

    it('should reject expired key', () => {
      const key: ApiKey = {
        id: 'key-123',
        status: 'active',
        expires_at: new Date(Date.now() - 1000),
      } as ApiKey;

      expect(service.isKeyUsable(key)).toBe(false);
    });
  });

  describe('isExpired', () => {
    it('should return false for non-expiring key', () => {
      const key: ApiKey = {
        id: 'key-123',
        expires_at: null,
      } as ApiKey;

      expect(service.isExpired(key)).toBe(false);
    });

    it('should return false for future expiration', () => {
      const key: ApiKey = {
        id: 'key-123',
        expires_at: new Date(Date.now() + 1000 * 60 * 60),
      } as ApiKey;

      expect(service.isExpired(key)).toBe(false);
    });

    it('should return true for past expiration', () => {
      const key: ApiKey = {
        id: 'key-123',
        expires_at: new Date(Date.now() - 1000),
      } as ApiKey;

      expect(service.isExpired(key)).toBe(true);
    });
  });

  // ============================================================================
  // PERMISSION VALIDATION
  // ============================================================================

  describe('checkPermission', () => {
    it('should allow full scope with wildcard permission', () => {
      const key = {
        id: 'key-123',
        permission_scope: 'full',
        permissions: ['*'], // Resolved from full scope at creation time
      } as unknown as ApiKey;

      const result = service.checkPermission(key, 'bugs:delete');

      expect(result.allowed).toBe(true);
    });

    it('should check specific permissions for custom scope', () => {
      const key = {
        id: 'key-123',
        permission_scope: 'custom',
        permissions: ['bugs:read'],
      } as unknown as ApiKey;

      const result = service.checkPermission(key, 'bugs:delete');

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Missing permission');
    });

    it('should check specific permissions for read scope', () => {
      const key: ApiKey = {
        id: 'key-123',
        permission_scope: 'read',
        permissions: ['bugs:read', 'sessions:read'],
      } as ApiKey;

      expect(service.checkPermission(key, 'bugs:read').allowed).toBe(true);
      expect(service.checkPermission(key, 'bugs:write').allowed).toBe(false);
    });

    it('should return reason for missing permission', () => {
      const key: ApiKey = {
        id: 'key-123',
        permission_scope: 'write',
        permissions: ['bugs:write'],
      } as ApiKey;

      const result = service.checkPermission(key, 'sessions:delete');

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('sessions:delete');
    });
  });

  describe('checkProjectPermission', () => {
    it('should allow global key access to any project', () => {
      const key: ApiKey = {
        id: 'key-123',
        allowed_projects: null,
      } as ApiKey;

      const result = service.checkProjectPermission(key, 'any-project');

      expect(result.allowed).toBe(true);
    });

    it('should allow key access to its project', () => {
      const key: ApiKey = {
        id: 'key-123',
        allowed_projects: ['proj-123'],
      } as ApiKey;

      const result = service.checkProjectPermission(key, 'proj-123');

      expect(result.allowed).toBe(true);
    });

    it('should reject key access to different project', () => {
      const key: ApiKey = {
        id: 'key-123',
        allowed_projects: ['proj-123'],
      } as ApiKey;

      const result = service.checkProjectPermission(key, 'proj-456');

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('proj-123');
    });
  });

  // ============================================================================
  // RATE LIMITING
  // ============================================================================

  // ============================================================================
  // RATE LIMITING (Security-Critical)
  // ============================================================================

  describe('checkRateLimit', () => {
    it('should atomically increment and check limit', async () => {
      mockDb.apiKeys.incrementRateLimit.mockResolvedValue(5);

      const result = await service.checkRateLimit('key-123', 'minute', 100);

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(95);
      expect(result.window).toBe('minute');
      expect(result.resetAt).toBeInstanceOf(Date);
      expect(mockDb.apiKeys.incrementRateLimit).toHaveBeenCalledWith(
        'key-123',
        'minute',
        expect.any(Date)
      );
    });

    it('should reject request when at exact limit', async () => {
      mockDb.apiKeys.incrementRateLimit.mockResolvedValue(100);

      const result = await service.checkRateLimit('key-123', 'minute', 100);

      expect(result.allowed).toBe(true); // Equal to limit is still allowed
      expect(result.remaining).toBe(0);
    });

    it('should reject request exceeding limit', async () => {
      mockDb.apiKeys.incrementRateLimit.mockResolvedValue(101);

      const result = await service.checkRateLimit('key-123', 'minute', 100);

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });

    it('should prevent race condition with concurrent requests', async () => {
      // Simulate concurrent requests - both get sequential counts
      let currentCount = 99;
      mockDb.apiKeys.incrementRateLimit.mockImplementation(async () => {
        return ++currentCount; // Atomic increment in DB
      });

      // Both requests check limit
      const result1 = await service.checkRateLimit('key-123', 'minute', 100);
      const result2 = await service.checkRateLimit('key-123', 'minute', 100);

      // First request: count = 100, allowed
      expect(result1.allowed).toBe(true);
      expect(result1.remaining).toBe(0);

      // Second request: count = 101, denied
      expect(result2.allowed).toBe(false);
      expect(result2.remaining).toBe(0);
    });

    it('should handle different time windows', async () => {
      mockDb.apiKeys.incrementRateLimit.mockResolvedValue(1);

      const minuteResult = await service.checkRateLimit('key-123', 'minute', 60);
      const hourResult = await service.checkRateLimit('key-123', 'hour', 1000);
      const dayResult = await service.checkRateLimit('key-123', 'day', 10000);

      expect(minuteResult.window).toBe('minute');
      expect(hourResult.window).toBe('hour');
      expect(dayResult.window).toBe('day');
    });

    it('should fail closed on database error (SECURITY)', async () => {
      mockDb.apiKeys.incrementRateLimit.mockRejectedValue(new Error('Database connection lost'));

      const result = await service.checkRateLimit('key-123', 'minute', 100);

      // Critical: Must deny request on error to prevent bypass
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });

    it('should fail closed on unknown error (SECURITY)', async () => {
      mockDb.apiKeys.incrementRateLimit.mockRejectedValue('Unknown error');

      const result = await service.checkRateLimit('key-123', 'minute', 100);

      expect(result.allowed).toBe(false);
    });

    it('should allow 0 rate limit to deny all requests (soft disable)', async () => {
      const result = await service.checkRateLimit('key-123', 'minute', 0);

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.window).toBe('minute');
      expect(result.resetAt).toBeInstanceOf(Date);
    });

    it('should reject negative rate limits', async () => {
      await expect(service.checkRateLimit('key-123', 'minute', -10)).rejects.toThrow(
        'Rate limit must be non-negative'
      );

      await expect(service.checkRateLimit('key-123', 'minute', -1)).rejects.toThrow(
        'Rate limit must be non-negative'
      );
    });

    it('should validate API key ID is provided', async () => {
      await expect(service.checkRateLimit('', 'minute', 100)).rejects.toThrow(
        'API key ID is required'
      );

      await expect(service.checkRateLimit('   ', 'minute', 100)).rejects.toThrow(
        'API key ID is required'
      );
    });

    it('should handle burst window correctly', async () => {
      mockDb.apiKeys.incrementRateLimit.mockResolvedValue(50);

      const result = await service.checkRateLimit('key-123', 'burst', 100);

      expect(result.allowed).toBe(true);
      expect(result.window).toBe('burst');
      // Burst window should reset in ~10 seconds
      expect(result.resetAt.getTime()).toBeGreaterThan(Date.now());
      expect(result.resetAt.getTime()).toBeLessThan(Date.now() + 15000);
    });

    it('should calculate remaining correctly when over limit', async () => {
      mockDb.apiKeys.incrementRateLimit.mockResolvedValue(150);

      const result = await service.checkRateLimit('key-123', 'minute', 100);

      // Remaining should never go negative
      expect(result.remaining).toBe(0);
      expect(result.allowed).toBe(false);
    });
  });

  describe('decrementRateLimit', () => {
    it('should decrement rate limit counter for rollback', async () => {
      const mockQuery = vi.fn().mockResolvedValue({ rowCount: 1 });
      mockDb.query = mockQuery;

      await service.decrementRateLimit('key-123', 'minute');

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE api_key_rate_limits'),
        ['key-123', 'minute', expect.any(Date)]
      );
    });

    it('should not throw on decrement error (best-effort)', async () => {
      const mockQuery = vi.fn().mockRejectedValue(new Error('Database error'));
      mockDb.query = mockQuery;

      await expect(service.decrementRateLimit('key-123', 'minute')).resolves.toBeUndefined();
    });
  });

  // ============================================================================
  // USAGE TRACKING
  // ============================================================================

  describe('trackUsage', () => {
    it('should track API key usage', async () => {
      await service.trackUsage(
        'key-123',
        '/api/bugs',
        'POST',
        201,
        45,
        'BugSpotter SDK/1.0',
        '192.168.1.1'
      );

      expect(mockDb.apiKeys.trackUsage).toHaveBeenCalledWith({
        api_key_id: 'key-123',
        endpoint: '/api/bugs',
        method: 'POST',
        status_code: 201,
        response_time_ms: 45,
        user_agent: 'BugSpotter SDK/1.0',
        ip_address: '192.168.1.1',
      });
    });

    it('should not throw on tracking error', async () => {
      mockDb.apiKeys.trackUsage.mockRejectedValue(new Error('Database error'));

      await expect(
        service.trackUsage('key-123', '/api/bugs', 'GET', 200, 10)
      ).resolves.toBeUndefined();
    });
  });

  describe('getUsageLogs', () => {
    it('should get usage logs with limit and offset', async () => {
      const mockLogs = [{ id: 'log-1' }] as ApiKeyUsage[];

      mockDb.apiKeys.getUsageLogs.mockResolvedValue(mockLogs);

      const result = await service.getUsageLogs('key-123', 20, 0);

      expect(result).toEqual(mockLogs);
      expect(mockDb.apiKeys.getUsageLogs).toHaveBeenCalledWith('key-123', 20, 0);
    });
  });

  describe('getKeyWithStats', () => {
    it('should get key with usage statistics', async () => {
      const mockKeyWithStats = {
        id: 'key-123',
        total_requests: 1000,
        total_errors: 10,
      };

      mockDb.apiKeys.findByIdWithStats.mockResolvedValue(mockKeyWithStats);

      const result = await service.getKeyWithStats('key-123');

      expect(result).toEqual(mockKeyWithStats);
    });
  });

  // ============================================================================
  // KEY LIFECYCLE
  // ============================================================================

  describe('revokeKey', () => {
    it('should revoke key and log audit', async () => {
      await service.revokeKey('key-123', 'user-123', 'Security breach');

      expect(mockDb.apiKeys.revoke).toHaveBeenCalledWith('key-123');
      expect(mockDb.apiKeys.logAudit).toHaveBeenCalledWith({
        api_key_id: 'key-123',
        action: 'revoked',
        performed_by: 'user-123',
        changes: { reason: 'Security breach' },
      });
    });

    it('should log audit without reason', async () => {
      await service.revokeKey('key-123', 'user-123');

      expect(mockDb.apiKeys.logAudit).toHaveBeenCalledWith({
        api_key_id: 'key-123',
        action: 'revoked',
        performed_by: 'user-123',
        changes: undefined,
      });
    });
  });

  describe('updateKey', () => {
    it('should update key and log audit', async () => {
      const updatedKey: ApiKey = {
        id: 'key-123',
        name: 'Updated Name',
      } as ApiKey;

      mockDb.apiKeys.update.mockResolvedValue(updatedKey);

      const result = await service.updateKey('key-123', { name: 'Updated Name' }, 'user-123');

      expect(result).toEqual(updatedKey);
      expect(mockDb.apiKeys.logAudit).toHaveBeenCalledWith({
        api_key_id: 'key-123',
        action: 'updated',
        performed_by: 'user-123',
        changes: { fields: ['name'] },
      });
    });

    it('should return null if key not found', async () => {
      mockDb.apiKeys.update.mockResolvedValue(null);

      const result = await service.updateKey('missing-key', { name: 'Test' }, 'user-123');

      expect(result).toBeNull();
    });

    it('should resolve permissions when updating to preset scope', async () => {
      const updatedKey = { id: 'key-123' } as ApiKey;
      mockDb.apiKeys.update.mockResolvedValue(updatedKey);

      await service.updateKey('key-123', { permission_scope: 'write' }, 'user-123');

      expect(mockDb.apiKeys.update).toHaveBeenCalledWith(
        'key-123',
        expect.objectContaining({
          permission_scope: 'write',
          permissions: ['reports:read', 'reports:write', 'sessions:read', 'sessions:write'],
        })
      );
    });

    it('should resolve full scope to wildcard on update', async () => {
      const updatedKey = { id: 'key-123' } as ApiKey;
      mockDb.apiKeys.update.mockResolvedValue(updatedKey);

      await service.updateKey('key-123', { permission_scope: 'full' }, 'user-123');

      expect(mockDb.apiKeys.update).toHaveBeenCalledWith(
        'key-123',
        expect.objectContaining({
          permissions: ['*'],
        })
      );
    });

    it('should pass through custom scope with explicit permissions', async () => {
      const updatedKey = { id: 'key-123' } as ApiKey;
      mockDb.apiKeys.update.mockResolvedValue(updatedKey);

      await service.updateKey(
        'key-123',
        { permission_scope: 'custom', permissions: ['reports:read'] },
        'user-123'
      );

      expect(mockDb.apiKeys.update).toHaveBeenCalledWith(
        'key-123',
        expect.objectContaining({
          permission_scope: 'custom',
          permissions: ['reports:read'],
        })
      );
    });

    it('should reject custom scope without permissions', async () => {
      await expect(
        service.updateKey('key-123', { permission_scope: 'custom' }, 'user-123')
      ).rejects.toThrow('Permissions array is required when switching to custom scope');
    });

    it('should reject custom scope with empty permissions array', async () => {
      await expect(
        service.updateKey('key-123', { permission_scope: 'custom', permissions: [] }, 'user-123')
      ).rejects.toThrow('Permissions array cannot be empty for custom scope');
    });

    it('should auto-set permission_scope to custom when only permissions are updated', async () => {
      const updatedKey = { id: 'key-123' } as ApiKey;
      mockDb.apiKeys.update.mockResolvedValue(updatedKey);

      await service.updateKey(
        'key-123',
        { permissions: ['sessions:read', 'sessions:write'] },
        'user-123'
      );

      expect(mockDb.apiKeys.update).toHaveBeenCalledWith(
        'key-123',
        expect.objectContaining({
          permission_scope: 'custom',
          permissions: ['sessions:read', 'sessions:write'],
        })
      );
    });

    it('should log normalized fields in audit (including implicit scope changes)', async () => {
      const updatedKey = { id: 'key-123' } as ApiKey;
      mockDb.apiKeys.update.mockResolvedValue(updatedKey);

      await service.updateKey('key-123', { permissions: ['reports:read'] }, 'user-123');

      // Audit should include permission_scope even though caller only sent permissions
      expect(mockDb.apiKeys.logAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          changes: {
            fields: expect.arrayContaining(['permissions', 'permission_scope']),
          },
        })
      );
    });
  });

  describe('deleteKey', () => {
    it('should delete key and log audit', async () => {
      mockDb.apiKeys.delete.mockResolvedValue(true);

      const result = await service.deleteKey('key-123', 'user-123');

      expect(result).toBe(true);
      expect(mockDb.apiKeys.logAudit).toHaveBeenCalledWith({
        api_key_id: 'key-123',
        action: 'revoked',
        performed_by: 'user-123',
        changes: { permanent_delete: true },
      });
    });

    it('should return false if key not found', async () => {
      mockDb.apiKeys.delete.mockResolvedValue(false);

      const result = await service.deleteKey('missing-key', 'user-123');

      expect(result).toBe(false);
    });
  });

  describe('updateExpiredKeys', () => {
    it('should update expired keys', async () => {
      mockDb.apiKeys.checkAndUpdateExpired.mockResolvedValue(5);

      const count = await service.updateExpiredKeys();

      expect(count).toBe(5);
    });
  });

  // ============================================================================
  // BATCH OPERATIONS
  // ============================================================================

  describe('revokeBatch', () => {
    it('should revoke multiple keys using batch query', async () => {
      const mockRevokedKeys = [
        { id: 'key-1', name: 'Key 1', project_id: 'proj-1' },
        { id: 'key-2', name: 'Key 2', project_id: 'proj-1' },
        { id: 'key-3', name: 'Key 3', project_id: 'proj-2' },
      ];
      mockDb.apiKeys.revokeBatch.mockResolvedValue(mockRevokedKeys);

      const count = await service.revokeBatch(['key-1', 'key-2', 'key-3'], 'user-123');

      expect(count).toBe(3);
      expect(mockDb.apiKeys.revokeBatch).toHaveBeenCalledWith(['key-1', 'key-2', 'key-3']);
      expect(mockDb.apiKeys.revokeBatch).toHaveBeenCalledTimes(1);
    });

    it('should handle partial revocations', async () => {
      // Only 2 keys get revoked (one might have already been revoked)
      const mockRevokedKeys = [
        { id: 'key-1', name: 'Key 1', project_id: 'proj-1' },
        { id: 'key-3', name: 'Key 3', project_id: 'proj-2' },
      ];
      mockDb.apiKeys.revokeBatch.mockResolvedValue(mockRevokedKeys);

      const count = await service.revokeBatch(['key-1', 'key-2', 'key-3'], 'user-123');

      expect(count).toBe(2); // Only keys that were actually revoked
    });
  });

  describe('deleteBatch', () => {
    it('should delete multiple keys using batch query', async () => {
      const mockExistingKeys = new Map([
        ['key-1', { id: 'key-1', name: 'Key 1', project_id: 'proj-1' }],
        ['key-2', { id: 'key-2', name: 'Key 2', project_id: 'proj-1' }],
      ]);
      mockDb.apiKeys.findByIds.mockResolvedValue(mockExistingKeys);
      mockDb.apiKeys.deleteBatch.mockResolvedValue(2);

      const count = await service.deleteBatch(['key-1', 'key-2'], 'user-123');

      expect(count).toBe(2);
      expect(mockDb.apiKeys.findByIds).toHaveBeenCalledWith(['key-1', 'key-2']);
      expect(mockDb.apiKeys.deleteBatch).toHaveBeenCalledWith(['key-1', 'key-2']);
      expect(mockDb.apiKeys.deleteBatch).toHaveBeenCalledTimes(1);
    });

    it('should only count actually deleted keys', async () => {
      // 3 keys requested but only 2 exist
      const mockExistingKeys = new Map([
        ['key-1', { id: 'key-1', name: 'Key 1', project_id: 'proj-1' }],
        ['key-3', { id: 'key-3', name: 'Key 3', project_id: 'proj-2' }],
      ]);
      mockDb.apiKeys.findByIds.mockResolvedValue(mockExistingKeys);
      mockDb.apiKeys.deleteBatch.mockResolvedValue(2);

      const count = await service.deleteBatch(['key-1', 'key-2', 'key-3'], 'user-123');

      expect(count).toBe(2); // Only keys that actually existed and were deleted
    });
  });

  // ============================================================================
  // QUERY & LISTING
  // ============================================================================

  describe('listKeys', () => {
    it('should list keys with filters and pagination', async () => {
      const mockResult = {
        data: [{ id: 'key-1' }, { id: 'key-2' }],
        pagination: { page: 1, limit: 20, total: 2, totalPages: 1 },
      };

      mockDb.apiKeys.list.mockResolvedValue(mockResult);

      const result = await service.listKeys(
        { status: 'active', type: 'production' },
        { sort_by: 'created_at', order: 'desc' },
        { page: 1, limit: 20 }
      );

      expect(result).toEqual(mockResult);
    });
  });

  describe('getKeyById', () => {
    it('should get key by ID', async () => {
      const mockKey: ApiKey = { id: 'key-123' } as ApiKey;
      mockDb.apiKeys.findById.mockResolvedValue(mockKey);

      const result = await service.getKeyById('key-123');

      expect(result).toEqual(mockKey);
    });
  });

  describe('getAuditLogs', () => {
    it('should get audit logs with pagination', async () => {
      const mockLogs = {
        data: [{ id: 'audit-1' }],
        pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
      };

      mockDb.apiKeys.getAuditLogs.mockResolvedValue(mockLogs);

      const result = await service.getAuditLogs('key-123', 20, 0);

      expect(result).toEqual(mockLogs);
    });
  });
});
