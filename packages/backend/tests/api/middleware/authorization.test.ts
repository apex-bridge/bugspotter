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
});
