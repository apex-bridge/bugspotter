-- Migration 006: Add JSONB settings column to organizations
-- Stores per-org feature flags (e.g. magic_login_enabled) in the database
-- instead of relying on environment variables.

ALTER TABLE saas.organizations
  ADD COLUMN settings JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Partial GIN index for efficient queries on settings keys
CREATE INDEX idx_organizations_settings ON saas.organizations USING gin (settings)
  WHERE deleted_at IS NULL;

COMMENT ON COLUMN saas.organizations.settings IS
  'Per-organization feature flags and settings stored as JSONB. Known keys: magic_login_enabled (boolean).';
