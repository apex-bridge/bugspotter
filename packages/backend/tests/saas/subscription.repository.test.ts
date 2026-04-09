/**
 * Subscription Repository Tests
 * Tests for saas.subscriptions CRUD and query operations
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DatabaseClient } from '../../src/db/client.js';
import type { Organization } from '../../src/db/types.js';

const TEST_DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/test';

describe('SubscriptionRepository', () => {
  let db: DatabaseClient;
  let testOrg1: Organization;
  let testOrg2: Organization;
  const createdOrgIds: string[] = [];

  beforeAll(async () => {
    db = DatabaseClient.create({ connectionString: TEST_DATABASE_URL });
    const isConnected = await db.testConnection();
    if (!isConnected) {
      throw new Error('Failed to connect to test database');
    }

    const ts = Date.now();
    testOrg1 = await db.organizations.create({
      name: 'Sub Test Org 1',
      subdomain: `sub-test1-${ts}`,
    });
    createdOrgIds.push(testOrg1.id);

    testOrg2 = await db.organizations.create({
      name: 'Sub Test Org 2',
      subdomain: `sub-test2-${ts}`,
    });
    createdOrgIds.push(testOrg2.id);
  });

  afterAll(async () => {
    for (const id of createdOrgIds) {
      try {
        await db.organizations.delete(id);
      } catch {
        // Ignore
      }
    }
    await db.close();
  });

  describe('CRUD', () => {
    it('should create a subscription', async () => {
      const now = new Date();
      const end = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

      const sub = await db.subscriptions.create({
        organization_id: testOrg1.id,
        plan_name: 'trial',
        status: 'trial',
        current_period_start: now,
        current_period_end: end,
      });

      expect(sub.id).toBeDefined();
      expect(sub.organization_id).toBe(testOrg1.id);
      expect(sub.plan_name).toBe('trial');
      expect(sub.status).toBe('trial');
      expect(sub.quotas).toBeDefined();
    });

    it('should update a subscription', async () => {
      const sub = await db.subscriptions.findByOrganizationId(testOrg1.id);
      expect(sub).not.toBeNull();

      const updated = await db.subscriptions.update(sub!.id, {
        plan_name: 'professional',
        status: 'active',
        payment_provider: 'stripe',
        external_subscription_id: 'sub_test123',
        external_customer_id: 'cus_test123',
      });

      expect(updated).not.toBeNull();
      expect(updated!.plan_name).toBe('professional');
      expect(updated!.status).toBe('active');
      expect(updated!.payment_provider).toBe('stripe');
      expect(updated!.external_subscription_id).toBe('sub_test123');
      expect(updated!.external_customer_id).toBe('cus_test123');
    });
  });

  describe('findByOrganizationId', () => {
    it('should find subscription by org id', async () => {
      const sub = await db.subscriptions.findByOrganizationId(testOrg1.id);
      expect(sub).not.toBeNull();
      expect(sub!.organization_id).toBe(testOrg1.id);
    });

    it('should return null for org without subscription', async () => {
      const sub = await db.subscriptions.findByOrganizationId(testOrg2.id);
      expect(sub).toBeNull();
    });
  });

  describe('findByExternalSubscriptionId', () => {
    it('should find by external subscription id', async () => {
      const sub = await db.subscriptions.findByExternalSubscriptionId('stripe', 'sub_test123');
      expect(sub).not.toBeNull();
      expect(sub!.organization_id).toBe(testOrg1.id);
    });

    it('should return null for non-existent external id', async () => {
      const sub = await db.subscriptions.findByExternalSubscriptionId('stripe', 'sub_nonexistent');
      expect(sub).toBeNull();
    });
  });

  describe('findByExternalCustomerId', () => {
    it('should find by external customer id', async () => {
      const sub = await db.subscriptions.findByExternalCustomerId('stripe', 'cus_test123');
      expect(sub).not.toBeNull();
      expect(sub!.organization_id).toBe(testOrg1.id);
    });

    it('should return null for non-existent customer id', async () => {
      const sub = await db.subscriptions.findByExternalCustomerId('stripe', 'cus_nonexistent');
      expect(sub).toBeNull();
    });
  });

  describe('quotas JSON field', () => {
    it('should store and retrieve quotas as JSON', async () => {
      const sub = await db.subscriptions.findByOrganizationId(testOrg1.id);
      expect(sub).not.toBeNull();

      const updated = await db.subscriptions.update(sub!.id, {
        quotas: { projects: 10, bug_reports: 1000, storage_bytes: 5368709120 },
      });

      expect(updated).not.toBeNull();
      expect(updated!.quotas).toEqual({
        projects: 10,
        bug_reports: 1000,
        storage_bytes: 5368709120,
      });
    });
  });

  describe('delete', () => {
    it('should delete a subscription', async () => {
      const sub = await db.subscriptions.findByOrganizationId(testOrg1.id);
      expect(sub).not.toBeNull();

      const deleted = await db.subscriptions.delete(sub!.id);
      expect(deleted).toBe(true);

      const found = await db.subscriptions.findByOrganizationId(testOrg1.id);
      expect(found).toBeNull();
    });
  });
});
