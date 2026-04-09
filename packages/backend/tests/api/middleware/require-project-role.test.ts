/**
 * requireProjectRole Middleware Tests
 * Unit tests for project role-based authorization middleware
 */

import { describe, it, expect, vi } from 'vitest';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { requireProjectRole } from '../../../src/api/middleware/auth/authorization.js';

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
    projectRole: undefined,
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

describe('requireProjectRole', () => {
  // ============================================================================
  // UNAUTHENTICATED REQUESTS
  // ============================================================================

  describe('unauthenticated requests', () => {
    it('should return 401 when no auth is present at all', async () => {
      const request = createMockRequest();
      const reply = createMockReply();

      const middleware = requireProjectRole('viewer');
      await middleware(request, reply);

      expect(reply.code).toHaveBeenCalledWith(401);
      expect(reply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Unauthorized',
          message: 'User authentication required',
        })
      );
    });
  });

  // ============================================================================
  // API KEY BYPASS
  // ============================================================================

  describe('API key bypass', () => {
    it('should allow project-scoped API key without checking role', async () => {
      const request = createMockRequest({
        authProject: { id: 'project-1' } as any,
      });
      const reply = createMockReply();

      const middleware = requireProjectRole('owner');
      await middleware(request, reply);

      expect(reply.code).not.toHaveBeenCalled();
      expect(reply.send).not.toHaveBeenCalled();
    });

    it('should allow full-scope API key without checking role', async () => {
      const request = createMockRequest({
        apiKey: { id: 'key-1', allowed_projects: null } as any,
      });
      const reply = createMockReply();

      const middleware = requireProjectRole('owner');
      await middleware(request, reply);

      expect(reply.code).not.toHaveBeenCalled();
      expect(reply.send).not.toHaveBeenCalled();
    });

    it('should allow multi-project API key without checking role', async () => {
      const request = createMockRequest({
        apiKey: { id: 'key-1', allowed_projects: ['p1', 'p2'] } as any,
      });
      const reply = createMockReply();

      const middleware = requireProjectRole('admin');
      await middleware(request, reply);

      expect(reply.code).not.toHaveBeenCalled();
    });

    it('should check JWT role when both JWT and API key are present', async () => {
      const request = createMockRequest({
        authUser: { id: 'user-1', email: 'user@test.com', role: 'user' },
        apiKey: { id: 'key-1' } as any,
        projectRole: 'viewer',
      } as any);
      const reply = createMockReply();

      const middleware = requireProjectRole('admin');
      await middleware(request, reply);

      // Should enforce role check because authUser is present
      expect(reply.code).toHaveBeenCalledWith(403);
    });
  });

  // ============================================================================
  // SYSTEM ADMIN BYPASS
  // ============================================================================

  describe('system admin bypass', () => {
    it('should allow system admin regardless of project role', async () => {
      const request = createMockRequest({
        authUser: { id: 'admin-1', email: 'admin@test.com', role: 'admin' },
        projectRole: undefined, // No project role at all
      } as any);
      const reply = createMockReply();

      const middleware = requireProjectRole('owner');
      await middleware(request, reply);

      expect(reply.code).not.toHaveBeenCalled();
      expect(reply.send).not.toHaveBeenCalled();
    });

    it('should allow system admin even when requiring owner role', async () => {
      const request = createMockRequest({
        authUser: { id: 'admin-1', email: 'admin@test.com', role: 'admin' },
        projectRole: 'viewer', // Low project role
      } as any);
      const reply = createMockReply();

      const middleware = requireProjectRole('owner');
      await middleware(request, reply);

      expect(reply.code).not.toHaveBeenCalled();
    });
  });

  // ============================================================================
  // NO PROJECT ROLE
  // ============================================================================

  describe('missing project role', () => {
    it('should return 403 when user has no project role', async () => {
      const request = createMockRequest({
        authUser: { id: 'user-1', email: 'user@test.com', role: 'user' },
        projectRole: undefined,
      } as any);
      const reply = createMockReply();

      const middleware = requireProjectRole('viewer');
      await middleware(request, reply);

      expect(reply.code).toHaveBeenCalledWith(403);
      expect(reply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Forbidden',
          message: 'You do not have a role in this project',
        })
      );
    });
  });

  // ============================================================================
  // ROLE HIERARCHY: VIEWER REQUIRED
  // ============================================================================

  describe('viewer required (minimum)', () => {
    it.each([
      ['owner', true],
      ['admin', true],
      ['member', true],
      ['viewer', true],
    ] as const)('should %s when project role is %s', async (projectRole, shouldAllow) => {
      const request = createMockRequest({
        authUser: { id: 'user-1', email: 'user@test.com', role: 'user' },
        projectRole,
      } as any);
      const reply = createMockReply();

      const middleware = requireProjectRole('viewer');
      await middleware(request, reply);

      if (shouldAllow) {
        expect(reply.code).not.toHaveBeenCalled();
      } else {
        expect(reply.code).toHaveBeenCalledWith(403);
      }
    });
  });

  // ============================================================================
  // ROLE HIERARCHY: MEMBER REQUIRED
  // ============================================================================

  describe('member required', () => {
    it.each([
      ['owner', true],
      ['admin', true],
      ['member', true],
      ['viewer', false],
    ] as const)('should %s when project role is %s', async (projectRole, shouldAllow) => {
      const request = createMockRequest({
        authUser: { id: 'user-1', email: 'user@test.com', role: 'user' },
        projectRole,
      } as any);
      const reply = createMockReply();

      const middleware = requireProjectRole('member');
      await middleware(request, reply);

      if (shouldAllow) {
        expect(reply.code).not.toHaveBeenCalled();
      } else {
        expect(reply.code).toHaveBeenCalledWith(403);
      }
    });

    it('should include required role in error message', async () => {
      const request = createMockRequest({
        authUser: { id: 'user-1', email: 'user@test.com', role: 'user' },
        projectRole: 'viewer',
      } as any);
      const reply = createMockReply();

      const middleware = requireProjectRole('member');
      await middleware(request, reply);

      expect(reply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Insufficient project permissions. Required: member or higher',
        })
      );
    });
  });

  // ============================================================================
  // ROLE HIERARCHY: ADMIN REQUIRED
  // ============================================================================

  describe('admin required', () => {
    it.each([
      ['owner', true],
      ['admin', true],
      ['member', false],
      ['viewer', false],
    ] as const)('should %s when project role is %s', async (projectRole, shouldAllow) => {
      const request = createMockRequest({
        authUser: { id: 'user-1', email: 'user@test.com', role: 'user' },
        projectRole,
      } as any);
      const reply = createMockReply();

      const middleware = requireProjectRole('admin');
      await middleware(request, reply);

      if (shouldAllow) {
        expect(reply.code).not.toHaveBeenCalled();
      } else {
        expect(reply.code).toHaveBeenCalledWith(403);
      }
    });
  });

  // ============================================================================
  // ROLE HIERARCHY: OWNER REQUIRED
  // ============================================================================

  describe('owner required', () => {
    it.each([
      ['owner', true],
      ['admin', false],
      ['member', false],
      ['viewer', false],
    ] as const)('should %s when project role is %s', async (projectRole, shouldAllow) => {
      const request = createMockRequest({
        authUser: { id: 'user-1', email: 'user@test.com', role: 'user' },
        projectRole,
      } as any);
      const reply = createMockReply();

      const middleware = requireProjectRole('owner');
      await middleware(request, reply);

      if (shouldAllow) {
        expect(reply.code).not.toHaveBeenCalled();
      } else {
        expect(reply.code).toHaveBeenCalledWith(403);
      }
    });
  });

  // ============================================================================
  // SYSTEM VIEWER ROLE (non-admin system roles)
  // ============================================================================

  describe('system viewer with project roles', () => {
    it('should allow system viewer with project admin role when admin required', async () => {
      const request = createMockRequest({
        authUser: { id: 'user-1', email: 'viewer@test.com', role: 'viewer' },
        projectRole: 'admin',
      } as any);
      const reply = createMockReply();

      const middleware = requireProjectRole('admin');
      await middleware(request, reply);

      expect(reply.code).not.toHaveBeenCalled();
    });

    it('should reject system viewer with project viewer role when admin required', async () => {
      const request = createMockRequest({
        authUser: { id: 'user-1', email: 'viewer@test.com', role: 'viewer' },
        projectRole: 'viewer',
      } as any);
      const reply = createMockReply();

      const middleware = requireProjectRole('admin');
      await middleware(request, reply);

      expect(reply.code).toHaveBeenCalledWith(403);
    });
  });
});
