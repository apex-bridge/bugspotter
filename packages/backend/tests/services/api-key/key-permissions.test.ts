/**
 * API Key Permission Tests
 * Tests for permission validation and access control
 */

import { describe, it, expect } from 'vitest';
import {
  isExpired,
  isInGracePeriod,
  isKeyUsable,
  checkPermission,
  checkProjectPermission,
  resolvePermissions,
  SCOPE_PERMISSIONS,
} from '../../../src/services/api-key/key-permissions.js';
import type { ApiKey } from '../../../src/db/types.js';
import { PERMISSION_SCOPE } from '../../../src/db/types.js';

/**
 * Helper to create complete ApiKey objects with defaults
 */
function createApiKey(overrides: Partial<ApiKey> = {}): ApiKey {
  return {
    id: 'key-1',
    name: 'Test Key',
    key_hash: 'hash',
    key_prefix: 'bgs_',
    key_suffix: 'abc',
    description: null,
    type: 'production',
    status: 'active',
    permission_scope: PERMISSION_SCOPE.FULL,
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

describe('key-permissions', () => {
  // ============================================================================
  // EXPIRATION CHECKING
  // ============================================================================

  describe('isExpired', () => {
    it('should return false for key without expiry', () => {
      const key = createApiKey();
      expect(isExpired(key)).toBe(false);
    });

    it('should return false for future expiry', () => {
      const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000); // Tomorrow
      const key = createApiKey({
        expires_at: futureDate,
      });

      expect(isExpired(key)).toBe(false);
    });

    it('should return true for past expiry', () => {
      const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000); // Yesterday
      const key = createApiKey({
        status: 'expired',
        expires_at: pastDate,
      });

      expect(isExpired(key)).toBe(true);
    });

    it('should return true for expiry 1 second ago', () => {
      const oneSecondAgo = new Date(Date.now() - 1000);
      const key = createApiKey({
        status: 'expired',
        expires_at: oneSecondAgo,
      });

      const expired = isExpired(key);
      expect(expired).toBe(true);
    });
  });

  // ============================================================================
  // GRACE PERIOD CHECKING
  // ============================================================================

  describe('isInGracePeriod', () => {
    const gracePeriod = 24 * 60 * 60 * 1000; // 24 hours

    it('should return true for recently rotated expired key', () => {
      const recentTime = new Date(Date.now() - 60 * 1000); // 1 minute ago
      const key = createApiKey({
        status: 'expired',
        expires_at: new Date(Date.now() - 1000),
        revoked_at: recentTime,
        rotate_at: recentTime,
      });

      expect(isInGracePeriod(key, gracePeriod)).toBe(true);
    });

    it('should return false for old rotated expired key', () => {
      const oldTime = new Date(Date.now() - 48 * 60 * 60 * 1000); // 48 hours ago
      const key = createApiKey({
        status: 'expired',
        expires_at: new Date(Date.now() - 1000),
        revoked_at: oldTime,
        rotate_at: oldTime,
      });

      expect(isInGracePeriod(key, gracePeriod)).toBe(false);
    });

    it('should return false for non-expired key', () => {
      const key = createApiKey();
      expect(isInGracePeriod(key, gracePeriod)).toBe(false);
    });

    it('should return false for expired key without rotate_at', () => {
      const key = createApiKey({
        status: 'expired',
        expires_at: new Date(Date.now() - 1000),
        revoked_at: new Date(),
        rotate_at: null,
      });

      expect(isInGracePeriod(key, gracePeriod)).toBe(false);
    });

    it('should return false for expired key without revoked_at', () => {
      const key = createApiKey({
        status: 'expired',
        expires_at: new Date(Date.now() - 1000),
        revoked_at: null,
        rotate_at: new Date(),
      });

      expect(isInGracePeriod(key, gracePeriod)).toBe(false);
    });

    it('should return false for expired key without both rotate_at and revoked_at', () => {
      const key = createApiKey({
        status: 'expired',
        expires_at: new Date(Date.now() - 1000),
        revoked_at: null,
        rotate_at: null,
      });

      expect(isInGracePeriod(key, gracePeriod)).toBe(false);
    });

    it('should return false for expired key with rotate_at but revoked recently (edge case)', () => {
      // Edge case: Key has rotate_at scheduled but was manually expired before rotation
      const key = createApiKey({
        status: 'expired',
        expires_at: new Date(Date.now() - 1000),
        revoked_at: new Date(), // Recently revoked
        rotate_at: new Date(Date.now() + 24 * 60 * 60 * 1000), // Rotation scheduled for future
      });

      // Should still be in grace period because it has both rotate_at and revoked_at
      expect(isInGracePeriod(key, gracePeriod)).toBe(true);
    });
  });

  // ============================================================================
  // KEY USABILITY
  // ============================================================================

  describe('isKeyUsable', () => {
    const gracePeriod = 24 * 60 * 60 * 1000;

    it('should return true for active key', () => {
      const key = createApiKey();
      expect(isKeyUsable(key, gracePeriod)).toBe(true);
    });

    it('should return true for expiring key', () => {
      const key = createApiKey({
        status: 'expiring',
        expires_at: new Date(Date.now() + 1000),
      });

      expect(isKeyUsable(key, gracePeriod)).toBe(true);
    });

    it('should return false for expired key outside grace period', () => {
      const oldTime = new Date(Date.now() - 48 * 60 * 60 * 1000);
      const key = createApiKey({
        status: 'expired',
        expires_at: oldTime,
      });

      expect(isKeyUsable(key, gracePeriod)).toBe(false);
    });

    it('should return true for rotated key in grace period (not time-expired)', () => {
      const recentTime = new Date(Date.now() - 60 * 1000); // 1 minute ago
      const key = createApiKey({
        status: 'expired',
        created_at: new Date(Date.now() - 48 * 60 * 60 * 1000), // 48 hours ago
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // Still valid for 30 days
        revoked_at: recentTime, // Revoked 1 minute ago (rotation)
        rotate_at: recentTime, // Rotated 1 minute ago
      });

      // Key status is 'expired' due to rotation, but not time-expired
      expect(isExpired(key)).toBe(false); // Not time-expired
      expect(isInGracePeriod(key, gracePeriod)).toBe(true); // In grace period
      expect(isKeyUsable(key, gracePeriod)).toBe(true); // Usable!
    });
  });

  // ============================================================================
  // RESOLVE PERMISSIONS
  // ============================================================================

  describe('resolvePermissions', () => {
    it('should resolve full scope to wildcard', () => {
      expect(resolvePermissions('full')).toEqual(['*']);
    });

    it('should resolve read scope to read permissions', () => {
      expect(resolvePermissions('read')).toEqual(['reports:read', 'sessions:read']);
    });

    it('should resolve write scope to read + write permissions', () => {
      expect(resolvePermissions('write')).toEqual([
        'reports:read',
        'reports:write',
        'sessions:read',
        'sessions:write',
      ]);
    });

    it('should resolve custom scope with provided permissions', () => {
      expect(resolvePermissions('custom', ['reports:read', 'sessions:write'])).toEqual([
        'reports:read',
        'sessions:write',
      ]);
    });

    it('should resolve custom scope to empty array when no permissions provided', () => {
      expect(resolvePermissions('custom')).toEqual([]);
      expect(resolvePermissions('custom', undefined)).toEqual([]);
    });

    it('should ignore customPermissions for non-custom scopes', () => {
      // Non-custom scopes always return their mapped permissions
      expect(resolvePermissions('full', ['reports:read'])).toEqual(['*']);
      expect(resolvePermissions('read', ['reports:write'])).toEqual([
        'reports:read',
        'sessions:read',
      ]);
    });
  });

  // ============================================================================
  // SCOPE_PERMISSIONS MAPPING
  // ============================================================================

  describe('SCOPE_PERMISSIONS', () => {
    it('should have entries for all 4 scopes', () => {
      expect(Object.keys(SCOPE_PERMISSIONS)).toEqual(['full', 'read', 'write', 'custom']);
    });

    it('should map full to wildcard', () => {
      expect(SCOPE_PERMISSIONS.full).toEqual(['*']);
    });

    it('should map read to read-only permissions', () => {
      for (const perm of SCOPE_PERMISSIONS.read) {
        expect(perm).toMatch(/:read$/);
      }
    });

    it('should map write to include both read and write permissions', () => {
      const readPerms = SCOPE_PERMISSIONS.write.filter((p) => p.endsWith(':read'));
      const writePerms = SCOPE_PERMISSIONS.write.filter((p) => p.endsWith(':write'));
      expect(readPerms.length).toBeGreaterThan(0);
      expect(writePerms.length).toBeGreaterThan(0);
    });

    it('should map custom to empty array', () => {
      expect(SCOPE_PERMISSIONS.custom).toEqual([]);
    });
  });

  // ============================================================================
  // PERMISSION CHECKING (array-based)
  // ============================================================================

  describe('checkPermission', () => {
    it('should allow wildcard key for any permission', () => {
      const key = createApiKey({ permissions: ['*'] });

      expect(checkPermission(key, 'reports:read')).toEqual({ allowed: true });
      expect(checkPermission(key, 'reports:write')).toEqual({ allowed: true });
      expect(checkPermission(key, 'anything:here')).toEqual({ allowed: true });
    });

    it('should allow specific permission in array', () => {
      const key = createApiKey({ permissions: ['reports:read', 'reports:write'] });

      expect(checkPermission(key, 'reports:read')).toEqual({ allowed: true });
      expect(checkPermission(key, 'reports:write')).toEqual({ allowed: true });
    });

    it('should deny permission not in array', () => {
      const key = createApiKey({ permissions: ['reports:read'] });

      const result = checkPermission(key, 'reports:write');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Missing permission: reports:write');
    });

    it('should deny all permissions for empty array', () => {
      const key = createApiKey({ permissions: [] });

      expect(checkPermission(key, 'reports:read').allowed).toBe(false);
      expect(checkPermission(key, 'reports:write').allowed).toBe(false);
    });

    it('should include key permissions in denial reason', () => {
      const key = createApiKey({ permissions: ['reports:read', 'sessions:read'] });

      const result = checkPermission(key, 'reports:write');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('reports:read');
      expect(result.reason).toContain('sessions:read');
    });
  });

  // ============================================================================
  // SCOPE ACCESS MATRIX (using resolved permissions)
  // ============================================================================

  describe('scope access matrix', () => {
    const RESOURCES = ['reports', 'sessions'] as const;
    const ACTIONS = ['read', 'write'] as const;

    describe('full scope — wildcard allows everything', () => {
      const key = createApiKey({ permissions: resolvePermissions('full') });

      for (const resource of RESOURCES) {
        for (const action of ACTIONS) {
          it(`should allow ${resource}:${action}`, () => {
            expect(checkPermission(key, `${resource}:${action}`)).toEqual({ allowed: true });
          });
        }
      }
    });

    describe('read scope — allows only :read', () => {
      const key = createApiKey({ permissions: resolvePermissions('read') });

      for (const resource of RESOURCES) {
        it(`should allow ${resource}:read`, () => {
          expect(checkPermission(key, `${resource}:read`)).toEqual({ allowed: true });
        });

        it(`should deny ${resource}:write`, () => {
          expect(checkPermission(key, `${resource}:write`).allowed).toBe(false);
        });
      }
    });

    describe('write scope — allows :read and :write', () => {
      const key = createApiKey({ permissions: resolvePermissions('write') });

      for (const resource of RESOURCES) {
        it(`should allow ${resource}:write`, () => {
          expect(checkPermission(key, `${resource}:write`)).toEqual({ allowed: true });
        });

        it(`should allow ${resource}:read (write implies read)`, () => {
          expect(checkPermission(key, `${resource}:read`)).toEqual({ allowed: true });
        });
      }
    });

    describe('custom scope — allows only explicit permissions', () => {
      it('should allow only listed permissions and deny everything else', () => {
        const key = createApiKey({
          permissions: resolvePermissions('custom', ['reports:write', 'sessions:read']),
        });

        expect(checkPermission(key, 'reports:write')).toEqual({ allowed: true });
        expect(checkPermission(key, 'sessions:read')).toEqual({ allowed: true });
        expect(checkPermission(key, 'reports:read').allowed).toBe(false);
        expect(checkPermission(key, 'sessions:write').allowed).toBe(false);
      });

      it.each([
        'reports:read',
        'reports:write',
        'reports:update',
        'reports:delete',
        'sessions:read',
        'sessions:write',
      ])('should allow single permission "%s" and deny others', (permission) => {
        const key = createApiKey({
          permissions: resolvePermissions('custom', [permission]),
        });

        expect(checkPermission(key, permission)).toEqual({ allowed: true });

        const other = permission === 'reports:read' ? 'reports:write' : 'reports:read';
        expect(checkPermission(key, other).allowed).toBe(false);
      });
    });
  });

  // ============================================================================
  // PROJECT PERMISSION CHECKING
  // ============================================================================

  describe('checkProjectPermission', () => {
    it('should allow all projects when no restrictions', () => {
      const key = createApiKey();

      expect(checkProjectPermission(key, 'project-1')).toEqual({ allowed: true });
      expect(checkProjectPermission(key, 'project-2')).toEqual({ allowed: true });
    });

    it('should allow all projects when empty array', () => {
      const key = createApiKey({
        allowed_projects: [],
      });

      expect(checkProjectPermission(key, 'project-1')).toEqual({ allowed: true });
    });

    it('should allow project in allowed list', () => {
      const key = createApiKey({
        allowed_projects: ['project-1', 'project-2'],
      });

      expect(checkProjectPermission(key, 'project-1')).toEqual({ allowed: true });
      expect(checkProjectPermission(key, 'project-2')).toEqual({ allowed: true });
    });

    it('should deny project not in allowed list', () => {
      const key = createApiKey({
        allowed_projects: ['project-1', 'project-2'],
      });

      const result = checkProjectPermission(key, 'project-3');
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('Access denied. Allowed projects: project-1, project-2');
    });

    it('should provide detailed error message with allowed projects', () => {
      const key = createApiKey({
        allowed_projects: ['proj-a', 'proj-b', 'proj-c'],
      });

      const result = checkProjectPermission(key, 'proj-x');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('proj-a');
      expect(result.reason).toContain('proj-b');
      expect(result.reason).toContain('proj-c');
    });
  });
});
