SET search_path TO application;

-- Storage for the tiny dedup-rule engine (Phase 0.5).
--
-- Each row is one trigger → conditions → actions automation. The rule
-- body lives in `rule_json` as a JSONB blob; the canonical shape is
-- defined by the `DedupRule` Pydantic model in bugspotter-intelligence
-- and mirrored in TypeScript via Zod (see src/integrations/dedup-rule.schema.ts).
-- Keeping the full rule as JSONB rather than relational columns is
-- deliberate: the discriminated unions on triggers / actions would
-- explode into a dozen columns most of which are NULL for any given
-- row, and the executor parses the whole thing per fire anyway.
--
-- Scope is per-project, mirroring `integration_rules` and
-- `project_integrations`: selfhosted mode has projects but no orgs,
-- and a single project may have its own ack / counter / reopen
-- automations independent of other projects in the same org.

CREATE TABLE IF NOT EXISTS dedup_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name VARCHAR(120) NOT NULL,
  rule_json JSONB NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT unique_dedup_rule_name_per_project UNIQUE(project_id, name)
);

-- The executor hot-path queries `WHERE project_id = $1 AND enabled = true`
-- for every dedup event, so index that exact predicate. Partial index
-- keeps the index small in projects with a long tail of historical /
-- disabled rules.
CREATE INDEX IF NOT EXISTS idx_dedup_rules_enabled_lookup
  ON dedup_rules(project_id)
  WHERE enabled = true;

CREATE TRIGGER update_dedup_rules_updated_at
  BEFORE UPDATE ON dedup_rules
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE dedup_rules IS
  'Per-project automation rules for the dedup pipeline. Each row is one trigger -> conditions -> actions DedupRule; canonical shape lives in bugspotter-intelligence Pydantic + src/integrations/dedup-rule.schema.ts (Zod).';
COMMENT ON COLUMN dedup_rules.rule_json IS
  'Full DedupRule blob. Validated against the Zod schema on write and on read (so manual SQL edits do not corrupt the executor).';
COMMENT ON COLUMN dedup_rules.name IS
  'Human-readable label. Unique per project so the admin UI can address rules by name in URLs / logs.';
