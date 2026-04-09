/**
 * Permissions Endpoint Tests
 * Unit tests for GET /api/v1/me/permissions
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the auth module
vi.mock('../../../src/api/middleware/auth.js', () => ({
  requireUser: vi.fn(async () => {}),
  isPlatformAdmin: vi.fn((requestOrUser: any) => {
    const user = requestOrUser?.authUser ?? requestOrUser;
    return user?.security?.is_platform_admin === true || user?.role === 'admin';
  }),
}));

// Mock project-roles
vi.mock('../../../src/types/project-roles.js', () => ({
  isProjectRole: vi.fn((role: string) => ['owner', 'admin', 'member', 'viewer'].includes(role)),
  hasPermissionLevel: vi.fn((userRole: string, requiredRole: string) => {
    const hierarchy: Record<string, number> = {
      owner: 4,
      admin: 3,
      member: 2,
      viewer: 1,
    };
    return (hierarchy[userRole] || 0) >= (hierarchy[requiredRole] || 0);
  }),
}));

// Mock db types
vi.mock('../../../src/db/types.js', () => ({
  ROLE_LEVEL: { owner: 3, admin: 2, member: 1 },
  ORG_MEMBER_ROLE: { OWNER: 'owner', ADMIN: 'admin', MEMBER: 'member' },
}));

// Import after mocks
import { permissionRoutes } from '../../../src/api/routes/permissions.js';
import type { FastifyInstance } from 'fastify';

// ============================================================================
// TEST SETUP
// ============================================================================

function createMockDb() {
  return {
    projects: {
      getUserRole: vi.fn(),
    },
    organizationMembers: {
      checkOrganizationAccess: vi.fn(),
    },
  } as any;
}

function createMockFastify() {
  const routes: Record<string, any> = {};

  return {
    get: vi.fn((path: string, opts: any, handler: any) => {
      routes[path] = { opts, handler };
    }),
    _routes: routes,
    _getHandler: (path: string) => routes[path]?.handler,
  } as unknown as FastifyInstance & { _getHandler: (path: string) => any };
}

function createMockReply() {
  const reply = {
    code: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
  };
  return reply as any;
}

describe('GET /api/v1/me/permissions', () => {
  let db: ReturnType<typeof createMockDb>;
  let fastify: ReturnType<typeof createMockFastify>;
  let handler: any;

  beforeEach(() => {
    db = createMockDb();
    fastify = createMockFastify();
    permissionRoutes(fastify as any, db);
    handler = fastify._getHandler('/api/v1/me/permissions');
  });

  // ============================================================================
  // SYSTEM PERMISSIONS
  // ============================================================================

  describe('system permissions', () => {
    it('should return system role for authenticated user', async () => {
      const request = {
        authUser: { id: 'user-1', role: 'user' },
        query: {},
      };
      const reply = createMockReply();

      await handler(request, reply);

      expect(reply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            system: { role: 'user', isAdmin: false },
          }),
        })
      );
    });

    it('should return isAdmin: true for system admin', async () => {
      const request = {
        authUser: { id: 'admin-1', role: 'admin' },
        query: {},
      };
      const reply = createMockReply();

      await handler(request, reply);

      expect(reply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            system: { role: 'admin', isAdmin: true },
          }),
        })
      );
    });

    it('should return isAdmin: true via security.is_platform_admin (non-admin role)', async () => {
      const request = {
        authUser: { id: 'user-1', role: 'user', security: { is_platform_admin: true } },
        query: {},
      };
      const reply = createMockReply();

      await handler(request, reply);

      expect(reply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            system: { role: 'user', isAdmin: true },
          }),
        })
      );
    });
  });

  // ============================================================================
  // PROJECT PERMISSIONS
  // ============================================================================

  describe('project permissions', () => {
    it('should omit project field when projectId not provided', async () => {
      const request = {
        authUser: { id: 'user-1', role: 'user' },
        query: {},
      };
      const reply = createMockReply();

      await handler(request, reply);

      const responseData = reply.send.mock.calls[0][0].data;
      expect(responseData.project).toBeUndefined();
    });

    it('should return project permissions for a project member', async () => {
      db.projects.getUserRole.mockResolvedValue('admin');
      const request = {
        authUser: { id: 'user-1', role: 'user' },
        query: { projectId: 'project-1' },
      };
      const reply = createMockReply();

      await handler(request, reply);

      const responseData = reply.send.mock.calls[0][0].data;
      expect(responseData.project).toEqual({
        role: 'admin',
        canManageIntegrations: true,
        canEditProject: true,
        canDeleteProject: false,
        canManageMembers: true,
        canDeleteReports: true,
        canUpload: true,
        canView: true,
      });
    });

    it('should return viewer-level permissions for viewer role', async () => {
      db.projects.getUserRole.mockResolvedValue('viewer');
      const request = {
        authUser: { id: 'user-1', role: 'user' },
        query: { projectId: 'project-1' },
      };
      const reply = createMockReply();

      await handler(request, reply);

      const responseData = reply.send.mock.calls[0][0].data;
      expect(responseData.project.canManageIntegrations).toBe(false);
      expect(responseData.project.canEditProject).toBe(false);
      expect(responseData.project.canDeleteProject).toBe(false);
      expect(responseData.project.canManageMembers).toBe(false);
      expect(responseData.project.canDeleteReports).toBe(false);
      expect(responseData.project.canUpload).toBe(false);
      expect(responseData.project.canView).toBe(true);
    });

    it('should return owner permissions for owner role', async () => {
      db.projects.getUserRole.mockResolvedValue('owner');
      const request = {
        authUser: { id: 'user-1', role: 'user' },
        query: { projectId: 'project-1' },
      };
      const reply = createMockReply();

      await handler(request, reply);

      const responseData = reply.send.mock.calls[0][0].data;
      expect(responseData.project.canDeleteProject).toBe(true);
      expect(responseData.project.canManageIntegrations).toBe(true);
    });

    it('should omit project field when user has no project access', async () => {
      db.projects.getUserRole.mockResolvedValue(null);
      const request = {
        authUser: { id: 'user-1', role: 'user' },
        query: { projectId: 'project-1' },
      };
      const reply = createMockReply();

      await handler(request, reply);

      const responseData = reply.send.mock.calls[0][0].data;
      expect(responseData.project).toBeUndefined();
    });

    it('should give system admin full project permissions without membership', async () => {
      const request = {
        authUser: { id: 'admin-1', role: 'admin' },
        query: { projectId: 'project-1' },
      };
      const reply = createMockReply();

      await handler(request, reply);

      const responseData = reply.send.mock.calls[0][0].data;
      expect(responseData.project.canDeleteProject).toBe(true);
      expect(responseData.project.canManageMembers).toBe(true);
      expect(responseData.project.canManageIntegrations).toBe(true);
      // Should flag as system admin (not actual membership)
      expect(responseData.project.isSystemAdmin).toBe(true);
      // Should NOT query database for admin
      expect(db.projects.getUserRole).not.toHaveBeenCalled();
    });

    it('should return member-level permissions for member role', async () => {
      db.projects.getUserRole.mockResolvedValue('member');
      const request = {
        authUser: { id: 'user-1', role: 'user' },
        query: { projectId: 'project-1' },
      };
      const reply = createMockReply();

      await handler(request, reply);

      const responseData = reply.send.mock.calls[0][0].data;
      expect(responseData.project.canUpload).toBe(true);
      expect(responseData.project.canView).toBe(true);
      expect(responseData.project.canManageIntegrations).toBe(false);
      expect(responseData.project.canDeleteReports).toBe(false);
    });
  });

  // ============================================================================
  // ORGANIZATION PERMISSIONS
  // ============================================================================

  describe('organization permissions', () => {
    it('should omit organization field when organizationId not provided', async () => {
      const request = {
        authUser: { id: 'user-1', role: 'user' },
        query: {},
      };
      const reply = createMockReply();

      await handler(request, reply);

      const responseData = reply.send.mock.calls[0][0].data;
      expect(responseData.organization).toBeUndefined();
    });

    it('should return org permissions for an org owner', async () => {
      db.organizationMembers.checkOrganizationAccess.mockResolvedValue({
        organization: { id: 'org-1' },
        membership: { role: 'owner', user_id: 'user-1', organization_id: 'org-1' },
      });
      const request = {
        authUser: { id: 'user-1', role: 'user' },
        query: { organizationId: 'org-1' },
      };
      const reply = createMockReply();

      await handler(request, reply);

      const responseData = reply.send.mock.calls[0][0].data;
      expect(responseData.organization).toEqual({
        role: 'owner',
        canManageMembers: true,
        canManageInvitations: true,
        canManageBilling: true,
      });
    });

    it('should return limited permissions for org member', async () => {
      db.organizationMembers.checkOrganizationAccess.mockResolvedValue({
        organization: { id: 'org-1' },
        membership: { role: 'member', user_id: 'user-1', organization_id: 'org-1' },
      });
      const request = {
        authUser: { id: 'user-1', role: 'user' },
        query: { organizationId: 'org-1' },
      };
      const reply = createMockReply();

      await handler(request, reply);

      const responseData = reply.send.mock.calls[0][0].data;
      expect(responseData.organization.canManageMembers).toBe(false);
      expect(responseData.organization.canManageInvitations).toBe(false);
      expect(responseData.organization.canManageBilling).toBe(false);
    });

    it('should return admin-level permissions for org admin', async () => {
      db.organizationMembers.checkOrganizationAccess.mockResolvedValue({
        organization: { id: 'org-1' },
        membership: { role: 'admin', user_id: 'user-1', organization_id: 'org-1' },
      });
      const request = {
        authUser: { id: 'user-1', role: 'user' },
        query: { organizationId: 'org-1' },
      };
      const reply = createMockReply();

      await handler(request, reply);

      const responseData = reply.send.mock.calls[0][0].data;
      expect(responseData.organization.canManageMembers).toBe(false);
      expect(responseData.organization.canManageInvitations).toBe(true);
      expect(responseData.organization.canManageBilling).toBe(false);
    });

    it('should omit organization field when user has no org membership', async () => {
      db.organizationMembers.checkOrganizationAccess.mockResolvedValue({
        organization: { id: 'org-1' },
        membership: null,
      });
      const request = {
        authUser: { id: 'user-1', role: 'user' },
        query: { organizationId: 'org-1' },
      };
      const reply = createMockReply();

      await handler(request, reply);

      const responseData = reply.send.mock.calls[0][0].data;
      expect(responseData.organization).toBeUndefined();
    });

    it('should give system admin full org permissions without membership', async () => {
      const request = {
        authUser: { id: 'admin-1', role: 'admin' },
        query: { organizationId: 'org-1' },
      };
      const reply = createMockReply();

      await handler(request, reply);

      const responseData = reply.send.mock.calls[0][0].data;
      expect(responseData.organization.canManageMembers).toBe(true);
      expect(responseData.organization.canManageInvitations).toBe(true);
      expect(responseData.organization.canManageBilling).toBe(true);
      // Should flag as system admin (not actual membership)
      expect(responseData.organization.isSystemAdmin).toBe(true);
      // Should NOT query database for admin
      expect(db.organizationMembers.checkOrganizationAccess).not.toHaveBeenCalled();
    });
  });

  // ============================================================================
  // COMBINED QUERIES
  // ============================================================================

  describe('combined project and org queries', () => {
    it('should return both project and org permissions when both IDs provided', async () => {
      db.projects.getUserRole.mockResolvedValue('member');
      db.organizationMembers.checkOrganizationAccess.mockResolvedValue({
        organization: { id: 'org-1' },
        membership: { role: 'owner', user_id: 'user-1', organization_id: 'org-1' },
      });

      const request = {
        authUser: { id: 'user-1', role: 'user' },
        query: { projectId: 'project-1', organizationId: 'org-1' },
      };
      const reply = createMockReply();

      await handler(request, reply);

      const responseData = reply.send.mock.calls[0][0].data;
      expect(responseData.system).toBeDefined();
      expect(responseData.project).toBeDefined();
      expect(responseData.organization).toBeDefined();
      expect(responseData.project.role).toBe('member');
      expect(responseData.organization.role).toBe('owner');
    });
  });
});
