-- Migration 015: Add security JSONB column for unified RBAC
-- Foundation step: adds security JSONB field alongside existing role column.
-- Platform admin status is backfilled to security.is_platform_admin.
-- The role column will be deprecated in a future migration.

SET search_path TO application;

-- Add security JSONB column
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS security JSONB NOT NULL DEFAULT '{}';

-- Backfill: mark current admins as platform admins (merge, don't overwrite)
UPDATE users
SET security = COALESCE(security, '{}'::jsonb) || jsonb_build_object('is_platform_admin', true)
WHERE role = 'admin';
