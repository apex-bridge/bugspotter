/**
 * Analytics Auth Middleware Tests
 * Tests for requireAnalyticsAccess — deployment-mode-aware authorization
 */

import { describe, it, expect, afterEach } from 'vitest';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { requireAnalyticsAccess } from '../../src/analytics/analytics-auth.js';
import { resetDeploymentConfig } from '../../src/saas/config.js';

const mockReply = {} as FastifyReply;

describe('requireAnalyticsAccess', () => {
  const originalEnv = process.env.DEPLOYMENT_MODE;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.DEPLOYMENT_MODE;
    } else {
      process.env.DEPLOYMENT_MODE = originalEnv;
    }
    resetDeploymentConfig();
  });

  // ===========================================================================
  // No auth
  // ===========================================================================

  it('should throw 401 when no authUser', async () => {
    process.env.DEPLOYMENT_MODE = 'selfhosted';
    resetDeploymentConfig();

    const middleware = requireAnalyticsAccess({} as never);
    const request = {} as FastifyRequest;

    await expect(middleware(request, mockReply)).rejects.toMatchObject({
      statusCode: 401,
      message: 'Authentication required',
    });
  });

  // ===========================================================================
  // Self-hosted mode
  // ===========================================================================

  it('should allow self-hosted admin', async () => {
    process.env.DEPLOYMENT_MODE = 'selfhosted';
    resetDeploymentConfig();

    const middleware = requireAnalyticsAccess({} as never);
    const request = {
      authUser: { id: 'u1', role: 'admin' },
    } as FastifyRequest;

    await expect(middleware(request, mockReply)).resolves.toBeUndefined();
  });

  it('should reject self-hosted non-admin', async () => {
    process.env.DEPLOYMENT_MODE = 'selfhosted';
    resetDeploymentConfig();

    const middleware = requireAnalyticsAccess({} as never);
    const request = {
      authUser: { id: 'u1', role: 'user' },
    } as FastifyRequest;

    await expect(middleware(request, mockReply)).rejects.toMatchObject({
      statusCode: 403,
      message: 'Admin access required for analytics',
    });
  });

  it('should reject self-hosted viewer', async () => {
    process.env.DEPLOYMENT_MODE = 'selfhosted';
    resetDeploymentConfig();

    const middleware = requireAnalyticsAccess({} as never);
    const request = {
      authUser: { id: 'u1', role: 'viewer' },
    } as FastifyRequest;

    await expect(middleware(request, mockReply)).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  // ===========================================================================
  // SaaS mode + platform admin (bypass — no org membership needed)
  // ===========================================================================

  it('should allow SaaS platform admin with tenant context', async () => {
    process.env.DEPLOYMENT_MODE = 'saas';
    resetDeploymentConfig();

    // db should never be called — admin bypass short-circuits
    const mockDb = {
      organizationMembers: {
        checkOrganizationAccess: async () => {
          throw new Error('should not be called');
        },
      },
    };

    const middleware = requireAnalyticsAccess(mockDb as never);
    const request = {
      authUser: { id: 'u1', role: 'admin' },
      organizationId: 'org-1',
    } as FastifyRequest;

    await expect(middleware(request, mockReply)).resolves.toBeUndefined();
  });

  it('should allow SaaS platform admin without tenant context (hub domain)', async () => {
    process.env.DEPLOYMENT_MODE = 'saas';
    resetDeploymentConfig();

    // db should never be called — admin bypass short-circuits
    const mockDb = {
      organizationMembers: {
        findByUserId: async () => {
          throw new Error('should not be called');
        },
      },
    };

    const middleware = requireAnalyticsAccess(mockDb as never);
    const request = {
      authUser: { id: 'u1', role: 'admin' },
    } as FastifyRequest;

    await expect(middleware(request, mockReply)).resolves.toBeUndefined();
  });

  it('should allow SaaS platform admin with no org memberships', async () => {
    process.env.DEPLOYMENT_MODE = 'saas';
    resetDeploymentConfig();

    // Even with an empty findByUserId, admin bypass should short-circuit
    const mockDb = {
      organizationMembers: {
        findByUserId: async () => {
          throw new Error('should not be called');
        },
      },
    };

    const middleware = requireAnalyticsAccess(mockDb as never);
    const request = {
      authUser: { id: 'u1', role: 'admin' },
    } as FastifyRequest;

    await expect(middleware(request, mockReply)).resolves.toBeUndefined();
  });

  // ===========================================================================
  // SaaS mode + tenant context (subdomain)
  // ===========================================================================

  it('should allow SaaS org admin via tenant context', async () => {
    process.env.DEPLOYMENT_MODE = 'saas';
    resetDeploymentConfig();

    const mockDb = {
      organizationMembers: {
        checkOrganizationAccess: async () => ({
          organization: { id: 'org-1', name: 'Org' },
          membership: { role: 'admin' },
        }),
      },
    };

    const middleware = requireAnalyticsAccess(mockDb as never);
    const request = {
      authUser: { id: 'u1', role: 'user' },
      organizationId: 'org-1',
    } as FastifyRequest;

    await expect(middleware(request, mockReply)).resolves.toBeUndefined();
  });

  it('should allow SaaS org owner via tenant context', async () => {
    process.env.DEPLOYMENT_MODE = 'saas';
    resetDeploymentConfig();

    const mockDb = {
      organizationMembers: {
        checkOrganizationAccess: async () => ({
          organization: { id: 'org-1', name: 'Org' },
          membership: { role: 'owner' },
        }),
      },
    };

    const middleware = requireAnalyticsAccess(mockDb as never);
    const request = {
      authUser: { id: 'u1', role: 'user' },
      organizationId: 'org-1',
    } as FastifyRequest;

    await expect(middleware(request, mockReply)).resolves.toBeUndefined();
  });

  it('should reject SaaS org member (not admin) via tenant context', async () => {
    process.env.DEPLOYMENT_MODE = 'saas';
    resetDeploymentConfig();

    const mockDb = {
      organizationMembers: {
        checkOrganizationAccess: async () => ({
          organization: { id: 'org-1', name: 'Org' },
          membership: { role: 'member' },
        }),
      },
    };

    const middleware = requireAnalyticsAccess(mockDb as never);
    const request = {
      authUser: { id: 'u1', role: 'user' },
      organizationId: 'org-1',
    } as FastifyRequest;

    await expect(middleware(request, mockReply)).rejects.toMatchObject({
      statusCode: 403,
      message: 'Admin access required for analytics',
    });
  });

  it('should throw 404 when SaaS org not found via tenant context', async () => {
    process.env.DEPLOYMENT_MODE = 'saas';
    resetDeploymentConfig();

    const mockDb = {
      organizationMembers: {
        checkOrganizationAccess: async () => ({
          organization: null,
          membership: null,
        }),
      },
    };

    const middleware = requireAnalyticsAccess(mockDb as never);
    const request = {
      authUser: { id: 'u1', role: 'user' },
      organizationId: 'org-gone',
    } as FastifyRequest;

    await expect(middleware(request, mockReply)).rejects.toMatchObject({
      statusCode: 404,
      message: 'Organization not found',
    });
  });

  it('should throw 403 when user is not a member via tenant context', async () => {
    process.env.DEPLOYMENT_MODE = 'saas';
    resetDeploymentConfig();

    const mockDb = {
      organizationMembers: {
        checkOrganizationAccess: async () => ({
          organization: { id: 'org-1', name: 'Org' },
          membership: null,
        }),
      },
    };

    const middleware = requireAnalyticsAccess(mockDb as never);
    const request = {
      authUser: { id: 'u1', role: 'user' },
      organizationId: 'org-1',
    } as FastifyRequest;

    await expect(middleware(request, mockReply)).rejects.toMatchObject({
      statusCode: 403,
      message: 'You are not a member of this organization',
    });
  });

  // ===========================================================================
  // SaaS mode + no tenant context (hub domain / multi-org)
  // ===========================================================================

  it('should allow SaaS user who is admin in at least one org (hub domain)', async () => {
    process.env.DEPLOYMENT_MODE = 'saas';
    resetDeploymentConfig();

    const mockDb = {
      organizationMembers: {
        findByUserId: async () => [
          { organization_id: 'org-a', role: 'member' },
          { organization_id: 'org-b', role: 'admin' },
        ],
      },
    };

    const middleware = requireAnalyticsAccess(mockDb as never);
    const request = {
      authUser: { id: 'u1', role: 'user' },
    } as FastifyRequest;

    await expect(middleware(request, mockReply)).resolves.toBeUndefined();
  });

  it('should allow SaaS user who is owner in at least one org (hub domain)', async () => {
    process.env.DEPLOYMENT_MODE = 'saas';
    resetDeploymentConfig();

    const mockDb = {
      organizationMembers: {
        findByUserId: async () => [
          { organization_id: 'org-a', role: 'member' },
          { organization_id: 'org-b', role: 'owner' },
        ],
      },
    };

    const middleware = requireAnalyticsAccess(mockDb as never);
    const request = {
      authUser: { id: 'u1', role: 'user' },
    } as FastifyRequest;

    await expect(middleware(request, mockReply)).resolves.toBeUndefined();
  });

  it('should reject SaaS user who is only member in all orgs (hub domain)', async () => {
    process.env.DEPLOYMENT_MODE = 'saas';
    resetDeploymentConfig();

    const mockDb = {
      organizationMembers: {
        findByUserId: async () => [
          { organization_id: 'org-a', role: 'member' },
          { organization_id: 'org-b', role: 'member' },
        ],
      },
    };

    const middleware = requireAnalyticsAccess(mockDb as never);
    const request = {
      authUser: { id: 'u1', role: 'user' },
    } as FastifyRequest;

    await expect(middleware(request, mockReply)).rejects.toMatchObject({
      statusCode: 403,
      message: 'Admin access required for analytics in at least one organization',
    });
  });

  it('should reject SaaS user with no memberships at all (hub domain)', async () => {
    process.env.DEPLOYMENT_MODE = 'saas';
    resetDeploymentConfig();

    const mockDb = {
      organizationMembers: {
        findByUserId: async () => [],
      },
    };

    const middleware = requireAnalyticsAccess(mockDb as never);
    const request = {
      authUser: { id: 'u1', role: 'user' },
    } as FastifyRequest;

    await expect(middleware(request, mockReply)).rejects.toMatchObject({
      statusCode: 403,
    });
  });
});
