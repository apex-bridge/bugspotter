/**
 * AI Severity → Priority application
 *
 * When an org opts in (`intelligence_auto_apply_severity`) and the enrichment's
 * severity confidence clears the threshold, set the bug's `priority` from the AI
 * suggested severity — but ONLY while the bug is still at the default 'medium',
 * so human triage is never overwritten. Writes an audit row when applied.
 *
 * Scoped to SaaS (org-gated): the worker only calls this when an organizationId
 * is present. Self-hosted has no per-org flag, so auto-apply stays off there.
 */

import { getLogger } from '../../logger.js';
import type { DatabaseClient } from '../../db/client.js';
import type { EnrichBugResponse } from './types.js';
import type { OrgIntelligenceSettings } from './tenant-config.js';

const logger = getLogger();

// AI `suggested_severity` vocabulary → `bug_reports.priority` values. An
// unrecognized value is skipped (never written) so a surprise upstream label
// can't land a bad priority.
const SEVERITY_TO_PRIORITY: Record<string, string> = {
  low: 'low',
  medium: 'medium',
  high: 'high',
  critical: 'critical',
};

// Only fill priority when the bug is still here — never overwrite human triage.
const DEFAULT_PRIORITY = 'medium';

export interface ApplySeverityResult {
  applied: boolean;
  priority?: string;
  /** Why it didn't apply — for logging/observability, not user-facing. */
  reason?:
    | 'disabled'
    | 'below_threshold'
    | 'unknown_severity'
    | 'priority_already_default'
    | 'priority_not_default';
}

/**
 * Conditionally apply the enrichment's suggested severity to the bug's priority.
 * Returns `{ applied: false, reason }` for every skip path; never throws on the
 * skip conditions (a DB error from the UPDATE itself still propagates).
 */
export async function applyAiSeverityToPriority(
  db: DatabaseClient,
  params: {
    bugReportId: string;
    organizationId: string;
    enrichment: EnrichBugResponse;
    settings: OrgIntelligenceSettings;
  }
): Promise<ApplySeverityResult> {
  const { bugReportId, organizationId, enrichment, settings } = params;

  if (!settings.intelligence_auto_apply_severity) {
    return { applied: false, reason: 'disabled' };
  }

  // Fail safe on the confidence gate. The values are typed numbers, but this
  // consumer trusts an upstream response that isn't runtime-validated — and a
  // missing confidence/threshold must NOT slip through, since `undefined < n`
  // is false and would silently bypass the gate and auto-apply.
  const confidence = enrichment.confidence?.severity;
  const threshold = settings.intelligence_severity_apply_threshold;
  if (
    typeof confidence !== 'number' ||
    !Number.isFinite(confidence) ||
    typeof threshold !== 'number' ||
    !Number.isFinite(threshold) ||
    confidence < threshold
  ) {
    return { applied: false, reason: 'below_threshold' };
  }

  const priority = SEVERITY_TO_PRIORITY[enrichment.suggested_severity?.toLowerCase?.() ?? ''];
  if (!priority) {
    logger.warn('AI suggested_severity is not a known priority; skipping auto-apply', {
      bugReportId,
      suggestedSeverity: enrichment.suggested_severity,
    });
    return { applied: false, reason: 'unknown_severity' };
  }

  if (priority === DEFAULT_PRIORITY) {
    // Suggested severity equals the default — applying is a no-op (we only ever
    // write when the bug is still at the default), so skip the redundant UPDATE
    // and the misleading medium→medium audit row.
    return { applied: false, reason: 'priority_already_default' };
  }

  // Atomic guard: only set priority if it's still the default. A single
  // conditional UPDATE avoids a read-then-write race. Tenant-scoped on the
  // indexed organization_id column, so a mismatched bugReportId/organizationId
  // can never write across tenants.
  const result = await db.getPool().query(
    `UPDATE application.bug_reports
        SET priority = $1, updated_at = NOW()
      WHERE id = $2
        AND priority = $3
        AND deleted_at IS NULL
        AND organization_id = $4`,
    [priority, bugReportId, DEFAULT_PRIORITY, organizationId]
  );

  if (!result.rowCount) {
    // Already triaged away from the default (or bug gone) — leave it.
    return { applied: false, reason: 'priority_not_default' };
  }

  // Audit the change. A failure here must not undo the applied priority.
  await db.auditLogs
    .create({
      action: 'bug_report.priority.ai_applied',
      resource: 'bug_report',
      resource_id: bugReportId,
      user_id: null,
      organization_id: organizationId,
      success: true,
      details: {
        from: DEFAULT_PRIORITY,
        to: priority,
        suggested_severity: enrichment.suggested_severity,
        confidence,
        threshold: settings.intelligence_severity_apply_threshold,
      },
    })
    .catch((err) => {
      logger.warn('Failed to write audit log for AI priority apply', {
        bugReportId,
        error: err instanceof Error ? err.message : String(err),
      });
    });

  logger.info('AI severity applied to bug priority', { bugReportId, priority, confidence });
  return { applied: true, priority };
}
