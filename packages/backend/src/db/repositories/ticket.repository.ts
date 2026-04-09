/**
 * Ticket Repository
 * Manages tickets created in external systems (Jira, Linear, etc.)
 * Supports both manual and automatic ticket creation
 */

import type { Pool, PoolClient } from 'pg';
import { BaseRepository } from './base-repository.js';
import type { Ticket, TicketStatus, TicketSyncStatus, AttachmentResult } from '../types.js';

export class TicketRepository extends BaseRepository<Ticket, Partial<Ticket>, never> {
  constructor(pool: Pool | PoolClient) {
    super(pool, 'application', 'tickets', ['attachment_results']);
  }

  /**
   * Create ticket with required fields
   * @param metadata - Optional metadata for automatic ticket creation (rule_id, created_automatically)
   */
  async createTicket(
    bugReportId: string,
    externalId: string,
    platform: string,
    status?: TicketStatus,
    metadata?: {
      integrationId?: string;
      ruleId?: string;
      createdAutomatically?: boolean;
      externalUrl?: string;
    }
  ): Promise<Ticket> {
    return this.create({
      bug_report_id: bugReportId,
      external_id: externalId,
      platform,
      status: status ?? null,
      integration_id: metadata?.integrationId ?? null,
      rule_id: metadata?.ruleId ?? null,
      created_automatically: metadata?.createdAutomatically ?? false,
      external_url: metadata?.externalUrl ?? null,
    });
  }

  /**
   * Find tickets by bug report ID
   */
  async findByBugReport(bugReportId: string): Promise<Ticket[]> {
    return this.findManyBy('bug_report_id', bugReportId);
  }

  /**
   * Count tickets created by a rule within a time window (for throttling)
   * Used to enforce rate limits on auto-ticket creation
   */
  async countByRuleSince(ruleId: string, since: Date): Promise<number> {
    const query = `
      SELECT COUNT(*)::int as count
      FROM tickets
      WHERE rule_id = $1
        AND created_at >= $2
    `;

    const result = await this.pool.query<{ count: number }>(query, [ruleId, since]);
    return result.rows[0].count;
  }

  /**
   * Update sync status after processing
   * Called after ticket creation or sync operations complete
   */
  async updateSyncStatus(id: string, status: TicketSyncStatus, error?: string): Promise<void> {
    const query = `
      UPDATE tickets
      SET 
        sync_status = $1,
        last_sync_error = $2
      WHERE id = $3
    `;

    await this.pool.query(query, [status, error ?? null, id]);
  }

  /**
   * Update attachment results after uploads complete
   * Records which attachments were successfully uploaded to the ticket
   */
  async updateAttachmentResults(id: string, results: AttachmentResult[]): Promise<void> {
    const query = `
      UPDATE tickets
      SET attachment_results = $1::jsonb
      WHERE id = $2
    `;

    await this.pool.query(query, [JSON.stringify(results), id]);
  }

  /**
   * Find tickets by integration ID (for activity feed)
   * Supports pagination and optional status filtering
   */
  async findByIntegrationId(
    integrationId: string,
    options: { limit?: number; offset?: number; status?: TicketStatus } = {}
  ): Promise<Ticket[]> {
    const { limit = 50, offset = 0, status } = options;

    let query = `
      SELECT 
        id, bug_report_id, external_id, platform, status, created_at,
        integration_id, rule_id, created_automatically, external_url,
        sync_status, last_sync_error, attachment_results
      FROM tickets
      WHERE integration_id = $1
    `;

    const values: unknown[] = [integrationId];

    if (status) {
      query += ` AND status = $${values.length + 1}`;
      values.push(status);
    }

    query += ` ORDER BY created_at DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`;
    values.push(limit, offset);

    const result = await this.pool.query<Ticket>(query, values);
    return result.rows;
  }

  /**
   * Count tickets by integration and status (for stats)
   * Used for dashboard metrics and integration health monitoring
   */
  async countByIntegration(
    integrationId: string,
    options: { since?: Date; status?: TicketStatus; createdAutomatically?: boolean } = {}
  ): Promise<number> {
    const { since, status, createdAutomatically } = options;

    let query = `
      SELECT COUNT(*)::int as count
      FROM tickets
      WHERE integration_id = $1
    `;

    const values: unknown[] = [integrationId];

    if (since) {
      query += ` AND created_at >= $${values.length + 1}`;
      values.push(since);
    }

    if (status) {
      query += ` AND status = $${values.length + 1}`;
      values.push(status);
    }

    if (createdAutomatically !== undefined) {
      query += ` AND created_automatically = $${values.length + 1}`;
      values.push(createdAutomatically);
    }

    const result = await this.pool.query<{ count: number }>(query, values);
    return result.rows[0].count;
  }

  /**
   * Update ticket metadata (rule_id, integration_id, created_automatically)
   * Used by AutoTicketService to enhance tickets created by platform services
   */
  async updateMetadata(
    id: string,
    metadata: {
      rule_id?: string;
      integration_id?: string;
      created_automatically?: boolean;
    }
  ): Promise<void> {
    const setClauses: string[] = [];
    const values: unknown[] = [];

    if (metadata.rule_id !== undefined) {
      values.push(metadata.rule_id);
      setClauses.push(`rule_id = $${values.length}`);
    }

    if (metadata.integration_id !== undefined) {
      values.push(metadata.integration_id);
      setClauses.push(`integration_id = $${values.length}`);
    }

    if (metadata.created_automatically !== undefined) {
      values.push(metadata.created_automatically);
      setClauses.push(`created_automatically = $${values.length}`);
    }

    if (setClauses.length === 0) {
      return; // Nothing to update
    }

    values.push(id);
    const query = `
      UPDATE tickets
      SET ${setClauses.join(', ')}
      WHERE id = $${values.length}
    `;

    await this.pool.query(query, values);
  }
}
