/**
 * Production `RuleContextProvider` — looks up the canonical bug and
 * computes windowed hit counts directly from `application.bug_reports`.
 *
 * Kept separate from the executor so unit tests can swap a stub
 * provider in without touching the DB.
 */

import type { DatabaseClient } from '../../db/client.js';
import type { BugReport } from '../../db/types.js';
import { getLogger } from '../../logger.js';
import type { RuleContextProvider } from './executor.js';
import { windowStringToMinutes } from './rate-limiter.js';

const logger = getLogger();

export class DatabaseRuleContextProvider implements RuleContextProvider {
  constructor(private readonly db: DatabaseClient) {}

  async loadCanonical(canonicalBugId: string, projectId: string): Promise<BugReport | null> {
    // Enforce the project scope in SQL — a stale `duplicate_of`
    // referencing a foreign bug must return null rather than leak
    // the foreign canonical into the rule context. `findById` alone
    // would not do this; the SQL adds the AND project_id check.
    const result = await this.db.getPool().query<BugReport>(
      `SELECT * FROM application.bug_reports
       WHERE id = $1
         AND project_id = $2
         AND deleted_at IS NULL`,
      [canonicalBugId, projectId]
    );
    return result.rows[0] ?? null;
  }

  async loadReporterTier(organizationId: string | null): Promise<string | null> {
    if (!organizationId) {
      // Legacy bug reports without organization_id (pre-SaaS data) and
      // selfhosted deployments (no `subscriptions` rows at all) both
      // resolve to null. A condition like `reporter.customer.tier eq
      // 'enterprise'` will fail closed.
      return null;
    }
    try {
      // Filter by live statuses only. `subscriptions` keeps rows
      // around after cancellation (status values include 'canceled',
      // 'past_due', 'paused', 'incomplete_expired' — see
      // BILLING_STATUS in db/types.ts). Without this filter, a rule
      // conditioned on `reporter.customer.tier eq 'enterprise'`
      // would continue to fire for orgs that have cancelled or
      // whose billing has lapsed, driving external API calls on
      // behalf of non-paying tenants. Other readers in the codebase
      // (e.g. saas/jobs/invoice-scheduler.job.ts) follow the same
      // pattern with `BILLING_STATUS.ACTIVE`.
      // `subscriptions.organization_id` has a UNIQUE constraint
      // (migration 001), so at most one row matches per org and the
      // LIMIT 1 is theoretically redundant. The explicit
      // `ORDER BY created_at DESC` is defense-in-depth against a
      // future schema change that drops the UNIQUE — if multiple
      // matching rows ever appear, we deterministically pick the
      // most recent one rather than getting whichever Postgres
      // happens to return.
      const result = await this.db.getPool().query<{ plan_name: string }>(
        `SELECT plan_name
         FROM saas.subscriptions
         WHERE organization_id = $1
           AND status IN ('active', 'trial')
         ORDER BY created_at DESC
         LIMIT 1`,
        [organizationId]
      );
      return result.rows[0]?.plan_name ?? null;
    } catch (error) {
      // Common case in selfhosted: the `saas.subscriptions` table
      // doesn't exist. Log at debug and fall through to null —
      // tier-based rules simply never match in that mode.
      logger.debug('Failed to load reporter tier, defaulting to null', {
        organizationId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  async countHitsInWindow(
    canonicalBugId: string,
    projectId: string,
    window: string
  ): Promise<number> {
    const minutes = windowStringToMinutes(window);
    try {
      // Filter `deleted_at IS NULL` to match how the rest of the
      // codebase reads `bug_reports` (see bug-report.repository.ts).
      // Without this, soft-deleted duplicates inflate the count, so a
      // rule like `hits_in_window >= 10` can fire on a cluster whose
      // raw rows have been cleaned up — misfiring the loud-bug
      // suppression / auto-reopen actions.
      //
      // The `project_id = $3` clause scopes the count to the firing
      // rule's tenant. Same defense-in-depth as loadCanonical.
      const result = await this.db.getPool().query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM application.bug_reports
         WHERE duplicate_of = $1
           AND project_id = $3
           AND deleted_at IS NULL
           AND created_at >= NOW() - ($2::int * INTERVAL '1 minute')`,
        [canonicalBugId, minutes, projectId]
      );
      // pg returns COUNT(*) as a string to avoid precision loss on
      // very large counts — cast back to a number for the rule
      // engine's numeric comparisons.
      return Number.parseInt(result.rows[0]?.count ?? '0', 10);
    } catch (error) {
      logger.warn('Failed to count hits in window, defaulting to 0', {
        canonicalBugId,
        projectId,
        window,
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    }
  }
}
