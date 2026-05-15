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

  async loadCanonical(canonicalBugId: string): Promise<BugReport | null> {
    return this.db.bugReports.findById(canonicalBugId);
  }

  async countHitsInWindow(canonicalBugId: string, window: string): Promise<number> {
    const minutes = windowStringToMinutes(window);
    try {
      const result = await this.db.getPool().query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM application.bug_reports
         WHERE duplicate_of = $1
           AND created_at >= NOW() - ($2::int * INTERVAL '1 minute')`,
        [canonicalBugId, minutes]
      );
      // pg returns COUNT(*) as a string to avoid precision loss on
      // very large counts — cast back to a number for the rule
      // engine's numeric comparisons.
      return Number.parseInt(result.rows[0]?.count ?? '0', 10);
    } catch (error) {
      logger.warn('Failed to count hits in window, defaulting to 0', {
        canonicalBugId,
        window,
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    }
  }
}
