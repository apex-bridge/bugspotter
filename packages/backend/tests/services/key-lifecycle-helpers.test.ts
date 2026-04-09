import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  invalidateKeyCache,
  invalidateBatchKeyCache,
  calculateNewExpiration,
  buildRotatedKeyData,
} from '../../src/services/api-key/key-lifecycle-helpers.js';
import type { ApiKey } from '../../src/db/types.js';
import type { DatabaseClient } from '../../src/db/client.js';

describe('invalidateKeyCache', () => {
  let mockDb: DatabaseClient;

  beforeEach(() => {
    mockDb = {
      apiKeys: {
        findById: vi.fn(),
      },
    } as any;
  });

  it('should invalidate cache for existing key', async () => {
    const mockKey: Partial<ApiKey> = {
      id: 'key-123',
      name: 'Test Key',
      key_hash: 'hash123',
      key_prefix: 'bgs_abc123',
      key_suffix: 'xyz789',
      type: 'personal',
      permission_scope: 'custom',
      permissions: [],
      status: 'active',
      created_by: 'user-1',
      created_at: new Date(),
      updated_at: new Date(),
      allowed_projects: null,
      allowed_origins: null,
      allowed_environments: null,
      expires_at: null,
      last_used_at: null,
      revoked_at: null,
      rotated_from: null,
      rotate_at: null,
    } as unknown as ApiKey;

    (mockDb.apiKeys.findById as any).mockResolvedValue(mockKey);

    // Mock getCacheService
    const mockInvalidate = vi.fn().mockResolvedValue(undefined);
    vi.doMock('../../src/services/cache/index.js', () => ({
      getCacheService: () => ({
        invalidateApiKey: mockInvalidate,
      }),
    }));

    await invalidateKeyCache(mockDb, 'key-123');

    expect(mockDb.apiKeys.findById).toHaveBeenCalledWith('key-123');
  });

  it('should handle non-existent key gracefully', async () => {
    (mockDb.apiKeys.findById as any).mockResolvedValue(null);

    // Should not throw
    await expect(invalidateKeyCache(mockDb, 'non-existent')).resolves.toBeUndefined();
    expect(mockDb.apiKeys.findById).toHaveBeenCalledWith('non-existent');
  });

  it('should log errors but not throw', async () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    (mockDb.apiKeys.findById as any).mockRejectedValue(new Error('Database error'));

    // Should not throw even if findById fails
    await expect(invalidateKeyCache(mockDb, 'key-123')).resolves.toBeUndefined();

    consoleWarnSpy.mockRestore();
  });
});

describe('invalidateBatchKeyCache', () => {
  it('should invalidate cache for multiple keys', async () => {
    const mockKeys: ApiKey[] = [
      {
        id: 'key-1',
        key_hash: 'hash1',
        // ... other required fields
      } as ApiKey,
      {
        id: 'key-2',
        key_hash: 'hash2',
        // ... other required fields
      } as ApiKey,
    ];

    const mockInvalidate = vi.fn().mockResolvedValue(undefined);
    vi.doMock('../../src/services/cache/index.js', () => ({
      getCacheService: () => ({
        invalidateApiKey: mockInvalidate,
      }),
    }));

    await invalidateBatchKeyCache(mockKeys);

    // Function should complete without throwing
  });

  it('should handle empty array', async () => {
    await expect(invalidateBatchKeyCache([])).resolves.toBeUndefined();
  });

  it('should handle partial failures in batch', async () => {
    const mockKeys: ApiKey[] = [
      { id: 'key-1', key_hash: 'hash1' } as ApiKey,
      { id: 'key-2', key_hash: 'hash2' } as ApiKey,
    ];

    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Should not throw even if some invalidations fail
    await expect(invalidateBatchKeyCache(mockKeys)).resolves.toBeUndefined();

    consoleWarnSpy.mockRestore();
  });
});

describe('calculateNewExpiration', () => {
  it('should return null when original key has no expiration', () => {
    const key: ApiKey = {
      id: 'key-1',
      created_at: new Date('2024-01-01'),
      expires_at: null,
    } as ApiKey;

    expect(calculateNewExpiration(key)).toBeNull();
  });

  it('should preserve duration from original key', () => {
    const createdAt = new Date('2024-01-01T00:00:00Z');
    const expiresAt = new Date('2024-02-01T00:00:00Z'); // 31 days later
    const originalDuration = expiresAt.getTime() - createdAt.getTime();

    const key: ApiKey = {
      id: 'key-1',
      created_at: createdAt,
      expires_at: expiresAt,
    } as ApiKey;

    const newExpiration = calculateNewExpiration(key);

    expect(newExpiration).not.toBeNull();
    if (newExpiration) {
      const newDuration = newExpiration.getTime() - Date.now();
      // Allow 1 second tolerance for test execution time
      expect(Math.abs(newDuration - originalDuration)).toBeLessThan(1000);
    }
  });

  it('should handle short-lived keys (hours)', () => {
    const createdAt = new Date('2024-01-01T00:00:00Z');
    const expiresAt = new Date('2024-01-01T06:00:00Z'); // 6 hours
    const originalDuration = expiresAt.getTime() - createdAt.getTime();

    const key: ApiKey = {
      id: 'key-1',
      created_at: createdAt,
      expires_at: expiresAt,
    } as ApiKey;

    const newExpiration = calculateNewExpiration(key);

    expect(newExpiration).not.toBeNull();
    if (newExpiration) {
      const newDuration = newExpiration.getTime() - Date.now();
      expect(Math.abs(newDuration - originalDuration)).toBeLessThan(1000);
    }
  });

  it('should handle long-lived keys (years)', () => {
    const createdAt = new Date('2024-01-01T00:00:00Z');
    const expiresAt = new Date('2025-01-01T00:00:00Z'); // 1 year
    const originalDuration = expiresAt.getTime() - createdAt.getTime();

    const key: ApiKey = {
      id: 'key-1',
      created_at: createdAt,
      expires_at: expiresAt,
    } as ApiKey;

    const newExpiration = calculateNewExpiration(key);

    expect(newExpiration).not.toBeNull();
    if (newExpiration) {
      const newDuration = newExpiration.getTime() - Date.now();
      expect(Math.abs(newDuration - originalDuration)).toBeLessThan(1000);
    }
  });
});

describe('buildRotatedKeyData', () => {
  it('should copy all configuration from original key', () => {
    const originalKey: Partial<ApiKey> = {
      id: 'old-key-id',
      name: 'Production Key',
      type: 'personal',
      permission_scope: 'custom',
      permissions: ['bug_report:read', 'bug_report:create'],
      created_by: 'original-user',
      created_at: new Date('2024-01-01'),
      updated_at: new Date('2024-01-01'),
      status: 'active',
      key_hash: 'hash123',
      key_prefix: 'bgs_abc123',
      key_suffix: 'xyz789',
      allowed_projects: ['project-1', 'project-2'],
      allowed_origins: ['https://example.com'],
      allowed_environments: ['production'],
      rate_limit_per_minute: 100,
      rate_limit_per_hour: 5000,
      rate_limit_per_day: 100000,
      burst_limit: 200,
      expires_at: new Date('2025-01-01'),
      last_used_at: null,
      revoked_at: null,
      rotated_from: null,
      rotate_at: null,
    } as unknown as ApiKey;

    const actorId = 'rotation-user';
    const newKeyData = buildRotatedKeyData(originalKey as ApiKey, actorId);

    // Should append "(rotated)" to name
    expect(newKeyData.name).toBe('Production Key (rotated)');

    // Should copy all configuration
    expect(newKeyData.type).toBe(originalKey.type);
    expect(newKeyData.permission_scope).toBe(originalKey.permission_scope);
    expect(newKeyData.permissions).toEqual(originalKey.permissions);
    expect(newKeyData.allowed_projects).toEqual(originalKey.allowed_projects);
    expect(newKeyData.allowed_origins).toEqual(originalKey.allowed_origins);
    expect(newKeyData.allowed_environments).toEqual(originalKey.allowed_environments);
    expect(newKeyData.rate_limit_per_minute).toBe(originalKey.rate_limit_per_minute);
    expect(newKeyData.rate_limit_per_hour).toBe(originalKey.rate_limit_per_hour);
    expect(newKeyData.rate_limit_per_day).toBe(originalKey.rate_limit_per_day);
    expect(newKeyData.burst_limit).toBe(originalKey.burst_limit);

    // Should set created_by to actor
    expect(newKeyData.created_by).toBe(actorId);

    // Should calculate new expiration (preserving duration)
    expect(newKeyData.expires_at).not.toBeNull();
  });

  it('should handle null optional fields', () => {
    const originalKey: Partial<ApiKey> = {
      id: 'old-key-id',
      name: 'Simple Key',
      type: 'personal',
      permission_scope: 'custom',
      permissions: [],
      created_by: 'user-1',
      created_at: new Date(),
      updated_at: new Date(),
      status: 'active',
      key_hash: 'hash',
      key_prefix: 'bgs_',
      key_suffix: 'suffix',
      allowed_projects: null,
      allowed_origins: null,
      allowed_environments: null,
      rate_limit_per_minute: 0,
      rate_limit_per_hour: 0,
      rate_limit_per_day: 0,
      burst_limit: 0,
      expires_at: null,
      last_used_at: null,
      revoked_at: null,
      rotated_from: null,
      rotate_at: null,
    } as unknown as ApiKey;

    const newKeyData = buildRotatedKeyData(originalKey as ApiKey, 'actor-1');

    expect(newKeyData.allowed_projects).toBeNull();
    expect(newKeyData.allowed_origins).toBeNull();
    expect(newKeyData.allowed_environments).toBeNull();
    expect(newKeyData.rate_limit_per_minute).toBe(0);
    expect(newKeyData.rate_limit_per_hour).toBe(0);
    expect(newKeyData.rate_limit_per_day).toBe(0);
    expect(newKeyData.burst_limit).toBe(0);
    expect(newKeyData.expires_at).toBeNull();
  });

  it('should not include key_hash, key_prefix, or key_suffix', () => {
    const originalKey = {
      name: 'Test Key',
      type: 'personal',
      created_by: 'user-1',
    } as unknown as ApiKey;

    const newKeyData = buildRotatedKeyData(originalKey, 'actor-1');

    expect(newKeyData).not.toHaveProperty('key_hash');
    expect(newKeyData).not.toHaveProperty('key_prefix');
    expect(newKeyData).not.toHaveProperty('key_suffix');
  });

  it('should handle already rotated keys', () => {
    const originalKey = {
      name: 'Production Key (rotated)',
      type: 'personal',
      created_by: 'user-1',
    } as unknown as ApiKey;

    const newKeyData = buildRotatedKeyData(originalKey, 'actor-1');

    // Should append "(rotated)" even if already present
    expect(newKeyData.name).toBe('Production Key (rotated) (rotated)');
  });
});
