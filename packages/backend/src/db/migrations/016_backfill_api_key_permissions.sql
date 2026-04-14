-- Migration: Backfill API key permissions from permission_scope
--
-- Previously, permission_scope (full/read/write) was checked at runtime
-- and the permissions array was only populated for 'custom' scope keys.
-- Now, permissions are resolved at creation time, so we backfill existing keys.
-- Uses IS DISTINCT FROM to ensure all non-custom keys get correct permissions
-- regardless of their current permissions state.

-- Full scope: wildcard access
UPDATE application.api_keys
SET permissions = '["*"]'::jsonb
WHERE permission_scope = 'full'
  AND permissions IS DISTINCT FROM '["*"]'::jsonb;

-- Read scope: read-only access to reports and sessions
UPDATE application.api_keys
SET permissions = '["reports:read", "sessions:read"]'::jsonb
WHERE permission_scope = 'read'
  AND permissions IS DISTINCT FROM '["reports:read", "sessions:read"]'::jsonb;

-- Write scope: read + write access to reports and sessions
UPDATE application.api_keys
SET permissions = '["reports:read", "reports:write", "sessions:read", "sessions:write"]'::jsonb
WHERE permission_scope = 'write'
  AND permissions IS DISTINCT FROM '["reports:read", "reports:write", "sessions:read", "sessions:write"]'::jsonb;

-- Custom scope keys already have their permissions populated — no change needed.
