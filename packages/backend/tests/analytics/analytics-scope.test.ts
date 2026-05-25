/**
 * Analytics Scope Resolution Tests
 * Tests for resolveAnalyticsScope — context-aware org filter resolution
 */

import { describe, it, expect, afterEach } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { resolveAnalyticsScope } from '../../src/analytics/analytics-scope.js';
import { resetDeploymentConfig } from '../../src/saas/config.js';

describe('resolveAnalyticsScope', () => {
  const originalEnv = process.env.DEPLOYMENT_MODE;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.DEPLOYMENT_MODE;
    } else {
      process.env.DEPLOYMENT_MODE = originalEnv;
    }
    resetDeploymentConfig();
  });

  it('should return null organizationIds in self-hosted mode', async () => {
    process.env.DEPLOYMENT_MODE = 'selfhosted';
    resetDeploymentConfig();

    const request = {} as FastifyRequest;
    const db = {} as never;

    const scope = await resolveAnalyticsScope(request, db);
    expect(scope.organizationIds).toBeNull();
  });

  it('should return null organizationIds when DEPLOYMENT_MODE is not set', async () => {
    delete process.env.DEPLOYMENT_MODE;
    resetDeploymentConfig();

    const request = {} as FastifyRequest;
    const db = {} as never;

    const scope = await resolveAnalyticsScope(request, db);
    expect(scope.organizationIds).toBeNull();
  });

  it('should return single org ID when request.organizationId is set (SaaS tenant)', async () => {
    process.env.DEPLOYMENT_MODE = 'saas';
    resetDeploymentConfig();

    const request = {
      organizationId: 'org-123',
    } as FastifyRequest;
    const db = {} as never;

    const scope = await resolveAnalyticsScope(request, db);
    expect(scope.organizationIds).toEqual(['org-123']);
  });

  it('should return only admin/owner org IDs when no org context (SaaS hub domain)', async () => {
    process.env.DEPLOYMENT_MODE = 'saas';
    resetDeploymentConfig();

    const request = {
      authUser: { id: 'user-1' },
    } as FastifyRequest;

    const mockDb = {
      organizationMembers: {
        findByUserId: async () => [
          { organization_id: 'org-a', role: 'admin' },
          { organization_id: 'org-b', role: 'member' },
          { organization_id: 'org-c', role: 'owner' },
        ],
      },
    } as never;

    const scope = await resolveAnalyticsScope(request, mockDb);
    // org-b excluded — user is only a member there, not admin/owner
    expect(scope.organizationIds).toEqual(['org-a', 'org-c']);
  });

  it('should return null organizationIds for SaaS platform admin on hub domain (no org context)', async () => {
    process.env.DEPLOYMENT_MODE = 'saas';
    resetDeploymentConfig();

    const request = {
      authUser: { id: 'admin-1', role: 'admin' },
    } as FastifyRequest;

    // DB should never be called — platform admin sees all data
    const mockDb = {
      organizationMembers: {
        findByUserId: async () => {
          throw new Error('should not be called');
        },
      },
    } as never;

    const scope = await resolveAnalyticsScope(request, mockDb);
    expect(scope.organizationIds).toBeNull();
  });

  it('should return tenant org for SaaS platform admin with org context (subdomain)', async () => {
    process.env.DEPLOYMENT_MODE = 'saas';
    resetDeploymentConfig();

    const request = {
      authUser: { id: 'admin-1', role: 'admin' },
      organizationId: 'org-tenant',
    } as FastifyRequest;

    const db = {} as never;

    const scope = await resolveAnalyticsScope(request, db);
    // Even platform admin should scope to tenant org when on subdomain
    expect(scope.organizationIds).toEqual(['org-tenant']);
  });

  it('should narrow to ?organization_id= for SaaS platform admin on hub domain', async () => {
    process.env.DEPLOYMENT_MODE = 'saas';
    resetDeploymentConfig();

    const request = {
      authUser: { id: 'admin-1', role: 'admin' },
      query: { organization_id: 'org-target' },
    } as unknown as FastifyRequest;

    const mockDb = {
      organizationMembers: {
        findByUserId: async () => {
          throw new Error('should not be called');
        },
      },
    } as never;

    const scope = await resolveAnalyticsScope(request, mockDb);
    expect(scope.organizationIds).toEqual(['org-target']);
  });

  it('should let subdomain context win over ?organization_id= for platform admin', async () => {
    process.env.DEPLOYMENT_MODE = 'saas';
    resetDeploymentConfig();

    // A platform admin already on acme.kz.bugspotter.io cannot widen / cross
    // to a different org via the query param.
    const request = {
      authUser: { id: 'admin-1', role: 'admin' },
      organizationId: 'org-subdomain',
      query: { organization_id: 'org-other' },
    } as unknown as FastifyRequest;

    const db = {} as never;

    const scope = await resolveAnalyticsScope(request, db);
    expect(scope.organizationIds).toEqual(['org-subdomain']);
  });

  it('should ignore ?organization_id= for non-admin users (security boundary)', async () => {
    process.env.DEPLOYMENT_MODE = 'saas';
    resetDeploymentConfig();

    // Non-admin user attempts to scope to an org they don't administer.
    // The query param branch is only reached for platform admins; everyone
    // else falls through to the memberships aggregation.
    const request = {
      authUser: { id: 'user-1' },
      query: { organization_id: 'org-foreign' },
    } as unknown as FastifyRequest;

    const mockDb = {
      organizationMembers: {
        findByUserId: async () => [{ organization_id: 'org-a', role: 'admin' }],
      },
    } as never;

    const scope = await resolveAnalyticsScope(request, mockDb);
    expect(scope.organizationIds).toEqual(['org-a']);
    expect(scope.organizationIds).not.toContain('org-foreign');
  });

  it('should throw 401 when SaaS mode, no org context, no auth user', async () => {
    process.env.DEPLOYMENT_MODE = 'saas';
    resetDeploymentConfig();

    const request = {} as FastifyRequest;
    const db = {} as never;

    await expect(resolveAnalyticsScope(request, db)).rejects.toMatchObject({
      statusCode: 401,
      message: 'Authentication required',
    });
  });

  it('should throw 403 when SaaS mode, no org context, user has no memberships', async () => {
    process.env.DEPLOYMENT_MODE = 'saas';
    resetDeploymentConfig();

    const request = {
      authUser: { id: 'user-lonely' },
    } as FastifyRequest;

    const mockDb = {
      organizationMembers: {
        findByUserId: async () => [],
      },
    } as never;

    await expect(resolveAnalyticsScope(request, mockDb)).rejects.toMatchObject({
      statusCode: 403,
      message: 'You are not an admin of any organization',
    });
  });

  it('should throw 403 when user has memberships but none with admin/owner role', async () => {
    process.env.DEPLOYMENT_MODE = 'saas';
    resetDeploymentConfig();

    const request = {
      authUser: { id: 'user-member-only' },
    } as FastifyRequest;

    const mockDb = {
      organizationMembers: {
        findByUserId: async () => [
          { organization_id: 'org-a', role: 'member' },
          { organization_id: 'org-b', role: 'member' },
        ],
      },
    } as never;

    await expect(resolveAnalyticsScope(request, mockDb)).rejects.toMatchObject({
      statusCode: 403,
      message: 'You are not an admin of any organization',
    });
  });
});
