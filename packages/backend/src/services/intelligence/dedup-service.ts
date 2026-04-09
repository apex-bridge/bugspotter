/**
 * Intelligence Dedup Service
 *
 * Applies duplicate detection actions (flag or auto_close) based on
 * org settings. Called from the intelligence worker after similarity
 * analysis completes.
 *
 * - flag: sets duplicate_of on the bug report, keeps status unchanged
 * - auto_close: sets duplicate_of AND closes the bug report
 *
 * Writes are idempotent — a bug already marked as a duplicate is not overwritten.
 */

import { getLogger } from '../../logger.js';
import type { DatabaseClient } from '../../db/client.js';
import type { SimilarBug, DedupAction } from './types.js';
import {
  getOrgIntelligenceSettings,
  INTELLIGENCE_SETTINGS_DEFAULTS,
  type OrgIntelligenceSettings,
} from './tenant-config.js';

const logger = getLogger();

// ============================================================================
// Types
// ============================================================================

export interface DedupActionResult {
  action: DedupAction;
  applied: boolean;
  duplicateOf: string | null;
  statusChanged: boolean;
}

// ============================================================================
// Service
// ============================================================================

export class IntelligenceDedupService {
  constructor(private readonly db: DatabaseClient) {}

  /**
   * Apply the appropriate dedup action for a bug report.
   *
   * Returns early (applied: false) when the bug is not a duplicate or
   * there are no similar bugs to reference.
   */
  async applyDedupAction(
    bugReportId: string,
    isDuplicate: boolean,
    similarBugs: SimilarBug[],
    organizationId?: string
  ): Promise<DedupActionResult> {
    if (!isDuplicate) {
      return { action: 'flag', applied: false, duplicateOf: null, statusChanged: false };
    }

    // Filter out self-references — the intelligence service may return the
    // bug itself in the similar list. Do this before fetching org settings
    // to avoid unnecessary DB work when there are no actionable candidates.
    const candidates = similarBugs.filter((b) => b.bug_id !== bugReportId);
    if (candidates.length === 0) {
      return { action: 'flag', applied: false, duplicateOf: null, statusChanged: false };
    }

    // Resolve org settings once — used for both the enabled flag and the action
    const settings = await this.resolveSettings(organizationId);

    if (!settings.intelligence_dedup_enabled) {
      return { action: 'flag', applied: false, duplicateOf: null, statusChanged: false };
    }

    const dedupAction = settings.intelligence_dedup_action;

    // Pick the most similar bug as canonical — sort defensively in case
    // the upstream API doesn't guarantee descending similarity order.
    const sorted = [...candidates].sort((a, b) => b.similarity - a.similarity);
    const canonicalBugId = sorted[0].bug_id;

    if (dedupAction === 'auto_close') {
      const applied = await this.autoCloseAsDuplicate(bugReportId, canonicalBugId);
      return {
        action: 'auto_close',
        applied,
        duplicateOf: applied ? canonicalBugId : null,
        statusChanged: applied,
      };
    }

    const applied = await this.flagAsDuplicate(bugReportId, canonicalBugId);
    return {
      action: 'flag',
      applied,
      duplicateOf: applied ? canonicalBugId : null,
      statusChanged: false,
    };
  }

  /**
   * Resolve org intelligence settings, falling back to defaults on error or missing org.
   */
  private async resolveSettings(organizationId?: string): Promise<OrgIntelligenceSettings> {
    if (!organizationId) {
      return INTELLIGENCE_SETTINGS_DEFAULTS;
    }

    try {
      return await getOrgIntelligenceSettings(this.db, organizationId);
    } catch (error) {
      logger.warn('Failed to load org intelligence settings, using defaults', {
        organizationId,
        error: error instanceof Error ? error.message : String(error),
      });
      return INTELLIGENCE_SETTINGS_DEFAULTS;
    }
  }

  /**
   * Flag a bug as a duplicate without changing its status.
   * Returns true if the update was applied, false if already marked.
   */
  private async flagAsDuplicate(bugReportId: string, canonicalBugId: string): Promise<boolean> {
    const query = `
      UPDATE application.bug_reports
      SET duplicate_of = $1, updated_at = NOW()
      WHERE id = $2 AND duplicate_of IS NULL
    `;

    const result = await this.db.getPool().query(query, [canonicalBugId, bugReportId]);
    const applied = (result.rowCount ?? 0) > 0;

    if (applied) {
      logger.debug('Bug flagged as duplicate', { bugReportId, canonicalBugId });
    } else {
      logger.debug('Bug already marked as duplicate, skipping', { bugReportId });
    }

    return applied;
  }

  /**
   * Auto-close a bug as a duplicate: set duplicate_of AND status = 'closed'.
   * Returns true if the update was applied, false if already marked.
   */
  private async autoCloseAsDuplicate(
    bugReportId: string,
    canonicalBugId: string
  ): Promise<boolean> {
    const query = `
      UPDATE application.bug_reports
      SET duplicate_of = $1, status = 'closed', updated_at = NOW()
      WHERE id = $2 AND duplicate_of IS NULL
    `;

    const result = await this.db.getPool().query(query, [canonicalBugId, bugReportId]);
    const applied = (result.rowCount ?? 0) > 0;

    if (applied) {
      logger.debug('Bug auto-closed as duplicate', { bugReportId, canonicalBugId });
    } else {
      logger.debug('Bug already marked as duplicate, skipping auto-close', { bugReportId });
    }

    return applied;
  }
}
