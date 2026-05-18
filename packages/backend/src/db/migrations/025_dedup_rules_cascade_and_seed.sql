SET search_path TO application;

-- Two things land together because they're both consequences of the
-- dedup-rule write path opening up (PR-D admin CRUD):
--
-- 1. AFTER DELETE trigger on `dedup_rules`. Migration 024 made
--    `notification_throttle.rule_id` polymorphic and added the
--    cascade trigger on `notification_rules`, but explicitly omitted
--    the parallel trigger on `dedup_rules` because no delete path
--    existed yet. PR-D introduces `DELETE /api/v1/projects/:projectId/dedup-rules/:ruleId`,
--    so the parallel cleanup needs to land in the same migration to
--    keep the polymorphic guarantee intact.
--
-- 2. Idempotent seed of the B1 / B2 preset rules for every existing
--    project. New projects get them via the service hook in
--    `project.service.ts`; this migration backfills demo / production
--    projects that already exist. Re-run safe: the unique constraint
--    `unique_dedup_rule_name_per_project` lets ON CONFLICT DO NOTHING
--    handle a project that already has B1 / B2 by hand.
--
-- B3 (auto-reopen on regression) is deliberately NOT seeded yet —
-- the `cluster_growing` trigger and `hits_in_window` condition that
-- B3 should branch on aren't wired in the executor, so seeding it
-- disabled-but-broken would be worse than leaving it absent.

-- ---------------------------------------------------------------------------
-- (1) AFTER DELETE trigger
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION cascade_delete_dedup_rule_throttle()
RETURNS TRIGGER AS $$
BEGIN
  DELETE FROM notification_throttle WHERE rule_id = OLD.id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS cascade_delete_throttle ON dedup_rules;
CREATE TRIGGER cascade_delete_throttle
  AFTER DELETE ON dedup_rules
  FOR EACH ROW
  EXECUTE FUNCTION cascade_delete_dedup_rule_throttle();

COMMENT ON FUNCTION cascade_delete_dedup_rule_throttle() IS
  'Mirrors cascade_delete_notification_rule_throttle (migration 024) for the dedup_rules side of the polymorphic notification_throttle.rule_id reference.';

-- ---------------------------------------------------------------------------
-- (2) Seed B1 and B2 for every existing project
-- ---------------------------------------------------------------------------
--
-- The blobs below MUST match what `parseDedupRule` (Zod) accepts —
-- adding a field here without updating the schema would store rules
-- the executor rejects on read. The schema lives in
-- src/integrations/dedup-rule.schema.ts.

-- B1 is seeded DISABLED. `to: "reporter"` resolves to the SDK-supplied
-- `bug_reports.metadata.metadata.user.email`, which has no verification
-- today — until the C2 mitigations (auth-bound reporter resolver,
-- per-recipient rate limit, literal-email allowlist) ship, operators
-- opt B1 on per project explicitly. See `src/services/rules/seed.ts`
-- for the matching JS preset; the drift test in
-- `tests/services/rules/seed.test.ts` enforces parity.
INSERT INTO dedup_rules (project_id, name, rule_json, enabled)
SELECT
  p.id,
  'Notify reporter on dedup',
  '{
    "name": "Notify reporter on dedup",
    "when": {"type": "duplicate_detected"},
    "conditions": [],
    "then": [{"type": "notify.email", "to": "reporter", "template": "dedup_ack"}],
    "rate_limit": {"count": 1, "window": "24h"},
    "enabled": false
  }'::jsonb,
  false
FROM projects p
ON CONFLICT (project_id, name) DO NOTHING;

INSERT INTO dedup_rules (project_id, name, rule_json, enabled)
SELECT
  p.id,
  'Counter on canonical',
  '{
    "name": "Counter on canonical",
    "when": {"type": "outbox_about_to_skip"},
    "conditions": [],
    "then": [{
      "type": "ticket.add_comment",
      "target": "canonical",
      "body": "+1 occurrence (deduplicated by BugSpotter)."
    }],
    "rate_limit": {"count": 1, "window": "60m"},
    "enabled": true
  }'::jsonb,
  true
FROM projects p
ON CONFLICT (project_id, name) DO NOTHING;
