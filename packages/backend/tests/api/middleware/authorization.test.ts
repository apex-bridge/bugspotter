/**
 * Authorization Middleware Tests
 * Unit tests for authorization middleware functions
 */

import { describe, it, expect, vi } from 'vitest';
import type { FastifyRequest, FastifyReply } from 'fastify';
import {
  requireRole,
  requireProject,
  requireUser,
  requireApiKey,
  requireAuth,
  requireApiKeyPermission,
} from '../../../src/api/middleware/auth/authorization.js';

// Mock response helpers
vi.mock('../../../src/api/middleware/auth/responses.js', () => ({
  sendUnauthorized: vi.fn((reply, message) => {
    reply.code(401);
    return reply.send({
      statusCode: 401,
      error: 'Unauthorized',
      message,
    });
  }),
  sendForbidden: vi.fn((reply, message) => {
    reply.code(403);
    return reply.send({
      statusCode: 403,
      error: 'Forbidden',
      message,
    });
  }),
}));

// Helper to create mock request
function createMockRequest(overrides: Partial<FastifyRequest> = {}): FastifyRequest {
  return {
    authUser: undefined,
    authProject: undefined,
    apiKey: undefined,
    ...overrides,
  } as FastifyRequest;
}

// Helper to create mock reply
function createMockReply(): FastifyReply {
  const reply = {
    code: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
  };
  return reply as unknown as FastifyReply;
}

describe('Authorization Middleware', () => {
  describe('requireRole', () => {
    it('should allow authenticated user with matching role', async () => {
      const request = createMockRequest({
        authUser: { id: 'user-123', email: 'user@example.com', role: 'admin' },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      const reply = createMockReply();

      const middleware = requireRole('admin');
      await middleware(request, reply);

      expect(reply.code).not.toHaveBeenCalled();
      expect(reply.send).not.toHaveBeenCalled();
    });

    it('should allow authenticated user with any of multiple allowed roles', async () => {
      const request = createMockRequest({
        authUser: { id: 'user-123', email: 'user@example.com', role: 'user' },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      const reply = createMockReply();

      const middleware = requireRole('admin', 'user');
      await middleware(request, reply);

      expect(reply.code).not.toHaveBeenCalled();
      expect(reply.send).not.toHaveBeenCalled();
    });

    it('should reject user without authentication', async () => {
      const request = createMockRequest();
      const reply = createMockReply();

      const middleware = requireRole('admin');
      await middleware(request, reply);

      expect(reply.code).toHaveBeenCalledWith(401);
      expect(reply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Unauthorized',
          message: 'User authentication required',
        })
      );
    });

    it('should reject user with insufficient role', async () => {
      const request = createMockRequest({
        authUser: { id: 'user-123', email: 'user@example.com', role: 'viewer' },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      const reply = createMockReply();

      const middleware = requireRole('admin');
      await middleware(request, reply);

      expect(reply.code).toHaveBeenCalledWith(403);
      expect(reply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Forbidden',
          message: 'Insufficient permissions. Required role: admin',
        })
      );
    });

    it('should show multiple roles in error message', async () => {
      const request = createMockRequest({
        authUser: { id: 'user-123', email: 'user@example.com', role: 'viewer' },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      const reply = createMockReply();

      const middleware = requireRole('admin', 'user');
      await middleware(request, reply);

      expect(reply.code).toHaveBeenCalledWith(403);
      expect(reply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Insufficient permissions. Required role: admin or user',
        })
      );
    });
  });

  describe('requireProject', () => {
    it('should allow legacy project authentication', async () => {
      const request = createMockRequest({
        authProject: { id: 'project-123', name: 'Test Project' },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      const reply = createMockReply();

      await requireProject(request, reply);

      expect(reply.code).not.toHaveBeenCalled();
      expect(reply.send).not.toHaveBeenCalled();
    });

    it('should allow new API key with allowed_projects', async () => {
      const request = createMockRequest({
        apiKey: {
          id: 'key-123',
          allowed_projects: ['project-456'],
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      const reply = createMockReply();

      await requireProject(request, reply);

      expect(reply.code).not.toHaveBeenCalled();
      expect(reply.send).not.toHaveBeenCalled();
    });

    it('should reject API key without allowed_projects', async () => {
      const request = createMockRequest({
        apiKey: {
          id: 'key-123',
          allowed_projects: [],
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      const reply = createMockReply();

      await requireProject(request, reply);

      expect(reply.code).toHaveBeenCalledWith(401);
      expect(reply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Project API key required (X-API-Key header)',
        })
      );
    });

    it('should reject request without API key or project auth', async () => {
      const request = createMockRequest();
      const reply = createMockReply();

      await requireProject(request, reply);

      expect(reply.code).toHaveBeenCalledWith(401);
      expect(reply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Project API key required (X-API-Key header)',
        })
      );
    });

    it('should reject API key with null allowed_projects', async () => {
      const request = createMockRequest({
        apiKey: {
          id: 'key-123',
          allowed_projects: null,
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      const reply = createMockReply();

      await requireProject(request, reply);

      expect(reply.code).toHaveBeenCalledWith(401);
    });

    it('should reject API key with undefined allowed_projects', async () => {
      const request = createMockRequest({
        apiKey: {
          id: 'key-123',
          allowed_projects: undefined,
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      const reply = createMockReply();

      await requireProject(request, reply);

      expect(reply.code).toHaveBeenCalledWith(401);
    });
  });

  describe('requireUser', () => {
    it('should allow authenticated user', async () => {
      const request = createMockRequest({
        authUser: { id: 'user-123', email: 'user@example.com', role: 'user' },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      const reply = createMockReply();

      await requireUser(request, reply);

      expect(reply.code).not.toHaveBeenCalled();
      expect(reply.send).not.toHaveBeenCalled();
    });

    it('should reject request without user authentication', async () => {
      const request = createMockRequest();
      const reply = createMockReply();

      await requireUser(request, reply);

      expect(reply.code).toHaveBeenCalledWith(401);
      expect(reply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'User authentication required (Authorization Bearer token)',
        })
      );
    });

    it('should reject even if API key is present', async () => {
      const request = createMockRequest({
        apiKey: { id: 'key-123', allowed_projects: ['project-456'] },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      const reply = createMockReply();

      await requireUser(request, reply);

      expect(reply.code).toHaveBeenCalledWith(401);
    });
  });

  describe('requireApiKey', () => {
    it('should allow authenticated API key', async () => {
      const request = createMockRequest({
        apiKey: { id: 'key-123', allowed_projects: ['project-456'] },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      const reply = createMockReply();

      await requireApiKey(request, reply);

      expect(reply.code).not.toHaveBeenCalled();
      expect(reply.send).not.toHaveBeenCalled();
    });

    it('should allow API key without allowed_projects', async () => {
      const request = createMockRequest({
        apiKey: { id: 'key-123', allowed_projects: [] },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      const reply = createMockReply();

      await requireApiKey(request, reply);

      expect(reply.code).not.toHaveBeenCalled();
      expect(reply.send).not.toHaveBeenCalled();
    });

    it('should reject request without API key', async () => {
      const request = createMockRequest();
      const reply = createMockReply();

      await requireApiKey(request, reply);

      expect(reply.code).toHaveBeenCalledWith(401);
      expect(reply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'API key required (X-API-Key header)',
        })
      );
    });

    it('should reject even if user JWT is present', async () => {
      const request = createMockRequest({
        authUser: { id: 'user-123', email: 'user@example.com', role: 'admin' },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      const reply = createMockReply();

      await requireApiKey(request, reply);

      expect(reply.code).toHaveBeenCalledWith(401);
    });
  });

  describe('requireAuth', () => {
    it('should allow legacy project authentication', async () => {
      const request = createMockRequest({
        authProject: { id: 'project-123', name: 'Test Project' },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      const reply = createMockReply();

      await requireAuth(request, reply);

      expect(reply.code).not.toHaveBeenCalled();
      expect(reply.send).not.toHaveBeenCalled();
    });

    it('should allow API key with allowed_projects', async () => {
      const request = createMockRequest({
        apiKey: {
          id: 'key-123',
          allowed_projects: ['project-456'],
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      const reply = createMockReply();

      await requireAuth(request, reply);

      expect(reply.code).not.toHaveBeenCalled();
      expect(reply.send).not.toHaveBeenCalled();
    });

    it('should allow JWT user authentication', async () => {
      const request = createMockRequest({
        authUser: { id: 'user-123', email: 'user@example.com', role: 'user' },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      const reply = createMockReply();

      await requireAuth(request, reply);

      expect(reply.code).not.toHaveBeenCalled();
      expect(reply.send).not.toHaveBeenCalled();
    });

    it('should prioritize authProject over apiKey', async () => {
      const request = createMockRequest({
        authProject: { id: 'project-123', name: 'Test Project' },
        apiKey: { id: 'key-123', allowed_projects: ['project-456'] },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      const reply = createMockReply();

      await requireAuth(request, reply);

      expect(reply.code).not.toHaveBeenCalled();
      expect(reply.send).not.toHaveBeenCalled();
    });

    it('should prioritize authProject over authUser', async () => {
      const request = createMockRequest({
        authProject: { id: 'project-123', name: 'Test Project' },
        authUser: { id: 'user-123', email: 'user@example.com', role: 'user' },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      const reply = createMockReply();

      await requireAuth(request, reply);

      expect(reply.code).not.toHaveBeenCalled();
      expect(reply.send).not.toHaveBeenCalled();
    });

    it('should prioritize apiKey over authUser when both present', async () => {
      const request = createMockRequest({
        apiKey: { id: 'key-123', allowed_projects: ['project-456'] },
        authUser: { id: 'user-123', email: 'user@example.com', role: 'user' },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      const reply = createMockReply();

      await requireAuth(request, reply);

      expect(reply.code).not.toHaveBeenCalled();
      expect(reply.send).not.toHaveBeenCalled();
    });

    it('should allow full-scope API key (empty allowed_projects)', async () => {
      const request = createMockRequest({
        apiKey: { id: 'key-123', allowed_projects: [] },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      const reply = createMockReply();

      await requireAuth(request, reply);

      expect(reply.code).not.toHaveBeenCalled();
      expect(reply.send).not.toHaveBeenCalled();
    });

    it('should reject request with no authentication', async () => {
      const request = createMockRequest();
      const reply = createMockReply();

      await requireAuth(request, reply);

      expect(reply.code).toHaveBeenCalledWith(401);
      expect(reply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Unauthorized',
          message: 'Authentication required (X-API-Key header or Authorization Bearer token)',
        })
      );
    });

    it('should allow full-scope API key (null allowed_projects)', async () => {
      const request = createMockRequest({
        apiKey: { id: 'key-123', allowed_projects: null },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      const reply = createMockReply();

      await requireAuth(request, reply);

      expect(reply.code).not.toHaveBeenCalled();
      expect(reply.send).not.toHaveBeenCalled();
    });

    it('should allow full-scope API key (undefined allowed_projects)', async () => {
      const request = createMockRequest({
        apiKey: { id: 'key-123', allowed_projects: undefined },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      const reply = createMockReply();

      await requireAuth(request, reply);

      expect(reply.code).not.toHaveBeenCalled();
      expect(reply.send).not.toHaveBeenCalled();
    });

    it('should allow authentication when both full-scope API key and authUser are present', async () => {
      const request = createMockRequest({
        apiKey: { id: 'key-123', allowed_projects: [] },
        authUser: { id: 'user-123', email: 'user@example.com', role: 'user' },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      const reply = createMockReply();

      await requireAuth(request, reply);

      expect(reply.code).not.toHaveBeenCalled();
      expect(reply.send).not.toHaveBeenCalled();
    });
  });

  // ============================================================================
  // requireApiKeyPermission
  // ============================================================================
  //
  // BACKGROUND: prior to this fix, an API key's `permissions` array was stored
  // but never consulted by any route middleware. The comment at
  // `requirePermission` in authorization.ts explicitly bypasses API keys,
  // saying "their access is validated by requireProjectAccess" — but
  // `requireProjectAccess` only checks `allowed_projects`, not per-action
  // permissions. Verified in prod 2026-04-20: a signup-issued key with
  // `permissions: ['reports:write', 'sessions:write']` could GET
  // `/api/v1/reports` and receive 200. See PR that introduces this middleware.
  //
  // These tests pin down the new behavior: the key's declared permissions
  // gate access to the route that declares a required permission.
  //
  describe('requireApiKeyPermission', () => {
    const mkKey = (overrides: Record<string, unknown> = {}) => ({
      id: 'key-123',
      permission_scope: 'custom',
      permissions: ['reports:write', 'sessions:write'],
      allowed_projects: ['proj-1'],
      ...overrides,
    });

    it('allows an API key whose permissions include the required one', async () => {
      const request = createMockRequest({
        apiKey: mkKey({ permissions: ['reports:read', 'reports:write'] }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      const reply = createMockReply();

      await requireApiKeyPermission('reports:read')(request, reply);

      expect(reply.code).not.toHaveBeenCalled();
      expect(reply.send).not.toHaveBeenCalled();
    });

    it('REJECTS an ingest-only API key (write-only) from a read-required route — 403', async () => {
      // This is the regression that PR #17 left open: a signup-issued
      // ingest-only key was supposed to be unable to read reports, but
      // the permissions array was purely advisory. This test locks in
      // the fix.
      const request = createMockRequest({
        apiKey: mkKey({ permissions: ['reports:write', 'sessions:write'] }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      const reply = createMockReply();

      await requireApiKeyPermission('reports:read')(request, reply);

      expect(reply.code).toHaveBeenCalledWith(403);
      expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({ error: 'Forbidden' }));
    });

    it('allows a full-scope API key regardless of the required permission', async () => {
      // `permission_scope: 'full'` is the legacy "can do anything" scope.
      // Middleware must not break existing keys that predate the permissions
      // array, even if the permissions array is empty or stale.
      const request = createMockRequest({
        apiKey: mkKey({ permission_scope: 'full', permissions: [] }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      const reply = createMockReply();

      await requireApiKeyPermission('reports:read')(request, reply);

      expect(reply.code).not.toHaveBeenCalled();
      expect(reply.send).not.toHaveBeenCalled();
    });

    it('allows a user JWT request (no API key) to pass through', async () => {
      // This middleware is a gate for API-key requests specifically.
      // User (JWT) requests go through system-role permission checks
      // elsewhere (`requirePermission`) and must not be double-blocked.
      const request = createMockRequest({
        authUser: { id: 'user-123', email: 'u@example.com', role: 'user' },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      const reply = createMockReply();

      await requireApiKeyPermission('reports:read')(request, reply);

      expect(reply.code).not.toHaveBeenCalled();
      expect(reply.send).not.toHaveBeenCalled();
    });

    it('rejects requests with neither API key nor user — 401', async () => {
      const request = createMockRequest();
      const reply = createMockReply();

      await requireApiKeyPermission('reports:read')(request, reply);

      expect(reply.code).toHaveBeenCalledWith(401);
    });

    it('rejects an API key with permissions array that does not match the required action', async () => {
      // Different axis: a key scoped to `reports:read` should NOT satisfy
      // `sessions:read`. Regression guard against string-match-any bugs.
      const request = createMockRequest({
        apiKey: mkKey({ permissions: ['reports:read'] }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      const reply = createMockReply();

      await requireApiKeyPermission('sessions:read')(request, reply);

      expect(reply.code).toHaveBeenCalledWith(403);
    });

    it("allows a key whose permissions array contains '*' (wildcard)", async () => {
      // Shared `checkPermission` treats '*' as "grants everything". The
      // middleware delegates to it, so the wildcard must be honored even
      // on a `custom`-scope key.
      const request = createMockRequest({
        apiKey: mkKey({ permission_scope: 'custom', permissions: ['*'] }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      const reply = createMockReply();

      await requireApiKeyPermission('reports:read')(request, reply);

      expect(reply.code).not.toHaveBeenCalled();
      expect(reply.send).not.toHaveBeenCalled();
    });

    it("falls back to permission_scope when a key's permissions array is empty (pre-backfill key)", async () => {
      // Regression guard for older keys stored with a scope (`read` /
      // `write`) but an EMPTY permissions array — those exist in DBs
      // predating the permissions-backfill migration. The shared
      // `checkPermission` resolves `scope → permissions` on the fly in
      // that case; the middleware must preserve that behavior, or it
      // would wrongly 403 older keys.
      const request = createMockRequest({
        apiKey: mkKey({ permission_scope: 'read', permissions: [] }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      const reply = createMockReply();

      await requireApiKeyPermission('reports:read')(request, reply);

      // `read` scope resolves to ['reports:read', 'sessions:read'] — so
      // the check passes even though the stored permissions array is empty.
      expect(reply.code).not.toHaveBeenCalled();
      expect(reply.send).not.toHaveBeenCalled();
    });

    it('fallback from empty permissions + `read` scope still rejects write actions', async () => {
      // Sanity check for the fallback: `read` scope must not satisfy a
      // required write permission even when the stored permissions array
      // is empty.
      const request = createMockRequest({
        apiKey: mkKey({ permission_scope: 'read', permissions: [] }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      const reply = createMockReply();

      await requireApiKeyPermission('reports:write')(request, reply);

      expect(reply.code).toHaveBeenCalledWith(403);
    });

    it('does NOT bypass on request.authProject — single-project keys still hit the permission check', async () => {
      // Regression guard for a recurring reviewer suggestion: do NOT add
      // `if (request.authProject) return;` to this middleware. `authProject`
      // is set in handlers.ts:98 for any API key with
      // `allowed_projects.length === 1`, including the self-service-signup-
      // issued ingest-only key. Bypassing on `authProject` would let that
      // key read reports — the exact bug this middleware fixes.
      const request = createMockRequest({
        apiKey: mkKey({
          permission_scope: 'custom',
          permissions: ['reports:write', 'sessions:write'],
          allowed_projects: ['proj-1'],
        }),
        authProject: { id: 'proj-1', name: 'Proj' },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      const reply = createMockReply();

      await requireApiKeyPermission('reports:read')(request, reply);

      // Must reject even though authProject is set.
      expect(reply.code).toHaveBeenCalledWith(403);
    });
  });
});
