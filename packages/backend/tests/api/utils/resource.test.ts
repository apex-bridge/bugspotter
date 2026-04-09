/**
 * Resource utilities tests
 * Tests for checkPermission and checkProjectAccess functions
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DatabaseClient } from '../../../src/db/client.js';
import { checkPermission, checkProjectAccess } from '../../../src/api/utils/resource.js';
import { AppError } from '../../../src/api/middleware/error.js';
import type { User, Project, ApiKey } from '../../../src/db/types.js';

const TEST_DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/test';

describe('Resource Utils', () => {
  let db: DatabaseClient;
  let adminUser: User;
  let regularUser: User;
  let viewerUser: User;
  let projectAdminUser: User; // System role='user', project role='admin'
  let testProject: Project;

  beforeAll(async () => {
    db = DatabaseClient.create({
      connectionString: TEST_DATABASE_URL,
    });

    const isConnected = await db.testConnection();
    if (!isConnected) {
      throw new Error('Failed to connect to test database');
    }

    // Create test users
    adminUser = await db.users.create({
      email: `admin-resource-${Date.now()}@test.com`,
      password_hash: 'hash1',
      role: 'admin',
    });

    regularUser = await db.users.create({
      email: `user-resource-${Date.now()}@test.com`,
      password_hash: 'hash2',
      role: 'user',
    });

    viewerUser = await db.users.create({
      email: `viewer-resource-${Date.now()}@test.com`,
      password_hash: 'hash3',
      role: 'viewer',
    });

    projectAdminUser = await db.users.create({
      email: `projadmin-resource-${Date.now()}@test.com`,
      password_hash: 'hash4',
      role: 'user',
    });

    // Create test project
    testProject = await db.projects.create({
      name: 'Resource Test Project',
      created_by: adminUser.id,
    });

    // Add regular user as project member
    await db.projectMembers.addMember(testProject.id, regularUser.id, 'member');

    // Add viewer user as project member
    await db.projectMembers.addMember(testProject.id, viewerUser.id, 'viewer');

    // Add project admin user as project member with 'admin' role
    await db.projectMembers.addMember(testProject.id, projectAdminUser.id, 'admin');
  });

  afterAll(async () => {
    // Clean up
    if (testProject) {
      await db.projectMembers.removeMember(testProject.id, regularUser.id);
      await db.projectMembers.removeMember(testProject.id, viewerUser.id);
      await db.projectMembers.removeMember(testProject.id, projectAdminUser.id);
      await db.projects.delete(testProject.id);
    }

    if (adminUser) {
      await db.users.delete(adminUser.id);
    }
    if (regularUser) {
      await db.users.delete(regularUser.id);
    }
    if (viewerUser) {
      await db.users.delete(viewerUser.id);
    }
    if (projectAdminUser) {
      await db.users.delete(projectAdminUser.id);
    }

    await db.close();
  });

  describe('checkPermission', () => {
    it('should allow admin users to perform any action', async () => {
      // Admin should bypass permission checks
      await expect(
        checkPermission(adminUser, 'integration_rules', 'create', db)
      ).resolves.toBeUndefined();

      await expect(
        checkPermission(adminUser, 'integration_rules', 'delete', db)
      ).resolves.toBeUndefined();

      // Verify admin bypass works even for non-existent permissions
      await expect(
        checkPermission(adminUser, 'nonexistent_resource_xyz', 'nonexistent_action_xyz', db)
      ).resolves.toBeUndefined();
    });

    it('should allow users with correct permission', async () => {
      // User role has create permission for integration_rules (from migration 003)
      await expect(
        checkPermission(regularUser, 'integration_rules', 'create', db)
      ).resolves.toBeUndefined();

      await expect(
        checkPermission(regularUser, 'integration_rules', 'read', db)
      ).resolves.toBeUndefined();
    });

    it('should deny users without permission', async () => {
      // Viewer role doesn't have create permission for integration_rules
      await expect(checkPermission(viewerUser, 'integration_rules', 'create', db)).rejects.toThrow(
        AppError
      );

      try {
        await checkPermission(viewerUser, 'integration_rules', 'create', db);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error).toBeInstanceOf(AppError);
        expect((error as AppError).message).toBe(
          'Insufficient permissions to create integration_rules'
        );
        expect((error as AppError).statusCode).toBe(403);
        expect((error as AppError).error).toBe('Forbidden');
      }
    });

    it('should allow viewer to read but not modify', async () => {
      // Viewer has read permission
      await expect(
        checkPermission(viewerUser, 'integration_rules', 'read', db)
      ).resolves.toBeUndefined();

      // Viewer doesn't have update permission
      await expect(checkPermission(viewerUser, 'integration_rules', 'update', db)).rejects.toThrow(
        AppError
      );

      // Viewer doesn't have delete permission
      await expect(checkPermission(viewerUser, 'integration_rules', 'delete', db)).rejects.toThrow(
        AppError
      );
    });

    it('should throw 401 if no user provided', async () => {
      try {
        await checkPermission(undefined, 'integration_rules', 'read', db);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error).toBeInstanceOf(AppError);
        expect((error as AppError).message).toBe('Authentication required');
        expect((error as AppError).statusCode).toBe(401);
        expect((error as AppError).error).toBe('Unauthorized');
      }
    });

    it('should deny access to non-existent permissions', async () => {
      await expect(
        checkPermission(regularUser, 'non_existent_resource', 'read', db)
      ).rejects.toThrow(AppError);
    });
  });

  describe('checkProjectAccess', () => {
    it('should allow API key authentication when project matches', async () => {
      const apiKeyProject: Project = testProject;

      await expect(
        checkProjectAccess(testProject.id, undefined, apiKeyProject, db)
      ).resolves.toBeUndefined();
    });

    it('should deny API key authentication when project does not match', async () => {
      const otherProject = await db.projects.create({
        name: 'Other Project',
        created_by: adminUser.id,
      });

      await expect(
        checkProjectAccess(testProject.id, undefined, otherProject, db)
      ).rejects.toMatchObject({
        message: 'Access denied to Resource',
        statusCode: 403,
      });

      await db.projects.delete(otherProject.id);
    });

    it('should work with JWT auth without permission options (backward compatible)', async () => {
      // Regular user is a member of testProject
      await expect(
        checkProjectAccess(testProject.id, regularUser, undefined, db)
      ).resolves.toBeUndefined();
    });

    it('should check permissions when resource and action are provided', async () => {
      // Regular user has create permission for integration_rules
      await expect(
        checkProjectAccess(testProject.id, regularUser, undefined, db, 'Integration Rules', {
          resource: 'integration_rules',
          action: 'create',
        })
      ).resolves.toBeUndefined();

      // Viewer doesn't have create permission
      await expect(
        checkProjectAccess(testProject.id, viewerUser, undefined, db, 'Integration Rules', {
          resource: 'integration_rules',
          action: 'create',
        })
      ).rejects.toMatchObject({
        message: 'Insufficient permissions to create integration_rules',
        statusCode: 403,
      });
    });

    it('should allow admin access even without project membership', async () => {
      // Create project without admin as member
      const isolatedProject = await db.projects.create({
        name: 'Isolated Project',
        created_by: regularUser.id,
      });

      // Admin should still have access
      await expect(
        checkProjectAccess(isolatedProject.id, adminUser, undefined, db)
      ).resolves.toBeUndefined();

      await db.projects.delete(isolatedProject.id);
    });

    it('should deny access to users not in project', async () => {
      const otherUser = await db.users.create({
        email: `outsider-${Date.now()}@test.com`,
        password_hash: 'hash',
        role: 'user',
      });

      await expect(
        checkProjectAccess(testProject.id, otherUser, undefined, db)
      ).rejects.toMatchObject({
        message: 'Access denied to Resource',
        statusCode: 403,
      });

      await db.users.delete(otherUser.id);
    });

    it('should throw 401 if no authentication provided', async () => {
      await expect(
        checkProjectAccess(testProject.id, undefined, undefined, db)
      ).rejects.toMatchObject({
        message: 'Authentication required',
        statusCode: 401,
      });
    });

    it('should use custom resource name in error messages', async () => {
      const otherUser = await db.users.create({
        email: `outsider2-${Date.now()}@test.com`,
        password_hash: 'hash',
        role: 'user',
      });

      await expect(
        checkProjectAccess(testProject.id, otherUser, undefined, db, 'Integration Rules')
      ).rejects.toMatchObject({
        message: 'Access denied to Integration Rules',
        statusCode: 403,
      });

      await db.users.delete(otherUser.id);
    });

    // ========================================================================
    // FULL-SCOPE API KEY TESTS (options.apiKey)
    // ========================================================================

    it('should allow full-scope API key access (empty allowed_projects)', async () => {
      const fullScopeKey = {
        allowed_projects: [], // Empty = full scope
      } as unknown as ApiKey;

      // Should allow access to any project
      await expect(
        checkProjectAccess(testProject.id, undefined, undefined, db, 'Resource', {
          apiKey: fullScopeKey,
        })
      ).resolves.toBeUndefined();
    });

    it('should allow full-scope API key access (null allowed_projects)', async () => {
      const fullScopeKey = {
        allowed_projects: null, // Null = full scope
      } as unknown as ApiKey;

      await expect(
        checkProjectAccess(testProject.id, undefined, undefined, db, 'Resource', {
          apiKey: fullScopeKey,
        })
      ).resolves.toBeUndefined();
    });

    it('should allow full-scope API key when project in allowed_projects', async () => {
      const limitedScopeKey = {
        allowed_projects: [testProject.id, 'other-project-id'], // Specific projects
      } as unknown as ApiKey;

      await expect(
        checkProjectAccess(testProject.id, undefined, undefined, db, 'Resource', {
          apiKey: limitedScopeKey,
        })
      ).resolves.toBeUndefined();
    });

    it('should deny full-scope API key when project not in allowed_projects', async () => {
      const restrictedKey = {
        allowed_projects: ['other-project-1', 'other-project-2'], // testProject.id NOT included
      } as unknown as ApiKey;

      await expect(
        checkProjectAccess(testProject.id, undefined, undefined, db, 'Resource', {
          apiKey: restrictedKey,
        })
      ).rejects.toMatchObject({
        message: 'Access denied to Resource',
        statusCode: 403,
      });
    });

    it('should prioritize JWT user over full-scope API key', async () => {
      const fullScopeKey = {
        allowed_projects: null, // Full scope
      } as unknown as ApiKey;

      // User NOT in project should still fail (JWT takes precedence)
      const outsiderUser = await db.users.create({
        email: `outsider-precedence-${Date.now()}@test.com`,
        password_hash: 'hash',
        role: 'user',
      });

      await expect(
        checkProjectAccess(testProject.id, outsiderUser, undefined, db, 'Resource', {
          apiKey: fullScopeKey, // Full-scope key present but ignored
        })
      ).rejects.toMatchObject({
        message: 'Access denied to Resource',
        statusCode: 403,
      });

      await db.users.delete(outsiderUser.id);
    });

    it('should prioritize project-scoped key over full-scope API key', async () => {
      const fullScopeKey = {
        allowed_projects: null, // Full scope
      } as unknown as ApiKey;

      // Create another project for project-scoped key
      const otherProject = await db.projects.create({
        name: 'Other Project for Precedence Test',
        created_by: adminUser.id,
      });

      // Project-scoped key doesn't match testProject.id, should fail
      await expect(
        checkProjectAccess(testProject.id, undefined, otherProject, db, 'Resource', {
          apiKey: fullScopeKey, // Full-scope key present but ignored
        })
      ).rejects.toMatchObject({
        message: 'Access denied to Resource',
        statusCode: 403,
      });

      await db.projects.delete(otherProject.id);
    });

    it('should use full-scope API key when only apiKey present', async () => {
      const fullScopeKey = {
        allowed_projects: [], // Empty = full scope
      } as unknown as ApiKey;

      // No authUser, no authProject - only apiKey
      await expect(
        checkProjectAccess(testProject.id, undefined, undefined, db, 'Resource', {
          apiKey: fullScopeKey,
        })
      ).resolves.toBeUndefined();
    });
  });

  // ========================================================================
  // MINIMUM PROJECT ROLE TESTS (options.minProjectRole)
  // ========================================================================
  // Project member roles in test setup:
  //   adminUser      — system admin (bypasses all checks)
  //   projectAdminUser — system role='user', project role='admin'
  //   regularUser    — system role='user', project role='member'
  //   viewerUser     — system role='viewer', project role='viewer'

  describe('checkProjectAccess with minProjectRole', () => {
    // --- viewer threshold ---

    it('should allow viewer when minProjectRole is viewer', async () => {
      await expect(
        checkProjectAccess(testProject.id, viewerUser, undefined, db, 'Bug report', {
          minProjectRole: 'viewer',
        })
      ).resolves.toBeUndefined();
    });

    it('should allow member when minProjectRole is viewer', async () => {
      await expect(
        checkProjectAccess(testProject.id, regularUser, undefined, db, 'Bug report', {
          minProjectRole: 'viewer',
        })
      ).resolves.toBeUndefined();
    });

    it('should allow project admin when minProjectRole is viewer', async () => {
      await expect(
        checkProjectAccess(testProject.id, projectAdminUser, undefined, db, 'Bug report', {
          minProjectRole: 'viewer',
        })
      ).resolves.toBeUndefined();
    });

    // --- member threshold ---

    it('should allow member when minProjectRole is member', async () => {
      await expect(
        checkProjectAccess(testProject.id, regularUser, undefined, db, 'Bug report', {
          minProjectRole: 'member',
        })
      ).resolves.toBeUndefined();
    });

    it('should deny viewer when minProjectRole is member', async () => {
      await expect(
        checkProjectAccess(testProject.id, viewerUser, undefined, db, 'Bug report', {
          minProjectRole: 'member',
        })
      ).rejects.toMatchObject({
        message: 'Insufficient project role for Bug report. Requires member or above.',
        statusCode: 403,
        error: 'Forbidden',
      });
    });

    it('should allow project admin when minProjectRole is member', async () => {
      await expect(
        checkProjectAccess(testProject.id, projectAdminUser, undefined, db, 'Bug report', {
          minProjectRole: 'member',
        })
      ).resolves.toBeUndefined();
    });

    // --- admin threshold ---

    it('should allow project admin when minProjectRole is admin', async () => {
      await expect(
        checkProjectAccess(testProject.id, projectAdminUser, undefined, db, 'Integration Rules', {
          minProjectRole: 'admin',
        })
      ).resolves.toBeUndefined();
    });

    it('should deny member when minProjectRole is admin', async () => {
      await expect(
        checkProjectAccess(testProject.id, regularUser, undefined, db, 'Integration Rules', {
          minProjectRole: 'admin',
        })
      ).rejects.toMatchObject({
        message: 'Insufficient project role for Integration Rules. Requires admin or above.',
        statusCode: 403,
        error: 'Forbidden',
      });
    });

    it('should deny viewer when minProjectRole is admin', async () => {
      await expect(
        checkProjectAccess(testProject.id, viewerUser, undefined, db, 'Integration Rules', {
          minProjectRole: 'admin',
        })
      ).rejects.toMatchObject({
        message: 'Insufficient project role for Integration Rules. Requires admin or above.',
        statusCode: 403,
        error: 'Forbidden',
      });
    });

    // --- owner threshold ---

    it('should deny project admin when minProjectRole is owner', async () => {
      await expect(
        checkProjectAccess(testProject.id, projectAdminUser, undefined, db, 'Project', {
          minProjectRole: 'owner',
        })
      ).rejects.toMatchObject({
        message: 'Insufficient project role for Project. Requires owner or above.',
        statusCode: 403,
        error: 'Forbidden',
      });
    });

    // --- non-member ---

    it('should deny non-member even with minProjectRole=viewer', async () => {
      const outsider = await db.users.create({
        email: `outsider-role-${Date.now()}@test.com`,
        password_hash: 'hash',
        role: 'user',
      });

      await expect(
        checkProjectAccess(testProject.id, outsider, undefined, db, 'Bug report', {
          minProjectRole: 'viewer',
        })
      ).rejects.toMatchObject({
        message: 'Access denied to Bug report',
        statusCode: 403,
      });

      await db.users.delete(outsider.id);
    });

    // --- system admin bypass ---

    it('should allow system admin regardless of minProjectRole', async () => {
      // adminUser is system admin (role='admin'), bypasses all project role checks
      await expect(
        checkProjectAccess(testProject.id, adminUser, undefined, db, 'Resource', {
          minProjectRole: 'owner',
        })
      ).resolves.toBeUndefined();
    });

    // --- API key bypass ---

    it('should allow full-scope API key regardless of minProjectRole', async () => {
      const fullScopeKey = {
        allowed_projects: [],
      } as unknown as ApiKey;

      await expect(
        checkProjectAccess(testProject.id, undefined, undefined, db, 'Resource', {
          apiKey: fullScopeKey,
          minProjectRole: 'owner',
        })
      ).resolves.toBeUndefined();
    });

    it('should allow project-scoped API key regardless of minProjectRole', async () => {
      await expect(
        checkProjectAccess(testProject.id, undefined, testProject, db, 'Resource', {
          minProjectRole: 'owner',
        })
      ).resolves.toBeUndefined();
    });

    // --- backward compatibility ---

    it('should fall back to boolean membership when minProjectRole is not specified', async () => {
      // regularUser is a project member — should pass without minProjectRole
      await expect(
        checkProjectAccess(testProject.id, regularUser, undefined, db, 'Resource')
      ).resolves.toBeUndefined();

      // viewerUser is also a project member — should pass without minProjectRole
      await expect(
        checkProjectAccess(testProject.id, viewerUser, undefined, db, 'Resource')
      ).resolves.toBeUndefined();
    });
  });
});
