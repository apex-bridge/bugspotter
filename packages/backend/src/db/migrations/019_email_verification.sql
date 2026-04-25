-- ============================================================================
-- EMAIL VERIFICATION
-- ============================================================================
-- Self-service-signup email verification. Sentry-style non-blocking flow:
-- the API key + session are issued immediately on signup; verification just
-- toggles `users.email_verified_at` and dismisses the onboarding banner.
--
-- Separate from `organization_requests.email_verified_at` (the enterprise
-- admin-approval flow) which has its own state machine and email subject
-- copy. Self-service signup creates a user directly; this table tracks
-- the post-signup verification token for that user.
-- ============================================================================

SET search_path TO application;

-- ---------------------------------------------------------------------------
-- 1. users.email_verified_at — null until the user clicks the email link.
-- ---------------------------------------------------------------------------
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;

COMMENT ON COLUMN users.email_verified_at IS
  'When the user verified their email via /auth/verify-email. Null until verified. Self-service signup is non-blocking — features stay available before this is set.';

-- ---------------------------------------------------------------------------
-- 2. email_verification_tokens — one row per outstanding verification email.
--    Resending invalidates prior unused tokens (handled in service layer).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS email_verification_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token VARCHAR(255) UNIQUE NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    -- One-time-use marker; set when /auth/verify-email consumes the token.
    -- Distinct from users.email_verified_at: this tracks token consumption
    -- (per-row), the users column tracks the user-level verified state.
    consumed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Foreign key + token uniqueness already covered by table definition.
-- Active-token lookup by user (resend path needs to find latest unconsumed).
CREATE INDEX IF NOT EXISTS idx_email_verification_user_active
    ON email_verification_tokens(user_id, created_at DESC)
    WHERE consumed_at IS NULL;

-- Cleanup: opportunistic delete of expired-and-consumed rows by a future
-- janitor job. Indexed so the cleanup query stays cheap.
CREATE INDEX IF NOT EXISTS idx_email_verification_expires
    ON email_verification_tokens(expires_at);

COMMENT ON TABLE email_verification_tokens IS
  'One-time tokens for self-service signup email verification. Distinct from organization_requests.';
COMMENT ON COLUMN email_verification_tokens.token IS
  'Cryptographically secure random token (43 base64url chars from generateShareToken).';
COMMENT ON COLUMN email_verification_tokens.consumed_at IS
  'Set when the token is consumed via /auth/verify-email. Tokens are single-use; resend issues a new row.';

-- Reset search_path
SET search_path TO application, saas, public;
