-- ============================================================================
-- SEED LINEAR INTEGRATION
-- ============================================================================
-- Registers the built-in Linear plugin in the `integrations` catalogue so:
--   1. `GET /api/v1/integrations/platforms` lists it as a supported platform.
--   2. `project_integrations.integration_id` FK can target it when an org
--      configures a Linear integration.
--   3. The admin UI's "Add integration" picker offers Linear alongside Jira.
--
-- Mirrors the Jira seed in migration 001. Idempotent (ON CONFLICT DO
-- NOTHING) so re-running on an already-seeded DB is a no-op.
--
-- Status is `not_configured` because the row represents the *plugin type*,
-- not a tenant's configuration — each `project_integrations` row carries
-- per-project credentials and enabled flag.
-- ============================================================================

INSERT INTO integrations (type, name, description, status, config, has_rules)
VALUES ('linear', 'Linear', 'Linear issue tracker integration', 'not_configured', '{}', TRUE)
ON CONFLICT (type) DO NOTHING;
