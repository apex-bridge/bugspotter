/**
 * Organization Repository Tests
 * Tests for saas.organizations CRUD and query operations
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DatabaseClient } from '../../src/db/client.js';
import type { User } from '../../src/db/types.js';

const TEST_DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/test';

describe('OrganizationRepository', () => {
  let db: DatabaseClient;
  let testUser: User;
  const createdOrgIds: string[] = [];

  beforeAll(async () => {
    db = DatabaseClient.create({ connectionString: TEST_DATABASE_URL });
    const isConnected = await db.testConnection();
    if (!isConnected) {
      throw new Error('Failed to connect to test database');
    }

    testUser = await db.users.create({
      email: `org-test-${Date.now()}@test.com`,
      password_hash: 'hash123',
      role: 'admin',
    });
  });

  afterAll(async () => {
    // Clean up orgs (cascades to members, subscriptions, usage_records)
    for (const id of createdOrgIds) {
      try {
        await db.organizations.delete(id);
      } catch {
        // Ignore
      }
    }
    if (testUser?.id) {
      await db.users.delete(testUser.id);
    }
    await db.close();
  });

  function uniqueSubdomain() {
    return `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  describe('CRUD', () => {
    it('should create an organization', async () => {
      const org = await db.organizations.create({
        name: 'Test Corp',
        subdomain: uniqueSubdomain(),
      });
      createdOrgIds.push(org.id);

      expect(org.id).toBeDefined();
      expect(org.name).toBe('Test Corp');
      expect(org.subscription_status).toBe('trial');
      expect(org.data_residency_region).toBe('global');
      expect(org.created_at).toBeInstanceOf(Date);
    });

    it('should find organization by id', async () => {
      const org = await db.organizations.create({
        name: 'Find Me Corp',
        subdomain: uniqueSubdomain(),
      });
      createdOrgIds.push(org.id);

      const found = await db.organizations.findById(org.id);
      expect(found).not.toBeNull();
      expect(found!.name).toBe('Find Me Corp');
    });

    it('should update an organization', async () => {
      const org = await db.organizations.create({
        name: 'Old Name',
        subdomain: uniqueSubdomain(),
      });
      createdOrgIds.push(org.id);

      const updated = await db.organizations.update(org.id, {
        name: 'New Name',
        subscription_status: 'active',
      });
      expect(updated).not.toBeNull();
      expect(updated!.name).toBe('New Name');
      expect(updated!.subscription_status).toBe('active');
    });

    it('should delete an organization', async () => {
      const org = await db.organizations.create({
        name: 'Delete Me',
        subdomain: uniqueSubdomain(),
      });

      const deleted = await db.organizations.delete(org.id);
      expect(deleted).toBe(true);

      const found = await db.organizations.findById(org.id);
      expect(found).toBeNull();
    });
  });

  describe('findBySubdomain', () => {
    it('should find organization by subdomain', async () => {
      const subdomain = uniqueSubdomain();
      const org = await db.organizations.create({
        name: 'Subdomain Corp',
        subdomain,
      });
      createdOrgIds.push(org.id);

      const found = await db.organizations.findBySubdomain(subdomain);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(org.id);
    });

    it('should return null for non-existent subdomain', async () => {
      const found = await db.organizations.findBySubdomain('does-not-exist-999');
      expect(found).toBeNull();
    });
  });

  describe('subdomain constraints', () => {
    it('should enforce unique subdomains', async () => {
      const subdomain = uniqueSubdomain();
      const org1 = await db.organizations.create({
        name: 'First',
        subdomain,
      });
      createdOrgIds.push(org1.id);

      await expect(db.organizations.create({ name: 'Second', subdomain })).rejects.toThrow();
    });
  });

  describe('isSubdomainAvailable', () => {
    it('should return true for available subdomain', async () => {
      const available = await db.organizations.isSubdomainAvailable('completely-new-subdomain');
      expect(available).toBe(true);
    });

    it('should return false for taken subdomain', async () => {
      const subdomain = uniqueSubdomain();
      const org = await db.organizations.create({
        name: 'Taken',
        subdomain,
      });
      createdOrgIds.push(org.id);

      const available = await db.organizations.isSubdomainAvailable(subdomain);
      expect(available).toBe(false);
    });
  });

  describe('findByUserId', () => {
    it('should find organizations a user belongs to', async () => {
      const org = await db.organizations.create({
        name: 'User Org',
        subdomain: uniqueSubdomain(),
      });
      createdOrgIds.push(org.id);

      await db.organizationMembers.create({
        organization_id: org.id,
        user_id: testUser.id,
        role: 'owner',
      });

      const orgs = await db.organizations.findByUserId(testUser.id);
      expect(orgs.length).toBeGreaterThanOrEqual(1);
      expect(orgs.some((o) => o.id === org.id)).toBe(true);
    });
  });

  describe('listWithMemberCount', () => {
    it('should list organizations with member count', async () => {
      const org = await db.organizations.create({
        name: 'List Test Corp',
        subdomain: uniqueSubdomain(),
        data_residency_region: 'kz',
      });
      createdOrgIds.push(org.id);

      const result = await db.organizations.listWithMemberCount();
      expect(result.data.length).toBeGreaterThanOrEqual(1);
      expect(result.pagination.total).toBeGreaterThanOrEqual(1);

      const found = result.data.find((o) => o.id === org.id);
      expect(found).toBeDefined();
      expect(found!.member_count).toBeDefined();
    });

    it('should filter by subscription_status', async () => {
      const org = await db.organizations.create({
        name: 'Active Corp',
        subdomain: uniqueSubdomain(),
        subscription_status: 'active',
      });
      createdOrgIds.push(org.id);

      const result = await db.organizations.listWithMemberCount({
        subscription_status: 'active',
      });
      expect(result.data.every((o) => o.subscription_status === 'active')).toBe(true);
    });

    it('should filter by search term', async () => {
      const name = `UniqueSearchName${Date.now()}`;
      const org = await db.organizations.create({
        name,
        subdomain: uniqueSubdomain(),
      });
      createdOrgIds.push(org.id);

      const result = await db.organizations.listWithMemberCount({ search: name });
      expect(result.data.length).toBe(1);
      expect(result.data[0].id).toBe(org.id);
    });

    it('should paginate results', async () => {
      const result = await db.organizations.listWithMemberCount({}, { page: 1, limit: 2 });
      expect(result.pagination.limit).toBe(2);
      expect(result.data.length).toBeLessThanOrEqual(2);
    });
  });

  describe('data residency', () => {
    it('should create with specific data residency region', async () => {
      const org = await db.organizations.create({
        name: 'KZ Corp',
        subdomain: uniqueSubdomain(),
        data_residency_region: 'kz',
      });
      createdOrgIds.push(org.id);

      expect(org.data_residency_region).toBe('kz');
    });
  });

  describe('soft delete', () => {
    it('should soft-delete an organization', async () => {
      const org = await db.organizations.create({
        name: 'Soft Delete Corp',
        subdomain: uniqueSubdomain(),
      });
      createdOrgIds.push(org.id);

      const result = await db.organizations.softDelete(org.id, testUser.id);
      expect(result).toBe(true);

      const found = await db.organizations.findByIdIncludeDeleted(org.id);
      expect(found).not.toBeNull();
      expect(found!.deleted_at).not.toBeNull();
      expect(found!.deleted_by).toBe(testUser.id);
    });

    it('should return false when soft-deleting an already deleted org', async () => {
      const org = await db.organizations.create({
        name: 'Double Delete Corp',
        subdomain: uniqueSubdomain(),
      });
      createdOrgIds.push(org.id);

      await db.organizations.softDelete(org.id, testUser.id);
      const result = await db.organizations.softDelete(org.id, testUser.id);
      expect(result).toBe(false);
    });

    it('findById should exclude soft-deleted orgs', async () => {
      const org = await db.organizations.create({
        name: 'Hidden Corp',
        subdomain: uniqueSubdomain(),
      });
      createdOrgIds.push(org.id);

      await db.organizations.softDelete(org.id, testUser.id);
      const found = await db.organizations.findById(org.id);
      expect(found).toBeNull();
    });

    it('findByIdIncludeDeleted should return soft-deleted orgs', async () => {
      const org = await db.organizations.create({
        name: 'Visible Deleted Corp',
        subdomain: uniqueSubdomain(),
      });
      createdOrgIds.push(org.id);

      await db.organizations.softDelete(org.id, testUser.id);
      const found = await db.organizations.findByIdIncludeDeleted(org.id);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(org.id);
    });

    it('findBySubdomain should exclude soft-deleted orgs', async () => {
      const subdomain = uniqueSubdomain();
      const org = await db.organizations.create({
        name: 'Subdomain Delete Corp',
        subdomain,
      });
      createdOrgIds.push(org.id);

      await db.organizations.softDelete(org.id, testUser.id);
      const found = await db.organizations.findBySubdomain(subdomain);
      expect(found).toBeNull();
    });

    it('findByUserId should exclude soft-deleted orgs', async () => {
      const org = await db.organizations.create({
        name: 'User Delete Corp',
        subdomain: uniqueSubdomain(),
      });
      createdOrgIds.push(org.id);

      await db.organizationMembers.create({
        organization_id: org.id,
        user_id: testUser.id,
        role: 'owner',
      });

      await db.organizations.softDelete(org.id, testUser.id);
      const orgs = await db.organizations.findByUserId(testUser.id);
      expect(orgs.some((o) => o.id === org.id)).toBe(false);
    });

    it('listWithMemberCount should exclude soft-deleted by default', async () => {
      const org = await db.organizations.create({
        name: 'List Delete Corp',
        subdomain: uniqueSubdomain(),
      });
      createdOrgIds.push(org.id);

      await db.organizations.softDelete(org.id, testUser.id);
      const result = await db.organizations.listWithMemberCount();
      expect(result.data.some((o) => o.id === org.id)).toBe(false);
    });

    it('listWithMemberCount should include soft-deleted when includeDeleted is true', async () => {
      const org = await db.organizations.create({
        name: 'List Include Deleted Corp',
        subdomain: uniqueSubdomain(),
      });
      createdOrgIds.push(org.id);

      await db.organizations.softDelete(org.id, testUser.id);
      const result = await db.organizations.listWithMemberCount({ includeDeleted: true });
      expect(result.data.some((o) => o.id === org.id)).toBe(true);
    });

    it('isSubdomainAvailable should return false for soft-deleted org subdomain', async () => {
      const subdomain = uniqueSubdomain();
      const org = await db.organizations.create({
        name: 'Reserved Subdomain Corp',
        subdomain,
      });
      createdOrgIds.push(org.id);

      await db.organizations.softDelete(org.id, testUser.id);
      const available = await db.organizations.isSubdomainAvailable(subdomain);
      expect(available).toBe(false);
    });
  });

  describe('restore', () => {
    it('should restore a soft-deleted organization', async () => {
      const org = await db.organizations.create({
        name: 'Restore Corp',
        subdomain: uniqueSubdomain(),
      });
      createdOrgIds.push(org.id);

      await db.organizations.softDelete(org.id, testUser.id);
      const result = await db.organizations.restore(org.id);
      expect(result).toBe(true);

      const found = await db.organizations.findById(org.id);
      expect(found).not.toBeNull();
      expect(found!.deleted_at).toBeNull();
      expect(found!.deleted_by).toBeNull();
    });

    it('should return false when restoring a non-deleted org', async () => {
      const org = await db.organizations.create({
        name: 'Not Deleted Corp',
        subdomain: uniqueSubdomain(),
      });
      createdOrgIds.push(org.id);

      const result = await db.organizations.restore(org.id);
      expect(result).toBe(false);
    });
  });

  describe('hard delete', () => {
    it('should permanently delete an organization', async () => {
      const org = await db.organizations.create({
        name: 'Hard Delete Corp',
        subdomain: uniqueSubdomain(),
      });
      // Not pushing to createdOrgIds — hard delete removes it

      const result = await db.organizations.hardDelete(org.id);
      expect(result).toBe(true);

      const found = await db.organizations.findByIdIncludeDeleted(org.id);
      expect(found).toBeNull();
    });
  });

  describe('hardDeleteGuarded', () => {
    it('should delete an organization with no vital data', async () => {
      const org = await db.organizations.create({
        name: 'Guarded Delete Corp',
        subdomain: uniqueSubdomain(),
      });
      // Not pushing to createdOrgIds — guarded delete removes it

      const result = await db.organizations.hardDeleteGuarded(org.id);
      expect(result).toBe(true);

      const found = await db.organizations.findByIdIncludeDeleted(org.id);
      expect(found).toBeNull();
    });

    it('should refuse to delete when org has projects', async () => {
      const org = await db.organizations.create({
        name: 'Guarded With Projects',
        subdomain: uniqueSubdomain(),
      });
      createdOrgIds.push(org.id);

      const project = await db.projects.create({
        name: 'Blocking Project',
        organization_id: org.id,
        created_by: testUser.id,
      });

      const result = await db.organizations.hardDeleteGuarded(org.id);
      expect(result).toBe(false);

      // Org still exists
      const found = await db.organizations.findByIdIncludeDeleted(org.id);
      expect(found).not.toBeNull();

      await db.projects.delete(project.id);
    });

    it('should refuse to delete when org has active subscription', async () => {
      const org = await db.organizations.create({
        name: 'Guarded With Active Sub',
        subdomain: uniqueSubdomain(),
      });
      createdOrgIds.push(org.id);

      const sub = await db.subscriptions.create({
        organization_id: org.id,
        plan_name: 'professional',
        status: 'active',
        current_period_start: new Date(),
        current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        quotas: {},
      });

      const result = await db.organizations.hardDeleteGuarded(org.id);
      expect(result).toBe(false);

      // Org still exists
      const found = await db.organizations.findByIdIncludeDeleted(org.id);
      expect(found).not.toBeNull();

      await db.subscriptions.delete(sub.id);
    });
  });

  describe('settings', () => {
    it('should default settings to empty object on create', async () => {
      const org = await db.organizations.create({
        name: 'Default Settings Corp',
        subdomain: uniqueSubdomain(),
      });
      createdOrgIds.push(org.id);

      expect(org.settings).toEqual({});
    });

    it('should create with initial settings', async () => {
      const org = await db.organizations.create({
        name: 'Magic Login Corp',
        subdomain: uniqueSubdomain(),
        settings: { magic_login_enabled: true },
      });
      createdOrgIds.push(org.id);

      expect(org.settings).toEqual({ magic_login_enabled: true });
    });

    it('should return parsed settings from findById', async () => {
      const org = await db.organizations.create({
        name: 'FindById Settings Corp',
        subdomain: uniqueSubdomain(),
        settings: { magic_login_enabled: true },
      });
      createdOrgIds.push(org.id);

      const found = await db.organizations.findById(org.id);
      expect(found).not.toBeNull();
      expect(found!.settings).toEqual({ magic_login_enabled: true });
      expect(typeof found!.settings).toBe('object');
    });

    it('updateSettings should enable magic_login_enabled', async () => {
      const org = await db.organizations.create({
        name: 'Enable ML Corp',
        subdomain: uniqueSubdomain(),
      });
      createdOrgIds.push(org.id);

      const updated = await db.organizations.updateSettings(org.id, {
        magic_login_enabled: true,
      });
      expect(updated).not.toBeNull();
      expect(updated!.settings.magic_login_enabled).toBe(true);
    });

    it('updateSettings should disable magic_login_enabled', async () => {
      const org = await db.organizations.create({
        name: 'Disable ML Corp',
        subdomain: uniqueSubdomain(),
        settings: { magic_login_enabled: true },
      });
      createdOrgIds.push(org.id);

      const updated = await db.organizations.updateSettings(org.id, {
        magic_login_enabled: false,
      });
      expect(updated).not.toBeNull();
      expect(updated!.settings.magic_login_enabled).toBe(false);
    });

    it('updateSettings should merge with existing settings (JSONB ||)', async () => {
      const org = await db.organizations.create({
        name: 'Merge Settings Corp',
        subdomain: uniqueSubdomain(),
        settings: { magic_login_enabled: true },
      });
      createdOrgIds.push(org.id);

      // Update with a different key — magic_login_enabled should be preserved
      const updated = await db.organizations.updateSettings(org.id, {
        magic_login_enabled: false,
      });
      expect(updated).not.toBeNull();
      expect(updated!.settings.magic_login_enabled).toBe(false);

      // Re-enable — verify toggle works
      const toggled = await db.organizations.updateSettings(org.id, {
        magic_login_enabled: true,
      });
      expect(toggled).not.toBeNull();
      expect(toggled!.settings.magic_login_enabled).toBe(true);
    });

    it('updateSettings should return null for non-existent org', async () => {
      const result = await db.organizations.updateSettings('00000000-0000-0000-0000-000000000000', {
        magic_login_enabled: true,
      });
      expect(result).toBeNull();
    });

    it('updateSettings should return null for soft-deleted org', async () => {
      const org = await db.organizations.create({
        name: 'Deleted Settings Corp',
        subdomain: uniqueSubdomain(),
      });
      createdOrgIds.push(org.id);

      await db.organizations.softDelete(org.id, testUser.id);

      const result = await db.organizations.updateSettings(org.id, {
        magic_login_enabled: true,
      });
      expect(result).toBeNull();
    });

    it('settings should appear in listWithMemberCount results', async () => {
      const org = await db.organizations.create({
        name: 'List Settings Corp',
        subdomain: uniqueSubdomain(),
        settings: { magic_login_enabled: true },
      });
      createdOrgIds.push(org.id);

      const result = await db.organizations.listWithMemberCount({ search: org.name });
      expect(result.data.length).toBe(1);
      expect(result.data[0].settings).toEqual({ magic_login_enabled: true });
    });
  });

  describe('hasVitalData', () => {
    it('should return no vital data for empty org', async () => {
      const org = await db.organizations.create({
        name: 'Empty Corp',
        subdomain: uniqueSubdomain(),
      });
      createdOrgIds.push(org.id);

      const vitalData = await db.organizations.hasVitalData(org.id);
      expect(vitalData.hasProjects).toBe(false);
      expect(vitalData.projectCount).toBe(0);
      expect(vitalData.hasActiveSubscription).toBe(false);
    });

    it('should detect projects as vital data', async () => {
      const org = await db.organizations.create({
        name: 'Project Corp',
        subdomain: uniqueSubdomain(),
      });
      createdOrgIds.push(org.id);

      const project = await db.projects.create({
        name: 'Vital Project',
        organization_id: org.id,
        created_by: testUser.id,
      });

      const vitalData = await db.organizations.hasVitalData(org.id);
      expect(vitalData.hasProjects).toBe(true);
      expect(vitalData.projectCount).toBe(1);

      // Clean up project
      await db.projects.delete(project.id);
    });

    it('should detect active subscription as vital data', async () => {
      const org = await db.organizations.create({
        name: 'Active Sub Corp',
        subdomain: uniqueSubdomain(),
      });
      createdOrgIds.push(org.id);

      const sub = await db.subscriptions.create({
        organization_id: org.id,
        plan_name: 'professional',
        status: 'active',
        current_period_start: new Date(),
        current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        quotas: {},
      });

      const vitalData = await db.organizations.hasVitalData(org.id);
      expect(vitalData.hasActiveSubscription).toBe(true);

      // Clean up subscription
      await db.subscriptions.delete(sub.id);
    });
  });
});
