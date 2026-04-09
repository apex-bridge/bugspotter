/**
 * Usage Record Repository Tests
 * Tests for saas.usage_records CRUD and query operations
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DatabaseClient } from '../../src/db/client.js';
import type { Organization } from '../../src/db/types.js';

const TEST_DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/test';

describe('UsageRecordRepository', () => {
  let db: DatabaseClient;
  let testOrg: Organization;
  const createdOrgIds: string[] = [];
  const periodStart = new Date('2025-01-01T00:00:00Z');
  const periodEnd = new Date('2025-02-01T00:00:00Z');

  beforeAll(async () => {
    db = DatabaseClient.create({ connectionString: TEST_DATABASE_URL });
    const isConnected = await db.testConnection();
    if (!isConnected) {
      throw new Error('Failed to connect to test database');
    }

    testOrg = await db.organizations.create({
      name: 'Usage Test Org',
      subdomain: `usage-test-${Date.now()}`,
    });
    createdOrgIds.push(testOrg.id);
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

  describe('increment (upsert)', () => {
    it('should create a new usage record', async () => {
      const record = await db.usageRecords.increment(
        testOrg.id,
        periodStart,
        periodEnd,
        'projects',
        5
      );

      expect(record.id).toBeDefined();
      expect(record.organization_id).toBe(testOrg.id);
      expect(record.resource_type).toBe('projects');
      expect(record.quantity).toBe(5);
    });

    it('should increment existing record quantity', async () => {
      const record = await db.usageRecords.increment(
        testOrg.id,
        periodStart,
        periodEnd,
        'projects',
        3
      );

      expect(record.quantity).toBe(8);
    });

    it('should default amount to 1', async () => {
      const record = await db.usageRecords.increment(
        testOrg.id,
        periodStart,
        periodEnd,
        'bug_reports'
      );

      expect(record.quantity).toBe(1);
    });
  });

  describe('findByOrgAndPeriod', () => {
    it('should find records for a specific period', async () => {
      const records = await db.usageRecords.findByOrgAndPeriod(testOrg.id, periodStart);
      expect(records.length).toBe(2); // projects + bug_reports
      expect(records[0].resource_type).toBe('bug_reports'); // ASC order
      expect(records[1].resource_type).toBe('projects');
    });

    it('should return empty for non-existent period', async () => {
      const records = await db.usageRecords.findByOrgAndPeriod(
        testOrg.id,
        new Date('2099-01-01T00:00:00Z')
      );
      expect(records.length).toBe(0);
    });
  });

  describe('findByOrgPeriodAndType', () => {
    it('should find a specific usage record', async () => {
      const record = await db.usageRecords.findByOrgPeriodAndType(
        testOrg.id,
        periodStart,
        'projects'
      );
      expect(record).not.toBeNull();
      expect(record!.quantity).toBe(8);
    });

    it('should return null for non-existent type', async () => {
      const record = await db.usageRecords.findByOrgPeriodAndType(
        testOrg.id,
        periodStart,
        'storage_bytes'
      );
      expect(record).toBeNull();
    });
  });

  describe('findByOrganizationId', () => {
    it('should find all records across periods', async () => {
      // Add a record in a different period
      const period2Start = new Date('2025-02-01T00:00:00Z');
      const period2End = new Date('2025-03-01T00:00:00Z');
      await db.usageRecords.increment(testOrg.id, period2Start, period2End, 'projects', 10);

      const records = await db.usageRecords.findByOrganizationId(testOrg.id);
      expect(records.length).toBeGreaterThanOrEqual(3);

      // Should be ordered by period_start DESC
      const dates = records.map((r) => new Date(r.period_start).getTime());
      for (let i = 1; i < dates.length; i++) {
        expect(dates[i]).toBeLessThanOrEqual(dates[i - 1]);
      }
    });
  });

  describe('decrement', () => {
    it('should decrement existing record quantity', async () => {
      // First, increment to ensure we have a record with quantity
      await db.usageRecords.increment(testOrg.id, periodStart, periodEnd, 'storage_bytes', 100);

      const record = await db.usageRecords.decrement(testOrg.id, periodStart, 'storage_bytes', 30);

      expect(record).not.toBeNull();
      expect(record!.quantity).toBe(70);
    });

    it('should return null when decrementing non-existent record', async () => {
      const result = await db.usageRecords.decrement(
        testOrg.id,
        new Date('2099-01-01T00:00:00Z'),
        'api_calls',
        10
      );

      expect(result).toBeNull();
    });

    it('should return null when decrement would go negative', async () => {
      // Ensure we have a record with known quantity
      await db.usageRecords.increment(testOrg.id, periodStart, periodEnd, 'screenshots', 5);

      // Try to decrement more than available
      const result = await db.usageRecords.decrement(testOrg.id, periodStart, 'screenshots', 10);

      expect(result).toBeNull();

      // Verify original quantity unchanged
      const record = await db.usageRecords.findByOrgPeriodAndType(
        testOrg.id,
        periodStart,
        'screenshots'
      );
      expect(record!.quantity).toBe(5);
    });

    it('should default amount to 1', async () => {
      // Ensure we have a record
      await db.usageRecords.increment(testOrg.id, periodStart, periodEnd, 'session_replays', 10);

      const record = await db.usageRecords.decrement(testOrg.id, periodStart, 'session_replays');

      expect(record).not.toBeNull();
      expect(record!.quantity).toBe(9);
    });

    it('should allow decrementing to exactly zero', async () => {
      // Create a new record with quantity 1 for api_calls
      // Use a different period to ensure fresh record
      const freshPeriodStart = new Date('2025-03-01T00:00:00Z');
      const freshPeriodEnd = new Date('2025-04-01T00:00:00Z');
      await db.usageRecords.increment(testOrg.id, freshPeriodStart, freshPeriodEnd, 'api_calls', 1);

      const record = await db.usageRecords.decrement(testOrg.id, freshPeriodStart, 'api_calls', 1);

      expect(record).not.toBeNull();
      expect(record!.quantity).toBe(0);
    });
  });

  describe('CRUD via base', () => {
    it('should create a record directly', async () => {
      const record = await db.usageRecords.create({
        organization_id: testOrg.id,
        period_start: new Date('2025-06-01T00:00:00Z'),
        period_end: new Date('2025-07-01T00:00:00Z'),
        resource_type: 'api_calls',
        quantity: 100,
      });

      expect(record.id).toBeDefined();
      expect(record.resource_type).toBe('api_calls');
      expect(record.quantity).toBe(100);
    });

    it('should delete a record', async () => {
      const records = await db.usageRecords.findByOrgPeriodAndType(
        testOrg.id,
        new Date('2025-06-01T00:00:00Z'),
        'api_calls'
      );
      expect(records).not.toBeNull();

      const deleted = await db.usageRecords.delete(records!.id);
      expect(deleted).toBe(true);
    });
  });
});
