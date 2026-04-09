/**
 * Self-Service Resolution Service
 *
 * Enables end users to find known resolutions for their issues before
 * submitting a new bug report. When a user's description matches a
 * resolved bug, the resolution is returned so the user can self-resolve.
 *
 * Deflection events are tracked for ROI measurement — each self-resolution
 * is recorded with a description hash to avoid double-counting.
 */

import { createHash } from 'crypto';
import { getLogger } from '../../logger.js';
import type { DatabaseClient } from '../../db/client.js';
import type { IntelligenceClient } from './intelligence-client.js';
import type { SearchResult } from './types.js';
import { getOrgIntelligenceSettings, INTELLIGENCE_SETTINGS_DEFAULTS } from './tenant-config.js';

const logger = getLogger();

// ============================================================================
// Types
// ============================================================================

export interface SelfServiceMatch {
  bug_id: string;
  title: string;
  resolution: string;
  similarity: number;
  status: string;
}

export interface SelfServiceCheckResult {
  matches: SelfServiceMatch[];
  has_resolution: boolean;
}

export interface DeflectionRecord {
  id: string;
  organization_id: string | null;
  project_id: string;
  matched_bug_id: string;
  description_hash: string;
  created_at: string;
}

export interface DeflectionStats {
  total_deflections: number;
  deflections_last_7d: number;
  deflections_last_30d: number;
  top_matched_bugs: Array<{ bug_id: string; deflection_count: number }>;
}

// ============================================================================
// Service
// ============================================================================

const SCHEMA = 'application';
const TABLE = 'intelligence_deflections';

export class SelfServiceResolutionService {
  constructor(
    private readonly db: DatabaseClient,
    private readonly client: IntelligenceClient
  ) {}

  /**
   * Check if self-service is enabled for the given organization.
   * Returns true when enabled or when no org context exists (global mode).
   */
  async isEnabled(organizationId?: string | null): Promise<boolean> {
    if (!organizationId) {
      return INTELLIGENCE_SETTINGS_DEFAULTS.intelligence_self_service_enabled;
    }

    try {
      const settings = await getOrgIntelligenceSettings(this.db, organizationId);
      return settings.intelligence_self_service_enabled;
    } catch (error) {
      logger.warn('Failed to load org intelligence settings, using defaults', {
        organizationId,
        error: error instanceof Error ? error.message : String(error),
      });
      return INTELLIGENCE_SETTINGS_DEFAULTS.intelligence_self_service_enabled;
    }
  }

  /**
   * Check a user's description against known resolved bugs.
   * Returns matching resolutions the user can use to self-resolve.
   */
  async checkForResolutions(
    description: string,
    projectId: string
  ): Promise<SelfServiceCheckResult> {
    const searchResult = await this.client.search({
      query: description,
      project_id: projectId,
      mode: 'fast',
      limit: 10,
      status: 'resolved',
    });

    // Filter to only bugs that have a resolution text
    const matches: SelfServiceMatch[] = searchResult.results
      .filter((r: SearchResult) => r.resolution && r.resolution.trim().length > 0)
      .slice(0, 5)
      .map((r: SearchResult) => ({
        bug_id: r.bug_id,
        title: r.title,
        resolution: r.resolution!,
        similarity: r.similarity,
        status: r.status,
      }));

    return {
      matches,
      has_resolution: matches.length > 0,
    };
  }

  /**
   * Record that a user self-resolved using a matched bug's resolution.
   * Stores a hash of the description to avoid double-counting.
   */
  async recordDeflection(
    projectId: string,
    matchedBugId: string,
    description: string,
    organizationId?: string
  ): Promise<DeflectionRecord> {
    const descriptionHash = createHash('sha256')
      .update(description.trim().toLowerCase())
      .digest('hex');

    // Atomic insert-or-select via CTE — avoids race conditions and extra round-trips.
    // The is_new flag distinguishes new inserts from existing-row fallbacks.
    const query = `
      WITH new_row AS (
        INSERT INTO ${SCHEMA}.${TABLE}
          (organization_id, project_id, matched_bug_id, description_hash)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (project_id, matched_bug_id, description_hash) DO NOTHING
        RETURNING *
      )
      SELECT *, true AS is_new FROM new_row
      UNION ALL
      SELECT *, false AS is_new FROM ${SCHEMA}.${TABLE}
      WHERE project_id = $2 AND matched_bug_id = $3 AND description_hash = $4
        AND NOT EXISTS (SELECT 1 FROM new_row)
    `;

    const result = await this.db
      .getPool()
      .query(query, [organizationId ?? null, projectId, matchedBugId, descriptionHash]);

    const { is_new: isNew, ...row } = result.rows[0] as DeflectionRecord & { is_new: boolean };

    if (isNew) {
      logger.info('Deflection recorded', {
        deflectionId: row.id,
        projectId,
        matchedBugId,
      });
    }

    return row;
  }

  /**
   * Get deflection statistics for a project.
   */
  async getStats(projectId: string): Promise<DeflectionStats> {
    const query = `
      SELECT
        COUNT(*)::int AS total_deflections,
        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days')::int AS deflections_last_7d,
        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '30 days')::int AS deflections_last_30d
      FROM ${SCHEMA}.${TABLE}
      WHERE project_id = $1
    `;

    const topQuery = `
      SELECT matched_bug_id AS bug_id, COUNT(*)::int AS deflection_count
      FROM ${SCHEMA}.${TABLE}
      WHERE project_id = $1
      GROUP BY matched_bug_id
      ORDER BY deflection_count DESC
      LIMIT 5
    `;

    const [statsResult, topResult] = await Promise.all([
      this.db.getPool().query(query, [projectId]),
      this.db.getPool().query(topQuery, [projectId]),
    ]);

    const stats = statsResult.rows[0];

    return {
      total_deflections: stats.total_deflections,
      deflections_last_7d: stats.deflections_last_7d,
      deflections_last_30d: stats.deflections_last_30d,
      top_matched_bugs: topResult.rows,
    };
  }
}
