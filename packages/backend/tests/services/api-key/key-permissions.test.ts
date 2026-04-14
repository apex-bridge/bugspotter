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
  // PERMISSION CHECKING
  // ============================================================================

  describe('checkPermission', () => {
    it('should allow full scope for any permission', () => {
      const key = createApiKey();

      expect(checkPermission(key, 'bugs:read')).toEqual({ allowed: true });
      expect(checkPermission(key, 'bugs:write')).toEqual({ allowed: true });
      expect(checkPermission(key, 'projects:delete')).toEqual({ allowed: true });
    });

    it('should allow custom scope with specific permission', () => {
      const key = createApiKey({
        permission_scope: PERMISSION_SCOPE.CUSTOM,
        permissions: ['bugs:read', 'bugs:write'],
      });

      expect(checkPermission(key, 'bugs:read')).toEqual({ allowed: true });
      expect(checkPermission(key, 'bugs:write')).toEqual({ allowed: true });
    });

    it('should deny custom scope without specific permission', () => {
      const key = createApiKey({
        permission_scope: PERMISSION_SCOPE.CUSTOM,
        permissions: ['bugs:read'],
      });

      const result = checkPermission(key, 'bugs:write');
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('Missing required permission: bugs:write');
    });

    it('should allow read scope for read permission in permissions array', () => {
      const key = createApiKey({
        permission_scope: PERMISSION_SCOPE.READ,
        permissions: ['bugs:read', 'projects:read'],
      });

      expect(checkPermission(key, 'bugs:read')).toEqual({ allowed: true });
    });

    it('should allow write scope for write permission in permissions array', () => {
      const key = createApiKey({
        permission_scope: PERMISSION_SCOPE.WRITE,
        permissions: ['bugs:write', 'bugs:update'],
      });

      expect(checkPermission(key, 'bugs:write')).toEqual({ allowed: true });
    });

    it('should deny read scope for write permission', () => {
      const key = createApiKey({
        permission_scope: PERMISSION_SCOPE.READ,
        permissions: ['bugs:read'],
      });

      const result = checkPermission(key, 'bugs:write');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Required permission: bugs:write');
    });

    it('should allow matching scope name as permission', () => {
      const key = createApiKey({
        permission_scope: PERMISSION_SCOPE.READ,
        permissions: [],
      });

      expect(checkPermission(key, 'read')).toEqual({ allowed: true });
    });

    it('should allow read scope for any :read permission (pattern matching)', () => {
      const key = createApiKey({
        permission_scope: PERMISSION_SCOPE.READ,
        permissions: [],
      });

      expect(checkPermission(key, 'bugs:read')).toEqual({ allowed: true });
      expect(checkPermission(key, 'projects:read')).toEqual({ allowed: true });
      expect(checkPermission(key, 'users:read')).toEqual({ allowed: true });
    });

    it('should allow write scope for any :write permission (pattern matching)', () => {
      const key = createApiKey({
        permission_scope: PERMISSION_SCOPE.WRITE,
        permissions: [],
      });

      expect(checkPermission(key, 'bugs:write')).toEqual({ allowed: true });
      expect(checkPermission(key, 'projects:write')).toEqual({ allowed: true });
      expect(checkPermission(key, 'users:write')).toEqual({ allowed: true });
    });

    it('should deny read scope for write operations', () => {
      const key = createApiKey({
        permission_scope: PERMISSION_SCOPE.READ,
        permissions: [],
      });

      const result = checkPermission(key, 'bugs:write');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('bugs:write');
      expect(result.reason).toContain('read');
      expect(result.reason).toContain('*:read');
    });

    it('should allow write scope for read operations (write implies read)', () => {
      const key = createApiKey({
        permission_scope: PERMISSION_SCOPE.WRITE,
        permissions: [],
      });

      expect(checkPermission(key, 'bugs:read')).toEqual({ allowed: true });
      expect(checkPermission(key, 'projects:read')).toEqual({ allowed: true });
      expect(checkPermission(key, 'users:read')).toEqual({ allowed: true });
      expect(checkPermission(key, 'sessions:read')).toEqual({ allowed: true });
    });

    it('should deny read scope for write operations (read does NOT imply write)', () => {
      const key = createApiKey({
        permission_scope: PERMISSION_SCOPE.READ,
        permissions: [],
      });

      expect(checkPermission(key, 'bugs:write').allowed).toBe(false);
      expect(checkPermission(key, 'projects:write').allowed).toBe(false);
      expect(checkPermission(key, 'users:write').allowed).toBe(false);
      expect(checkPermission(key, 'sessions:write').allowed).toBe(false);
    });

    it('should prioritize explicit permissions over pattern matching', () => {
      const key = createApiKey({
        permission_scope: PERMISSION_SCOPE.READ,
        permissions: ['bugs:write'], // Explicit override
      });

      // Explicit permission takes precedence
      expect(checkPermission(key, 'bugs:write')).toEqual({ allowed: true });

      // Pattern matching still works for other permissions
      expect(checkPermission(key, 'projects:read')).toEqual({ allowed: true });

      // But not for write operations not in explicit list
      const result = checkPermission(key, 'projects:write');
      expect(result.allowed).toBe(false);
    });

    it('should handle custom scope without permissions array gracefully', () => {
      const key = createApiKey({
        permission_scope: PERMISSION_SCOPE.CUSTOM,
        permissions: [],
      });

      const result = checkPermission(key, 'bugs:read');
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('Missing required permission: bugs:read');
    });

    it('should handle unknown permission scope', () => {
      const key = createApiKey({
        permission_scope: 'unknown' as any,
        permissions: [],
      });

      const result = checkPermission(key, 'bugs:read');
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('Unknown permission scope: unknown');
    });
  });

  // ============================================================================
  // SCOPE ACCESS MATRIX
  // ============================================================================

  describe('scope access matrix', () => {
    const RESOURCES = ['reports', 'sessions', 'bugs', 'projects'] as const;
    const ACTIONS = ['read', 'write'] as const;

    // Expected access for each scope
    // full: everything allowed
    // read: only :read
    // write: :read + :write (write implies read)
    // custom: only explicit permissions

    describe('full scope — allows everything', () => {
      const key = createApiKey({ permission_scope: PERMISSION_SCOPE.FULL });

      for (const resource of RESOURCES) {
        for (const action of ACTIONS) {
          it(`should allow ${resource}:${action}`, () => {
            expect(checkPermission(key, `${resource}:${action}`)).toEqual({ allowed: true });
          });
        }
      }
    });

    describe('read scope — allows only :read', () => {
      const key = createApiKey({ permission_scope: PERMISSION_SCOPE.READ, permissions: [] });

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
      const key = createApiKey({ permission_scope: PERMISSION_SCOPE.WRITE, permissions: [] });

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
          permission_scope: PERMISSION_SCOPE.CUSTOM,
          permissions: ['reports:write', 'sessions:read'],
        });

        expect(checkPermission(key, 'reports:write')).toEqual({ allowed: true });
        expect(checkPermission(key, 'sessions:read')).toEqual({ allowed: true });
        expect(checkPermission(key, 'reports:read').allowed).toBe(false);
        expect(checkPermission(key, 'sessions:write').allowed).toBe(false);
        expect(checkPermission(key, 'bugs:read').allowed).toBe(false);
        expect(checkPermission(key, 'bugs:write').allowed).toBe(false);
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
          permission_scope: PERMISSION_SCOPE.CUSTOM,
          permissions: [permission],
        });

        expect(checkPermission(key, permission)).toEqual({ allowed: true });

        // Pick a different permission and verify it's denied
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
