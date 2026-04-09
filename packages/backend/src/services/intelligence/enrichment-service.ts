/**
 * Intelligence Enrichment Service
 *
 * Persists and retrieves AI-generated enrichment data for bug reports:
 * categorization, suggested severity, tags, root cause summary, and
 * affected components — each with a confidence score.
 */

import { getLogger } from '../../logger.js';
import type { DatabaseClient } from '../../db/client.js';
import type { EnrichBugResponse } from './types.js';

const logger = getLogger();

// ============================================================================
// Types
// ============================================================================

export interface BugEnrichmentRow {
  id: string;
  bug_report_id: string;
  project_id: string;
  organization_id: string | null;
  category: string;
  suggested_severity: string;
  tags: string[];
  root_cause_summary: string;
  affected_components: string[];
  confidence_category: number;
  confidence_severity: number;
  confidence_tags: number;
  confidence_root_cause: number;
  confidence_components: number;
  enrichment_version: number;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// Service
// ============================================================================

const SCHEMA = 'application';
const TABLE = 'bug_enrichments';

export class IntelligenceEnrichmentService {
  constructor(private readonly db: DatabaseClient) {}

  /**
   * Save or update enrichment data for a bug report.
   * Uses upsert — re-enrichment increments the version.
   */
  async saveEnrichment(
    bugReportId: string,
    projectId: string,
    organizationId: string | undefined,
    response: EnrichBugResponse
  ): Promise<BugEnrichmentRow> {
    const query = `
      INSERT INTO ${SCHEMA}.${TABLE}
        (bug_report_id, project_id, organization_id, category, suggested_severity,
         tags, root_cause_summary, affected_components,
         confidence_category, confidence_severity, confidence_tags,
         confidence_root_cause, confidence_components, enrichment_version)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 1)
      ON CONFLICT (bug_report_id) DO UPDATE SET
        category = EXCLUDED.category,
        suggested_severity = EXCLUDED.suggested_severity,
        tags = EXCLUDED.tags,
        root_cause_summary = EXCLUDED.root_cause_summary,
        affected_components = EXCLUDED.affected_components,
        confidence_category = EXCLUDED.confidence_category,
        confidence_severity = EXCLUDED.confidence_severity,
        confidence_tags = EXCLUDED.confidence_tags,
        confidence_root_cause = EXCLUDED.confidence_root_cause,
        confidence_components = EXCLUDED.confidence_components,
        enrichment_version = ${TABLE}.enrichment_version + 1,
        updated_at = NOW()
      RETURNING *
    `;

    const result = await this.db
      .getPool()
      .query(query, [
        bugReportId,
        projectId,
        organizationId ?? null,
        response.category,
        response.suggested_severity,
        response.tags,
        response.root_cause_summary,
        response.affected_components,
        response.confidence.category,
        response.confidence.severity,
        response.confidence.tags,
        response.confidence.root_cause,
        response.confidence.components,
      ]);

    const row = result.rows[0];

    logger.info('Bug enrichment saved', {
      enrichmentId: row.id,
      bugReportId,
      category: response.category,
      version: row.enrichment_version,
    });

    return row;
  }

  /**
   * Get enrichment data for a specific bug report.
   */
  async getEnrichment(bugReportId: string): Promise<BugEnrichmentRow | null> {
    const query = `
      SELECT * FROM ${SCHEMA}.${TABLE}
      WHERE bug_report_id = $1
    `;

    const result = await this.db.getPool().query(query, [bugReportId]);
    return result.rows[0] ?? null;
  }

  /**
   * Get all enrichments for a project, ordered by most recent.
   */
  async getEnrichmentsByProject(projectId: string): Promise<BugEnrichmentRow[]> {
    const query = `
      SELECT * FROM ${SCHEMA}.${TABLE}
      WHERE project_id = $1
      ORDER BY updated_at DESC
    `;

    const result = await this.db.getPool().query(query, [projectId]);
    return result.rows;
  }
}
