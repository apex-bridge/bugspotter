/**
 * Usage Record Repository
 * CRUD operations for saas.usage_records table
 */

import type { Pool, PoolClient } from 'pg';
import { BaseRepository } from '../../db/repositories/base-repository.js';
import type {
  UsageRecord,
  UsageRecordInsert,
  UsageRecordUpdate,
  ResourceType,
} from '../../db/types.js';

export class UsageRecordRepository extends BaseRepository<
  UsageRecord,
  UsageRecordInsert,
  UsageRecordUpdate
> {
  constructor(pool: Pool | PoolClient) {
    super(pool, 'saas', 'usage_records', []);
  }

  /**
   * Parse BIGINT quantity from string to number.
   * node-postgres returns BIGINT as string; our usage values
   * are well within Number.MAX_SAFE_INTEGER.
   */
  protected deserialize(row: unknown): UsageRecord {
    const record = super.deserialize(row);
    record.quantity = Number(record.quantity);
    return record;
  }

  /**
   * Find usage records for an organization in a specific period
   */
  async findByOrgAndPeriod(organizationId: string, periodStart: Date): Promise<UsageRecord[]> {
    const query = `
      SELECT id, organization_id, period_start, period_end, resource_type, quantity, created_at, updated_at
      FROM ${this.schema}.${this.tableName}
      WHERE organization_id = $1 AND period_start = $2
      ORDER BY resource_type ASC
    `;
    const result = await this.pool.query<UsageRecord>(query, [organizationId, periodStart]);
    return this.deserializeMany(result.rows);
  }

  /**
   * Find a specific usage record by org, period, and resource type
   */
  async findByOrgPeriodAndType(
    organizationId: string,
    periodStart: Date,
    resourceType: ResourceType
  ): Promise<UsageRecord | null> {
    const query = `
      SELECT id, organization_id, period_start, period_end, resource_type, quantity, created_at, updated_at
      FROM ${this.schema}.${this.tableName}
      WHERE organization_id = $1
        AND period_start = $2
        AND resource_type = $3
    `;
    const result = await this.pool.query<UsageRecord>(query, [
      organizationId,
      periodStart,
      resourceType,
    ]);
    return result.rows[0] ? this.deserialize(result.rows[0]) : null;
  }

  /**
   * Increment usage quantity (upsert pattern)
   * Creates the record if it doesn't exist, increments if it does
   */
  async increment(
    organizationId: string,
    periodStart: Date,
    periodEnd: Date,
    resourceType: ResourceType,
    amount: number = 1
  ): Promise<UsageRecord> {
    const query = `
      INSERT INTO ${this.schema}.${this.tableName} (organization_id, period_start, period_end, resource_type, quantity)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (organization_id, period_start, resource_type)
      DO UPDATE SET
        quantity = ${this.tableName}.quantity + $5,
        updated_at = NOW()
      RETURNING id, organization_id, period_start, period_end, resource_type, quantity, created_at, updated_at
    `;
    const result = await this.pool.query<UsageRecord>(query, [
      organizationId,
      periodStart,
      periodEnd,
      resourceType,
      amount,
    ]);
    return this.deserialize(result.rows[0]);
  }

  /**
   * Atomically increment usage only if the new total stays within the limit.
   * Returns { allowed: true, quantity } on success, { allowed: false } if the
   * increment would exceed the limit. Uses a conditional ON CONFLICT WHERE clause
   * so the update never applies when it would breach the quota.
   */
  async incrementWithLimit(
    organizationId: string,
    periodStart: Date,
    periodEnd: Date,
    resourceType: ResourceType,
    amount: number,
    limit: number
  ): Promise<{ allowed: boolean; quantity: number }> {
    // Atomic upsert that only succeeds when the new total <= limit.
    // The INSERT path checks $5 <= $6 (amount <= limit) for new rows.
    // The UPDATE path checks existing quantity + amount <= limit.
    const query = `
      INSERT INTO ${this.schema}.${this.tableName} (organization_id, period_start, period_end, resource_type, quantity)
      SELECT $1, $2, $3, $4, $5::bigint
      WHERE $5::bigint <= $6::bigint
      ON CONFLICT (organization_id, period_start, resource_type)
      DO UPDATE SET
        quantity = ${this.tableName}.quantity + $5::bigint,
        updated_at = NOW()
      WHERE ${this.tableName}.quantity + $5::bigint <= $6::bigint
      RETURNING quantity
    `;
    const result = await this.pool.query<{ quantity: string | number }>(query, [
      organizationId,
      periodStart,
      periodEnd,
      resourceType,
      amount,
      limit,
    ]);

    if (result.rows.length === 0) {
      return { allowed: false, quantity: -1 };
    }

    return { allowed: true, quantity: Number(result.rows[0].quantity) };
  }

  /**
   * Decrement usage quantity for a resource.
   * Used to release quota when a resource creation fails after quota was reserved.
   * Returns the updated record, or null if no record exists or quantity would go negative.
   */
  async decrement(
    organizationId: string,
    periodStart: Date,
    resourceType: ResourceType,
    amount: number = 1
  ): Promise<UsageRecord | null> {
    // Only decrement if record exists and quantity >= amount (prevent negative values)
    const query = `
      UPDATE ${this.schema}.${this.tableName}
      SET quantity = quantity - $4,
          updated_at = NOW()
      WHERE organization_id = $1
        AND period_start = $2
        AND resource_type = $3
        AND quantity >= $4
      RETURNING id, organization_id, period_start, period_end, resource_type, quantity, created_at, updated_at
    `;
    const result = await this.pool.query<UsageRecord>(query, [
      organizationId,
      periodStart,
      resourceType,
      amount,
    ]);
    return result.rows[0] ? this.deserialize(result.rows[0]) : null;
  }

  /**
   * Get all usage records for an organization (across all periods)
   */
  async findByOrganizationId(organizationId: string): Promise<UsageRecord[]> {
    const query = `
      SELECT id, organization_id, period_start, period_end, resource_type, quantity, created_at, updated_at
      FROM ${this.schema}.${this.tableName}
      WHERE organization_id = $1
      ORDER BY period_start DESC, resource_type ASC
    `;
    const result = await this.pool.query<UsageRecord>(query, [organizationId]);
    return this.deserializeMany(result.rows);
  }
}
