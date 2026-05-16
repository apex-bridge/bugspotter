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
