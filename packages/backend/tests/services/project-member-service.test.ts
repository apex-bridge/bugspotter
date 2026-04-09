/**
 * Project Member Service Tests
 * Unit tests for business logic
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ProjectMemberService } from '../../src/services/project-member-service.js';
import { AppError } from '../../src/api/middleware/error.js';
import type { DatabaseClient } from '../../src/db/client.js';
import type { Project } from '../../src/db/types.js';

describe('ProjectMemberService', () => {
  let service: ProjectMemberService;
  let mockDb: DatabaseClient;
  let testProject: Project;

  beforeEach(() => {
    // Create mock database client
    mockDb = {
      users: {
        findById: vi.fn(),
      },
      projects: {
        hasAccess: vi.fn(),
        getUserRole: vi.fn(),
        getProjectMembers: vi.fn(),
      },
      projectMembers: {
        addMember: vi.fn(),
        updateMemberRole: vi.fn(),
        removeMember: vi.fn(),
        getMemberByUserId: vi.fn(),
      },
    } as any;

    service = new ProjectMemberService(mockDb);

    testProject = {
      id: 'project-123',
      name: 'Test Project',
      created_by: 'owner-456',
      settings: {},
      created_at: new Date(),
      updated_at: new Date(),
    };
  });

  describe('addMember', () => {
    it('should successfully add a new member', async () => {
      const targetUserId = 'user-789';
      const requesterId = 'owner-456';
      const role: 'member' = 'member';

      // Mock requester has admin role
      vi.mocked(mockDb.projects.getUserRole).mockResolvedValue('admin');

      // Mock target user exists
      vi.mocked(mockDb.users.findById).mockResolvedValue({
        id: targetUserId,
        email: 'user@example.com',
      } as any);

      // Mock user is not already a member
      vi.mocked(mockDb.projects.hasAccess).mockResolvedValue(false);

      // Mock successful member addition
      const mockMember = {
        id: 'member-123',
        project_id: testProject.id,
        user_id: targetUserId,
        role,
        created_at: new Date(),
        updated_at: new Date(),
      };
      vi.mocked(mockDb.projectMembers.addMember).mockResolvedValue(mockMember);

      const result = await service.addMember({
        projectId: testProject.id,
        targetUserId,
        requesterId,
        role,
        project: testProject,
        requesterRole: 'admin',
      });

      expect(result).toEqual(mockMember);
      expect(mockDb.users.findById).toHaveBeenCalledWith(targetUserId);
      expect(mockDb.projects.hasAccess).toHaveBeenCalledWith(testProject.id, targetUserId);
      expect(mockDb.projectMembers.addMember).toHaveBeenCalledWith(
        testProject.id,
        targetUserId,
        role
      );
    });

    it('should throw error if requester is not admin/owner', async () => {
      vi.mocked(mockDb.projects.getUserRole).mockResolvedValue('member');

      await expect(
        service.addMember({
          projectId: testProject.id,
          targetUserId: 'user-789',
          requesterId: 'member-999',
          role: 'member',
          project: testProject,
          requesterRole: 'member',
        })
      ).rejects.toThrow('Only project owners and admins can add members');
    });

    it('should throw error if target user does not exist', async () => {
      vi.mocked(mockDb.projects.getUserRole).mockResolvedValue('admin');
      vi.mocked(mockDb.users.findById).mockResolvedValue(null);

      await expect(
        service.addMember({
          projectId: testProject.id,
          targetUserId: 'nonexistent-user',
          requesterId: 'owner-456',
          role: 'member',
          project: testProject,
          requesterRole: 'admin',
        })
      ).rejects.toThrow('User not found');
    });

    it('should throw error if user is already a member', async () => {
      vi.mocked(mockDb.projects.getUserRole).mockResolvedValue('admin');
      vi.mocked(mockDb.users.findById).mockResolvedValue({
        id: 'user-789',
        email: 'user@example.com',
      } as any);
      vi.mocked(mockDb.projects.hasAccess).mockResolvedValue(true);

      await expect(
        service.addMember({
          projectId: testProject.id,
          targetUserId: 'user-789',
          requesterId: 'owner-456',
          role: 'member',
          project: testProject,
          requesterRole: 'admin',
        })
      ).rejects.toThrow(AppError);

      const error = await service
        .addMember({
          projectId: testProject.id,
          targetUserId: 'user-789',
          requesterId: 'owner-456',
          role: 'member',
          project: testProject,
          requesterRole: 'admin',
        })
        .catch((e) => e);

      expect(error.statusCode).toBe(409);
      expect(error.message).toContain('already a member');
    });
  });

  describe('updateMemberRole', () => {
    it('should successfully update member role', async () => {
      const targetUserId = 'user-789';
      const requesterId = 'owner-456';
      const newRole: 'admin' = 'admin';

      // Mock requester has owner role
      vi.mocked(mockDb.projects.getUserRole).mockResolvedValue('owner');

      // Mock target user exists and has current role
      vi.mocked(mockDb.projectMembers.getMemberByUserId).mockResolvedValue({
        id: 'member-123',
        project_id: testProject.id,
        user_id: targetUserId,
        role: 'member',
        created_at: new Date(),
      });

      // Mock successful role update
      const mockUpdated = {
        id: 'member-123',
        project_id: testProject.id,
        user_id: targetUserId,
        role: newRole,
        created_at: new Date(),
        updated_at: new Date(),
      };
      vi.mocked(mockDb.projectMembers.updateMemberRole).mockResolvedValue(mockUpdated);

      const result = await service.updateMemberRole({
        projectId: testProject.id,
        targetUserId,
        requesterId,
        newRole,
        project: testProject,
        requesterRole: 'owner',
      });

      expect(result).toEqual(mockUpdated);
      expect(mockDb.projectMembers.updateMemberRole).toHaveBeenCalledWith(
        testProject.id,
        targetUserId,
        newRole
      );
    });

    it('should throw error if update fails', async () => {
      vi.mocked(mockDb.projects.getUserRole).mockResolvedValue('owner');
      vi.mocked(mockDb.projectMembers.getMemberByUserId).mockResolvedValue({
        id: 'member-123',
        project_id: testProject.id,
        user_id: 'user-789',
        role: 'member',
        created_at: new Date(),
      });
      vi.mocked(mockDb.projectMembers.updateMemberRole).mockResolvedValue(null);

      await expect(
        service.updateMemberRole({
          projectId: testProject.id,
          targetUserId: 'user-789',
          requesterId: 'owner-456',
          newRole: 'admin',
          project: testProject,
          requesterRole: 'owner',
        })
      ).rejects.toThrow('Failed to update member role');
    });
  });

  describe('removeMember', () => {
    it('should successfully remove a member', async () => {
      const targetUserId = 'user-789';
      const requesterId = 'owner-456';

      // Mock requester has admin role
      vi.mocked(mockDb.projects.getUserRole).mockResolvedValue('admin');

      // Mock target user exists
      vi.mocked(mockDb.projectMembers.getMemberByUserId).mockResolvedValue({
        id: 'member-123',
        project_id: testProject.id,
        user_id: targetUserId,
        role: 'member',
        created_at: new Date(),
      });

      // Mock successful removal
      vi.mocked(mockDb.projectMembers.removeMember).mockResolvedValue(1);

      await service.removeMember({
        projectId: testProject.id,
        targetUserId,
        requesterId,
        project: testProject,
        requesterRole: 'admin',
      });

      expect(mockDb.projectMembers.removeMember).toHaveBeenCalledWith(testProject.id, targetUserId);
    });

    it('should throw error if trying to remove project owner', async () => {
      // Target user is the owner
      const ownerUserId = testProject.created_by!;
      const requesterId = 'admin-999';

      vi.mocked(mockDb.projects.getUserRole).mockResolvedValue('admin');
      vi.mocked(mockDb.projectMembers.getMemberByUserId).mockResolvedValue(null); // Owner is not in project_members table

      await expect(
        service.removeMember({
          projectId: testProject.id,
          targetUserId: ownerUserId,
          requesterId,
          project: testProject,
          requesterRole: 'admin',
        })
      ).rejects.toThrow('Cannot remove project owner');
    });
  });

  describe('getMembers', () => {
    it('should return all project members', async () => {
      const mockMembers = [
        {
          id: null,
          project_id: testProject.id,
          user_id: 'owner-456',
          role: 'owner',
          created_at: new Date(),
          user_email: 'owner@example.com',
          user_name: 'Owner User',
        },
        {
          id: 'member-123',
          project_id: testProject.id,
          user_id: 'member-789',
          role: 'member',
          created_at: new Date(),
          user_email: 'member@example.com',
          user_name: 'Member User',
        },
      ];

      vi.mocked(mockDb.projects.getProjectMembers).mockResolvedValue(mockMembers);

      const result = await service.getMembers(testProject.id);

      expect(result).toEqual(mockMembers);
      expect(mockDb.projects.getProjectMembers).toHaveBeenCalledWith(testProject.id);
    });
  });
});
