/**
 * Guard Middleware Tests
 * Tests for the guard() middleware factory.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { guard } from '../../../src/api/authorization/middleware.js';

vi.mock('../../../src/logger.js', () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockUser(role: 'admin' | 'user' | 'viewer' = 'user') {
  return {
    id: 'user-1',
    email: 'test@example.com',
    name: 'Test',
    role,
    password_hash: null,
    oauth_provider: null,
    oauth_id: null,
    preferences: {},
    created_at: new Date(),
  };
}

function mockApiKey(allowedProjects: string[] | null = null) {
  return {
    id: 'key-1',
    key_hash: '',
    key_prefix: 'bgs_test',
    key_suffix: '',
    name: 'Test Key',
    description: null,
    type: 'project',
    status: 'active',
    permission_scope: 'full',
    permissions: [],
    allowed_projects: allowedProjects,
    allowed_environments: null,
  };
}

function createMockDb(overrides: Record<string, any> = {}) {
  return {
    projects: {
      findById: vi.fn().mockResolvedValue({
        id: 'proj-1',
        organization_id: 'org-1',
        name: 'Test Project',
        created_by: 'user-other',
      }),
      getUserRole: vi.fn().mockResolvedValue('member'),
      ...overrides.projects,
    },
    organizationMembers: {
      checkOrganizationAccess: vi.fn().mockResolvedValue({
        organization: { id: 'org-1', name: 'Test Org' },
        membership: { role: 'owner', user_id: 'user-1' },
      }),
      ...overrides.organizationMembers,
    },
  } as any;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('guard() middleware', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  // ---- Fail-fast validation ----

  describe('option validation', () => {
    it('throws if projectRole without project resource', () => {
      expect(() => guard(createMockDb(), { auth: 'user', projectRole: 'admin' })).toThrow(
        'projectRole requires resource'
      );
    });

    it('throws if orgRole without org or project resource', () => {
      expect(() => guard(createMockDb(), { auth: 'user', orgRole: 'admin' })).toThrow(
        'orgRole requires resource'
      );
    });

    it('allows orgRole with project resource (org resolved from project)', () => {
      expect(() =>
        guard(createMockDb(), {
          auth: 'user',
          resource: { type: 'project', paramName: 'projectId' },
          orgRole: 'admin',
        })
      ).not.toThrow();
    });
  });

  // ---- Auth method validation ----

  describe('auth method validation', () => {
    it('rejects unauthenticated request when auth: any', async () => {
      app = Fastify();
      app.get('/test', { preHandler: [guard(createMockDb(), { auth: 'any' })] }, async () => ({
        ok: true,
      }));
      await app.ready();

      const res = await app.inject({ method: 'GET', url: '/test' });
      expect(res.statusCode).toBe(401);
    });

    it('rejects API key when auth: user', async () => {
      app = Fastify();
      app.get(
        '/test',
        {
          preHandler: [
            async (req) => {
              (req as any).apiKey = mockApiKey();
            },
            guard(createMockDb(), { auth: 'user' }),
          ],
        },
        async () => ({ ok: true })
      );
      await app.ready();

      const res = await app.inject({ method: 'GET', url: '/test' });
      expect(res.statusCode).toBe(401);
    });

    it('rejects user when auth: apiKey', async () => {
      app = Fastify();
      app.get(
        '/test',
        {
          preHandler: [
            async (req) => {
              (req as any).authUser = mockUser();
            },
            guard(createMockDb(), { auth: 'apiKey' }),
          ],
        },
        async () => ({ ok: true })
      );
      await app.ready();

      const res = await app.inject({ method: 'GET', url: '/test' });
      expect(res.statusCode).toBe(401);
    });
  });

  // ---- Platform admin ----

  describe('platform admin', () => {
    it('allows platform admin for any resource without DB lookup', async () => {
      const db = createMockDb();
      app = Fastify();
      app.get(
        '/test',
        {
          preHandler: [
            async (req) => {
              (req as any).authUser = mockUser('admin');
            },
            guard(db, { auth: 'user' }),
          ],
        },
        async () => ({ ok: true })
      );
      await app.ready();

      const res = await app.inject({ method: 'GET', url: '/test' });
      expect(res.statusCode).toBe(200);
      expect(db.projects.findById).not.toHaveBeenCalled();
    });

    it('denies non-admin when platformRole: admin required', async () => {
      app = Fastify();
      app.get(
        '/admin-only',
        {
          preHandler: [
            async (req) => {
              (req as any).authUser = mockUser('user');
            },
            guard(createMockDb(), { auth: 'user', platformRole: 'admin' }),
          ],
        },
        async () => ({ ok: true })
      );
      await app.ready();

      const res = await app.inject({ method: 'GET', url: '/admin-only' });
      expect(res.statusCode).toBe(403);
    });
  });

  // ---- Project resource ----

  describe('project resource', () => {
    it('resolves project and user role from DB', async () => {
      const db = createMockDb();
      db.projects.getUserRole.mockResolvedValue('admin');
      app = Fastify();
      app.get(
        '/projects/:projectId/data',
        {
          preHandler: [
            async (req) => {
              (req as any).authUser = mockUser();
            },
            guard(db, {
              auth: 'user',
              resource: { type: 'project', paramName: 'projectId' },
              projectRole: 'admin',
            }),
          ],
        },
        async () => ({ ok: true })
      );
      await app.ready();

      const res = await app.inject({ method: 'GET', url: '/projects/proj-1/data' });
      expect(res.statusCode).toBe(200);
      expect(db.projects.findById).toHaveBeenCalledWith('proj-1');
      expect(db.projects.getUserRole).toHaveBeenCalledWith('proj-1', 'user-1');
    });

    it('denies when user has insufficient project role', async () => {
      const db = createMockDb({
        organizationMembers: {
          checkOrganizationAccess: vi.fn().mockResolvedValue({
            organization: { id: 'org-1' },
            membership: { role: 'member', user_id: 'user-1' },
          }),
        },
      });
      db.projects.getUserRole.mockResolvedValue('viewer');
      app = Fastify();
      app.get(
        '/projects/:projectId/data',
        {
          preHandler: [
            async (req) => {
              (req as any).authUser = mockUser();
            },
            guard(db, {
              auth: 'user',
              resource: { type: 'project', paramName: 'projectId' },
              projectRole: 'admin',
            }),
          ],
        },
        async () => ({ ok: true })
      );
      await app.ready();

      const res = await app.inject({ method: 'GET', url: '/projects/proj-1/data' });
      expect(res.statusCode).toBe(403);
    });

    it('returns 404 when project not found', async () => {
      const db = createMockDb();
      db.projects.findById.mockResolvedValue(null);
      app = Fastify();
      app.get(
        '/projects/:projectId/data',
        {
          preHandler: [
            async (req) => {
              (req as any).authUser = mockUser();
            },
            guard(db, {
              auth: 'user',
              resource: { type: 'project', paramName: 'projectId' },
            }),
          ],
        },
        async () => ({ ok: true })
      );
      await app.ready();

      const res = await app.inject({ method: 'GET', url: '/projects/proj-1/data' });
      expect(res.statusCode).toBe(404);
    });

    it('denies when no project role and org member only inherits viewer (guard requires admin)', async () => {
      const db = createMockDb({
        organizationMembers: {
          checkOrganizationAccess: vi.fn().mockResolvedValue({
            organization: { id: 'org-1' },
            membership: { role: 'member', user_id: 'user-1' },
          }),
        },
      });
      db.projects.getUserRole.mockResolvedValue(null);
      app = Fastify();
      app.get(
        '/projects/:projectId/admin',
        {
          preHandler: [
            async (req) => {
              (req as any).authUser = mockUser();
            },
            guard(db, {
              auth: 'user',
              resource: { type: 'project', paramName: 'projectId' },
              projectRole: 'admin',
            }),
          ],
        },
        async () => ({ ok: true })
      );
      await app.ready();

      const res = await app.inject({ method: 'GET', url: '/projects/proj-1/admin' });
      expect(res.statusCode).toBe(403);
    });

    it('denies when orgRole required but user has no org membership', async () => {
      const db = createMockDb({
        organizationMembers: {
          checkOrganizationAccess: vi.fn().mockResolvedValue({
            organization: { id: 'org-1' },
            membership: null,
          }),
        },
      });
      db.projects.getUserRole.mockResolvedValue('admin');
      app = Fastify();
      app.get(
        '/projects/:projectId/org-admin',
        {
          preHandler: [
            async (req) => {
              (req as any).authUser = mockUser();
            },
            guard(db, {
              auth: 'user',
              resource: { type: 'project', paramName: 'projectId' },
              orgRole: 'admin',
            }),
          ],
        },
        async () => ({ ok: true })
      );
      await app.ready();

      const res = await app.inject({ method: 'GET', url: '/projects/proj-1/org-admin' });
      expect(res.statusCode).toBe(403);
    });
  });

  // ---- Org-to-project inheritance ----

  describe('org role inheritance', () => {
    it('org owner gets project admin access (no explicit project role)', async () => {
      const db = createMockDb();
      db.projects.getUserRole.mockResolvedValue(null);
      db.organizationMembers.checkOrganizationAccess.mockResolvedValue({
        organization: { id: 'org-1' },
        membership: { role: 'owner', user_id: 'user-1' },
      });
      app = Fastify();
      app.get(
        '/projects/:projectId/data',
        {
          preHandler: [
            async (req) => {
              (req as any).authUser = mockUser();
            },
            guard(db, {
              auth: 'user',
              resource: { type: 'project', paramName: 'projectId' },
              action: 'manage',
            }),
          ],
        },
        async () => ({ ok: true })
      );
      await app.ready();

      const res = await app.inject({ method: 'GET', url: '/projects/proj-1/data' });
      expect(res.statusCode).toBe(200);
    });

    it('org member gets project read but not manage', async () => {
      const db = createMockDb();
      db.projects.getUserRole.mockResolvedValue(null);
      db.organizationMembers.checkOrganizationAccess.mockResolvedValue({
        organization: { id: 'org-1' },
        membership: { role: 'member', user_id: 'user-1' },
      });

      app = Fastify();
      app.get(
        '/projects/:projectId/read',
        {
          preHandler: [
            async (req) => {
              (req as any).authUser = mockUser();
            },
            guard(db, {
              auth: 'user',
              resource: { type: 'project', paramName: 'projectId' },
              action: 'read',
            }),
          ],
        },
        async () => ({ ok: true })
      );
      app.get(
        '/projects/:projectId/manage',
        {
          preHandler: [
            async (req) => {
              (req as any).authUser = mockUser();
            },
            guard(db, {
              auth: 'user',
              resource: { type: 'project', paramName: 'projectId' },
              action: 'manage',
            }),
          ],
        },
        async () => ({ ok: true })
      );

      await app.ready();

      expect((await app.inject({ method: 'GET', url: '/projects/proj-1/read' })).statusCode).toBe(
        200
      );
      expect((await app.inject({ method: 'GET', url: '/projects/proj-1/manage' })).statusCode).toBe(
        403
      );
    });

    it('skips org lookup when project has no organization_id', async () => {
      const db = createMockDb();
      db.projects.findById.mockResolvedValue({
        id: 'proj-1',
        organization_id: null,
        name: 'Standalone',
      });
      db.projects.getUserRole.mockResolvedValue('admin');
      app = Fastify();
      app.get(
        '/projects/:projectId/data',
        {
          preHandler: [
            async (req) => {
              (req as any).authUser = mockUser();
            },
            guard(db, {
              auth: 'user',
              resource: { type: 'project', paramName: 'projectId' },
              action: 'manage',
            }),
          ],
        },
        async () => ({ ok: true })
      );
      await app.ready();

      const res = await app.inject({ method: 'GET', url: '/projects/proj-1/data' });
      expect(res.statusCode).toBe(200);
      expect(db.organizationMembers.checkOrganizationAccess).not.toHaveBeenCalled();
    });
  });

  // ---- API key ----

  describe('API key access', () => {
    it('allows API key with matching project', async () => {
      const db = createMockDb();
      app = Fastify();
      app.post(
        '/projects/:projectId/reports',
        {
          preHandler: [
            async (req) => {
              (req as any).apiKey = mockApiKey(['proj-1']);
            },
            guard(db, { auth: 'apiKey', resource: { type: 'project', paramName: 'projectId' } }),
          ],
        },
        async () => ({ ok: true })
      );
      await app.ready();

      const res = await app.inject({ method: 'POST', url: '/projects/proj-1/reports' });
      expect(res.statusCode).toBe(200);
    });

    it('denies API key when route requires projectRole', async () => {
      const db = createMockDb();
      app = Fastify();
      app.get(
        '/projects/:projectId/admin',
        {
          preHandler: [
            async (req) => {
              (req as any).apiKey = mockApiKey(['proj-1']);
            },
            guard(db, {
              auth: 'any',
              resource: { type: 'project', paramName: 'projectId' },
              projectRole: 'admin',
            }),
          ],
        },
        async () => ({ ok: true })
      );
      await app.ready();

      const res = await app.inject({ method: 'GET', url: '/projects/proj-1/admin' });
      expect(res.statusCode).toBe(403);
    });

    it('denies API key when route requires orgRole', async () => {
      const db = createMockDb();
      app = Fastify();
      app.get(
        '/projects/:projectId/org-admin',
        {
          preHandler: [
            async (req) => {
              (req as any).apiKey = mockApiKey(['proj-1']);
            },
            guard(db, {
              auth: 'any',
              resource: { type: 'project', paramName: 'projectId' },
              orgRole: 'admin',
            }),
          ],
        },
        async () => ({ ok: true })
      );
      await app.ready();

      const res = await app.inject({ method: 'GET', url: '/projects/proj-1/org-admin' });
      expect(res.statusCode).toBe(403);
    });

    it('denies API key with non-matching project', async () => {
      const db = createMockDb();
      app = Fastify();
      app.post(
        '/projects/:projectId/reports',
        {
          preHandler: [
            async (req) => {
              (req as any).apiKey = mockApiKey(['proj-99']);
            },
            guard(db, { auth: 'apiKey', resource: { type: 'project', paramName: 'projectId' } }),
          ],
        },
        async () => ({ ok: true })
      );
      await app.ready();

      const res = await app.inject({ method: 'POST', url: '/projects/proj-1/reports' });
      expect(res.statusCode).toBe(403);
    });
  });

  // ---- Organization resource ----

  describe('organization resource', () => {
    it('allows org owner to manage org', async () => {
      const db = createMockDb();
      app = Fastify();
      app.patch(
        '/orgs/:orgId/settings',
        {
          preHandler: [
            async (req) => {
              (req as any).authUser = mockUser();
            },
            guard(db, {
              auth: 'user',
              resource: { type: 'organization', paramName: 'orgId' },
              action: 'manage',
            }),
          ],
        },
        async () => ({ ok: true })
      );
      await app.ready();

      const res = await app.inject({ method: 'PATCH', url: '/orgs/org-1/settings' });
      expect(res.statusCode).toBe(200);
    });

    it('denies org member from managing org', async () => {
      const db = createMockDb({
        organizationMembers: {
          checkOrganizationAccess: vi.fn().mockResolvedValue({
            organization: { id: 'org-1' },
            membership: { role: 'member', user_id: 'user-1' },
          }),
        },
      });
      app = Fastify();
      app.patch(
        '/orgs/:orgId/settings',
        {
          preHandler: [
            async (req) => {
              (req as any).authUser = mockUser();
            },
            guard(db, {
              auth: 'user',
              resource: { type: 'organization', paramName: 'orgId' },
              action: 'manage',
            }),
          ],
        },
        async () => ({ ok: true })
      );
      await app.ready();

      const res = await app.inject({ method: 'PATCH', url: '/orgs/org-1/settings' });
      expect(res.statusCode).toBe(403);
    });

    it('returns 404 when org not found', async () => {
      const db = createMockDb({
        organizationMembers: {
          checkOrganizationAccess: vi.fn().mockResolvedValue({
            organization: null,
            membership: null,
          }),
        },
      });
      app = Fastify();
      app.get(
        '/orgs/:orgId',
        {
          preHandler: [
            async (req) => {
              (req as any).authUser = mockUser();
            },
            guard(db, {
              auth: 'user',
              resource: { type: 'organization', paramName: 'orgId' },
              action: 'read',
            }),
          ],
        },
        async () => ({ ok: true })
      );
      await app.ready();

      const res = await app.inject({ method: 'GET', url: '/orgs/org-1' });
      expect(res.statusCode).toBe(404);
    });
  });
});
