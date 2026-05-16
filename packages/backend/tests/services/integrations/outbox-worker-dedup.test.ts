/**
 * Unit tests for the pre-file dedup gate in the ticket-creation outbox worker.
 *
 * The grace window itself is enforced at row-creation time via `scheduled_at`,
 * so the worker has no defer/retry path to test — only the gate checks that
 * matter at dequeue time:
 *   1. duplicate_of set on the bug report → markSkipped("duplicate_of_set").
 *   2. bug report missing (hard-delete / soft-delete) → markSkipped
 *      ("bug_report_not_found") — terminal, not a retry-burning throw.
 *   3. duplicate_of null and bug present → happy path (markProcessing →
 *      createIssue → markCompleted).
 *   4. markProcessing returns null (peer worker already claimed) → exit clean.
 *
 * All DB and plugin-registry calls are mocked; no Postgres / BullMQ required.
 */

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { TicketCreationOutboxProcessor } from '../../../src/queue/workers/outbox/ticket-creation-outbox.worker.js';
import type { DatabaseClient } from '../../../src/db/client.js';
import type { PluginRegistry } from '../../../src/integrations/plugin-registry.js';
import type {
  TicketCreationOutboxEntry,
  OutboxStatus,
} from '../../../src/db/repositories/ticket-creation-outbox.repository.js';

type JobHandleMock = {
  id: string;
  data: { outboxEntryId: string };
  attemptsMade: number;
};

function buildEntry(overrides: Partial<TicketCreationOutboxEntry> = {}): TicketCreationOutboxEntry {
  const base: TicketCreationOutboxEntry = {
    id: 'outbox-1',
    bug_report_id: 'bug-1',
    project_id: 'project-1',
    integration_id: 'integration-1',
    platform: 'jira',
    rule_id: 'rule-1',
    payload: {},
    status: 'pending' as OutboxStatus,
    retry_count: 0,
    max_retries: 3,
    scheduled_at: new Date(),
    next_retry_at: null,
    external_ticket_id: null,
    external_ticket_url: null,
    error_message: null,
    created_at: new Date(),
    updated_at: new Date(),
    processed_at: null,
    idempotency_key: 'bug-1:rule-1:1',
    dedup_grace_until: null,
    skipped_reason: null,
  };
  return { ...base, ...overrides };
}

function buildJob(outboxEntryId: string): JobHandleMock {
  return {
    id: `job-${outboxEntryId}`,
    data: { outboxEntryId },
    attemptsMade: 0,
  };
}

describe('TicketCreationOutboxProcessor — pre-file dedup gate', () => {
  let db: DatabaseClient;
  let registry: PluginRegistry;
  let createFromBugReport: Mock;
  let processor: TicketCreationOutboxProcessor;

  beforeEach(() => {
    createFromBugReport = vi.fn().mockResolvedValue({
      externalId: 'JIRA-1',
      externalUrl: 'https://jira.example.com/browse/JIRA-1',
    });

    registry = {
      get: vi.fn().mockReturnValue({ createFromBugReport }),
      getSupportedPlatforms: vi.fn().mockReturnValue(['jira']),
      isSupported: vi.fn().mockReturnValue(true),
    } as unknown as PluginRegistry;

    db = {
      ticketOutbox: {
        // markProcessing returns the claimed row (or null if not claimed).
        markProcessing: vi.fn(),
        markSkipped: vi.fn().mockResolvedValue(undefined),
        markCompleted: vi.fn().mockResolvedValue(undefined),
        markFailed: vi.fn(),
      },
      bugReports: {
        findById: vi.fn(),
      },
    } as unknown as DatabaseClient;

    processor = new TicketCreationOutboxProcessor(db, registry);
  });

  it('skips ticket creation when the bug is already flagged as a duplicate', async () => {
    const entry = buildEntry({ dedup_grace_until: null, status: 'pending' });
    (db.ticketOutbox.markProcessing as Mock).mockResolvedValueOnce({
      ...entry,
      status: 'processing',
    });
    (db.bugReports.findById as Mock).mockResolvedValueOnce({
      id: 'bug-1',
      duplicate_of: 'bug-canonical',
    });

    await processor.process(buildJob('outbox-1') as never);

    expect(db.ticketOutbox.markProcessing).toHaveBeenCalledWith('outbox-1');
    expect(db.ticketOutbox.markSkipped).toHaveBeenCalledWith('outbox-1', 'duplicate_of_set');
    expect(createFromBugReport).not.toHaveBeenCalled();
    expect(db.ticketOutbox.markCompleted).not.toHaveBeenCalled();
  });

  it('files the ticket normally when the bug is not a duplicate', async () => {
    const entry = buildEntry({ dedup_grace_until: null, status: 'pending' });
    (db.ticketOutbox.markProcessing as Mock).mockResolvedValueOnce({
      ...entry,
      status: 'processing',
    });
    (db.bugReports.findById as Mock).mockResolvedValue({ id: 'bug-1', duplicate_of: null });

    await processor.process(buildJob('outbox-1') as never);

    expect(db.ticketOutbox.markProcessing).toHaveBeenCalledWith('outbox-1');
    expect(db.ticketOutbox.markSkipped).not.toHaveBeenCalled();
    expect(createFromBugReport).toHaveBeenCalledTimes(1);
    expect(db.ticketOutbox.markCompleted).toHaveBeenCalledWith(
      'outbox-1',
      expect.objectContaining({ external_ticket_id: 'JIRA-1' })
    );
  });

  it('marks the entry skipped when the bug report no longer exists', async () => {
    const entry = buildEntry({ dedup_grace_until: null, status: 'pending' });
    (db.ticketOutbox.markProcessing as Mock).mockResolvedValueOnce({
      ...entry,
      status: 'processing',
    });
    (db.bugReports.findById as Mock).mockResolvedValueOnce(null);

    await processor.process(buildJob('outbox-1') as never);

    // Missing bug is terminal — no throw, no external API call, no retry burn.
    expect(db.ticketOutbox.markSkipped).toHaveBeenCalledWith('outbox-1', 'bug_report_not_found');
    expect(db.ticketOutbox.markFailed).not.toHaveBeenCalled();
    expect(createFromBugReport).not.toHaveBeenCalled();
  });

  it('exits cleanly when another worker has already claimed the entry', async () => {
    // markProcessing returns null because a peer worker has already
    // transitioned the row out of pending/failed.
    (db.ticketOutbox.markProcessing as Mock).mockResolvedValueOnce(null);

    await processor.process(buildJob('outbox-1') as never);

    expect(db.bugReports.findById).not.toHaveBeenCalled();
    expect(createFromBugReport).not.toHaveBeenCalled();
    expect(db.ticketOutbox.markCompleted).not.toHaveBeenCalled();
    expect(db.ticketOutbox.markSkipped).not.toHaveBeenCalled();
  });

  // ──────────────────────────────────────────────────────────────────
  // Rule executor hook (outbox_about_to_skip trigger)
  //
  // The hook fires the rule engine on the dedup-suppression branch.
  // These tests pass an injected stub executor (4th constructor arg)
  // so we exercise the worker's contract with the engine without
  // building the real DedupRuleExecutor or its plugin-registry deps.
  // The earlier dedup-gate test happened to pass even though the
  // executor was unreachable (the stub `db` lacks `getPool()`, so
  // the lazy build threw and was swallowed); these tests close that
  // coverage gap.
  // ──────────────────────────────────────────────────────────────────

  describe('outbox_about_to_skip rule trigger', () => {
    it('fires the rule executor after markSkipped, with the dedup-suppressed bug', async () => {
      const fire = vi.fn().mockResolvedValue([
        {
          ruleId: 'rule-x',
          fired: true,
          skipReason: null,
          actionsDispatched: 1,
          actionsSkipped: 0,
        },
      ]);
      const ruleExecutor = { fire } as never;
      const processorWithExec = new TicketCreationOutboxProcessor(
        db,
        registry,
        undefined,
        ruleExecutor
      );

      const entry = buildEntry();
      (db.ticketOutbox.markProcessing as Mock).mockResolvedValueOnce({
        ...entry,
        status: 'processing',
      });
      const bug = { id: 'bug-1', project_id: 'project-1', duplicate_of: 'bug-canonical' };
      (db.bugReports.findById as Mock).mockResolvedValueOnce(bug);

      await processorWithExec.process(buildJob('outbox-1') as never);

      // Order matters: markSkipped FIRST (terminal state), then fire.
      // Reversing would mean a markSkipped failure causes BullMQ to
      // retry and re-fire — actions replay.
      const markSkippedOrder = (db.ticketOutbox.markSkipped as Mock).mock.invocationCallOrder[0];
      const fireOrder = fire.mock.invocationCallOrder[0];
      expect(markSkippedOrder).toBeLessThan(fireOrder);

      expect(fire).toHaveBeenCalledWith('outbox_about_to_skip', bug);
      expect(db.ticketOutbox.markSkipped).toHaveBeenCalledWith('outbox-1', 'duplicate_of_set');
    });

    it('still markSkipped runs to completion when the executor throws', async () => {
      // The executor's contract is "no error propagates", but
      // defensively the worker also wraps the call. Even if the
      // executor escapes its own guards, the outbox row must still
      // land in terminal state.
      const fire = vi.fn().mockRejectedValue(new Error('executor went sideways'));
      const ruleExecutor = { fire } as never;
      const processorWithExec = new TicketCreationOutboxProcessor(
        db,
        registry,
        undefined,
        ruleExecutor
      );

      (db.ticketOutbox.markProcessing as Mock).mockResolvedValueOnce({
        ...buildEntry(),
        status: 'processing',
      });
      (db.bugReports.findById as Mock).mockResolvedValueOnce({
        id: 'bug-1',
        duplicate_of: 'bug-canonical',
      });

      await expect(
        processorWithExec.process(buildJob('outbox-1') as never)
      ).resolves.toBeUndefined();

      expect(db.ticketOutbox.markSkipped).toHaveBeenCalledWith('outbox-1', 'duplicate_of_set');
      expect(fire).toHaveBeenCalled();
    });

    it('does not fire the executor on the happy path (no duplicate_of)', async () => {
      const fire = vi.fn();
      const ruleExecutor = { fire } as never;
      const processorWithExec = new TicketCreationOutboxProcessor(
        db,
        registry,
        undefined,
        ruleExecutor
      );

      (db.ticketOutbox.markProcessing as Mock).mockResolvedValueOnce({
        ...buildEntry(),
        status: 'processing',
      });
      (db.bugReports.findById as Mock).mockResolvedValue({
        id: 'bug-1',
        duplicate_of: null,
      });

      await processorWithExec.process(buildJob('outbox-1') as never);

      expect(fire).not.toHaveBeenCalled();
      expect(createFromBugReport).toHaveBeenCalledTimes(1);
    });
  });
});
