/**
 * Intelligence Mitigation Service
 *
 * Persists and retrieves AI-generated mitigation suggestions for bug reports.
 * Follows the same upsert + versioning pattern as enrichment-service.ts.
 */

import { getLogger } from '../../logger.js';
import type { DatabaseClient } from '../../db/client.js';
import type { MitigationResponse } from './types.js';

const logger = getLogger();

// ============================================================================
// Types
// ============================================================================

export interface BugMitigationRow {
  id: string;
  bug_report_id: string;
  project_id: string;
  organization_id: string | null;
  mitigation_suggestion: string;
  based_on_similar_bugs: boolean;
  mitigation_version: number;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// Service
// ============================================================================

// Hardcoded constants — safe for SQL interpolation (never user input).
// Matches the pattern used by enrichment-service.ts.
const SCHEMA = 'application' as const;
const TABLE = 'bug_mitigations' as const;

export class IntelligenceMitigationService {
  constructor(private readonly db: DatabaseClient) {}

  /**
   * Save or update mitigation for a bug report.
   * Uses upsert — re-generation increments the version.
   */
  async saveMitigation(
    bugReportId: string,
    projectId: string,
    organizationId: string | undefined,
    response: MitigationResponse
  ): Promise<BugMitigationRow> {
    const query = `
      INSERT INTO ${SCHEMA}.${TABLE}
        (bug_report_id, project_id, organization_id,
         mitigation_suggestion, based_on_similar_bugs, mitigation_version)
      VALUES ($1, $2, $3, $4, $5, 1)
      ON CONFLICT (bug_report_id) DO UPDATE SET
        mitigation_suggestion = EXCLUDED.mitigation_suggestion,
        based_on_similar_bugs = EXCLUDED.based_on_similar_bugs,
        mitigation_version = ${TABLE}.mitigation_version + 1,
        updated_at = NOW()
      RETURNING *
    `;

    const result = await this.db
      .getPool()
      .query(query, [
        bugReportId,
        projectId,
        organizationId ?? null,
        response.mitigation_suggestion,
        response.based_on_similar_bugs,
      ]);

    const row = result.rows[0];

    logger.info('Bug mitigation saved', {
      mitigationId: row.id,
      bugReportId,
      basedOnSimilar: response.based_on_similar_bugs,
      version: row.mitigation_version,
    });

    return row;
  }

  /**
   * Get mitigation for a specific bug report.
   */
  async getMitigation(bugReportId: string): Promise<BugMitigationRow | null> {
    const query = `
      SELECT * FROM ${SCHEMA}.${TABLE}
      WHERE bug_report_id = $1
    `;

    const result = await this.db.getPool().query(query, [bugReportId]);
    return result.rows[0] ?? null;
  }
}
