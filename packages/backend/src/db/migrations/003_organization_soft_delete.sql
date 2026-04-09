-- Migration 003: Add soft-delete support to organizations
SET search_path TO saas;

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS deleted_by UUID DEFAULT NULL
    REFERENCES application.users(id) ON DELETE SET NULL;

-- Partial index for the default list view (active orgs sorted by creation date)
CREATE INDEX IF NOT EXISTS idx_organizations_active_created
  ON organizations(created_at DESC) WHERE deleted_at IS NULL;
