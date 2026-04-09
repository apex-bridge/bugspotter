/**
 * Repository-specific method tests
 * Tests for custom repository methods beyond base CRUD operations
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DatabaseClient } from '../../src/db/client.js';
import type { User, Project } from '../../src/db/types.js';

const TEST_DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/test';

describe('Repository Specific Methods', () => {
  let db: DatabaseClient;
  let testUser1: User;
  let testUser2: User;
  let testUser3: User;
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
    testUser1 = await db.users.create({
      email: `owner-${Date.now()}@test.com`,
      password_hash: 'hash1',
      role: 'user',
    });

    testUser2 = await db.users.create({
      email: `member-${Date.now()}@test.com`,
      password_hash: 'hash2',
      role: 'user',
    });

    testUser3 = await db.users.create({
      email: `nonmember-${Date.now()}@test.com`,
      password_hash: 'hash3',
      role: 'user',
    });

    // Create test project with owner
    testProject = await db.projects.create({
      name: 'Test Project for Access Control',
      created_by: testUser1.id,
    });
  });

  afterAll(async () => {
    // Cleanup
    if (testProject?.id) {
      await db.projects.delete(testProject.id);
    }
    if (testUser1?.id) {
      await db.users.delete(testUser1.id);
    }
    if (testUser2?.id) {
      await db.users.delete(testUser2.id);
    }
    if (testUser3?.id) {
      await db.users.delete(testUser3.id);
    }

    await db.close();
  });

  describe('ProjectRepository', () => {
    describe('hasAccess()', () => {
      it('should return true for project owner', async () => {
        const hasAccess = await db.projects.hasAccess(testProject.id, testUser1.id);
        expect(hasAccess).toBe(true);
      });

      it('should return true for project member', async () => {
        // Add user2 as member
        await db.projectMembers.addMember(testProject.id, testUser2.id, 'member');

        const hasAccess = await db.projects.hasAccess(testProject.id, testUser2.id);
        expect(hasAccess).toBe(true);

        // Cleanup
        await db.projectMembers.removeMember(testProject.id, testUser2.id);
      });

      it('should return false for non-member', async () => {
        const hasAccess = await db.projects.hasAccess(testProject.id, testUser3.id);
        expect(hasAccess).toBe(false);
      });

      it('should return false for invalid project ID', async () => {
        const fakeProjectId = '00000000-0000-0000-0000-000000000000';
        const hasAccess = await db.projects.hasAccess(fakeProjectId, testUser1.id);
        expect(hasAccess).toBe(false);
      });

      it('should return false for invalid user ID', async () => {
        const fakeUserId = '00000000-0000-0000-0000-000000000000';
        const hasAccess = await db.projects.hasAccess(testProject.id, fakeUserId);
        expect(hasAccess).toBe(false);
      });
    });

    describe('getUserRole()', () => {
      it('should return "owner" for project owner', async () => {
        const role = await db.projects.getUserRole(testProject.id, testUser1.id);
        expect(role).toBe('owner');
      });

      it('should return member role for project member', async () => {
        // Add user2 as admin
        await db.projectMembers.addMember(testProject.id, testUser2.id, 'admin');

        const role = await db.projects.getUserRole(testProject.id, testUser2.id);
        expect(role).toBe('admin');

        // Cleanup
        await db.projectMembers.removeMember(testProject.id, testUser2.id);
      });

      it('should return null for non-member', async () => {
        const role = await db.projects.getUserRole(testProject.id, testUser3.id);
        expect(role).toBeNull();
      });

      it('should return null for invalid project ID', async () => {
        const fakeProjectId = '00000000-0000-0000-0000-000000000000';
        const role = await db.projects.getUserRole(fakeProjectId, testUser1.id);
        expect(role).toBeNull();
      });

      it('should prioritize owner role over member role', async () => {
        // Try to add owner as member (shouldn't happen in practice, but test the logic)
        await db.projectMembers.addMember(testProject.id, testUser1.id, 'member');

        const role = await db.projects.getUserRole(testProject.id, testUser1.id);
        expect(role).toBe('owner'); // Should return owner, not member

        // Cleanup
        await db.projectMembers.removeMember(testProject.id, testUser1.id);
      });
    });

    describe('getUserRolesForProjects()', () => {
      it('should return empty map for empty project list', async () => {
        const roleMap = await db.projects.getUserRolesForProjects([], testUser1.id);
        expect(roleMap.size).toBe(0);
      });

      it('should return owner role for project creator', async () => {
        const roleMap = await db.projects.getUserRolesForProjects([testProject.id], testUser1.id);
        expect(roleMap.get(testProject.id)).toBe('owner');
      });

      it('should return member roles for multiple projects', async () => {
        // Create a second project
        const project2 = await db.projects.create({
          name: 'Test Project 2',
          created_by: testUser2.id,
        });

        // Add user3 as admin to testProject and member to project2
        await db.projectMembers.addMember(testProject.id, testUser3.id, 'admin');
        await db.projectMembers.addMember(project2.id, testUser3.id, 'member');

        const roleMap = await db.projects.getUserRolesForProjects(
          [testProject.id, project2.id],
          testUser3.id
        );

        expect(roleMap.get(testProject.id)).toBe('admin');
        expect(roleMap.get(project2.id)).toBe('member');

        // Cleanup
        await db.projectMembers.removeMember(testProject.id, testUser3.id);
        await db.projectMembers.removeMember(project2.id, testUser3.id);
        await db.query('DELETE FROM projects WHERE id = $1', [project2.id]);
      });

      it('should return null for projects user has no access to', async () => {
        const fakeProjectId = '00000000-0000-0000-0000-000000000000';
        const roleMap = await db.projects.getUserRolesForProjects(
          [testProject.id, fakeProjectId],
          testUser3.id
        );

        expect(roleMap.get(testProject.id)).toBeNull();
        expect(roleMap.get(fakeProjectId)).toBeNull();
      });

      it('should prioritize owner role over member role', async () => {
        // Add owner as a member (shouldn't happen, but test the logic)
        await db.projectMembers.addMember(testProject.id, testUser1.id, 'member');

        const roleMap = await db.projects.getUserRolesForProjects([testProject.id], testUser1.id);
        expect(roleMap.get(testProject.id)).toBe('owner'); // Should return owner, not member

        // Cleanup
        await db.projectMembers.removeMember(testProject.id, testUser1.id);
      });
    });

    describe('getUserAccessibleProjects()', () => {
      it('should return empty array for user with no projects', async () => {
        const projects = await db.projects.getUserAccessibleProjects(testUser3.id);
        expect(projects).toEqual([]);
      });

      it('should return projects created by user', async () => {
        const projects = await db.projects.getUserAccessibleProjects(testUser1.id);

        expect(projects).toBeDefined();
        expect(projects.length).toBeGreaterThanOrEqual(1);
        expect(projects.some((p) => p.id === testProject.id)).toBe(true);
      });

      it('should return projects where user is a member', async () => {
        // Add user2 as member to testProject
        await db.projectMembers.addMember(testProject.id, testUser2.id, 'member');

        const projects = await db.projects.getUserAccessibleProjects(testUser2.id);

        expect(projects).toBeDefined();
        expect(projects.length).toBeGreaterThanOrEqual(1);
        expect(projects.some((p) => p.id === testProject.id)).toBe(true);

        // Cleanup
        await db.projectMembers.removeMember(testProject.id, testUser2.id);
      });

      it('should return DISTINCT projects (no duplicates if user is both owner and member)', async () => {
        // This shouldn't happen in practice, but test the DISTINCT behavior
        await db.projectMembers.addMember(testProject.id, testUser1.id, 'admin');

        const projects = await db.projects.getUserAccessibleProjects(testUser1.id);

        // Count how many times testProject appears
        const count = projects.filter((p) => p.id === testProject.id).length;
        expect(count).toBe(1); // Should appear only once due to DISTINCT

        // Cleanup
        await db.projectMembers.removeMember(testProject.id, testUser1.id);
      });

      it('should order projects by created_at DESC', async () => {
        // Create a second project
        const secondProject = await db.projects.create({
          name: 'Second Project',
          created_by: testUser1.id,
        });

        const projects = await db.projects.getUserAccessibleProjects(testUser1.id);

        expect(projects.length).toBeGreaterThanOrEqual(2);
        // Newer project should come first
        expect(new Date(projects[0].created_at).getTime()).toBeGreaterThanOrEqual(
          new Date(projects[1].created_at).getTime()
        );

        // Cleanup
        await db.projects.delete(secondProject.id);
      });

      it('should include both owned and member projects in single query', async () => {
        // Create a project owned by user2
        const user2Project = await db.projects.create({
          name: 'User2 Project',
          created_by: testUser2.id,
        });

        // Add user2 as member to user1's project
        await db.projectMembers.addMember(testProject.id, testUser2.id, 'viewer');

        const projects = await db.projects.getUserAccessibleProjects(testUser2.id);

        expect(projects.length).toBeGreaterThanOrEqual(2);
        expect(projects.some((p) => p.id === testProject.id)).toBe(true); // Member project
        expect(projects.some((p) => p.id === user2Project.id)).toBe(true); // Owned project

        // Cleanup
        await db.projectMembers.removeMember(testProject.id, testUser2.id);
        await db.projects.delete(user2Project.id);
      });
    });

    describe('countByOrganizationId()', () => {
      it('should return 0 for organization with no projects', async () => {
        const org = await db.organizations.create({
          name: 'Empty Org',
          subdomain: `empty-${Date.now()}`,
          subscription_status: 'trial',
          trial_ends_at: new Date(),
        });

        const count = await db.projects.countByOrganizationId(org.id);
        expect(count).toBe(0);

        // Cleanup
        await db.organizations.delete(org.id);
      });

      it('should return correct count for organization with one project', async () => {
        const org = await db.organizations.create({
          name: 'Single Project Org',
          subdomain: `single-${Date.now()}`,
          subscription_status: 'trial',
          trial_ends_at: new Date(),
        });

        const project = await db.projects.create({
          name: 'Org Project 1',
          created_by: testUser1.id,
          organization_id: org.id,
        });

        const count = await db.projects.countByOrganizationId(org.id);
        expect(count).toBe(1);

        // Cleanup
        await db.projects.delete(project.id);
        await db.organizations.delete(org.id);
      });

      it('should return correct count for organization with multiple projects', async () => {
        const org = await db.organizations.create({
          name: 'Multi Project Org',
          subdomain: `multi-${Date.now()}`,
          subscription_status: 'trial',
          trial_ends_at: new Date(),
        });

        const project1 = await db.projects.create({
          name: 'Org Project 1',
          created_by: testUser1.id,
          organization_id: org.id,
        });

        const project2 = await db.projects.create({
          name: 'Org Project 2',
          created_by: testUser2.id,
          organization_id: org.id,
        });

        const project3 = await db.projects.create({
          name: 'Org Project 3',
          created_by: testUser3.id,
          organization_id: org.id,
        });

        const count = await db.projects.countByOrganizationId(org.id);
        expect(count).toBe(3);

        // Cleanup
        await db.projects.delete(project1.id);
        await db.projects.delete(project2.id);
        await db.projects.delete(project3.id);
        await db.organizations.delete(org.id);
      });

      it('should not count projects from other organizations', async () => {
        const org1 = await db.organizations.create({
          name: 'Org 1',
          subdomain: `org1-${Date.now()}`,
          subscription_status: 'trial',
          trial_ends_at: new Date(),
        });

        const org2 = await db.organizations.create({
          name: 'Org 2',
          subdomain: `org2-${Date.now()}`,
          subscription_status: 'trial',
          trial_ends_at: new Date(),
        });

        const org1Project1 = await db.projects.create({
          name: 'Org1 Project 1',
          created_by: testUser1.id,
          organization_id: org1.id,
        });

        const org1Project2 = await db.projects.create({
          name: 'Org1 Project 2',
          created_by: testUser2.id,
          organization_id: org1.id,
        });

        const org2Project = await db.projects.create({
          name: 'Org2 Project',
          created_by: testUser3.id,
          organization_id: org2.id,
        });

        // Org1 should have 2 projects
        const org1Count = await db.projects.countByOrganizationId(org1.id);
        expect(org1Count).toBe(2);

        // Org2 should have 1 project
        const org2Count = await db.projects.countByOrganizationId(org2.id);
        expect(org2Count).toBe(1);

        // Cleanup
        await db.projects.delete(org1Project1.id);
        await db.projects.delete(org1Project2.id);
        await db.projects.delete(org2Project.id);
        await db.organizations.delete(org1.id);
        await db.organizations.delete(org2.id);
      });

      it('should handle null organization_id correctly', async () => {
        const org = await db.organizations.create({
          name: 'Test Org',
          subdomain: `test-${Date.now()}`,
          subscription_status: 'trial',
          trial_ends_at: new Date(),
        });

        // Projects without organization_id (self-hosted mode)
        const nonOrgProject = await db.projects.create({
          name: 'Non-Org Project',
          created_by: testUser1.id,
          organization_id: null,
        });

        const count = await db.projects.countByOrganizationId(org.id);

        // Should not count the null organization_id project
        expect(count).toBe(0);

        // Cleanup
        await db.projects.delete(nonOrgProject.id);
        await db.organizations.delete(org.id);
      });
    });

    describe('findByOrganizationId()', () => {
      it('should return empty array for organization with no projects', async () => {
        const org = await db.organizations.create({
          name: 'Empty Org',
          subdomain: `empty-${Date.now()}`,
          subscription_status: 'trial',
          trial_ends_at: new Date(),
        });

        const projects = await db.projects.findByOrganizationId(org.id);
        expect(projects).toEqual([]);

        // Cleanup
        await db.organizations.delete(org.id);
      });

      it('should return all projects for an organization', async () => {
        const org = await db.organizations.create({
          name: 'Test Org',
          subdomain: `test-${Date.now()}`,
          subscription_status: 'trial',
          trial_ends_at: new Date(),
        });

        const project1 = await db.projects.create({
          name: 'Org Project A',
          created_by: testUser1.id,
          organization_id: org.id,
        });

        const project2 = await db.projects.create({
          name: 'Org Project B',
          created_by: testUser2.id,
          organization_id: org.id,
        });

        const projects = await db.projects.findByOrganizationId(org.id);

        expect(projects).toHaveLength(2);
        expect(projects.some((p) => p.id === project1.id)).toBe(true);
        expect(projects.some((p) => p.id === project2.id)).toBe(true);

        // Cleanup
        await db.projects.delete(project1.id);
        await db.projects.delete(project2.id);
        await db.organizations.delete(org.id);
      });

      it('should order projects by created_at DESC', async () => {
        const org = await db.organizations.create({
          name: 'Test Org',
          subdomain: `test-${Date.now()}`,
          subscription_status: 'trial',
          trial_ends_at: new Date(),
        });

        const project1 = await db.projects.create({
          name: 'First Project',
          created_by: testUser1.id,
          organization_id: org.id,
        });

        // Small delay to ensure different timestamps
        await new Promise((resolve) => setTimeout(resolve, 10));

        const project2 = await db.projects.create({
          name: 'Second Project',
          created_by: testUser1.id,
          organization_id: org.id,
        });

        const projects = await db.projects.findByOrganizationId(org.id);

        expect(projects).toHaveLength(2);
        // Newer project should come first
        expect(projects[0].id).toBe(project2.id);
        expect(projects[1].id).toBe(project1.id);

        // Cleanup
        await db.projects.delete(project1.id);
        await db.projects.delete(project2.id);
        await db.organizations.delete(org.id);
      });
    });
  });

  describe('ProjectMemberRepository', () => {
    describe('addMember()', () => {
      it('should add member with default role', async () => {
        const member = await db.projectMembers.addMember(testProject.id, testUser2.id);

        expect(member).toBeDefined();
        expect(member.project_id).toBe(testProject.id);
        expect(member.user_id).toBe(testUser2.id);
        expect(member.role).toBe('member'); // Default role

        // Cleanup
        await db.projectMembers.removeMember(testProject.id, testUser2.id);
      });

      it('should add member with specific role', async () => {
        const member = await db.projectMembers.addMember(testProject.id, testUser2.id, 'admin');

        expect(member.role).toBe('admin');

        // Cleanup
        await db.projectMembers.removeMember(testProject.id, testUser2.id);
      });

      it('should add member with viewer role', async () => {
        const member = await db.projectMembers.addMember(testProject.id, testUser2.id, 'viewer');

        expect(member.role).toBe('viewer');

        // Cleanup
        await db.projectMembers.removeMember(testProject.id, testUser2.id);
      });

      it('should prevent duplicate member entries', async () => {
        await db.projectMembers.addMember(testProject.id, testUser2.id, 'member');

        // Try to add same member again
        await expect(
          db.projectMembers.addMember(testProject.id, testUser2.id, 'admin')
        ).rejects.toThrow();

        // Cleanup
        await db.projectMembers.removeMember(testProject.id, testUser2.id);
      });
    });

    describe('removeMember()', () => {
      it('should remove member from project', async () => {
        // Add member
        await db.projectMembers.addMember(testProject.id, testUser2.id, 'member');

        // Verify member exists
        let hasAccess = await db.projects.hasAccess(testProject.id, testUser2.id);
        expect(hasAccess).toBe(true);

        // Remove member
        await db.projectMembers.removeMember(testProject.id, testUser2.id);

        // Verify member removed
        hasAccess = await db.projects.hasAccess(testProject.id, testUser2.id);
        expect(hasAccess).toBe(false);
      });

      it('should handle removing non-existent member gracefully', async () => {
        // Should return 0 when removing non-existent member
        const rowCount = await db.projectMembers.removeMember(testProject.id, testUser3.id);
        expect(rowCount).toBe(0);
      });
    });

    describe('getProjectMembers()', () => {
      it('should return all members of a project', async () => {
        // Add multiple members
        await db.projectMembers.addMember(testProject.id, testUser2.id, 'admin');
        await db.projectMembers.addMember(testProject.id, testUser3.id, 'viewer');

        const members = await db.projectMembers.getProjectMembers(testProject.id);

        expect(members).toHaveLength(2);
        expect(members.some((m) => m.user_id === testUser2.id && m.role === 'admin')).toBe(true);
        expect(members.some((m) => m.user_id === testUser3.id && m.role === 'viewer')).toBe(true);

        // Cleanup
        await db.projectMembers.removeMember(testProject.id, testUser2.id);
        await db.projectMembers.removeMember(testProject.id, testUser3.id);
      });

      it('should return empty array for project with no members', async () => {
        const members = await db.projectMembers.getProjectMembers(testProject.id);
        expect(members).toEqual([]);
      });

      it('should return empty array for non-existent project', async () => {
        const fakeProjectId = '00000000-0000-0000-0000-000000000000';
        const members = await db.projectMembers.getProjectMembers(fakeProjectId);
        expect(members).toEqual([]);
      });
    });

    describe('getMemberByUserId()', () => {
      it('should return a specific member when they exist', async () => {
        // Add a member
        await db.projectMembers.addMember(testProject.id, testUser2.id, 'admin');

        const member = await db.projectMembers.getMemberByUserId(testProject.id, testUser2.id);

        expect(member).toBeDefined();
        expect(member?.user_id).toBe(testUser2.id);
        expect(member?.project_id).toBe(testProject.id);
        expect(member?.role).toBe('admin');

        // Cleanup
        await db.projectMembers.removeMember(testProject.id, testUser2.id);
      });

      it('should return null when member does not exist in project', async () => {
        const member = await db.projectMembers.getMemberByUserId(testProject.id, testUser2.id);
        expect(member).toBeNull();
      });

      it('should return null for non-existent project', async () => {
        const fakeProjectId = '00000000-0000-0000-0000-000000000000';
        const member = await db.projectMembers.getMemberByUserId(fakeProjectId, testUser2.id);
        expect(member).toBeNull();
      });

      it('should return null for non-existent user', async () => {
        const fakeUserId = '00000000-0000-0000-0000-000000000000';
        const member = await db.projectMembers.getMemberByUserId(testProject.id, fakeUserId);
        expect(member).toBeNull();
      });

      it('should correctly identify different roles', async () => {
        // Add members with different roles
        await db.projectMembers.addMember(testProject.id, testUser2.id, 'admin');
        await db.projectMembers.addMember(testProject.id, testUser3.id, 'viewer');

        const adminMember = await db.projectMembers.getMemberByUserId(testProject.id, testUser2.id);
        const viewerMember = await db.projectMembers.getMemberByUserId(
          testProject.id,
          testUser3.id
        );

        expect(adminMember?.role).toBe('admin');
        expect(viewerMember?.role).toBe('viewer');

        // Cleanup
        await db.projectMembers.removeMember(testProject.id, testUser2.id);
        await db.projectMembers.removeMember(testProject.id, testUser3.id);
      });

      it('should only return member from correct project', async () => {
        // Create another project
        const project2 = await db.projects.create({
          name: 'Test Project 2',
          created_by: testUser1.id,
        });

        // Add testUser2 to both projects
        await db.projectMembers.addMember(testProject.id, testUser2.id, 'admin');
        await db.projectMembers.addMember(project2.id, testUser2.id, 'member');

        // Should return member with correct project_id
        const memberProject1 = await db.projectMembers.getMemberByUserId(
          testProject.id,
          testUser2.id
        );
        const memberProject2 = await db.projectMembers.getMemberByUserId(project2.id, testUser2.id);

        expect(memberProject1?.project_id).toBe(testProject.id);
        expect(memberProject1?.role).toBe('admin');
        expect(memberProject2?.project_id).toBe(project2.id);
        expect(memberProject2?.role).toBe('member');

        // Cleanup
        await db.projectMembers.removeMember(testProject.id, testUser2.id);
        await db.projectMembers.removeMember(project2.id, testUser2.id);
        await db.projects.delete(project2.id);
      });
    });

    describe('getUserProjects()', () => {
      it('should return all projects for a user', async () => {
        // Add user2 to the test project
        await db.projectMembers.addMember(testProject.id, testUser2.id, 'member');

        const projects = await db.projectMembers.getUserProjects(testUser2.id);

        expect(projects).toHaveLength(1);
        expect(projects[0].project_id).toBe(testProject.id);
        expect(projects[0].user_id).toBe(testUser2.id);

        // Cleanup
        await db.projectMembers.removeMember(testProject.id, testUser2.id);
      });

      it('should return empty array for user with no projects', async () => {
        const projects = await db.projectMembers.getUserProjects(testUser3.id);
        expect(projects).toEqual([]);
      });

      it('should return multiple projects if user is member of multiple', async () => {
        // Create another project
        const project2 = await db.projects.create({
          name: 'Second Test Project',
          created_by: testUser1.id,
        });

        // Add user2 to both projects
        await db.projectMembers.addMember(testProject.id, testUser2.id, 'admin');
        await db.projectMembers.addMember(project2.id, testUser2.id, 'viewer');

        const projects = await db.projectMembers.getUserProjects(testUser2.id);

        expect(projects).toHaveLength(2);
        expect(projects.some((p) => p.project_id === testProject.id)).toBe(true);
        expect(projects.some((p) => p.project_id === project2.id)).toBe(true);

        // Cleanup
        await db.projectMembers.removeMember(testProject.id, testUser2.id);
        await db.projectMembers.removeMember(project2.id, testUser2.id);
        await db.projects.delete(project2.id);
      });
    });

    describe('Access Control Integration', () => {
      it('should properly integrate with hasAccess after adding member', async () => {
        // User3 should not have access initially
        let hasAccess = await db.projects.hasAccess(testProject.id, testUser3.id);
        expect(hasAccess).toBe(false);

        // Add user3 as member
        await db.projectMembers.addMember(testProject.id, testUser3.id, 'viewer');

        // Now user3 should have access
        hasAccess = await db.projects.hasAccess(testProject.id, testUser3.id);
        expect(hasAccess).toBe(true);

        // Check role
        const role = await db.projects.getUserRole(testProject.id, testUser3.id);
        expect(role).toBe('viewer');

        // Cleanup
        await db.projectMembers.removeMember(testProject.id, testUser3.id);
      });

      it('should properly integrate with getUserRole for different roles', async () => {
        // Add members with different roles
        await db.projectMembers.addMember(testProject.id, testUser2.id, 'admin');
        await db.projectMembers.addMember(testProject.id, testUser3.id, 'viewer');

        const role2 = await db.projects.getUserRole(testProject.id, testUser2.id);
        const role3 = await db.projects.getUserRole(testProject.id, testUser3.id);

        expect(role2).toBe('admin');
        expect(role3).toBe('viewer');

        // Cleanup
        await db.projectMembers.removeMember(testProject.id, testUser2.id);
        await db.projectMembers.removeMember(testProject.id, testUser3.id);
      });
    });
  });
});
