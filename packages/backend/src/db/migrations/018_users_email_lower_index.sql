-- Migration 018: functional index on LOWER(email) for users
--
-- `UserRepository.findByEmail` now matches on `LOWER(email) = LOWER($1)`
-- to make duplicate-email detection reliable across mixed-case rows.
-- Without a functional index the query degrades to a seq scan on every
-- login / registration / signup attempt.
--
-- This is NOT a UNIQUE index: prior data may contain case-insensitive
-- duplicates (the base `users.email` UNIQUE constraint is case-sensitive
-- and historical `/auth/register` calls didn't always normalize). A
-- UNIQUE functional index would fail to create. Upgrading to UNIQUE is
-- a follow-up that requires a data audit and cleanup.

SET search_path TO application;

CREATE INDEX IF NOT EXISTS idx_users_email_lower
  ON users (LOWER(email));

SET search_path TO application, saas, public;
