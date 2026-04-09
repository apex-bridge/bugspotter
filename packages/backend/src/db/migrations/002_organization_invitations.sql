-- ============================================================================
-- ORGANIZATION INVITATIONS
-- ============================================================================
-- Email-based invitation system for organization onboarding.
-- Supports admin-driven and org-admin-driven invitations.
-- ============================================================================

SET search_path TO saas;

CREATE TABLE IF NOT EXISTS organization_invitations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'member')),
    invited_by UUID NOT NULL REFERENCES application.users(id),
    token VARCHAR(255) UNIQUE NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
      CHECK (status IN ('pending', 'accepted', 'expired', 'canceled')),
    expires_at TIMESTAMPTZ NOT NULL,
    accepted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Partial unique: only one pending invite per email per org (allows re-invite after accept/cancel)
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_pending_org_invite
    ON organization_invitations(organization_id, email) WHERE status = 'pending';

-- token already has a UNIQUE constraint (implicit index) — no separate index needed
CREATE INDEX IF NOT EXISTS idx_org_invitations_email ON organization_invitations(email) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_org_invitations_org_id ON organization_invitations(organization_id);

COMMENT ON TABLE organization_invitations IS 'Email-based invitations for organization membership';
COMMENT ON COLUMN organization_invitations.token IS 'Secure random token for invitation acceptance (32-byte hex)';
COMMENT ON COLUMN organization_invitations.role IS 'Role to assign on acceptance: admin or member (not owner)';

CREATE TRIGGER update_org_invitations_updated_at
    BEFORE UPDATE ON organization_invitations
    FOR EACH ROW EXECUTE FUNCTION application.update_updated_at_column();

-- Reset search_path
SET search_path TO application, saas, public;
