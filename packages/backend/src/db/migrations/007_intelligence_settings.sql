-- Migration 007: Intelligence settings in organization JSONB
--
-- Extends saas.organizations.settings with intelligence-related keys.
-- No ALTER TABLE needed (JSONB is schema-less). This migration serves as
-- the canonical record of the new keys and their defaults.

COMMENT ON COLUMN saas.organizations.settings IS
  'Per-organization settings stored as JSONB. Known keys:
   - magic_login_enabled (boolean, default false)
   - intelligence_enabled (boolean, default false) — per-org intelligence kill switch
   - intelligence_api_key (string, encrypted) — encrypted API key for intelligence service
   - intelligence_provider (string, default null) — LLM provider preference
   - intelligence_auto_analyze (boolean, default true) — auto-queue analysis on bug creation
   - intelligence_similarity_threshold (number, default 0.75) — duplicate detection threshold
   - intelligence_dedup_action (string: "flag"|"auto_close", default "flag")
   - intelligence_api_key_provisioned_at (string, ISO timestamp) — when key was provisioned
   - intelligence_api_key_provisioned_by (string, user ID) — who provisioned the key';
