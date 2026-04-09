/**
 * Invitation Repository
 * CRUD operations for saas.organization_invitations table
 */

import type { Pool, PoolClient } from 'pg';
import { BaseRepository } from '../../db/repositories/base-repository.js';
import type {
  OrganizationInvitation,
  OrganizationInvitationInsert,
  OrganizationInvitationUpdate,
  OrganizationInvitationWithDetails,
} from '../../db/types.js';

export class InvitationRepository extends BaseRepository<
  OrganizationInvitation,
  OrganizationInvitationInsert,
  OrganizationInvitationUpdate
> {
  constructor(pool: Pool | PoolClient) {
    super(pool, 'saas', 'organization_invitations', []);
  }

  /**
   * Find invitation by token with org and inviter details
   */
  async findByToken(token: string): Promise<OrganizationInvitationWithDetails | null> {
    const query = `
      SELECT i.*,
        o.name AS organization_name,
        o.subdomain AS organization_subdomain,
        u.email AS inviter_email,
        u.name AS inviter_name
      FROM ${this.schema}.${this.tableName} i
      INNER JOIN ${this.schema}.organizations o ON o.id = i.organization_id
      INNER JOIN application.users u ON u.id = i.invited_by
      WHERE i.token = $1
    `;
    const result = await this.pool.query<OrganizationInvitationWithDetails>(query, [token]);
    return result.rows[0] ?? null;
  }

  /**
   * Check for existing pending invitation for an email in an org
   */
  async findPendingByOrgAndEmail(
    organizationId: string,
    email: string
  ): Promise<OrganizationInvitation | null> {
    const query = `
      SELECT * FROM ${this.schema}.${this.tableName}
      WHERE organization_id = $1 AND email = $2 AND status = 'pending' AND expires_at > NOW()
    `;
    const result = await this.pool.query<OrganizationInvitation>(query, [
      organizationId,
      email.toLowerCase(),
    ]);
    return result.rows[0] ?? null;
  }

  /**
   * Find a pending owner invitation for an organization.
   * Uses the idx_invitations_one_pending_owner_per_org partial unique index.
   */
  async findPendingOwnerByOrganizationId(
    organizationId: string
  ): Promise<OrganizationInvitation | null> {
    const query = `
      SELECT * FROM ${this.schema}.${this.tableName}
      WHERE organization_id = $1 AND role = 'owner' AND status = 'pending' AND expires_at > NOW()
    `;
    const result = await this.pool.query<OrganizationInvitation>(query, [organizationId]);
    return result.rows[0] ?? null;
  }

  /**
   * List pending invitations for an organization
   */
  async findPendingByOrganizationId(
    organizationId: string
  ): Promise<OrganizationInvitationWithDetails[]> {
    const query = `
      SELECT i.*,
        o.name AS organization_name,
        o.subdomain AS organization_subdomain,
        u.email AS inviter_email,
        u.name AS inviter_name
      FROM ${this.schema}.${this.tableName} i
      INNER JOIN ${this.schema}.organizations o ON o.id = i.organization_id
      INNER JOIN application.users u ON u.id = i.invited_by
      WHERE i.organization_id = $1 AND i.status = 'pending' AND i.expires_at > NOW()
      ORDER BY i.created_at DESC
    `;
    const result = await this.pool.query<OrganizationInvitationWithDetails>(query, [
      organizationId,
    ]);
    return result.rows;
  }

  /**
   * Find all pending invitations for an email address
   * Used during registration to auto-accept invitations
   */
  async findPendingByEmail(email: string): Promise<OrganizationInvitationWithDetails[]> {
    const query = `
      SELECT i.*,
        o.name AS organization_name,
        o.subdomain AS organization_subdomain,
        u.email AS inviter_email,
        u.name AS inviter_name
      FROM ${this.schema}.${this.tableName} i
      INNER JOIN ${this.schema}.organizations o ON o.id = i.organization_id
      INNER JOIN application.users u ON u.id = i.invited_by
      WHERE i.email = $1 AND i.status = 'pending' AND i.expires_at > NOW()
      ORDER BY i.created_at ASC
    `;
    const result = await this.pool.query<OrganizationInvitationWithDetails>(query, [
      email.toLowerCase(),
    ]);
    return result.rows;
  }

  /**
   * Accept an invitation (set status + accepted_at)
   */
  async acceptInvitation(id: string): Promise<OrganizationInvitation | null> {
    const query = `
      UPDATE ${this.schema}.${this.tableName}
      SET status = 'accepted', accepted_at = NOW(), updated_at = NOW()
      WHERE id = $1 AND status = 'pending' AND expires_at > NOW()
      RETURNING *
    `;
    const result = await this.pool.query<OrganizationInvitation>(query, [id]);
    return result.rows[0] ?? null;
  }

  /**
   * Cancel an invitation
   */
  async cancelInvitation(id: string): Promise<OrganizationInvitation | null> {
    const query = `
      UPDATE ${this.schema}.${this.tableName}
      SET status = 'canceled', updated_at = NOW()
      WHERE id = $1 AND status = 'pending'
      RETURNING *
    `;
    const result = await this.pool.query<OrganizationInvitation>(query, [id]);
    return result.rows[0] ?? null;
  }

  /**
   * Expire stale pending invitations for a specific org+email.
   * Clears the partial unique index slot so a new invite can be created.
   */
  async expireStaleByOrgAndEmail(organizationId: string, email: string): Promise<number> {
    const query = `
      UPDATE ${this.schema}.${this.tableName}
      SET status = 'expired', updated_at = NOW()
      WHERE organization_id = $1 AND email = $2
        AND status = 'pending' AND expires_at <= NOW()
    `;
    const result = await this.pool.query(query, [organizationId, email.toLowerCase()]);
    return result.rowCount ?? 0;
  }

  /**
   * Expire all stale invitations (past their expiry date)
   * Designed to be called periodically (e.g., cron job)
   */
  async expireStaleInvitations(): Promise<number> {
    const query = `
      UPDATE ${this.schema}.${this.tableName}
      SET status = 'expired', updated_at = NOW()
      WHERE status = 'pending' AND expires_at <= NOW()
    `;
    const result = await this.pool.query(query);
    return result.rowCount ?? 0;
  }
}
