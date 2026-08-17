# ADR-0045: SSO/OIDC infrastructure slice — `oidc_idp_config` schema, repository, and credential encryption

- Status: Proposed
- Area: Auth / SSO / persistence
- Date: 2026-08-17
- Refs: #352

## Context

ADR-0044 settled the four contested SSO design questions (provider abstraction, account-linking rule, tenant→IdP mapping, API-key coexistence) and mandated that OIDC client secrets be stored encrypted at rest using the same `CredentialEncryption` path already in use for Jira/Linear integration credentials. It left implementation sequencing to the delivery team.

Issue #265 (the OIDC login feature) spans at least four separable work items: the IdP config persistence layer, the admin CRUD endpoints (create/update/delete), the login-initiation and callback routes, and the existing-session guards on protected endpoints. PR #345 bundled all of these into a single sixteen-file diff. Three review rounds found a different category of defect each time — infra gaps, a cross-tenant account-takeover vector, mechanical inconsistencies in route paths — without converging. That pattern is evidence the decisions were being made implicitly, inside the diff, rather than explicitly before it.

This ADR governs only the first deliverable: the `oidc_idp_config` table, the `OidcIdpConfigRepository`, and the encryption contract that ties them together. No route or auth-flow change is included. This scope means the slice can be deployed ahead of any login-path work, is independently rollbackable (drop the migration, delete the repository file), and leaves reviewers of subsequent slices with one fewer concern per diff.

## Options considered

1. **Bundle schema + repository + admin CRUD routes in one slice** — delivers a working admin surface sooner; reviewers can see the full read/write path end-to-end. Tradeoff: the migration, the encryption wire-up, and the route-level auth decisions (which admin role may call which endpoint, rate limiting, SSRF guard on `issuer_url`) all land together. A defect in any layer blocks the whole slice, and reviewers must context-switch across all three concerns simultaneously. This was the shape of PR #345 and the review history argues against repeating it.

2. **Schema only (no repository), leave persistence encapsulation to a later slice** — maximally small; a pure SQL migration is trivially reviewable. Tradeoff: encryption is not wired up until the next slice, creating a window where the table exists but its access pattern is untested. Any developer writing an ad-hoc query against the table in that window could touch the `encrypted_client_secret` column without the encryption contract being established. Leaves the codebase in a deliberately incomplete state.

3. **Schema + repository together, no routes, encryption wired at write time** — the table cannot be read or written by application code without going through the repository, which enforces encryption on every write and decryption on every read. The slice is still independently deployable and rollbackable. Review scope is: one migration file, one repository class, one unit-test file. This is the approach taken by the Jira and Linear integration-credential implementations, which ADR-0044 explicitly names as the reference pattern.

## Decision

Option 3. The `oidc_idp_config` table and `OidcIdpConfigRepository` ship together, with no API routes in this slice.

The schema (`id`, `tenant_id` UNIQUE, `issuer_url`, `client_id`, `encrypted_client_secret`, `allowed_domains TEXT[]`, `enforce_sso BOOLEAN`, created/updated timestamps) uses `CREATE TABLE IF NOT EXISTS` to match the idempotent migration convention in this repo. The UNIQUE constraint on `tenant_id` enforces the one-IdP-per-tenant rule from ADR-0044 Decision 3 at the database level, independent of application logic.

The repository exposes `findByTenantId` and `upsert`. The upsert path calls `getEncryptionService()` → `CredentialEncryption.encrypt()` before writing `encrypted_client_secret`; `findByTenantId` calls `decrypt()` before returning the struct. No caller ever sees the raw ciphertext column. This is structurally identical to `jira/config.ts`, which serves as the reference implementation per ADR-0044 Decision 6.

The repository is exported from `packages/backend/src/db/repositories.ts` so subsequent slices can import it without reaching into internal paths.

Unit tests cover: round-trip encrypt/decrypt correctness, `upsert` idempotency (two upserts with the same `tenant_id` produce one row, second call updates), and `findByTenantId` returning `null` for an unknown tenant. No integration test or Docker dependency is needed for this slice.

## Consequences

**Positive:**

- The encryption invariant (`encrypted_client_secret` is never plaintext in the database) is enforced by the only code path that touches the column, before any route or login logic exists to accidentally bypass it.
- Subsequent slices (admin CRUD, login flow) have a stable, tested persistence layer to build on and can be reviewed without a schema diff mixed in.
- Independent rollback: `DROP TABLE oidc_idp_config` and deleting the repository file leaves the system exactly as it was before; nothing else references either yet.
- The `UNIQUE(tenant_id)` constraint eliminates a class of multi-IdP-per-tenant bugs at the DB level, complementing the application-level check that will be added in the admin-CRUD slice.

**Negative / accepted:**

- The table is live in production before any route or UI exists to populate it, so `oidc_idp_config` will be an empty table for the duration of the gap between this slice and the admin-CRUD slice. This is benign but may prompt questions from operators inspecting the schema.
- `enforce_sso BOOLEAN` and `allowed_domains TEXT[]` are stored and retrievable by the repository from this slice, but the logic that enforces them lives in a later slice. There is a window where the columns exist but have no behavioral effect — an accepted cost of additive slicing.
- Unit tests mock the encryption service; a future integration test (when the admin-CRUD slice lands) will exercise the full encrypted column in a real Postgres instance. Until then, the integration between `CredentialEncryption` and the actual column type (`TEXT`) is untested at the DB layer.

**Neutral:**

- `issuer_url` is stored as plain `TEXT` with no validation at the repository layer. SSRF-hardening of admin-supplied `issuer_url` values (required by ADR-0044's security review findings) is explicitly deferred to the admin-CRUD slice where the input boundary exists. No validation belongs in the repository.
- The repository uses `getEncryptionService()` (the same singleton accessor used by the integration-credential repositories) rather than receiving the service by constructor injection. This matches the existing pattern and avoids a DI refactor out of scope for this slice.
