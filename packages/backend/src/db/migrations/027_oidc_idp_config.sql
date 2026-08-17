-- Migration 027: oidc_idp_config
--
-- Per-tenant OpenID Connect identity-provider configuration for SSO login
-- (ADR-0044, docs/adr/0044-sso-oidc-account-linking-and-tenant-boundary.md).
-- One row per organization. saas mode only — selfhosted mode configures its
-- single global IdP via OIDC_* env vars instead (ADR-0044 decision 4), so
-- this table stays empty there, same as subscriptions/invitations.
--
-- client_secret is stored encrypted (encrypted_client_secret) via the
-- existing CredentialEncryption service; the application layer never writes
-- plaintext into this column.

SET search_path TO saas;

CREATE TABLE IF NOT EXISTS oidc_idp_config (
    id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Named tenant_id (not organization_id, unlike every sibling saas.* FK)
    -- per ADR-0044's own vocabulary for this feature ("Tenant -> IdP
    -- mapping", `/api/v1/auth/oidc/:tenant/callback`). Still references
    -- organizations(id) — same entity, ADR-chosen column name.
    tenant_id               UUID        NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
    issuer_url              TEXT        NOT NULL,
    client_id               TEXT        NOT NULL,
    encrypted_client_secret TEXT        NOT NULL,
    allowed_domains         TEXT[]      NOT NULL DEFAULT '{}',
    enforce_sso             BOOLEAN     NOT NULL DEFAULT false,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- CREATE TRIGGER has no IF NOT EXISTS guard (unlike CREATE TABLE above), so
-- an unguarded CREATE TRIGGER would fail with duplicate_object if this
-- file's SQL is ever executed a second time against a schema that already
-- has it. DROP TRIGGER IF EXISTS immediately before CREATE TRIGGER is the
-- existing convention for this in the repo — see
-- 024_notification_throttle_cascade_trigger.sql and
-- 025_dedup_rules_cascade_and_seed.sql.
DROP TRIGGER IF EXISTS update_oidc_idp_config_updated_at ON oidc_idp_config;
CREATE TRIGGER update_oidc_idp_config_updated_at
    BEFORE UPDATE ON oidc_idp_config
    FOR EACH ROW EXECUTE FUNCTION application.update_updated_at_column();

-- Reset search_path
SET search_path TO application, saas, public;
