/**
 * Platform Admin Middleware Tests
 * Tests for isPlatformAdmin() and requirePlatformAdmin()
 */

import { describe, it, expect, vi } from 'vitest';
import { isPlatformAdmin } from '../../../src/api/middleware/auth/assertions.js';
import { requirePlatformAdmin } from '../../../src/api/middleware/auth/authorization.js';
import type { FastifyRequest, FastifyReply } from 'fastify';

function createMockRequest(overrides: Record<string, unknown> = {}): FastifyRequest {
  return { authUser: null, ...overrides } as unknown as FastifyRequest;
}

function createMockReply(): FastifyReply {
  const reply = {
    status: vi.fn().mockReturnThis(),
    code: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
  };
  return reply as unknown as FastifyReply;
}

describe('isPlatformAdmin', () => {
  it('returns false when no user', () => {
    expect(isPlatformAdmin(createMockRequest())).toBe(false);
  });

  it('returns true when security.is_platform_admin is true', () => {
    const request = createMockRequest({
      authUser: {
        id: '1',
        email: 'admin@test.com',
        role: 'user',
        security: { is_platform_admin: true },
      },
    });
    expect(isPlatformAdmin(request)).toBe(true);
  });

  it('returns false when security.is_platform_admin is false', () => {
    const request = createMockRequest({
      authUser: {
        id: '1',
        email: 'user@test.com',
        role: 'user',
        security: { is_platform_admin: false },
      },
    });
    expect(isPlatformAdmin(request)).toBe(false);
  });

  it('returns false when security is empty', () => {
    const request = createMockRequest({
      authUser: { id: '1', email: 'user@test.com', role: 'user', security: {} },
    });
    expect(isPlatformAdmin(request)).toBe(false);
  });

  it('falls back to role === admin when security field is missing', () => {
    const request = createMockRequest({
      authUser: { id: '1', email: 'admin@test.com', role: 'admin' },
    });
    expect(isPlatformAdmin(request)).toBe(true);
  });

  it('returns false for role=user without security field', () => {
    const request = createMockRequest({
      authUser: { id: '1', email: 'user@test.com', role: 'user' },
    });
    expect(isPlatformAdmin(request)).toBe(false);
  });

  it('grants admin via legacy role fallback even when security says false', () => {
    // During migration, both security.is_platform_admin and role='admin' grant admin.
    // This ensures existing admins keep access until role column is dropped.
    const request = createMockRequest({
      authUser: {
        id: '1',
        email: 'admin@test.com',
        role: 'admin',
        security: { is_platform_admin: false },
      },
    });
    expect(isPlatformAdmin(request)).toBe(true);
  });
});

describe('requirePlatformAdmin', () => {
  it('returns 401 when no user', async () => {
    const middleware = requirePlatformAdmin();
    const request = createMockRequest();
    const reply = createMockReply();

    await middleware(request, reply);

    expect(reply.code).toHaveBeenCalledWith(401);
  });

  it('allows platform admin via security field', async () => {
    const middleware = requirePlatformAdmin();
    const request = createMockRequest({
      authUser: { id: '1', role: 'user', security: { is_platform_admin: true } },
    });
    const reply = createMockReply();

    await middleware(request, reply);

    expect(reply.code).not.toHaveBeenCalled();
  });

  it('allows legacy admin via role field', async () => {
    const middleware = requirePlatformAdmin();
    const request = createMockRequest({
      authUser: { id: '1', role: 'admin', security: {} },
    });
    const reply = createMockReply();

    await middleware(request, reply);

    expect(reply.code).not.toHaveBeenCalled();
  });

  it('returns 403 for non-admin user', async () => {
    const middleware = requirePlatformAdmin();
    const request = createMockRequest({
      authUser: { id: '1', role: 'user', security: {} },
    });
    const reply = createMockReply();

    await middleware(request, reply);

    expect(reply.code).toHaveBeenCalledWith(403);
  });

  it('returns 403 for viewer', async () => {
    const middleware = requirePlatformAdmin();
    const request = createMockRequest({
      authUser: { id: '1', role: 'viewer', security: {} },
    });
    const reply = createMockReply();

    await middleware(request, reply);

    expect(reply.code).toHaveBeenCalledWith(403);
  });

  it('returns 403 for user with explicit is_platform_admin=false', async () => {
    const middleware = requirePlatformAdmin();
    const request = createMockRequest({
      authUser: { id: '1', role: 'user', security: { is_platform_admin: false } },
    });
    const reply = createMockReply();

    await middleware(request, reply);

    expect(reply.code).toHaveBeenCalledWith(403);
  });
});
