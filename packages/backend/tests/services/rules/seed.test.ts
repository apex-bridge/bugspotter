/**
 * Unit tests for the dedup-rule preset seed helper.
 *
 * Covers what the integration-time backfill (migration 025) does NOT —
 * the per-call hook that runs on `POST /projects` and the signup
 * wizard's transaction. The helper must be idempotent, must swallow
 * uniqueness violations on individual presets, and must not throw
 * past the caller (project creation continues even on seed failure).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import type { DedupRuleRepository } from '../../../src/db/dedup-rule.repository.js';
import { parseDedupRule } from '../../../src/integrations/dedup-rule.schema.js';
import { seedDefaultDedupRules } from '../../../src/services/rules/seed.js';

function mockRepo(overrides: Partial<DedupRuleRepository> = {}): DedupRuleRepository {
  // Cast through unknown — the helper only touches `.create`, so we
  // don't need to stub the rest of the BaseRepository surface.
  return overrides as unknown as DedupRuleRepository;
}

const PROJECT_ID = '00000000-0000-0000-0000-000000000001';

describe('seedDefaultDedupRules', () => {
  it('inserts both presets (B1 + B2) on a fresh project', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'r' });
    const repo = mockRepo({ create });

    const count = await seedDefaultDedupRules(repo, PROJECT_ID);

    expect(count).toBe(2);
    expect(create).toHaveBeenCalledTimes(2);
    const names = create.mock.calls.map((c) => c[0].name);
    expect(names).toEqual(['Notify reporter on dedup', 'Counter on canonical']);
  });

  it('passes through the project_id on each insert', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'r' });
    const repo = mockRepo({ create });

    await seedDefaultDedupRules(repo, PROJECT_ID);

    for (const call of create.mock.calls) {
      expect(call[0].project_id).toBe(PROJECT_ID);
    }
  });

  it('seeds B1 with the duplicate_detected trigger and notify.email action', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'r' });
    const repo = mockRepo({ create });

    await seedDefaultDedupRules(repo, PROJECT_ID);

    const b1 = create.mock.calls[0][0];
    expect(b1.rule_json).toMatchObject({
      when: { type: 'duplicate_detected' },
      then: [{ type: 'notify.email', to: 'reporter', template: 'dedup_ack' }],
      rate_limit: { count: 1, window: '24h' },
    });
  });

  it('seeds B2 with outbox_about_to_skip + ticket.add_comment on canonical', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'r' });
    const repo = mockRepo({ create });

    await seedDefaultDedupRules(repo, PROJECT_ID);

    const b2 = create.mock.calls[1][0];
    expect(b2.rule_json).toMatchObject({
      when: { type: 'outbox_about_to_skip' },
      then: [
        {
          type: 'ticket.add_comment',
          target: 'canonical',
        },
      ],
      rate_limit: { count: 1, window: '60m' },
    });
  });

  it('swallows pg unique_violation (23505) on individual presets', async () => {
    // Simulates the case where migration 025 already backfilled B1 for
    // an existing project but B2 was missing. Should still seed B2.
    const uniqueErr = Object.assign(new Error('duplicate key value'), { code: '23505' });
    const create = vi.fn().mockRejectedValueOnce(uniqueErr).mockResolvedValueOnce({ id: 'r2' });
    const repo = mockRepo({ create });

    const count = await seedDefaultDedupRules(repo, PROJECT_ID);

    expect(count).toBe(1);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('continues past non-uniqueness errors but reports them in the count', async () => {
    // Other errors (a connection drop mid-loop, a schema mismatch) are
    // logged but never thrown — project creation must not fail because
    // of a broken seed hook.
    const create = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ id: 'r2' });
    const repo = mockRepo({ create });

    const count = await seedDefaultDedupRules(repo, PROJECT_ID);

    expect(count).toBe(1);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('returns 0 and does not throw when every preset fails', async () => {
    const create = vi.fn().mockRejectedValue(new Error('total outage'));
    const repo = mockRepo({ create });

    await expect(seedDefaultDedupRules(repo, PROJECT_ID)).resolves.toBe(0);
  });
});

/**
 * The B1 / B2 preset shapes live in three places: the `PRESETS` array
 * in seed.ts, the INSERT statements in migration 025, and the Zod
 * `parseDedupRule` schema they must conform to. A drift between any
 * two of those would silently break the engine on the affected
 * deployment (the executor parses on read and rejects bad blobs).
 *
 * These tests are the canary: they fail the suite when someone
 * touches one side without the other.
 */
describe('preset / migration 025 / Zod schema consistency', () => {
  const MIGRATION_PATH = join(
    __dirname,
    '../../../src/db/migrations/025_dedup_rules_cascade_and_seed.sql'
  );

  /**
   * Pull every `'{...}'::jsonb` literal out of the migration. The
   * naive single-quote split is good enough because the migration
   * has no embedded apostrophes inside the JSON blobs and no other
   * `::jsonb` casts in the file.
   */
  function extractMigrationBlobs(): unknown[] {
    const sql = readFileSync(MIGRATION_PATH, 'utf8');
    const blobs: unknown[] = [];
    const re = /'(\{[\s\S]*?\})'::jsonb/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(sql)) !== null) {
      blobs.push(JSON.parse(match[1]));
    }
    return blobs;
  }

  it('migration 025 contains exactly two seed inserts (B1 + B2)', () => {
    const blobs = extractMigrationBlobs();
    expect(blobs).toHaveLength(2);
  });

  it('every migration 025 JSON blob round-trips through parseDedupRule', () => {
    // If this fails, the migration would store rows the executor
    // silently rejects on read — a deployment-time data corruption
    // hazard that no other test catches.
    for (const blob of extractMigrationBlobs()) {
      expect(() => parseDedupRule(blob)).not.toThrow();
    }
  });

  it('migration 025 B1/B2 shapes match the seed.ts PRESETS array', async () => {
    // Re-derive PRESETS by inspecting what `seedDefaultDedupRules`
    // tries to insert for a fresh project — keeps this test
    // resilient to PRESETS being un-exported.
    const create = vi.fn().mockResolvedValue({ id: 'r' });
    await seedDefaultDedupRules(mockRepo({ create }), PROJECT_ID);
    const fromSeed = create.mock.calls.map((c) => c[0].rule_json);

    const fromMigration = extractMigrationBlobs();
    expect(fromSeed).toHaveLength(fromMigration.length);
    // Match by name rather than positional, so re-ordering one side
    // doesn't cause a false drift signal.
    const byName = (list: unknown[]) =>
      Object.fromEntries(list.map((r) => [(r as { name: string }).name, r]));
    expect(byName(fromSeed)).toEqual(byName(fromMigration));
  });
});
