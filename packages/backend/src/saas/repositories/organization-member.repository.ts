/**
 * Organization Member Repository
 * CRUD operations for saas.organization_members table
 */

import type { Pool, PoolClient } from 'pg';
import { BaseRepository } from '../../db/repositories/base-repository.js';
import type {
  OrganizationMember,
  OrganizationMemberInsert,
  OrganizationMemberUpdate,
  OrganizationMemberWithUser,
  OrgMemberRole,
  Organization,
} from '../../db/types.js';

export class OrganizationMemberRepository extends BaseRepository<
  OrganizationMember,
  OrganizationMemberInsert,
  OrganizationMemberUpdate
> {
  constructor(pool: Pool | PoolClient) {
    super(pool, 'saas', 'organization_members', []);
  }

  /**
   * List members of an organization with user details
   */
  async findByOrganizationId(organizationId: string): Promise<OrganizationMemberWithUser[]> {
    const query = `
      SELECT om.id, om.organization_id, om.user_id, om.role, om.created_at, om.updated_at,
        u.email AS user_email,
        u.name AS user_name
      FROM ${this.schema}.${this.tableName} om
      INNER JOIN application.users u ON u.id = om.user_id
      WHERE om.organization_id = $1
      ORDER BY
        CASE om.role
          WHEN 'owner' THEN 1
          WHEN 'admin' THEN 2
          WHEN 'member' THEN 3
        END,
        om.created_at ASC
    `;
    const result = await this.pool.query<OrganizationMemberWithUser>(query, [organizationId]);
    return result.rows;
  }

  /**
   * Find a specific membership (user + org combination)
   */
  async findMembership(organizationId: string, userId: string): Promise<OrganizationMember | null> {
    const query = `
      SELECT id, organization_id, user_id, role, created_at, updated_at
      FROM ${this.schema}.${this.tableName}
      WHERE organization_id = $1 AND user_id = $2
    `;
    const result = await this.pool.query<OrganizationMember>(query, [organizationId, userId]);
    return result.rows[0] ?? null;
  }

  /**
   * Find a specific membership with user details (email, name)
   */
  async findMembershipWithUser(
    organizationId: string,
    userId: string
  ): Promise<OrganizationMemberWithUser | null> {
    const query = `
      SELECT om.id, om.organization_id, om.user_id, om.role, om.created_at, om.updated_at,
        u.email AS user_email,
        u.name AS user_name
      FROM ${this.schema}.${this.tableName} om
      INNER JOIN application.users u ON u.id = om.user_id
      WHERE om.organization_id = $1 AND om.user_id = $2
    `;
    const result = await this.pool.query<OrganizationMemberWithUser>(query, [
      organizationId,
      userId,
    ]);
    return result.rows[0] ?? null;
  }

  /**
   * Find all organizations a user is a member of (with their role)
   */
  async findByUserId(userId: string): Promise<OrganizationMember[]> {
    const query = `
      SELECT id, organization_id, user_id, role, created_at, updated_at
      FROM ${this.schema}.${this.tableName}
      WHERE user_id = $1
      ORDER BY created_at ASC
    `;
    const result = await this.pool.query<OrganizationMember>(query, [userId]);
    return result.rows;
  }

  /**
   * Update a member's role
   */
  async updateRole(
    organizationId: string,
    userId: string,
    role: OrgMemberRole
  ): Promise<OrganizationMember | null> {
    const query = `
      UPDATE ${this.schema}.${this.tableName}
      SET role = $3, updated_at = NOW()
      WHERE organization_id = $1 AND user_id = $2
      RETURNING id, organization_id, user_id, role, created_at, updated_at
    `;
    const result = await this.pool.query<OrganizationMember>(query, [organizationId, userId, role]);
    return result.rows[0] ?? null;
  }

  /**
   * Remove a member from an organization
   */
  async removeMember(organizationId: string, userId: string): Promise<boolean> {
    const query = `
      DELETE FROM ${this.schema}.${this.tableName}
      WHERE organization_id = $1 AND user_id = $2
    `;
    const result = await this.pool.query(query, [organizationId, userId]);
    return (result.rowCount ?? 0) > 0;
  }

  /**
   * Get the owner of an organization
   */
  async findOwner(organizationId: string): Promise<OrganizationMember | null> {
    const query = `
      SELECT id, organization_id, user_id, role, created_at, updated_at
      FROM ${this.schema}.${this.tableName}
      WHERE organization_id = $1 AND role = 'owner'
    `;
    const result = await this.pool.query<OrganizationMember>(query, [organizationId]);
    return result.rows[0] ?? null;
  }

  /**
   * Count members in an organization
   */
  async countByOrganizationId(organizationId: string): Promise<number> {
    const query = `
      SELECT COUNT(*)::int AS count
      FROM ${this.schema}.${this.tableName}
      WHERE organization_id = $1
    `;
    const result = await this.pool.query<{ count: number }>(query, [organizationId]);
    return result.rows[0]?.count ?? 0;
  }

  /**
   * Create member with user details in a single atomic query.
   * Uses ON CONFLICT to handle duplicates gracefully.
   * Returns null if the member already exists.
   */
  async createWithUser(
    organizationId: string,
    userId: string,
    role: OrgMemberRole
  ): Promise<OrganizationMemberWithUser | null> {
    const query = `
      WITH inserted AS (
        INSERT INTO ${this.schema}.${this.tableName} (organization_id, user_id, role)
        VALUES ($1, $2, $3)
        ON CONFLICT (organization_id, user_id) DO NOTHING
        RETURNING *
      )
      SELECT 
        i.id, i.organization_id, i.user_id, i.role, i.created_at, i.updated_at,
        u.email AS user_email, u.name AS user_name
      FROM inserted i
      INNER JOIN application.users u ON u.id = i.user_id
    `;

    const result = await this.pool.query<OrganizationMemberWithUser>(query, [
      organizationId,
      userId,
      role,
    ]);

    return result.rows[0] ?? null;
  }

  /**
   * Check organization access in a single atomic query.
   * Returns organization data and membership status for authorization checks.
   *
   * @returns Object with organization and membership properties:
   * - { organization: null, membership: null } - Organization doesn't exist (404)
   * - { organization: Organization, membership: null } - Org exists, user not a member (403)
   * - { organization: Organization, membership: OrganizationMember } - User is a member (200)
   *
   * Uses PostgreSQL's jsonb_build_object to automatically construct typed objects,
   * reducing manual mapping and making the code resilient to schema changes.
   */
  async checkOrganizationAccess(
    organizationId: string,
    userId: string
  ): Promise<{
    organization: Organization | null;
    membership: OrganizationMember | null;
  }> {
    const query = `
      SELECT 
        jsonb_build_object(
          'id', o.id,
          'name', o.name,
          'subdomain', o.subdomain,
          'data_residency_region', o.data_residency_region,
          'storage_region', o.storage_region,
          'subscription_status', o.subscription_status,
          'trial_ends_at', o.trial_ends_at,
          'deleted_at', o.deleted_at,
          'deleted_by', o.deleted_by,
          'pending_owner_email', (
            SELECT oi.email FROM saas.organization_invitations oi
            WHERE oi.organization_id = o.id AND oi.role = 'owner' AND oi.status = 'pending'
            LIMIT 1
          ),
          'billing_method', o.billing_method,
          'settings', o.settings,
          'created_at', o.created_at,
          'updated_at', o.updated_at
        ) AS organization,
        CASE 
          WHEN om.id IS NOT NULL THEN
            jsonb_build_object(
              'id', om.id,
              'organization_id', om.organization_id,
              'user_id', om.user_id,
              'role', om.role,
              'created_at', om.created_at,
              'updated_at', om.updated_at
            )
          ELSE NULL
        END AS membership
      FROM saas.organizations o
      LEFT JOIN ${this.schema}.${this.tableName} om 
        ON om.organization_id = o.id AND om.user_id = $2
      WHERE o.id = $1
    `;

    const result = await this.pool.query(query, [organizationId, userId]);

    if (result.rows.length === 0) {
      // Organization doesn't exist
      return { organization: null, membership: null };
    }

    const row = result.rows[0];

    // pg driver automatically parses JSONB into JavaScript objects
    return {
      organization: row.organization as Organization,
      membership: row.membership as OrganizationMember | null,
    };
  }
}
