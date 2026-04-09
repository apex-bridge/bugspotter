-- ============================================================================
-- ORGANIZATION REQUESTS
-- ============================================================================
-- Public-facing request form for prospective customers to request an
-- organization. Requests go through email verification and spam filtering
-- before landing in an admin approval queue. Admins can approve (which
-- creates the organization) or reject (with a reason sent to the requester).
-- ============================================================================

SET search_path TO saas;

CREATE TABLE organization_requests (
  id              uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name    varchar(255)    NOT NULL,
  subdomain       varchar(63)     NOT NULL,
  contact_name    varchar(255)    NOT NULL,
  contact_email   varchar(255)    NOT NULL,
  phone           varchar(50),
  message         text,
  data_residency_region varchar(20) NOT NULL DEFAULT 'kz',

  -- Workflow status
  status          varchar(30)     NOT NULL DEFAULT 'pending_verification'
    CHECK (status IN (
      'pending_verification',
      'verified',
      'approved',
      'rejected',
      'expired'
    )),

  -- Email verification
  verification_token  varchar(255) NOT NULL,
  email_verified_at   timestamptz,

  -- Admin review
  reviewed_by     uuid            REFERENCES application.users(id) ON DELETE SET NULL,
  reviewed_at     timestamptz,
  admin_notes     text,
  rejection_reason text,

  -- Link to created organization on approval
  organization_id uuid            REFERENCES saas.organizations(id) ON DELETE SET NULL,

  -- Anti-spam / abuse
  ip_address      inet            NOT NULL,
  honeypot        varchar(255),
  spam_score      integer         NOT NULL DEFAULT 0,

  created_at      timestamptz     NOT NULL DEFAULT now(),
  updated_at      timestamptz     NOT NULL DEFAULT now()
);

-- Keep updated_at in sync on updates
CREATE TRIGGER update_organization_requests_updated_at
  BEFORE UPDATE ON organization_requests
  FOR EACH ROW
  EXECUTE FUNCTION application.update_updated_at_column();

-- Duplicate prevention: one active request per email (DB-level enforcement)
CREATE UNIQUE INDEX idx_unique_active_org_request_email
  ON organization_requests (lower(contact_email))
  WHERE status IN ('pending_verification', 'verified');

-- Token lookup for email verification
CREATE INDEX idx_org_requests_verification_token
  ON organization_requests (verification_token);

-- Admin listing: verified requests newest first
CREATE INDEX idx_org_requests_status_created
  ON organization_requests (status, created_at DESC);

-- Rate limit checks: requests per IP within time window
CREATE INDEX idx_org_requests_ip_created
  ON organization_requests (ip_address, created_at);

SET search_path TO application, saas, public;
