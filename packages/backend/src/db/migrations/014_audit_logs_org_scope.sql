-- Migration 014: Add organization scope to audit logs
-- Allows org owners/admins to view their organization's audit trail

SET search_path TO application;

-- Add organization_id column
ALTER TABLE audit_logs
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES saas.organizations(id) ON DELETE SET NULL;

-- Index for org-scoped queries (most common access pattern)
CREATE INDEX IF NOT EXISTS idx_audit_org_timestamp
  ON audit_logs(organization_id, timestamp DESC)
  WHERE organization_id IS NOT NULL;

-- Backfill existing logs: set organization_id from user's org membership.
-- Only backfill when the user belongs to exactly one org (deterministic).
-- Multi-org users are left NULL to avoid incorrect attribution.
UPDATE audit_logs al
SET organization_id = single_org.organization_id
FROM (
  SELECT DISTINCT ON (user_id) user_id, organization_id
  FROM saas.organization_members
  WHERE user_id IN (
    SELECT user_id FROM saas.organization_members
    GROUP BY user_id HAVING COUNT(*) = 1
  )
) single_org
WHERE al.user_id = single_org.user_id
  AND al.organization_id IS NULL;
