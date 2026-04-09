-- ============================================================================
-- PENDING OWNER SUPPORT
-- ============================================================================
-- Allow 'owner' role in organization invitations so that an admin can create
-- an organization for a user who has not registered yet. The invitation
-- record itself serves as the pending-owner state — no column is added to
-- the organizations table.
-- ============================================================================

SET search_path TO saas;

-- Extend invitation role CHECK to include 'owner'
ALTER TABLE organization_invitations
  DROP CONSTRAINT IF EXISTS organization_invitations_role_check;
ALTER TABLE organization_invitations
  ADD CONSTRAINT organization_invitations_role_check
  CHECK (role IN ('owner', 'admin', 'member'));

-- At most one pending owner invitation per organization.
-- Enforces the single-owner invariant at the DB level and makes the
-- correlated subquery (SELECT email WHERE role='owner' AND status='pending')
-- fast and deterministic.
--
-- Index interaction with idx_unique_pending_org_invite (migration 002):
--   002's index: UNIQUE (organization_id, email) WHERE status = 'pending'
--   This index: UNIQUE (organization_id) WHERE role = 'owner' AND status = 'pending'
--
-- Together they enforce:
--   1. At most one pending invitation per email per org (any role) — from 002
--   2. At most one pending owner invitation per org (any email) — from this migration
--
-- This means a pending owner invitation also blocks inviting the same email as
-- admin/member, which is intentional — the service layer (createInvitation)
-- provides a clear "duplicate pending invitation" error for this case.
CREATE UNIQUE INDEX IF NOT EXISTS idx_invitations_one_pending_owner_per_org
  ON organization_invitations (organization_id)
  WHERE role = 'owner' AND status = 'pending';

-- Update column comment (supersedes 002_organization_invitations.sql line 35
-- which stated "admin or member (not owner)")
COMMENT ON COLUMN organization_invitations.role IS 'Role to assign on acceptance: owner (pending-owner flow only), admin, or member';

SET search_path TO application, saas, public;
