/**
 * Seed default dedup-rule presets on a new project.
 *
 * Called from the two project-creation paths (admin `POST /projects`
 * and the SaaS signup wizard, post-commit). Migration 025 backfills
 * the same presets for existing projects, so the two layers together
 * ensure every project the executor reads has B1 / B2 available.
 *
 * Idempotent via the `unique_dedup_rule_name_per_project` constraint
 * — running this twice (e.g. operator manually creates B1 then the
 * hook fires for a project re-creation) silently skips the existing
 * row.
 *
 * Failures here do NOT roll back project creation. A project without
 * seed rules is still functional (the engine has no rules to fire
 * for it; the operator can add rules later via the admin API), so
 * surfacing a seed failure as a 500 on project-create would be worse
 * than logging and continuing.
 *
 * **NOT safe inside `db.transaction(...)`.** The per-preset try/catch
 * looks like it tolerates failures, but Postgres aborts the entire
 * transaction on any failed statement and every subsequent query in
 * the same tx will fail with "current transaction is aborted" —
 * `db.transaction` does not use savepoints. Callers running inside a
 * tx (signup wizard) MUST invoke this AFTER the tx commits, with the
 * post-commit `db.dedupRules` repo. Crash-between-commit-and-seed is
 * the accepted failure mode; migration 025's idempotent backfill is
 * the safety net.
 */

import type { DedupRuleRepository } from '../../db/dedup-rule.repository.js';
import { PG_UNIQUE_VIOLATION } from '../../db/pg-error-codes.js';
import type { DedupRule } from '../../integrations/dedup-rule.schema.js';
import { getLogger } from '../../logger.js';

const logger = getLogger();

/**
 * The hard-coded preset definitions. Keep these in sync with the
 * INSERT statements in `migrations/025_dedup_rules_cascade_and_seed.sql`
 * — that migration backfills existing projects, this hook covers new
 * ones, and divergence between them would leave projects in an
 * inconsistent default state depending on creation date.
 *
 * B3 (auto-reopen on regression) is intentionally omitted: it needs
 * the `cluster_growing` trigger / `hits_in_window` condition wiring
 * that lives in a follow-up PR. Seeding it disabled-but-unfireable
 * would be worse than not seeding it at all.
 */
const PRESETS: Array<DedupRule> = [
  {
    name: 'Notify reporter on dedup',
    when: { type: 'duplicate_detected' },
    conditions: [],
    then: [{ type: 'notify.email', to: 'reporter', template: 'dedup_ack' }],
    rate_limit: { count: 1, window: '24h' },
    enabled: true,
  },
  {
    name: 'Counter on canonical',
    when: { type: 'outbox_about_to_skip' },
    conditions: [],
    then: [
      {
        type: 'ticket.add_comment',
        target: 'canonical',
        body: '+1 occurrence (deduplicated by BugSpotter).',
      },
    ],
    rate_limit: { count: 1, window: '60m' },
    enabled: true,
  },
];

/**
 * Insert the default presets for a project. **Call AFTER any
 * surrounding transaction has committed**, with the post-commit
 * `db.dedupRules` repo — the per-preset try/catch below can swallow
 * a JS error but cannot un-abort a Postgres transaction, see the
 * file-header warning. The admin `POST /projects` path calls this
 * outside any tx; the signup wizard calls it after `db.transaction`
 * returns.
 *
 * Returns the count of rules actually inserted. A uniqueness
 * violation on any single preset (operator manually pre-created one
 * with the same name) is swallowed — partial seeding is still
 * better than aborting the whole hook.
 */
export async function seedDefaultDedupRules(
  repo: DedupRuleRepository,
  projectId: string
): Promise<number> {
  let inserted = 0;
  for (const preset of PRESETS) {
    try {
      await repo.create({
        project_id: projectId,
        name: preset.name,
        rule_json: preset,
        enabled: preset.enabled,
      });
      inserted++;
    } catch (error) {
      // unique_violation is expected if migration 025's backfill
      // already ran or the operator manually pre-seeded. Anything
      // else is a real failure; log but don't throw — the project
      // itself is fine without seeds.
      const code = (error as { code?: string } | null)?.code;
      if (code !== PG_UNIQUE_VIOLATION) {
        logger.warn('Failed to seed dedup-rule preset', {
          projectId,
          name: preset.name,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
  logger.debug('Seeded default dedup rules', { projectId, inserted });
  return inserted;
}
