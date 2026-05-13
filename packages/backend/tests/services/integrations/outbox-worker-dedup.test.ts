/**
 * Unit tests for the pre-file dedup gate in the ticket-creation outbox worker.
 *
 * Three paths are covered:
 *   1. dedup_grace_until still in the future → entry is deferred (scheduled_at
 *      pushed forward via deferUntil), no markProcessing, no external API call.
 *   2. duplicate_of set on the bug report by the time the entry is dequeued →
 *      outbox row is markSkipped("duplicate_of_set"), no external API call.
 *   3. Grace window has elapsed and bug is not a duplicate → existing happy
 *      path runs unchanged (markProcessing → createIssue → markCompleted).
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
        findById: vi.fn(),
        deferUntil: vi.fn().mockResolvedValue(true),
        // markProcessing now returns the claimed row (or null if not claimed).
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

  it('defers the entry when dedup_grace_until is in the future', async () => {
    const graceUntil = new Date(Date.now() + 30_000);
    const entry = buildEntry({ dedup_grace_until: graceUntil, status: 'pending' });
    (db.ticketOutbox.findById as Mock).mockResolvedValueOnce(entry);

    await processor.process(buildJob('outbox-1') as never);

    expect(db.ticketOutbox.deferUntil).toHaveBeenCalledWith('outbox-1', graceUntil);
    expect(db.ticketOutbox.markProcessing).not.toHaveBeenCalled();
    expect(db.bugReports.findById).not.toHaveBeenCalled();
    expect(createFromBugReport).not.toHaveBeenCalled();
    expect(db.ticketOutbox.markCompleted).not.toHaveBeenCalled();
    expect(db.ticketOutbox.markSkipped).not.toHaveBeenCalled();
  });

  it('skips ticket creation when the bug is already flagged as a duplicate', async () => {
    const entry = buildEntry({ dedup_grace_until: null, status: 'pending' });
    (db.ticketOutbox.findById as Mock).mockResolvedValueOnce(entry);
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
    expect(db.ticketOutbox.deferUntil).not.toHaveBeenCalled();
  });

  it('files the ticket normally when grace has elapsed and the bug is not a duplicate', async () => {
    const grace = new Date(Date.now() - 1000); // already expired
    const entry = buildEntry({ dedup_grace_until: grace, status: 'pending' });
    (db.ticketOutbox.findById as Mock).mockResolvedValueOnce(entry);
    (db.ticketOutbox.markProcessing as Mock).mockResolvedValueOnce({
      ...entry,
      status: 'processing',
    });
    (db.bugReports.findById as Mock).mockResolvedValue({ id: 'bug-1', duplicate_of: null });

    await processor.process(buildJob('outbox-1') as never);

    expect(db.ticketOutbox.deferUntil).not.toHaveBeenCalled();
    expect(db.ticketOutbox.markProcessing).toHaveBeenCalledWith('outbox-1');
    expect(db.ticketOutbox.markSkipped).not.toHaveBeenCalled();
    expect(createFromBugReport).toHaveBeenCalledTimes(1);
    expect(db.ticketOutbox.markCompleted).toHaveBeenCalledWith(
      'outbox-1',
      expect.objectContaining({ external_ticket_id: 'JIRA-1' })
    );
  });

  it('fails fast when the bug report no longer exists', async () => {
    const entry = buildEntry({ dedup_grace_until: null, status: 'pending' });
    (db.ticketOutbox.findById as Mock).mockResolvedValueOnce(entry);
    (db.ticketOutbox.markProcessing as Mock).mockResolvedValueOnce({
      ...entry,
      status: 'processing',
    });
    (db.bugReports.findById as Mock).mockResolvedValueOnce(null);
    (db.ticketOutbox.markFailed as Mock).mockResolvedValueOnce({ ...entry, status: 'failed' });

    await expect(processor.process(buildJob('outbox-1') as never)).rejects.toThrow(
      /Bug report not found/
    );

    // Hard-fail flows through the catch → markFailed (not markSkipped), and
    // no external ticket is created.
    expect(db.ticketOutbox.markSkipped).not.toHaveBeenCalled();
    expect(createFromBugReport).not.toHaveBeenCalled();
    expect(db.ticketOutbox.markFailed).toHaveBeenCalledWith(
      'outbox-1',
      expect.stringMatching(/Bug report not found/)
    );
  });

  it('files immediately when dedup_grace_until is NULL (legacy behavior)', async () => {
    const entry = buildEntry({ dedup_grace_until: null, status: 'pending' });
    (db.ticketOutbox.findById as Mock).mockResolvedValueOnce(entry);
    (db.ticketOutbox.markProcessing as Mock).mockResolvedValueOnce({
      ...entry,
      status: 'processing',
    });
    (db.bugReports.findById as Mock).mockResolvedValue({ id: 'bug-1', duplicate_of: null });

    await processor.process(buildJob('outbox-1') as never);

    expect(db.ticketOutbox.deferUntil).not.toHaveBeenCalled();
    expect(createFromBugReport).toHaveBeenCalledTimes(1);
    expect(db.ticketOutbox.markCompleted).toHaveBeenCalledTimes(1);
  });

  it('exits cleanly when another worker has already claimed the entry', async () => {
    // pre-check still loads the entry; markProcessing returns null because
    // a peer worker has already transitioned it out of pending/failed.
    const entry = buildEntry({ dedup_grace_until: null, status: 'pending' });
    (db.ticketOutbox.findById as Mock).mockResolvedValueOnce(entry);
    (db.ticketOutbox.markProcessing as Mock).mockResolvedValueOnce(null);

    await processor.process(buildJob('outbox-1') as never);

    expect(db.bugReports.findById).not.toHaveBeenCalled();
    expect(createFromBugReport).not.toHaveBeenCalled();
    expect(db.ticketOutbox.markCompleted).not.toHaveBeenCalled();
    expect(db.ticketOutbox.markSkipped).not.toHaveBeenCalled();
  });

  it('defers a failed retry that fires inside an unexpired grace window', async () => {
    const graceUntil = new Date(Date.now() + 30_000);
    const entry = buildEntry({
      dedup_grace_until: graceUntil,
      status: 'failed',
      retry_count: 1,
    });
    (db.ticketOutbox.findById as Mock).mockResolvedValueOnce(entry);

    await processor.process(buildJob('outbox-1') as never);

    // Grace window still applies even though the entry is on a retry path.
    expect(db.ticketOutbox.deferUntil).toHaveBeenCalledWith('outbox-1', graceUntil);
    expect(db.ticketOutbox.markProcessing).not.toHaveBeenCalled();
    expect(createFromBugReport).not.toHaveBeenCalled();
  });
});
