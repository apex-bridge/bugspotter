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
vi.mock('../../../src/types/project-roles.js', () => {
  const hierarchy: Record<string, number> = {
    owner: 4,
    admin: 3,
    member: 2,
    viewer: 1,
  };
  return {
    isProjectRole: vi.fn((role: string) => ['owner', 'admin', 'member', 'viewer'].includes(role)),
    hasPermissionLevel: vi.fn((userRole: string, requiredRole: string) => {
      return (hierarchy[userRole] || 0) >= (hierarchy[requiredRole] || 0);
    }),
    pickHigherProjectRole: vi.fn(
      (explicit: string | null | undefined, inherited: string | null | undefined) => {
        if (!explicit && !inherited) {
          return null;
        }
        if (!explicit) {
          return inherited;
        }
        if (!inherited) {
          return explicit;
        }
        return (hierarchy[explicit] || 0) >= (hierarchy[inherited] || 0) ? explicit : inherited;
      }
    ),
  };
});

// Mock the inherited-role helper so the permissions route can be tested
// in isolation without standing up the org-membership lookup chain.
// Default returns null (no inheritance); individual tests override per-case.
vi.mock('../../../src/api/utils/resource.js', () => ({
  lookupInheritedProjectRole: vi.fn().mockResolvedValue(null),
}));

// Mock db types
vi.mock('../../../src/db/types.js', () => ({
  ROLE_LEVEL: { owner: 3, admin: 2, member: 1 },
  ORG_MEMBER_ROLE: { OWNER: 'owner', ADMIN: 'admin', MEMBER: 'member' },
}));

// Import after mocks
import { permissionRoutes } from '../../../src/api/routes/permissions.js';
import { lookupInheritedProjectRole } from '../../../src/api/utils/resource.js';
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
    // Reset the inherited-role mock between tests — default behaviour
    // is "no inheritance" (null), matching the pre-existing test
    // assumptions. Tests that exercise the org-inheritance path
    // override per-case via mockResolvedValueOnce.
    vi.mocked(lookupInheritedProjectRole).mockReset();
    vi.mocked(lookupInheritedProjectRole).mockResolvedValue(null);
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
    it('returns both project and org permissions when both IDs provided (explicit-only project role)', async () => {
      db.projects.getUserRole.mockResolvedValue('admin');
      // Pretend the user is NOT an org member here, so the inheritance
      // path doesn't kick in and project.role reflects only the explicit
      // project_members row.
      vi.mocked(lookupInheritedProjectRole).mockResolvedValue(null);
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
      expect(responseData.project.role).toBe('admin');
      expect(responseData.organization.role).toBe('owner');
    });
  });

  // ============================================================================
  // EFFECTIVE PROJECT ROLE (org → project inheritance)
  // ============================================================================
  //
  // The route enforcement layer (`requireProjectAccess` →
  // `pickHigherProjectRole`) has always granted org-owners admin-equivalent
  // access on projects in their org. Until this fix, the permissions
  // endpoint returned only the explicit project_members role, so the UI
  // rendered disabled buttons for actions the API would actually allow.
  // These tests pin the corrected behaviour: project.role reflects the
  // effective role (max of explicit + org-inherited), matching what
  // enforcement would honour.
  describe('effective project role (org-inheritance)', () => {
    it('org-owner with no explicit project membership gets admin-equivalent perms', async () => {
      db.projects.getUserRole.mockResolvedValue(null);
      // ORG_TO_PROJECT_ROLE['owner'] === 'admin'
      vi.mocked(lookupInheritedProjectRole).mockResolvedValue('admin');

      const request = {
        authUser: { id: 'user-1', role: 'user' },
        query: { projectId: 'project-1' },
      };
      const reply = createMockReply();

      await handler(request, reply);

      const responseData = reply.send.mock.calls[0][0].data;
      expect(responseData.project).toBeDefined();
      expect(responseData.project.role).toBe('admin');
      expect(responseData.project.canManageIntegrations).toBe(true);
      expect(responseData.project.canEditProject).toBe(true);
      expect(responseData.project.canManageMembers).toBe(true);
      // Org-owner inherits to project-admin, not project-owner — so
      // canDeleteProject (which requires explicit 'owner') stays false.
      expect(responseData.project.canDeleteProject).toBe(false);
    });

    it('org-owner with explicit viewer membership still gets admin (inherited wins)', async () => {
      // This is the exact scenario behind the original bug report:
      // demo-login@bugspotter.io has org.role='owner' AND
      // project.role='viewer', and previously the API said
      // canManageIntegrations=false (UI disabled Add Integration).
      db.projects.getUserRole.mockResolvedValue('viewer');
      vi.mocked(lookupInheritedProjectRole).mockResolvedValue('admin');

      const request = {
        authUser: { id: 'user-1', role: 'user' },
        query: { projectId: 'project-1' },
      };
      const reply = createMockReply();

      await handler(request, reply);

      const responseData = reply.send.mock.calls[0][0].data;
      expect(responseData.project.role).toBe('admin');
      expect(responseData.project.canManageIntegrations).toBe(true);
    });

    it('explicit owner beats inherited admin (explicit wins when higher)', async () => {
      // The opposite case — a project owner who is also a regular org
      // member shouldn't be downgraded by the inheritance path.
      db.projects.getUserRole.mockResolvedValue('owner');
      vi.mocked(lookupInheritedProjectRole).mockResolvedValue('viewer');

      const request = {
        authUser: { id: 'user-1', role: 'user' },
        query: { projectId: 'project-1' },
      };
      const reply = createMockReply();

      await handler(request, reply);

      const responseData = reply.send.mock.calls[0][0].data;
      expect(responseData.project.role).toBe('owner');
      expect(responseData.project.canDeleteProject).toBe(true);
    });

    it('no explicit + no inherited role → project field omitted', async () => {
      db.projects.getUserRole.mockResolvedValue(null);
      vi.mocked(lookupInheritedProjectRole).mockResolvedValue(null);

      const request = {
        authUser: { id: 'user-1', role: 'user' },
        query: { projectId: 'project-1' },
      };
      const reply = createMockReply();

      await handler(request, reply);

      const responseData = reply.send.mock.calls[0][0].data;
      expect(responseData.project).toBeUndefined();
    });

    it('system admin path skips both lookups (regression guard)', async () => {
      // The system-admin branch returns synthetic 'owner' permissions
      // without hitting the DB. It must NOT call either lookup —
      // otherwise platform-admin requests would do unnecessary work
      // and surface confusing race conditions on missing-org projects.
      const request = {
        authUser: { id: 'admin-1', role: 'admin' },
        query: { projectId: 'project-1' },
      };
      const reply = createMockReply();

      await handler(request, reply);

      expect(db.projects.getUserRole).not.toHaveBeenCalled();
      expect(vi.mocked(lookupInheritedProjectRole)).not.toHaveBeenCalled();
    });
  });
});
