SET search_path TO application;

-- Drop the FK constraint on `notification_throttle.rule_id`.
--
-- Migration 001 declared:
--     rule_id UUID NOT NULL REFERENCES notification_rules(id) ON DELETE CASCADE
--
-- assuming this table was notification-only. The dedup-rule engine
-- (PR-C, src/services/rules/) reuses the same throttle infrastructure
-- to enforce per-rule, per-canonical fire counts — but its rule ids
-- live in `dedup_rules` (migration 022), not `notification_rules`. The
-- FK rejected every insert from the new code path, breaking every rule
-- that configures `rate_limit`.
--
-- Two options were on the table:
--   1. Create a separate `dedup_rule_throttle` table mirroring this
--      one. Duplicates ~30 lines of schema and indexes for no
--      functional benefit.
--   2. Drop the FK and make `rule_id` polymorphic.
-- Going with (2). The CASCADE on rule deletion is replaced by:
--   - existing `cleanup_old_notification_history` cron drops rows
--     whose `window_end` has passed (so stale rows time out naturally);
--   - callers that delete a rule should explicitly DELETE matching
--     throttle rows when stronger guarantees matter.
--
-- The unique constraint on (rule_id, group_key, window_start) is
-- unchanged — `rule_id` is just a UUID identifying the owning rule,
-- regardless of which table it lives in.

ALTER TABLE notification_throttle
  DROP CONSTRAINT IF EXISTS notification_throttle_rule_id_fkey;

COMMENT ON COLUMN notification_throttle.rule_id IS
  'Owning rule UUID. Polymorphic: may reference notification_rules(id) or dedup_rules(id) depending on caller. The FK constraint was dropped in migration 023 so the dedup-rule engine can share this table; rows are cleaned up by `cleanup_old_notification_history` once window_end passes.';
