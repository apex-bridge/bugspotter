-- Migration: Backfill API key permissions from permission_scope
--
-- Previously, permission_scope (full/read/write) was checked at runtime
-- and the permissions array was only populated for 'custom' scope keys.
-- Now, permissions are resolved at creation time, so we backfill existing keys.

-- Full scope: wildcard access
UPDATE application.api_keys
SET permissions = '["*"]'::jsonb
WHERE permission_scope = 'full'
  AND (permissions = '[]'::jsonb OR permissions IS NULL);

-- Read scope: read-only access to reports and sessions
UPDATE application.api_keys
SET permissions = '["reports:read", "sessions:read"]'::jsonb
WHERE permission_scope = 'read'
  AND (permissions = '[]'::jsonb OR permissions IS NULL);

-- Write scope: read + write access to reports and sessions
UPDATE application.api_keys
SET permissions = '["reports:read", "reports:write", "sessions:read", "sessions:write"]'::jsonb
WHERE permission_scope = 'write'
  AND (permissions = '[]'::jsonb OR permissions IS NULL);

-- Custom scope keys already have their permissions populated — no change needed.
