SET search_path TO application;

-- Restore CASCADE semantics on `notification_throttle.rule_id` after
-- migration 023 made the column polymorphic (dropped the FK that
-- carried `ON DELETE CASCADE`). Without this, deleting a row from
-- `notification_rules` leaves orphan throttle rows behind forever —
-- the unique `(rule_id, group_key, window_start)` index gives them
-- no natural collision so they never get reclaimed, and
-- `cleanup_expired_throttle_windows()` is not currently wired to a
-- scheduler.
--
-- Use AFTER DELETE triggers instead of restoring the FK because the
-- column is now polymorphic — a single FK can only reference one
-- parent table. Each source table gets its own trigger that DELETEs
-- matching rows. Same row-level cascade behaviour as the original
-- FK, scoped per source.
--
-- The trigger on `dedup_rules` is intentionally omitted here: the
-- dedup-rule deletion path doesn't exist yet (the engine reads
-- rules; the admin UI in PR-D will introduce the DELETE handler).
-- The parallel trigger lands alongside that work to keep this
-- migration narrowly scoped to the regression it fixes.

CREATE OR REPLACE FUNCTION cascade_delete_notification_rule_throttle()
RETURNS TRIGGER AS $$
BEGIN
  DELETE FROM notification_throttle WHERE rule_id = OLD.id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS cascade_delete_throttle ON notification_rules;
CREATE TRIGGER cascade_delete_throttle
  AFTER DELETE ON notification_rules
  FOR EACH ROW
  EXECUTE FUNCTION cascade_delete_notification_rule_throttle();

COMMENT ON FUNCTION cascade_delete_notification_rule_throttle() IS
  'Restores the CASCADE-on-delete behaviour the polymorphic rule_id lost in migration 023. Fires AFTER DELETE on notification_rules. A parallel trigger on dedup_rules will be added when the dedup-rule deletion path lands.';
