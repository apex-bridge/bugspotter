SET search_path TO application;

-- Pre-file deduplication support for the ticket creation outbox.
--
-- The async intelligence dedup pipeline sets bug_reports.duplicate_of after a
-- ticket has already been filed externally, producing duplicate Jira/Linear
-- tickets. This migration lets the outbox worker (a) defer processing until a
-- per-org grace window has elapsed, giving intelligence time to populate
-- duplicate_of, and (b) record a 'skipped' terminal state for entries that
-- were intentionally not filed because the bug turned out to be a duplicate.
--
-- All additions are nullable / opt-in: dedup_grace_until is NULL for entries
-- created before this feature is enabled per org, in which case the worker
-- behaves exactly as before.

ALTER TABLE ticket_creation_outbox
  DROP CONSTRAINT IF EXISTS ticket_creation_outbox_status_check;

ALTER TABLE ticket_creation_outbox
  ADD CONSTRAINT ticket_creation_outbox_status_check
  CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'dead_letter', 'skipped'));

ALTER TABLE ticket_creation_outbox
  ADD COLUMN IF NOT EXISTS dedup_grace_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS skipped_reason TEXT;

COMMENT ON COLUMN ticket_creation_outbox.dedup_grace_until IS
  'Worker defers filing until NOW() >= dedup_grace_until, then re-checks bug_reports.duplicate_of before calling the external platform. NULL = no grace (legacy immediate-file behavior). Source: OrgIntelligenceSettings.pre_file_dedup_grace_ms.';

COMMENT ON COLUMN ticket_creation_outbox.skipped_reason IS
  'Reason an entry was set to status=skipped (e.g. "duplicate_of_set"). NULL for non-skipped entries.';
