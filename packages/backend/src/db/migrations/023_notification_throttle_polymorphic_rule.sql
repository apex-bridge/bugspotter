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
-- Going with (2). The original FK had `ON DELETE CASCADE` so deleting
-- a notification_rules row also wiped its throttle rows. After this
-- migration that cascade is gone — migration 024 restores it with an
-- AFTER DELETE trigger on `notification_rules` (and adds the parallel
-- trigger on `dedup_rules` once the engine's deletion path lands).
-- The DB function `cleanup_expired_throttle_windows()` (migration 001
-- line 994) drops stale rows by `window_end` if scheduled, but it is
-- not currently wired to a scheduler — so the per-delete trigger is
-- the load-bearing cleanup mechanism.
--
-- The unique constraint on (rule_id, group_key, window_start) is
-- unchanged — `rule_id` is just a UUID identifying the owning rule,
-- regardless of which table it lives in.

ALTER TABLE notification_throttle
  DROP CONSTRAINT IF EXISTS notification_throttle_rule_id_fkey;

COMMENT ON COLUMN notification_throttle.rule_id IS
  'Owning rule UUID. Polymorphic: may reference notification_rules(id) or dedup_rules(id) depending on caller. The FK constraint was dropped in migration 023 so the dedup-rule engine can share this table. CASCADE-on-delete is restored via per-source AFTER DELETE triggers (see migration 024); cleanup_expired_throttle_windows() additionally drops stale rows by window_end if scheduled.';
