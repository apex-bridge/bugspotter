/**
 * Integration tests for NotificationRuleRepository transactional atomicity.
 *
 * Runs against REAL Postgres (testcontainers) because the property under test —
 * "a failed write rolls back earlier writes" — can only be proven by the database,
 * not by asserting that BEGIN/ROLLBACK were emitted.
 *
 * createWithChannels / updateWithChannels each perform multiple dependent writes:
 *   rule INSERT/UPDATE  +  channel-link DELETE  +  channel-link INSERT
 * If they don't run in one transaction, a failure in the channel-link INSERT leaves
 * committed partial state:
 *   - updateWithChannels: existing channel links already DELETEd → rule delivers nowhere.
 *   - createWithChannels: rule row already committed → orphaned, channel-less rule.
 *
 * We force the channel-link INSERT to fail by pointing at a non-existent channel id
 * (foreign-key violation), then assert the prior state is intact.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createTestDatabase } from '../setup.integration.js';
import type { DatabaseClient } from '../../src/db/client.js';

describe('NotificationRuleRepository — transactional atomicity (real Postgres)', () => {
  let db: DatabaseClient;
  let projectId: string;
  let channelId: string;

  beforeEach(async () => {
    db = createTestDatabase();

    const project = await db.projects.create({ name: 'Atomicity Test Project' });
    projectId = project.id;

    const channel = await db.notificationChannels.create({
      project_id: projectId,
      type: 'webhook',
      name: 'Existing Channel',
      config: {
        type: 'webhook',
        url: 'https://example.com/webhook',
        method: 'POST',
        auth_type: 'none',
      },
      active: true,
    });
    channelId = channel.id;
  });

  afterEach(async () => {
    if (db) {
      await db.close();
    }
  });

  it('updateWithChannels preserves the existing channel link when the new set is invalid', async () => {
    // Rule starts wired to one valid channel.
    const rule = await db.notificationRules.createWithChannels({
      project_id: projectId,
      name: 'Rule under test',
      enabled: true,
      triggers: [{ event: 'new_bug' }],
      channel_ids: [channelId],
    });

    // No such channel — the channel-link INSERT will violate the FK.
    const nonExistentChannel = randomUUID();

    await expect(
      db.notificationRules.updateWithChannels(rule.id, {
        channel_ids: [nonExistentChannel],
      })
    ).rejects.toThrow();

    // Without a transaction the DELETE has already committed and the rule now has
    // ZERO channels. With proper atomicity the original link is restored.
    const after = await db.notificationRules.findByIdWithChannels(rule.id);
    expect(after).not.toBeNull();
    expect(after!.channels).toEqual([channelId]);
  });

  it('createWithChannels does not leave an orphaned rule when channel linkage fails', async () => {
    const nonExistentChannel = randomUUID();

    await expect(
      db.notificationRules.createWithChannels({
        project_id: projectId,
        name: 'Orphan candidate',
        enabled: true,
        triggers: [{ event: 'new_bug' }],
        channel_ids: [nonExistentChannel],
      })
    ).rejects.toThrow();

    // Without a transaction the rule row is committed before the failing channel
    // INSERT, leaving a channel-less rule behind. With atomicity, nothing persists.
    const rules = await db.notificationRules.findAll({ project_id: projectId });
    expect(rules.find((r) => r.name === 'Orphan candidate')).toBeUndefined();
  });
});
