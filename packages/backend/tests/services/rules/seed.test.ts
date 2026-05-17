/**
 * Unit tests for the dedup-rule preset seed helper.
 *
 * Covers what the integration-time backfill (migration 025) does NOT —
 * the per-call hook that runs on `POST /projects` and the signup
 * wizard's transaction. The helper must be idempotent, must swallow
 * uniqueness violations on individual presets, and must not throw
 * past the caller (project creation continues even on seed failure).
 */

import { describe, it, expect, vi } from 'vitest';
import type { DedupRuleRepository } from '../../../src/db/dedup-rule.repository.js';
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
