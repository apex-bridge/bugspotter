SET search_path TO application;

-- Correct the idempotency_key column comment (#446).
--
-- 001 described the key as "{bug_report_id}:{rule_id}:{timestamp}" that
-- "prevents duplicate ticket creation on retries". Neither is true any more:
-- the key now ends with a random UUID so same-millisecond creates cannot
-- collide, and nothing reads it - its only effect is the UNIQUE constraint.
-- Real deduplication (one entry per bug report + rule) is an open decision in
-- #446. Comment-only; no schema change.

COMMENT ON COLUMN ticket_creation_outbox.idempotency_key IS
  'Unique per outbox row ({bug_report_id}:{rule_id}:{timestamp}:{uuid}). Not read anywhere and does not deduplicate retries or repeated triggers; see #446.';
