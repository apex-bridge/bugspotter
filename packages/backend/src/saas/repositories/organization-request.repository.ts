/**
 * Organization Request Repository
 * CRUD operations for saas.organization_requests table
 */

import type { Pool, PoolClient } from 'pg';
import { BaseRepository } from '../../db/repositories/base-repository.js';
import type {
  OrganizationRequest,
  OrganizationRequestInsert,
  OrganizationRequestUpdate,
  OrganizationRequestFilters,
  OrgRequestStatus,
} from '../../db/types.js';

export class OrganizationRequestRepository extends BaseRepository<
  OrganizationRequest,
  OrganizationRequestInsert,
  OrganizationRequestUpdate
> {
  constructor(pool: Pool | PoolClient) {
    super(pool, 'saas', 'organization_requests', []);
  }

  /**
   * Find a request by its hashed verification token
   */
  async findByToken(token: string): Promise<OrganizationRequest | null> {
    const query = `
      SELECT * FROM ${this.schema}.${this.tableName}
      WHERE verification_token = $1
    `;
    const result = await this.pool.query<OrganizationRequest>(query, [token]);
    return result.rows[0] ?? null;
  }

  /**
   * Find active (pending_verification or verified) requests by email for duplicate detection.
   * Excludes approved/rejected/expired so users can submit new requests after resolution.
   */
  async findPendingByEmail(email: string): Promise<OrganizationRequest | null> {
    const query = `
      SELECT * FROM ${this.schema}.${this.tableName}
      WHERE contact_email = $1 AND status IN ('pending_verification', 'verified')
      ORDER BY created_at DESC
      LIMIT 1
    `;
    const result = await this.pool.query<OrganizationRequest>(query, [email.toLowerCase()]);
    return result.rows[0] ?? null;
  }

  /**
   * Count recent requests from an IP address for rate limiting
   */
  async countRecentByIp(ip: string, windowMinutes: number): Promise<number> {
    const query = `
      SELECT COUNT(*)::integer AS count
      FROM ${this.schema}.${this.tableName}
      WHERE ip_address = $1 AND created_at > NOW() - ($2 || ' minutes')::interval
    `;
    const result = await this.pool.query<{ count: number }>(query, [ip, windowMinutes.toString()]);
    return result.rows[0]?.count ?? 0;
  }

  /**
   * List requests for admin review with filtering and pagination
   */
  async listForAdmin(
    filters: OrganizationRequestFilters,
    pagination: { limit: number; offset: number },
    sort: { sort_by: string; order: 'asc' | 'desc' } = { sort_by: 'created_at', order: 'desc' }
  ): Promise<{
    data: OrganizationRequest[];
    pagination: { total: number; page: number; limit: number; totalPages: number };
  }> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (filters.status) {
      conditions.push(`status = $${paramIndex++}`);
      params.push(filters.status);
    }

    if (filters.contact_email) {
      conditions.push(`contact_email = $${paramIndex++}`);
      params.push(filters.contact_email.toLowerCase());
    }

    if (filters.search) {
      conditions.push(
        `(company_name ILIKE $${paramIndex} OR contact_email ILIKE $${paramIndex} OR contact_name ILIKE $${paramIndex})`
      );
      params.push(`%${filters.search}%`);
      paramIndex++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Whitelist sort columns to prevent SQL injection
    const allowedSortColumns = ['created_at', 'updated_at', 'company_name', 'status'];
    const sortColumn = allowedSortColumns.includes(sort.sort_by) ? sort.sort_by : 'created_at';
    const sortOrder = sort.order === 'asc' ? 'ASC' : 'DESC';

    const countQuery = `SELECT COUNT(*)::integer AS total FROM ${this.schema}.${this.tableName} ${whereClause}`;
    const countResult = await this.pool.query<{ total: number }>(countQuery, params);
    const total = countResult.rows[0]?.total ?? 0;

    const dataQuery = `
      SELECT * FROM ${this.schema}.${this.tableName}
      ${whereClause}
      ORDER BY ${sortColumn} ${sortOrder}
      LIMIT $${paramIndex++} OFFSET $${paramIndex++}
    `;
    const dataResult = await this.pool.query<OrganizationRequest>(dataQuery, [
      ...params,
      pagination.limit,
      pagination.offset,
    ]);

    const page = Math.floor(pagination.offset / pagination.limit) + 1;

    return {
      data: dataResult.rows,
      pagination: {
        total,
        page,
        limit: pagination.limit,
        totalPages: Math.ceil(total / pagination.limit),
      },
    };
  }

  /**
   * Expire unverified requests older than the given number of hours
   * Returns the count of expired requests
   */
  async expireUnverified(olderThanHours: number): Promise<number> {
    const query = `
      UPDATE ${this.schema}.${this.tableName}
      SET status = 'expired', updated_at = NOW()
      WHERE status = 'pending_verification'
        AND created_at < NOW() - ($1 || ' hours')::interval
    `;
    const result = await this.pool.query(query, [olderThanHours.toString()]);
    return result.rowCount ?? 0;
  }

  /**
   * Check if a subdomain is already taken by an existing organization
   */
  async isSubdomainTaken(subdomain: string): Promise<boolean> {
    const query = `
      SELECT EXISTS(
        SELECT 1 FROM ${this.schema}.organizations
        WHERE subdomain = $1 AND deleted_at IS NULL
      ) AS taken
    `;
    const result = await this.pool.query<{ taken: boolean }>(query, [subdomain.toLowerCase()]);
    return result.rows[0]?.taken ?? false;
  }

  /**
   * Check whether a subdomain is held by a non-terminal organization request
   * (pending_verification / verified / approved). Rejected and expired
   * requests are ignored — their subdomain is free to reuse.
   *
   * Used by self-service signup to avoid racing an enterprise onboarding
   * request that hasn't yet materialized into a real organization row.
   */
  async isSubdomainReservedByRequest(subdomain: string): Promise<boolean> {
    const query = `
      SELECT EXISTS(
        SELECT 1 FROM ${this.schema}.${this.tableName}
        WHERE LOWER(subdomain) = $1
          AND status IN ('pending_verification', 'verified', 'approved')
      ) AS reserved
    `;
    const result = await this.pool.query<{ reserved: boolean }>(query, [subdomain.toLowerCase()]);
    return result.rows[0]?.reserved ?? false;
  }

  /**
   * Update request status with audit fields
   */
  async updateStatus(
    id: string,
    status: OrgRequestStatus,
    extra?: Partial<OrganizationRequestUpdate>
  ): Promise<OrganizationRequest | null> {
    const updates: OrganizationRequestUpdate = {
      status,
      ...extra,
    };
    return this.update(id, updates);
  }
}
