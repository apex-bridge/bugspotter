/**
 * Notification Rule Repository — atomicity tests
 *
 * `createWithChannels` / `updateWithChannels` perform multiple dependent writes
 * (rule INSERT/UPDATE + channel DELETE + channel INSERT). They MUST run inside a
 * single transaction so a failure in a later write rolls back the earlier ones.
 *
 * The data-loss case these guard against:
 *   - updateWithChannels deletes all existing rule→channel rows, then inserts the
 *     new set. If the INSERT fails and the DELETE has already committed, the rule
 *     is left wired to ZERO channels and silently stops delivering notifications.
 *   - createWithChannels inserts the rule, then its channels. A channel-insert
 *     failure must not leave an orphaned, channel-less rule behind.
 *
 * Pure unit test: `pg` is mocked, no database required.
 */

import { describe, it, expect, vi } from 'vitest';
import type { Pool, PoolClient } from 'pg';
import { NotificationRuleRepository } from '../../src/db/repositories/notification-rule.repository.js';

interface RecordedQuery {
  sql: string;
  params?: unknown[];
}

/**
 * Build a mock pg Pool + PoolClient that record every query.
 * - Pool has `connect()` (and no `release`) — looks like a real Pool.
 * - Client has `release()` — looks like a real pooled client / tx client.
 * Both `query` impls share one recording handler so the call sequence is visible
 * regardless of whether the code runs on the pool directly or on a tx client.
 */
function makeDb(opts: { failChannelInsert?: boolean } = {}) {
  const queries: RecordedQuery[] = [];

  const ruleRow = {
    id: 'rule-1',
    project_id: 'proj-1',
    name: 'My Rule',
    enabled: true,
    triggers: [],
    filters: null,
    throttle: null,
    schedule: null,
    priority: 5,
    created_at: new Date('2026-01-01T00:00:00Z'),
    updated_at: new Date('2026-01-01T00:00:00Z'),
  };

  const handle = async (sql: string, params?: unknown[]) => {
    queries.push({ sql, params });
    const s = sql.replace(/\s+/g, ' ').trim();

    if (/INSERT INTO application\.notification_rule_channels/i.test(s)) {
      if (opts.failChannelInsert) {
        throw new Error('simulated channel insert failure');
      }
      return { rows: [], rowCount: params ? params.length - 1 : 0 };
    }
    if (/INSERT INTO application\.notification_rules/i.test(s)) {
      return { rows: [ruleRow], rowCount: 1 };
    }
    if (/UPDATE application\.notification_rules/i.test(s)) {
      return { rows: [ruleRow], rowCount: 1 };
    }
    if (/SELECT channel_id FROM application\.notification_rule_channels/i.test(s)) {
      return { rows: [{ channel_id: 'chan-1' }], rowCount: 1 };
    }
    // BEGIN / COMMIT / ROLLBACK / DELETE / anything else
    return { rows: [], rowCount: 0 };
  };

  const client = { query: vi.fn(handle), release: vi.fn() };
  const pool = { query: vi.fn(handle), connect: vi.fn(async () => client) };

  return { pool, client, queries };
}

const verbsOf = (queries: RecordedQuery[]): string[] =>
  queries.map((q) => q.sql.replace(/\s+/g, ' ').trim().toUpperCase());

describe('NotificationRuleRepository atomicity', () => {
  it('updateWithChannels rolls back the channel DELETE when the channel INSERT fails', async () => {
    const { pool, queries } = makeDb({ failChannelInsert: true });
    const repo = new NotificationRuleRepository(pool as unknown as Pool);

    await expect(
      repo.updateWithChannels('rule-1', {
        name: 'My Rule',
        channel_ids: ['chan-1'],
      } as never)
    ).rejects.toThrow();

    const verbs = verbsOf(queries);
    // The whole operation must be undone — not left with the channels deleted.
    expect(verbs).toContain('ROLLBACK');
    expect(verbs).not.toContain('COMMIT');
  });

  it('createWithChannels rolls back the rule INSERT when the channel INSERT fails (no orphaned rule)', async () => {
    const { pool, queries } = makeDb({ failChannelInsert: true });
    const repo = new NotificationRuleRepository(pool as unknown as Pool);

    await expect(
      repo.createWithChannels({
        project_id: 'proj-1',
        name: 'My Rule',
        triggers: [],
        channel_ids: ['chan-1'],
      } as never)
    ).rejects.toThrow();

    const verbs = verbsOf(queries);
    expect(verbs).toContain('ROLLBACK');
    expect(verbs).not.toContain('COMMIT');
  });

  it('createWithChannels commits when all writes succeed', async () => {
    const { pool, queries } = makeDb({ failChannelInsert: false });
    const repo = new NotificationRuleRepository(pool as unknown as Pool);

    const result = await repo.createWithChannels({
      project_id: 'proj-1',
      name: 'My Rule',
      triggers: [],
      channel_ids: ['chan-1'],
    } as never);

    expect(result.channels).toEqual(['chan-1']);

    const verbs = verbsOf(queries);
    expect(verbs).toContain('BEGIN');
    expect(verbs).toContain('COMMIT');
    expect(verbs).not.toContain('ROLLBACK');
  });

  it('does NOT open its own transaction when already running on a caller-managed tx client', async () => {
    // Constructed with a PoolClient (has .release) — e.g. inside db.transaction(...).
    // The caller owns BEGIN/COMMIT; the repo must run inline and not nest a transaction.
    const { client, queries } = makeDb();
    const repo = new NotificationRuleRepository(client as unknown as PoolClient);

    await repo.createWithChannels({
      project_id: 'proj-1',
      name: 'My Rule',
      triggers: [],
      channel_ids: ['chan-1'],
    } as never);

    const verbs = verbsOf(queries);
    expect(verbs).not.toContain('BEGIN');
    expect(verbs).not.toContain('COMMIT');
    expect(verbs).not.toContain('ROLLBACK');
  });
});
