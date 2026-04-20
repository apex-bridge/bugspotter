/**
 * Minimal env setup for the unit test suite.
 *
 * Unit tests intentionally run without the Postgres testcontainer
 * (that lives in `tests/setup.ts` for the integration config), but a
 * handful of modules read env vars at import time — e.g.
 * `JiraConfigManager` instantiates `CredentialEncryption` in a field
 * initializer, which throws if `ENCRYPTION_KEY` is unset. On CI those
 * env vars are provided by the workflow; locally, `pnpm test:unit`
 * otherwise fails with 24 Jira config errors that have nothing to do
 * with the test author's changes.
 *
 * This file populates the minimum env needed for modules to load
 * cleanly. It does NOT stand up any services. Registered via
 * `setupFiles` in `vitest.unit.config.ts`.
 *
 * All values are obvious test sentinels — never rely on these in
 * production code paths.
 */

// Required by JiraConfigManager → CredentialEncryption. The validator
// checks the raw string length (≥ 32 chars, UTF-8 — no base64 decode).
// Any sentinel of the right length works.
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? 'unit-test-encryption-key-32-bytes-min';

// Required by the JWT plugin when any auth-handling module loads.
process.env.JWT_SECRET =
  process.env.JWT_SECRET ?? 'unit-test-jwt-secret-for-testing-only-not-production';
