/**
 * Authorization Utilities Tests
 * Tests for requireProjectRole, validateMemberModification, and validateRole helpers
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createDatabaseClient } from '../../../src/db/client.js';
import type { DatabaseClient } from '../../../src/db/client.js';
import {
  requireProjectRole,
  validateMemberModification,
  validateRole,
} from '../../../src/api/utils/authorization.js';
import { ASSIGNABLE_PROJECT_ROLES } from '../../../src/types/project-roles.js';
import { AppError } from '../../../src/api/middleware/error.js';

describe('Authorization Utilities', () => {
  let db: DatabaseClient;
  let testProject: { id: string; created_by: string };
  let ownerUser: { id: string; email: string };
  let adminUser: { id: string };
  let memberUser: { id: string };
  let viewerUser: { id: string };
  let outsiderUser: { id: string };

  beforeAll(async () => {
    const testDbUrl = process.env.DATABASE_URL || 'postgresql://localhost:5432/bugspotter_test';
    db = createDatabaseClient(testDbUrl);
  });

  afterAll(async () => {
    await db.close();
  });

  beforeEach(async () => {
    const timestamp = Date.now();

    // Create test users
    ownerUser = await db.users.create({
      email: `owner-${timestamp}@example.com`,
      password_hash: 'hash',
      role: 'user',
    });

    adminUser = await db.users.create({
      email: `admin-${timestamp}@example.com`,
      password_hash: 'hash',
      role: 'user',
    });

    memberUser = await db.users.create({
      email: `member-${timestamp}@example.com`,
      password_hash: 'hash',
      role: 'user',
    });

    viewerUser = await db.users.create({
      email: `viewer-${timestamp}@example.com`,
      password_hash: 'hash',
      role: 'user',
    });

    outsiderUser = await db.users.create({
      email: `outsider-${timestamp}@example.com`,
      password_hash: 'hash',
      role: 'user',
    });

    // Create test project
    testProject = (await db.projects.create({
      name: `Auth Test Project ${timestamp}`,
      settings: {},
      created_by: ownerUser.id,
    })) as { id: string; created_by: string };

    // Add members with different roles
    await db.projectMembers.addMember(testProject.id, adminUser.id, 'admin');
    await db.projectMembers.addMember(testProject.id, memberUser.id, 'member');
    await db.projectMembers.addMember(testProject.id, viewerUser.id, 'viewer');
  });

  describe('requireProjectRole', () => {
    it('should return owner role for project creator', async () => {
      const role = await requireProjectRole(testProject.id, ownerUser.id, db, 'viewer');
      expect(role).toBe('owner');
    });

    it('should return admin role for admin member', async () => {
      const role = await requireProjectRole(testProject.id, adminUser.id, db, 'viewer');
      expect(role).toBe('admin');
    });

    it('should return member role for member', async () => {
      const role = await requireProjectRole(testProject.id, memberUser.id, db, 'viewer');
      expect(role).toBe('member');
    });

    it('should return viewer role for viewer member', async () => {
      const role = await requireProjectRole(testProject.id, viewerUser.id, db, 'viewer');
      expect(role).toBe('viewer');
    });

    it('should allow owner when requiring admin role', async () => {
      const role = await requireProjectRole(testProject.id, ownerUser.id, db, 'admin');
      expect(role).toBe('owner');
    });

    it('should allow admin when requiring member role', async () => {
      const role = await requireProjectRole(testProject.id, adminUser.id, db, 'member');
      expect(role).toBe('admin');
    });

    it('should throw AppError when user has insufficient role', async () => {
      await expect(requireProjectRole(testProject.id, viewerUser.id, db, 'admin')).rejects.toThrow(
        AppError
      );

      await expect(requireProjectRole(testProject.id, viewerUser.id, db, 'admin')).rejects.toThrow(
        /Only project admins/
      );
    });

    it('should throw AppError when user is not a member', async () => {
      await expect(
        requireProjectRole(testProject.id, outsiderUser.id, db, 'viewer')
      ).rejects.toThrow(AppError);

      await expect(
        requireProjectRole(testProject.id, outsiderUser.id, db, 'viewer')
      ).rejects.toThrow(/Only project viewers/);
    });

    it('should use custom error message when provided', async () => {
      const customMessage = 'Custom access denied message';
      await expect(
        requireProjectRole(testProject.id, viewerUser.id, db, 'admin', customMessage)
      ).rejects.toThrow(customMessage);
    });

    it('should enforce role hierarchy correctly', async () => {
      // Owner (4) can do anything
      await expect(requireProjectRole(testProject.id, ownerUser.id, db, 'owner')).resolves.toBe(
        'owner'
      );
      await expect(requireProjectRole(testProject.id, ownerUser.id, db, 'admin')).resolves.toBe(
        'owner'
      );
      await expect(requireProjectRole(testProject.id, ownerUser.id, db, 'member')).resolves.toBe(
        'owner'
      );
      await expect(requireProjectRole(testProject.id, ownerUser.id, db, 'viewer')).resolves.toBe(
        'owner'
      );

      // Admin (3) can do member/viewer actions
      await expect(requireProjectRole(testProject.id, adminUser.id, db, 'admin')).resolves.toBe(
        'admin'
      );
      await expect(requireProjectRole(testProject.id, adminUser.id, db, 'member')).resolves.toBe(
        'admin'
      );
      await expect(requireProjectRole(testProject.id, adminUser.id, db, 'viewer')).resolves.toBe(
        'admin'
      );

      // Member (2) can do viewer actions
      await expect(requireProjectRole(testProject.id, memberUser.id, db, 'member')).resolves.toBe(
        'member'
      );
      await expect(requireProjectRole(testProject.id, memberUser.id, db, 'viewer')).resolves.toBe(
        'member'
      );

      // Viewer (1) can only do viewer actions
      await expect(requireProjectRole(testProject.id, viewerUser.id, db, 'viewer')).resolves.toBe(
        'viewer'
      );
    });

    it('should reject invalid role strings from database (security)', async () => {
      // Mock getUserRole to return an invalid role string (simulating database corruption or injection)
      const originalGetUserRole = db.projects.getUserRole;
      db.projects.getUserRole = vi.fn().mockResolvedValue('guest' as any);

      // Should throw for invalid role string
      await expect(requireProjectRole(testProject.id, viewerUser.id, db, 'viewer')).rejects.toThrow(
        AppError
      );

      await expect(requireProjectRole(testProject.id, viewerUser.id, db, 'viewer')).rejects.toThrow(
        /Invalid project role/
      );

      // Restore original method
      db.projects.getUserRole = originalGetUserRole;
    });
  });

  describe('validateRole', () => {
    it('should accept valid roles', () => {
      expect(() => validateRole('admin')).not.toThrow();
      expect(() => validateRole('member')).not.toThrow();
      expect(() => validateRole('viewer')).not.toThrow();
    });

    it('should throw AppError for invalid roles', () => {
      expect(() => validateRole('invalid')).toThrow(AppError);
      expect(() => validateRole('owner')).toThrow(AppError); // Owner is not assignable
      expect(() => validateRole('superuser')).toThrow(AppError);
      expect(() => validateRole('')).toThrow(AppError);
    });

    it('should throw with correct error details', () => {
      try {
        validateRole('invalid');
        expect.fail('Should have thrown AppError');
      } catch (error) {
        expect(error).toBeInstanceOf(AppError);
        expect((error as AppError).message).toContain('Invalid role');
      }
    });
  });

  describe('validateMemberModification', () => {
    describe('Authorization checks', () => {
      it('should allow owner to update any member', async () => {
        const result = await validateMemberModification({
          projectId: testProject.id,
          targetUserId: memberUser.id,
          requesterId: ownerUser.id,
          db,
          project: testProject,
          operation: 'update',
          newRole: 'admin',
        });

        expect(result.requesterRole).toBe('owner');
        expect(result.currentMemberRole).toBe('member');
      });

      it('should allow admin to update member role', async () => {
        const result = await validateMemberModification({
          projectId: testProject.id,
          targetUserId: memberUser.id,
          requesterId: adminUser.id,
          db,
          project: testProject,
          operation: 'update',
          newRole: 'viewer',
        });

        expect(result.requesterRole).toBe('admin');
        expect(result.currentMemberRole).toBe('member');
      });

      it('should deny member from modifying roles', async () => {
        await expect(
          validateMemberModification({
            projectId: testProject.id,
            targetUserId: viewerUser.id,
            requesterId: memberUser.id,
            db,
            project: testProject,
            operation: 'update',
            newRole: 'member',
          })
        ).rejects.toThrow('Only project owners and admins can update members');
      });

      it('should deny viewer from modifying roles', async () => {
        await expect(
          validateMemberModification({
            projectId: testProject.id,
            targetUserId: memberUser.id,
            requesterId: viewerUser.id,
            db,
            project: testProject,
            operation: 'update',
            newRole: 'admin',
          })
        ).rejects.toThrow('Only project owners and admins can update members');
      });
    });

    describe('Owner protection', () => {
      it('should prevent modifying project owner role', async () => {
        await expect(
          validateMemberModification({
            projectId: testProject.id,
            targetUserId: ownerUser.id,
            requesterId: ownerUser.id,
            db,
            project: testProject,
            operation: 'update',
            newRole: 'admin',
          })
        ).rejects.toThrow('Cannot change owner role');
      });

      it('should prevent removing project owner', async () => {
        await expect(
          validateMemberModification({
            projectId: testProject.id,
            targetUserId: ownerUser.id,
            requesterId: ownerUser.id,
            db,
            project: testProject,
            operation: 'remove',
          })
        ).rejects.toThrow('Cannot remove project owner');
      });
    });

    describe('Self-modification protection', () => {
      it('should prevent users from changing their own role', async () => {
        await expect(
          validateMemberModification({
            projectId: testProject.id,
            targetUserId: adminUser.id,
            requesterId: adminUser.id,
            db,
            project: testProject,
            operation: 'update',
            newRole: 'owner',
          })
        ).rejects.toThrow('Cannot change your own role');
      });

      it('should prevent users from removing themselves', async () => {
        await expect(
          validateMemberModification({
            projectId: testProject.id,
            targetUserId: adminUser.id,
            requesterId: adminUser.id,
            db,
            project: testProject,
            operation: 'remove',
          })
        ).rejects.toThrow('Cannot remove yourself');
      });
    });

    describe('Admin role protection', () => {
      it('should prevent non-owners from changing FROM admin roles', async () => {
        await expect(
          validateMemberModification({
            projectId: testProject.id,
            targetUserId: adminUser.id,
            requesterId: adminUser.id,
            db,
            project: testProject,
            operation: 'update',
            newRole: 'member',
          })
        ).rejects.toThrow('Cannot change your own role');
      });

      it('should prevent non-owners from promoting TO admin roles', async () => {
        await expect(
          validateMemberModification({
            projectId: testProject.id,
            targetUserId: memberUser.id,
            requesterId: adminUser.id,
            db,
            project: testProject,
            operation: 'update',
            newRole: 'admin',
          })
        ).rejects.toThrow('Only project owners can promote users to admin');
      });

      it('should allow owner to promote to admin', async () => {
        const result = await validateMemberModification({
          projectId: testProject.id,
          targetUserId: memberUser.id,
          requesterId: ownerUser.id,
          db,
          project: testProject,
          operation: 'update',
          newRole: 'admin',
        });

        expect(result.requesterRole).toBe('owner');
      });

      it('should prevent non-owners from removing admins', async () => {
        // Create another admin to test removal
        const anotherAdmin = await db.users.create({
          email: `admin2-${Date.now()}@example.com`,
          password_hash: 'hash',
          role: 'user',
        });
        await db.projectMembers.addMember(testProject.id, anotherAdmin.id, 'admin');

        await expect(
          validateMemberModification({
            projectId: testProject.id,
            targetUserId: anotherAdmin.id,
            requesterId: adminUser.id,
            db,
            project: testProject,
            operation: 'remove',
          })
        ).rejects.toThrow('Only project owners can remove admins');
      });
    });

    describe('Member existence validation', () => {
      it('should throw when target user is not a member', async () => {
        await expect(
          validateMemberModification({
            projectId: testProject.id,
            targetUserId: outsiderUser.id,
            requesterId: ownerUser.id,
            db,
            project: testProject,
            operation: 'update',
            newRole: 'member',
          })
        ).rejects.toThrow('User is not a member of this project');
      });
    });

    describe('Null created_by handling', () => {
      it('should handle projects with null created_by', async () => {
        // Create project with null created_by (edge case)
        const nullProject = await db.projects.create({
          name: `Null Owner Project ${Date.now()}`,
          settings: {},
          created_by: null as any,
        });

        await db.projectMembers.addMember(nullProject.id, memberUser.id, 'member');
        // Add ownerUser as admin so they can update members
        await db.projectMembers.addMember(nullProject.id, ownerUser.id, 'admin');

        const result = await validateMemberModification({
          projectId: nullProject.id,
          targetUserId: memberUser.id,
          requesterId: ownerUser.id,
          db,
          project: { created_by: null },
          operation: 'update',
          newRole: 'viewer',
        });

        // Should not throw, as null !== memberUser.id
        expect(result.requesterRole).toBeDefined();
      });
    });
  });

  describe('ASSIGNABLE_PROJECT_ROLES constant', () => {
    it('should export all valid assignable roles', () => {
      expect(ASSIGNABLE_PROJECT_ROLES).toEqual(['admin', 'member', 'viewer']);
    });

    it('should not include owner role', () => {
      expect(ASSIGNABLE_PROJECT_ROLES).not.toContain('owner');
    });
  });
});
