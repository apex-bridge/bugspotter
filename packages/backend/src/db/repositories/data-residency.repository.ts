/**
 * Data Residency Repository
 *
 * Database operations for data residency policies, audit logs, and violations.
 */

import type { Pool, PoolClient } from 'pg';
import type {
  DataResidencyRegion,
  StorageRegion,
  DataResidencyPolicy,
} from '../../data-residency/types.js';
import {
  DATA_RESIDENCY_PRESETS,
  DEFAULT_DATA_RESIDENCY_POLICY,
} from '../../data-residency/types.js';

// ============================================================================
// TYPES
// ============================================================================

export interface DataResidencyAuditRow {
  id: string;
  project_id: string;
  action: string;
  resource_type: string;
  resource_id: string | null;
  storage_region: string;
  user_id: string | null;
  ip_address: string | null;
  metadata: Record<string, unknown> | null;
  created_at: Date;
}

export interface DataResidencyViolationRow {
  id: string;
  project_id: string;
  violation_type: string;
  description: string;
  attempted_action: string;
  user_id: string | null;
  source_region: string | null;
  target_region: string | null;
  blocked: boolean;
  created_at: Date;
}

export interface DataResidencyAuditInsert {
  project_id: string;
  action: string;
  resource_type: string;
  resource_id?: string | null;
  storage_region: string;
  user_id?: string | null;
  ip_address?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface DataResidencyViolationInsert {
  project_id: string;
  violation_type: string;
  description: string;
  attempted_action: string;
  user_id?: string | null;
  source_region?: string | null;
  target_region?: string | null;
  blocked: boolean;
}

export interface AuditQueryOptions {
  action?: string;
  since?: Date;
  until?: Date;
  limit?: number;
  offset?: number;
}

export interface ViolationQueryOptions {
  violationType?: string;
  blocked?: boolean;
  since?: Date;
  until?: Date;
  limit?: number;
  offset?: number;
}

// ============================================================================
// REPOSITORY
// ============================================================================

/**
 * Data Residency Repository
 *
 * Note: This repository does NOT extend BaseRepository because it manages
 * three distinct entities with specialized cross-table business logic:
 * 1. Project data residency policies (projects table)
 * 2. Audit logs (data_residency_audit table)
 * 3. Violations (data_residency_violations table)
 *
 * Similar pattern to NotificationThrottleRepository which also handles
 * specialized operations that don't fit the single-entity BaseRepository pattern.
 *
 * Retry Logic: All read methods (getProjectPolicy, getComplianceSummary, etc.)
 * are wrapped with automatic retry logic by DatabaseClient.wrapWithRetry().
 * Write methods (insertAuditEntry, insertViolation, updateProjectPolicy) are
 * NOT retried to prevent duplicate operations.
 */
export class DataResidencyRepository {
  private pool: Pool | PoolClient;

  constructor(pool: Pool | PoolClient) {
    this.pool = pool;
  }

  protected getClient(): Pool | PoolClient {
    return this.pool;
  }

  // ==========================================================================
  // PROJECT POLICY OPERATIONS
  // ==========================================================================

  /**
   * Get data residency policy for a project
   */
  async getProjectPolicy(projectId: string): Promise<DataResidencyPolicy> {
    const query = `
      SELECT data_residency_region, storage_region
      FROM projects
      WHERE id = $1
    `;

    const result = await this.getClient().query(query, [projectId]);

    if (result.rows.length === 0) {
      return DEFAULT_DATA_RESIDENCY_POLICY;
    }

    const row = result.rows[0];
    const region = (row.data_residency_region || 'global') as DataResidencyRegion;
    const storageRegion = (row.storage_region || 'auto') as StorageRegion;

    // Get the preset for this region and override storage region if customized
    const preset = DATA_RESIDENCY_PRESETS[region] || DATA_RESIDENCY_PRESETS.global;

    return {
      ...preset,
      storageRegion: storageRegion,
    };
  }

  /**
   * Update data residency policy for a project
   */
  async updateProjectPolicy(
    projectId: string,
    region: DataResidencyRegion,
    storageRegion: StorageRegion
  ): Promise<void> {
    const query = `
      UPDATE projects
      SET data_residency_region = $2,
          storage_region = $3,
          updated_at = NOW()
      WHERE id = $1
    `;

    await this.getClient().query(query, [projectId, region, storageRegion]);
  }

  // ==========================================================================
  // AUDIT LOG OPERATIONS
  // ==========================================================================

  /**
   * Insert an audit log entry
   */
  async insertAuditEntry(entry: DataResidencyAuditInsert): Promise<DataResidencyAuditRow> {
    const query = `
      INSERT INTO data_residency_audit (
        project_id, action, resource_type, resource_id,
        storage_region, user_id, ip_address, metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `;

    const result = await this.getClient().query(query, [
      entry.project_id,
      entry.action,
      entry.resource_type,
      entry.resource_id || null,
      entry.storage_region,
      entry.user_id || null,
      entry.ip_address || null,
      entry.metadata ? JSON.stringify(entry.metadata) : null,
    ]);

    return result.rows[0];
  }

  /**
   * Get audit entries for a project
   */
  async getProjectAuditEntries(
    projectId: string,
    options: AuditQueryOptions = {}
  ): Promise<DataResidencyAuditRow[]> {
    const conditions: string[] = ['project_id = $1'];
    const params: unknown[] = [projectId];
    let paramIndex = 2;

    if (options.action) {
      conditions.push(`action = $${paramIndex}`);
      params.push(options.action);
      paramIndex++;
    }

    if (options.since) {
      conditions.push(`created_at >= $${paramIndex}`);
      params.push(options.since);
      paramIndex++;
    }

    if (options.until) {
      conditions.push(`created_at <= $${paramIndex}`);
      params.push(options.until);
      paramIndex++;
    }

    const limit = options.limit || 100;
    const offset = options.offset || 0;

    const limitParam = paramIndex++;
    const offsetParam = paramIndex++;
    params.push(limit, offset);

    const query = `
      SELECT *
      FROM data_residency_audit
      WHERE ${conditions.join(' AND ')}
      ORDER BY created_at DESC
      LIMIT $${limitParam} OFFSET $${offsetParam}
    `;

    const result = await this.getClient().query(query, params);
    return result.rows;
  }

  /**
   * Count audit entries for a project
   */
  async countProjectAuditEntries(
    projectId: string,
    options: AuditQueryOptions = {}
  ): Promise<number> {
    const conditions: string[] = ['project_id = $1'];
    const params: unknown[] = [projectId];
    let paramIndex = 2;

    if (options.action) {
      conditions.push(`action = $${paramIndex}`);
      params.push(options.action);
      paramIndex++;
    }

    if (options.since) {
      conditions.push(`created_at >= $${paramIndex}`);
      params.push(options.since);
      paramIndex++;
    }

    if (options.until) {
      conditions.push(`created_at <= $${paramIndex}`);
      params.push(options.until);
      paramIndex++;
    }

    const query = `
      SELECT COUNT(*) as count
      FROM data_residency_audit
      WHERE ${conditions.join(' AND ')}
    `;

    const result = await this.getClient().query(query, params);
    return parseInt(result.rows[0].count, 10);
  }

  // ==========================================================================
  // VIOLATION OPERATIONS
  // ==========================================================================

  /**
   * Insert a violation record
   */
  async insertViolation(
    violation: DataResidencyViolationInsert
  ): Promise<DataResidencyViolationRow> {
    const query = `
      INSERT INTO data_residency_violations (
        project_id, violation_type, description, attempted_action,
        user_id, source_region, target_region, blocked
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `;

    const result = await this.getClient().query(query, [
      violation.project_id,
      violation.violation_type,
      violation.description,
      violation.attempted_action,
      violation.user_id || null,
      violation.source_region || null,
      violation.target_region || null,
      violation.blocked,
    ]);

    return result.rows[0];
  }

  /**
   * Get violations for a project
   */
  async getProjectViolations(
    projectId: string,
    options: ViolationQueryOptions = {}
  ): Promise<DataResidencyViolationRow[]> {
    const conditions: string[] = ['project_id = $1'];
    const params: unknown[] = [projectId];
    let paramIndex = 2;

    if (options.violationType) {
      conditions.push(`violation_type = $${paramIndex}`);
      params.push(options.violationType);
      paramIndex++;
    }

    if (options.blocked !== undefined) {
      conditions.push(`blocked = $${paramIndex}`);
      params.push(options.blocked);
      paramIndex++;
    }

    if (options.since) {
      conditions.push(`created_at >= $${paramIndex}`);
      params.push(options.since);
      paramIndex++;
    }

    if (options.until) {
      conditions.push(`created_at <= $${paramIndex}`);
      params.push(options.until);
      paramIndex++;
    }

    const limit = options.limit || 100;
    const offset = options.offset || 0;

    const limitParam = paramIndex++;
    const offsetParam = paramIndex++;
    params.push(limit, offset);

    const query = `
      SELECT *
      FROM data_residency_violations
      WHERE ${conditions.join(' AND ')}
      ORDER BY created_at DESC
      LIMIT $${limitParam} OFFSET $${offsetParam}
    `;

    const result = await this.getClient().query(query, params);
    return result.rows;
  }

  /**
   * Count violations for a project
   */
  async countProjectViolations(
    projectId: string,
    options: ViolationQueryOptions = {}
  ): Promise<number> {
    const conditions: string[] = ['project_id = $1'];
    const params: unknown[] = [projectId];
    let paramIndex = 2;

    if (options.violationType) {
      conditions.push(`violation_type = $${paramIndex}`);
      params.push(options.violationType);
      paramIndex++;
    }

    if (options.blocked !== undefined) {
      conditions.push(`blocked = $${paramIndex}`);
      params.push(options.blocked);
      paramIndex++;
    }

    if (options.since) {
      conditions.push(`created_at >= $${paramIndex}`);
      params.push(options.since);
      paramIndex++;
    }

    if (options.until) {
      conditions.push(`created_at <= $${paramIndex}`);
      params.push(options.until);
      paramIndex++;
    }

    const query = `
      SELECT COUNT(*) as count
      FROM data_residency_violations
      WHERE ${conditions.join(' AND ')}
    `;

    const result = await this.getClient().query(query, params);
    return parseInt(result.rows[0].count, 10);
  }

  /**
   * Get compliance summary for a project
   */
  async getComplianceSummary(projectId: string): Promise<{
    policy: DataResidencyPolicy;
    violationCount: number;
    recentViolations: DataResidencyViolationRow[];
    auditCount: number;
  }> {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000); // Last 24 hours

    const [policy, violationCount, recentViolations, auditCount] = await Promise.all([
      this.getProjectPolicy(projectId),
      this.countProjectViolations(projectId, { since }),
      this.getProjectViolations(projectId, { since, limit: 10 }),
      this.countProjectAuditEntries(projectId, { since }),
    ]);

    return {
      policy,
      violationCount,
      recentViolations,
      auditCount,
    };
  }
}
