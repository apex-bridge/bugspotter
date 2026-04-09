/**
 * Organization Repository
 * CRUD operations for saas.organizations table
 */

import type { Pool, PoolClient } from 'pg';
import { BaseRepository } from '../../db/repositories/base-repository.js';
import type {
  Organization,
  OrganizationInsert,
  OrganizationUpdate,
  OrganizationSettings,
  OrganizationFilters,
  OrganizationWithMemberCount,
  PaginationOptions,
  PaginatedResult,
  SubscriptionStatus,
} from '../../db/types.js';

export class OrganizationRepository extends BaseRepository<
  Organization,
  OrganizationInsert,
  OrganizationUpdate
> {
  constructor(pool: Pool | PoolClient) {
    super(pool, 'saas', 'organizations', ['settings']);
  }

  /**
   * Find organization by ID, excluding soft-deleted.
   */
  override async findById(id: string): Promise<Organization | null> {
    const query = `SELECT * FROM ${this.schema}.${this.tableName} WHERE id = $1 AND deleted_at IS NULL`;
    const result = await this.getClient().query<Organization>(query, [id]);
    return result.rows[0] ?? null;
  }

  /**
   * Find organization by ID, including soft-deleted (for admin restore/precheck).
   */
  async findByIdIncludeDeleted(id: string): Promise<Organization | null> {
    const query = `SELECT * FROM ${this.schema}.${this.tableName} WHERE id = $1`;
    const result = await this.getClient().query<Organization>(query, [id]);
    return result.rows[0] ?? null;
  }

  /**
   * Find organization by subdomain, excluding soft-deleted.
   */
  async findBySubdomain(subdomain: string): Promise<Organization | null> {
    const query = `SELECT * FROM ${this.schema}.${this.tableName} WHERE subdomain = $1 AND deleted_at IS NULL`;
    const result = await this.getClient().query<Organization>(query, [subdomain]);
    return result.rows[0] ?? null;
  }

  /**
   * List organizations with member count, supporting filters and pagination.
   * Excludes soft-deleted by default unless includeDeleted is set.
   */
  async listWithMemberCount(
    filters: OrganizationFilters = {},
    pagination: PaginationOptions = {}
  ): Promise<PaginatedResult<OrganizationWithMemberCount>> {
    const { page = 1, limit = 20 } = pagination;
    const offset = (page - 1) * limit;
    const conditions: string[] = [];
    const values: unknown[] = [];
    let paramCount = 0;

    if (!filters.includeDeleted) {
      conditions.push('o.deleted_at IS NULL');
    }

    if (filters.subscription_status) {
      paramCount++;
      conditions.push(`o.subscription_status = $${paramCount}`);
      values.push(filters.subscription_status);
    }

    if (filters.data_residency_region) {
      paramCount++;
      conditions.push(`o.data_residency_region = $${paramCount}`);
      values.push(filters.data_residency_region);
    }

    if (filters.search) {
      paramCount++;
      conditions.push(`(o.name ILIKE $${paramCount} OR o.subdomain ILIKE $${paramCount})`);
      values.push(`%${filters.search}%`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Count query
    const countQuery = `SELECT COUNT(*)::int AS total FROM ${this.schema}.${this.tableName} o ${whereClause}`;
    const countResult = await this.pool.query<{ total: number }>(countQuery, values);
    const total = countResult.rows[0]?.total ?? 0;

    // Data query with member count
    const limitParam = values.length + 1;
    const offsetParam = values.length + 2;

    const dataQuery = `
      SELECT o.id, o.name, o.subdomain, o.data_residency_region, o.storage_region,
        o.subscription_status, o.billing_method, o.settings, o.trial_ends_at, o.deleted_at, o.deleted_by,
        o.created_at, o.updated_at,
        COALESCE(COUNT(om.id), 0)::int AS member_count,
        (SELECT oi.email FROM ${this.schema}.organization_invitations oi
         WHERE oi.organization_id = o.id AND oi.role = 'owner' AND oi.status = 'pending'
         LIMIT 1) AS pending_owner_email
      FROM ${this.schema}.${this.tableName} o
      LEFT JOIN ${this.schema}.organization_members om ON om.organization_id = o.id
      ${whereClause}
      GROUP BY o.id, o.name, o.subdomain, o.data_residency_region, o.storage_region,
        o.subscription_status, o.billing_method, o.settings, o.trial_ends_at, o.deleted_at, o.deleted_by,
        o.created_at, o.updated_at
      ORDER BY o.created_at DESC
      LIMIT $${limitParam} OFFSET $${offsetParam}
    `;

    const dataResult = await this.pool.query<OrganizationWithMemberCount>(dataQuery, [
      ...values,
      limit,
      offset,
    ]);

    return {
      data: dataResult.rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Check if a subdomain is available.
   * Includes soft-deleted orgs — subdomain stays reserved for restore.
   */
  async isSubdomainAvailable(subdomain: string): Promise<boolean> {
    const query = `SELECT 1 FROM ${this.schema}.${this.tableName} WHERE subdomain = $1 LIMIT 1`;
    const result = await this.pool.query(query, [subdomain]);
    return (result.rowCount ?? 0) === 0;
  }

  /**
   * Update subscription status
   */
  async updateSubscriptionStatus(
    organizationId: string,
    status: SubscriptionStatus
  ): Promise<Organization | null> {
    return this.update(organizationId, { subscription_status: status });
  }

  /**
   * Find organizations a user belongs to, excluding soft-deleted.
   */
  async findByUserId(userId: string): Promise<Organization[]> {
    const query = `
      SELECT o.*, om.role AS my_role
      FROM ${this.schema}.${this.tableName} o
      INNER JOIN ${this.schema}.organization_members om ON om.organization_id = o.id
      WHERE om.user_id = $1 AND o.deleted_at IS NULL
      ORDER BY o.name ASC
    `;
    const result = await this.pool.query<Organization>(query, [userId]);
    return result.rows;
  }

  /**
   * Soft-delete an organization by setting deleted_at/deleted_by.
   * Returns true if a row was updated.
   */
  async softDelete(organizationId: string, deletedBy: string): Promise<boolean> {
    const query = `
      UPDATE ${this.schema}.${this.tableName}
      SET deleted_at = CURRENT_TIMESTAMP, deleted_by = $2
      WHERE id = $1 AND deleted_at IS NULL
    `;
    const result = await this.pool.query(query, [organizationId, deletedBy]);
    return (result.rowCount ?? 0) > 0;
  }

  /**
   * Restore a soft-deleted organization.
   * Returns true if a row was updated.
   */
  async restore(organizationId: string): Promise<boolean> {
    const query = `
      UPDATE ${this.schema}.${this.tableName}
      SET deleted_at = NULL, deleted_by = NULL
      WHERE id = $1 AND deleted_at IS NOT NULL
    `;
    const result = await this.pool.query(query, [organizationId]);
    return (result.rowCount ?? 0) > 0;
  }

  /**
   * Permanently delete an organization.
   * ON DELETE CASCADE handles all child records (members, subscriptions, projects, etc.).
   */
  async hardDelete(organizationId: string): Promise<boolean> {
    const query = `DELETE FROM ${this.schema}.${this.tableName} WHERE id = $1`;
    const result = await this.pool.query(query, [organizationId]);
    return (result.rowCount ?? 0) > 0;
  }

  /**
   * Atomically delete an organization ONLY if it has no vital data.
   * Combines the vital-data check and DELETE in a single statement to prevent
   * TOCTOU races (projects/subscriptions created between check and delete).
   * Returns true if deleted, false if the org has vital data or doesn't exist.
   */
  async hardDeleteGuarded(organizationId: string): Promise<boolean> {
    const query = `
      DELETE FROM ${this.schema}.${this.tableName}
      WHERE id = $1
        AND NOT EXISTS (
          SELECT 1 FROM application.projects WHERE organization_id = $1
        )
        AND NOT EXISTS (
          SELECT 1 FROM ${this.schema}.subscriptions
          WHERE organization_id = $1 AND status IN ('active', 'past_due', 'incomplete')
        )
    `;
    const result = await this.pool.query(query, [organizationId]);
    return (result.rowCount ?? 0) > 0;
  }

  /**
   * Merge keys into the organization's JSONB settings column.
   * Uses jsonb_concat (||) so only supplied keys are overwritten; others are preserved.
   */
  async updateSettings(
    organizationId: string,
    patch: OrganizationSettings
  ): Promise<Organization | null> {
    const query = `
      UPDATE ${this.schema}.${this.tableName}
      SET settings = settings || $2::jsonb, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND deleted_at IS NULL
      RETURNING *
    `;
    const result = await this.getClient().query(query, [organizationId, JSON.stringify(patch)]);
    return result.rows[0] ? this.deserialize(result.rows[0]) : null;
  }

  /**
   * Check if an organization has vital data that prevents hard deletion.
   */
  async hasVitalData(organizationId: string): Promise<{
    hasProjects: boolean;
    projectCount: number;
    hasActiveSubscription: boolean;
  }> {
    const query = `
      SELECT
        (SELECT COUNT(*)::int FROM application.projects WHERE organization_id = $1) AS project_count,
        (SELECT COUNT(*)::int FROM ${this.schema}.subscriptions
          WHERE organization_id = $1
          AND status IN ('active', 'past_due', 'incomplete')
        ) AS active_sub_count
    `;
    const result = await this.pool.query<{
      project_count: number;
      active_sub_count: number;
    }>(query, [organizationId]);
    const row = result.rows[0];
    return {
      hasProjects: row.project_count > 0,
      projectCount: row.project_count,
      hasActiveSubscription: row.active_sub_count > 0,
    };
  }
}
