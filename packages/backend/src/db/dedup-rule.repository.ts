/**
 * Dedup Rule Repository
 *
 * Storage for the tiny dedup-rule engine (Phase 0.5). Each row is one
 * `DedupRule` (see ../integrations/dedup-rule.schema.ts) keyed by
 * project. The repository deals only in storage — Zod validation
 * happens at the call sites (admin API on write, executor on read)
 * so the DB layer can stay agnostic about which fields are
 * discriminator-required.
 */

import type { Pool, PoolClient } from 'pg';
import { BaseRepository } from './repositories/base-repository.js';

/**
 * Row shape as it lives in the DB. `rule_json` is the raw blob;
 * the executor parses it through `parseDedupRule` (which validates).
 */
export interface DedupRuleRow {
  id: string;
  project_id: string;
  name: string;
  rule_json: unknown;
  enabled: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface DedupRuleInsert {
  id?: string;
  project_id: string;
  name: string;
  rule_json: unknown;
  enabled?: boolean;
}

export interface DedupRuleUpdate {
  name?: string;
  rule_json?: unknown;
  enabled?: boolean;
}

export class DedupRuleRepository extends BaseRepository<
  DedupRuleRow,
  DedupRuleInsert,
  DedupRuleUpdate
> {
  constructor(pool: Pool | PoolClient) {
    super(pool, 'application', 'dedup_rules', ['rule_json']);
  }

  /**
   * Find all rules for a project. The executor's hot path uses
   * `includeDisabled=false` (the partial index on
   * `dedup_rules(project_id) WHERE enabled = true` is sized for this);
   * the admin UI uses `includeDisabled=true` to render disabled rows
   * with a toggle.
   */
  async findByProject(projectId: string, includeDisabled = false): Promise<DedupRuleRow[]> {
    const query = `
      SELECT id, project_id, name, rule_json, enabled, created_at, updated_at
      FROM dedup_rules
      WHERE project_id = $1
        ${includeDisabled ? '' : 'AND enabled = true'}
      ORDER BY name ASC
    `;
    const result = await this.pool.query<DedupRuleRow>(query, [projectId]);
    return result.rows;
  }

  /**
   * Look up a rule by (project, name). Used by the admin UI to detect
   * name collisions before INSERT, and by the seed helpers to upsert
   * the B1 / B2 / B3 preset rules without duplicating them on repeat
   * deploys.
   */
  async findByProjectAndName(projectId: string, name: string): Promise<DedupRuleRow | null> {
    const query = `
      SELECT id, project_id, name, rule_json, enabled, created_at, updated_at
      FROM dedup_rules
      WHERE project_id = $1 AND name = $2
    `;
    const result = await this.pool.query<DedupRuleRow>(query, [projectId, name]);
    return result.rows[0] ?? null;
  }
}
