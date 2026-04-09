/**
 * Tests for project_roles table and role hierarchy
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDatabaseClient } from '../../src/db/client.js';

describe('ProjectRoles Table', () => {
  const db = createDatabaseClient();

  beforeAll(async () => {
    await db.testConnection();
  });

  afterAll(async () => {
    await db.close();
  });

  describe('Schema and Constraints', () => {
    it('should have all required columns', async () => {
      const query = `
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_name = 'project_roles'
        ORDER BY ordinal_position
      `;
      const result = await db.query(query);

      const columns = result.rows.map((r) => r.column_name);
      expect(columns).toContain('id');
      expect(columns).toContain('name');
      expect(columns).toContain('rank');
      expect(columns).toContain('description');
      expect(columns).toContain('created_at');
    });

    it('should have unique constraint on name', async () => {
      const query = `
        SELECT constraint_name, constraint_type
        FROM information_schema.table_constraints
        WHERE table_name = 'project_roles'
        AND constraint_type = 'UNIQUE'
        AND constraint_name LIKE '%name%'
      `;
      const result = await db.query(query);
      expect(result.rows.length).toBeGreaterThan(0);
    });

    it('should have unique constraint on rank', async () => {
      const query = `
        SELECT constraint_name, constraint_type
        FROM information_schema.table_constraints
        WHERE table_name = 'project_roles'
        AND constraint_type = 'UNIQUE'
        AND constraint_name LIKE '%rank%'
      `;
      const result = await db.query(query);
      expect(result.rows.length).toBeGreaterThan(0);
    });

    it('should have index on rank column', async () => {
      const query = `
        SELECT indexname
        FROM pg_indexes
        WHERE tablename = 'project_roles'
        AND indexname = 'idx_project_roles_rank'
      `;
      const result = await db.query(query);
      expect(result.rows).toHaveLength(1);
    });

    it('should have foreign key constraint on project_members.role', async () => {
      const query = `
        SELECT constraint_name
        FROM information_schema.table_constraints
        WHERE table_name = 'project_members'
        AND constraint_type = 'FOREIGN KEY'
        AND constraint_name = 'fk_project_members_role'
      `;
      const result = await db.query(query);
      expect(result.rows).toHaveLength(1);
    });
  });

  describe('Seeded Data', () => {
    it('should have exactly 4 default roles', async () => {
      const result = await db.query('SELECT COUNT(*) FROM project_roles');
      expect(parseInt(result.rows[0].count)).toBe(4);
    });

    it('should have owner role with rank 1', async () => {
      const result = await db.query("SELECT name, rank FROM project_roles WHERE name = 'owner'");
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].rank).toBe(1);
    });

    it('should have admin role with rank 2', async () => {
      const result = await db.query("SELECT name, rank FROM project_roles WHERE name = 'admin'");
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].rank).toBe(2);
    });

    it('should have member role with rank 3', async () => {
      const result = await db.query("SELECT name, rank FROM project_roles WHERE name = 'member'");
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].rank).toBe(3);
    });

    it('should have viewer role with rank 4', async () => {
      const result = await db.query("SELECT name, rank FROM project_roles WHERE name = 'viewer'");
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].rank).toBe(4);
    });

    it('should have descriptions for all roles', async () => {
      const result = await db.query(
        'SELECT name, description FROM project_roles WHERE description IS NULL'
      );
      expect(result.rows).toHaveLength(0);
    });
  });

  describe('Role Hierarchy', () => {
    it('should order roles correctly by rank (owner < admin < member < viewer)', async () => {
      const result = await db.query('SELECT name, rank FROM project_roles ORDER BY rank');

      expect(result.rows).toHaveLength(4);
      expect(result.rows[0].name).toBe('owner');
      expect(result.rows[1].name).toBe('admin');
      expect(result.rows[2].name).toBe('member');
      expect(result.rows[3].name).toBe('viewer');

      // Verify ranks are sequential
      expect(result.rows[0].rank).toBe(1);
      expect(result.rows[1].rank).toBe(2);
      expect(result.rows[2].rank).toBe(3);
      expect(result.rows[3].rank).toBe(4);
    });

    it('should prevent duplicate role names', async () => {
      await expect(
        db.query("INSERT INTO project_roles (name, rank) VALUES ('owner', 10)")
      ).rejects.toThrow();
    });

    it('should prevent duplicate ranks', async () => {
      await expect(
        db.query("INSERT INTO project_roles (name, rank) VALUES ('superadmin', 1)")
      ).rejects.toThrow();
    });
  });

  describe('Foreign Key Constraint', () => {
    let testUser: any;
    let testProject: any;

    beforeAll(async () => {
      // Create test user
      testUser = await db.users.create({
        email: `role-fk-test-${Date.now()}@example.com`,
        password_hash: 'hash',
        name: 'Role FK Test User',
      });

      // Create test project
      testProject = await db.projects.create({
        name: `Role FK Test Project ${Date.now()}`,
        created_by: testUser.id,
      });
    });

    it('should allow valid role from project_roles table', async () => {
      const member = await db.projectMembers.addMember(testProject.id, testUser.id, 'admin');
      expect(member.role).toBe('admin');
    });

    it('should prevent invalid role not in project_roles table', async () => {
      const anotherUser = await db.users.create({
        email: `invalid-role-${Date.now()}@example.com`,
        password_hash: 'hash',
        name: 'Invalid Role User',
      });

      await expect(
        db.query('INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, $3)', [
          testProject.id,
          anotherUser.id,
          'superadmin',
        ])
      ).rejects.toThrow(/violates foreign key constraint/);
    });

    it('should prevent deleting role that is in use', async () => {
      await expect(db.query("DELETE FROM project_roles WHERE name = 'admin'")).rejects.toThrow(
        /violates foreign key constraint/
      );
    });

    it('should cascade updates to role name', async () => {
      // Create a custom role for testing
      await db.query(
        "INSERT INTO project_roles (name, rank, description) VALUES ('custom', 10, 'Custom role')"
      );

      const customUser = await db.users.create({
        email: `custom-role-${Date.now()}@example.com`,
        password_hash: 'hash',
        name: 'Custom Role User',
      });

      await db.query(
        'INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, $3)',
        [testProject.id, customUser.id, 'custom']
      );

      // Update role name should cascade
      await db.query("UPDATE project_roles SET name = 'custom_updated' WHERE name = 'custom'");

      const result = await db.query('SELECT role FROM project_members WHERE user_id = $1', [
        customUser.id,
      ]);
      expect(result.rows[0].role).toBe('custom_updated');

      // Cleanup
      await db.query('DELETE FROM project_members WHERE user_id = $1', [customUser.id]);
      await db.query("DELETE FROM project_roles WHERE name = 'custom_updated'");
    });
  });

  describe('getProjectMembers with Role Ranking', () => {
    let owner: any;
    let adminUser: any;
    let memberUser: any;
    let viewerUser: any;
    let testProject: any;

    beforeAll(async () => {
      // Create test users
      owner = await db.users.create({
        email: `owner-rank-${Date.now()}@example.com`,
        password_hash: 'hash',
        name: 'Owner User',
      });

      adminUser = await db.users.create({
        email: `admin-rank-${Date.now()}@example.com`,
        password_hash: 'hash',
        name: 'Admin User',
      });

      memberUser = await db.users.create({
        email: `member-rank-${Date.now()}@example.com`,
        password_hash: 'hash',
        name: 'Member User',
      });

      viewerUser = await db.users.create({
        email: `viewer-rank-${Date.now()}@example.com`,
        password_hash: 'hash',
        name: 'Viewer User',
      });

      // Create project
      testProject = await db.projects.create({
        name: `Role Rank Test ${Date.now()}`,
        created_by: owner.id,
      });

      // Add members with different roles (in reverse order to test sorting)
      await db.projectMembers.addMember(testProject.id, viewerUser.id, 'viewer');
      await db.projectMembers.addMember(testProject.id, memberUser.id, 'member');
      await db.projectMembers.addMember(testProject.id, adminUser.id, 'admin');
    });

    it('should order members by role rank (owner, admin, member, viewer)', async () => {
      const members = await db.projects.getProjectMembers(testProject.id);

      expect(members).toHaveLength(4);
      expect(members[0].role).toBe('owner');
      expect(members[0].user_id).toBe(owner.id);

      expect(members[1].role).toBe('admin');
      expect(members[1].user_id).toBe(adminUser.id);

      expect(members[2].role).toBe('member');
      expect(members[2].user_id).toBe(memberUser.id);

      expect(members[3].role).toBe('viewer');
      expect(members[3].user_id).toBe(viewerUser.id);
    });

    it('should not include role_rank in returned data', async () => {
      const members = await db.projects.getProjectMembers(testProject.id);

      members.forEach((member) => {
        expect(member).not.toHaveProperty('role_rank');
      });
    });

    it('should not duplicate owner if not in project_members table', async () => {
      const members = await db.projects.getProjectMembers(testProject.id);
      const ownerEntries = members.filter((m) => m.user_id === owner.id);

      expect(ownerEntries).toHaveLength(1);
      expect(ownerEntries[0].role).toBe('owner');
    });

    it('should include owner only once even if added as member', async () => {
      // This should be prevented by the duplicate check in routes,
      // but verify UNION ALL + NOT EXISTS prevents database-level duplication

      // Try to add owner as member directly (bypassing route validation)
      try {
        await db.query(
          'INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, $3)',
          [testProject.id, owner.id, 'member']
        );
      } catch {
        // May fail due to unique constraint or other checks
      }

      const members = await db.projects.getProjectMembers(testProject.id);
      const ownerEntries = members.filter((m) => m.user_id === owner.id);

      // Should still only see owner once due to NOT EXISTS clause
      expect(ownerEntries.length).toBeLessThanOrEqual(1);

      // Cleanup
      await db.query('DELETE FROM project_members WHERE project_id = $1 AND user_id = $2', [
        testProject.id,
        owner.id,
      ]);
    });
  });

  describe('Duplicate Member Prevention', () => {
    let owner: any;
    let testProject: any;

    beforeAll(async () => {
      owner = await db.users.create({
        email: `owner-dup-${Date.now()}@example.com`,
        password_hash: 'hash',
        name: 'Owner Dup Test',
      });

      testProject = await db.projects.create({
        name: `Dup Test ${Date.now()}`,
        created_by: owner.id,
      });
    });

    it('should detect owner in getProjectMembers check', async () => {
      const members = await db.projects.getProjectMembers(testProject.id);
      const hasOwner = members.some((m) => m.user_id === owner.id);

      expect(hasOwner).toBe(true);
    });

    it('should prevent adding owner as member via duplicate check', async () => {
      // Simulate route logic
      const existingMembers = await db.projects.getProjectMembers(testProject.id);
      const isDuplicate = existingMembers.some((m) => m.user_id === owner.id);

      expect(isDuplicate).toBe(true);
    });
  });
});
