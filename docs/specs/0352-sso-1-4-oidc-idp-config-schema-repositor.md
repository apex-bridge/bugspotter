# Spec: SSO 1/4: oidc_idp_config schema, repository, and encryption

Linked issue: Refs #352
ADR: docs/adr/0044-sso-oidc-account-linking-and-tenant-boundary.md

**Files touched:**

- `packages/backend/src/db/migrations/027_oidc_idp_config.sql` (new)
- `packages/backend/src/db/repositories/oidc-idp-config.repository.ts` (new)
- `packages/backend/src/db/repositories.ts` (export addition)
- `packages/backend/tests/db/oidc-idp-config.repository.test.ts` (new)
- `packages/backend/vitest.unit.config.ts` (one-line addition — registers the new test file; see constraint 10)

**Blocking prerequisites:** none

## Problem

BugSpotter has no database table or data-access layer for per-tenant OIDC/SSO provider configuration. ADR-0044 resolved the design, but slices 2–4 of #265 (login callback, API routes, admin UI) cannot be built without a schema and repository to write against. Every tenant that needs SSO enforcement or OIDC login is blocked until this foundation exists.

## Out of scope

- API routes for reading or writing OIDC provider config (slice 2)
- OIDC login flow, callback handler, or session integration (slice 3)
- Admin UI for SSO configuration (slice 4)
- Any change to existing auth middleware, JWT handling, or share-token behavior
- Wiring `OidcIdpConfigRepository` into `DatabaseClient`/`RepositoryRegistry` (`packages/backend/src/db/client.ts`, `packages/backend/src/db/repositories/factory.ts`). Every existing repository is registered there, but that file is large and load-bearing for every request; slice 2 (#353), the first real consumer, adds the wiring alongside its own usage rather than this isolated slice touching shared plumbing it doesn't yet need.
- Migration rollback DDL (the repo convention is additive-only `IF NOT EXISTS`; rollback is a manual table drop documented under Rollback below)

## Constraints

1. The migration must use `CREATE TABLE IF NOT EXISTS` so it is safe to run more than once, consistent with the idempotent-migration convention noted in the ADR index.
2. `tenant_id` must carry a `UNIQUE` constraint at the database level and a `NOT NULL REFERENCES organizations(id) ON DELETE CASCADE` foreign key, matching how every other one-row-per-org table in this codebase (`saas.subscriptions`, `saas.organization_invitations`) FKs to `organizations`. `upsert()` must rely on the `UNIQUE` constraint (`ON CONFLICT (tenant_id) DO UPDATE`) rather than a read-before-write guard, so concurrent callers are safe.
3. `encrypted_client_secret` must never hold plaintext. Encryption must happen inside the repository method before the SQL statement executes; the value captured by the query must differ from the caller's input string.
4. The type returned by `findByTenantId` and `upsert` must expose `clientSecret` as the decrypted string, not the cipher envelope, so callers above this layer never handle ciphertext directly.
5. `packages/backend/src/utils/encryption.ts` is confirmed in the source tree. It exports `CredentialEncryption` and `getEncryptionService()`. All `import` paths in the repository file must use `../../utils/encryption.js` (relative to the repository file at `packages/backend/src/db/repositories/`) and all `import` paths in the test file must use `../../src/utils/encryption.js` (relative to the test at `packages/backend/tests/db/`).
6. The `encrypt` and `decrypt` method names on `CredentialEncryption` are **confirmed**: the class exposes `encrypt(plaintext: string): string` and `decrypt(encryptedString: string): string`. No pre-commit verification of these names is required.
7. No API routes, middleware registration, or auth-behavior changes belong in this slice.
8. All new files must pass `pnpm --filter @bugspotter/backend typecheck` without introducing new errors.
9. **Confirmed: this project has no `kysely` dependency anywhere (checked `packages/backend/package.json` and the lockfile) and no TypeScript migration runner — `packages/backend/src/db/migrations/migrate.ts` only discovers and executes files matching `*.sql` (excluding `schema.sql`), applied in filename-sort order inside a single transaction per file.** `packages/backend/src/db/client.ts` imports from `pg` and uses `pg.Pool` directly. Every repository in this codebase (see `packages/backend/src/db/repositories/api-key.repository.ts`, `system-config.repository.ts`) is a plain class taking `Pool | PoolClient` in its constructor and issuing raw parameterized SQL via `this.pool.query(...)`. The `Changes` section below gives the actual raw-pg implementation directly — there is no Kysely placeholder to rewrite.
10. `packages/backend/vitest.unit.config.ts` uses an explicit file-path allowlist (`test.include`), not a glob — adding a new file under `tests/db/` does **not** make `pnpm test:unit` pick it up automatically. `tests/db/oidc-idp-config.repository.test.ts` must be added as a new line in that `include` array (alongside the other genuinely-mocked-DB entries like `tests/db/user-repository-org-filter.test.ts`) or the acceptance-criteria tests below will never run in CI.
11. `oidc_idp_config` lives in the `saas` schema, not `application`. Per `packages/backend/docs/db-schema.md`: "`application.*` rows reference `saas.organizations` (always nullable) — never the reverse." This table's `tenant_id` FK is mandatory (`NOT NULL`), which only the `saas` schema's own tables do for their `organization_id` FK (e.g. `subscriptions`, `organization_invitations`); `application`-schema tables that reference `organizations` do so nullably. The migration must `SET search_path TO saas;` before `CREATE TABLE` and reset to `SET search_path TO application, saas, public;` at the end, matching `002_organization_invitations.sql`.

## Acceptance criteria

- [ ] Running the migration SQL twice against the same schema produces no error and leaves exactly one `oidc_idp_config` table — verified by test case A.
- [ ] Calling `upsert()` twice with the same `tenantId` but different field values returns the updated row and does not insert a second row — verified by test case B.
- [ ] `findByTenantId()` returns `null` for a `tenantId` that has no row — verified by test case C.
- [ ] `findByTenantId()` returns a record whose `clientSecret` equals the plaintext value originally passed to `upsert()` (constraint C4) — verified by test case D.
- [ ] The value the repository passes to the SQL statement for `encrypted_client_secret` is not equal to the plaintext `clientSecret` supplied by the caller (constraint C3) — verified by test case E.
- [ ] `OidcIdpConfigRepository`, `OidcIdpConfig`, and `OidcIdpConfigUpsertInput` are importable from the `packages/backend/src/db/repositories.ts` barrel — verified by test case F.
- [ ] `tests/db/oidc-idp-config.repository.test.ts` is listed in `vitest.unit.config.ts`'s `include` array and `pnpm --filter @bugspotter/backend test:unit` actually executes test cases A–F (constraint 10).

## Changes

### `packages/backend/src/db/migrations/027_oidc_idp_config.sql`

New file. `026_enrichment_rationale.sql` is the latest existing migration, so this is next in sequence. Complete content:

```sql
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

CREATE TRIGGER update_oidc_idp_config_updated_at
    BEFORE UPDATE ON oidc_idp_config
    FOR EACH ROW EXECUTE FUNCTION application.update_updated_at_column();

-- Reset search_path
SET search_path TO application, saas, public;
```

### `packages/backend/src/db/repositories/oidc-idp-config.repository.ts`

New file. Complete content:

```ts
// New file — complete content:

/**
 * OIDC IdP Config Repository
 * Per-tenant OpenID Connect identity-provider configuration (ADR-0044).
 * client_secret is encrypted at rest; findByTenantId/upsert always return
 * the decrypted plaintext to callers, never the cipher envelope.
 */

import type { Pool, PoolClient } from 'pg';
import { BaseRepository } from './base-repository.js';
import { getEncryptionService } from '../../utils/encryption.js';

export interface OidcIdpConfig {
  id: string;
  tenantId: string;
  issuerUrl: string;
  clientId: string;
  /** Decrypted on every read. Never the raw ciphertext. */
  clientSecret: string;
  allowedDomains: string[];
  enforceSso: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface OidcIdpConfigUpsertInput {
  tenantId: string;
  issuerUrl: string;
  clientId: string;
  /** Plaintext. Encrypted before the INSERT/UPDATE executes. */
  clientSecret: string;
  allowedDomains: string[];
  enforceSso: boolean;
}

interface OidcIdpConfigRow {
  id: string;
  tenant_id: string;
  issuer_url: string;
  client_id: string;
  encrypted_client_secret: string;
  allowed_domains: string[];
  enforce_sso: boolean;
  created_at: Date;
  updated_at: Date;
}

export class OidcIdpConfigRepository extends BaseRepository<OidcIdpConfig> {
  constructor(pool: Pool | PoolClient) {
    super(pool, 'saas', 'oidc_idp_config');
  }

  async findByTenantId(tenantId: string): Promise<OidcIdpConfig | null> {
    const result = await this.pool.query<OidcIdpConfigRow>(
      `SELECT * FROM ${this.schema}.${this.tableName} WHERE tenant_id = $1`,
      [tenantId]
    );

    return result.rows[0] ? this.fromRow(result.rows[0]) : null;
  }

  async upsert(input: OidcIdpConfigUpsertInput): Promise<OidcIdpConfig> {
    const enc = getEncryptionService();
    const encryptedClientSecret = enc.encrypt(input.clientSecret);

    const result = await this.pool.query<OidcIdpConfigRow>(
      `INSERT INTO ${this.schema}.${this.tableName}
         (tenant_id, issuer_url, client_id, encrypted_client_secret, allowed_domains, enforce_sso, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
       ON CONFLICT (tenant_id) DO UPDATE
       SET issuer_url = EXCLUDED.issuer_url,
           client_id = EXCLUDED.client_id,
           encrypted_client_secret = EXCLUDED.encrypted_client_secret,
           allowed_domains = EXCLUDED.allowed_domains,
           enforce_sso = EXCLUDED.enforce_sso,
           updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [
        input.tenantId,
        input.issuerUrl,
        input.clientId,
        encryptedClientSecret,
        input.allowedDomains,
        input.enforceSso,
      ]
    );

    return this.fromRow(result.rows[0]);
  }

  private fromRow(row: OidcIdpConfigRow): OidcIdpConfig {
    const enc = getEncryptionService();
    return {
      id: row.id,
      tenantId: row.tenant_id,
      issuerUrl: row.issuer_url,
      clientId: row.client_id,
      clientSecret: enc.decrypt(row.encrypted_client_secret),
      allowedDomains: row.allowed_domains,
      enforceSso: row.enforce_sso,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
```

### `packages/backend/src/db/repositories.ts`

Append after the last existing export line in the file.

```ts
// Append after the last existing export line:
export { OidcIdpConfigRepository } from './repositories/oidc-idp-config.repository.js';
export type {
  OidcIdpConfig,
  OidcIdpConfigUpsertInput,
} from './repositories/oidc-idp-config.repository.js';
```

### `packages/backend/vitest.unit.config.ts`

Add one line to the `test.include` array (in the `// Only include pure unit tests from tests/db/` group, alongside `tests/db/user-repository-org-filter.test.ts`):

```ts
'tests/db/oidc-idp-config.repository.test.ts',
```

Without this, `pnpm --filter @bugspotter/backend test:unit` will not discover the new test file at all (constraint 10).

## Tests

### `packages/backend/tests/db/oidc-idp-config.repository.test.ts`

New file. `tests/db/api-key-repository.test.ts` is **not** a useful template here — it (and `notification-channel.repository.test.ts`) is a real-Postgres integration-style test built on `DatabaseClient.create()`, with no mock DB factory. The actual mocked-pool pattern used by the genuinely-unit-tested repository tests in this directory is `tests/db/user-repository-org-filter.test.ts`'s `makeFakePool()`: a `{ query: vi.fn(...) }` object cast to `Pool`, constructed directly into the repository (`new SomeRepository(fakePool)`). Follow that pattern, not a mock query-builder.

```ts
// Top of test file — must be at module scope, not inside describe/it:
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Pool } from 'pg';
import { OidcIdpConfigRepository } from '../../src/db/repositories/oidc-idp-config.repository.js';
import { getEncryptionService } from '../../src/utils/encryption.js';

vi.mock('../../src/utils/encryption.js', () => ({
  getEncryptionService: vi.fn(),
}));

const fakeEnc = {
  encrypt: vi.fn((s: string) => `enc::${s}`),
  decrypt: vi.fn((s: string) => s.replace('enc::', '')),
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getEncryptionService).mockReturnValue(fakeEnc as never);
});

/** Fake pg.Pool whose query() returns canned rows and records what was sent. */
function makeFakePool(rows: unknown[], captured: { sql: string; params: unknown[] }[]): Pool {
  return {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      captured.push({ sql, params });
      return { rows };
    }),
  } as unknown as Pool;
}
```

**Test case A — migration contains idempotency guard and lives in the saas schema (AC #1):**

```ts
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

it('migration file uses CREATE TABLE IF NOT EXISTS in the saas schema', () => {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const migrationsDir = join(__dirname, '../../src/db/migrations');
  const files = readdirSync(migrationsDir).filter((f) => f.includes('oidc_idp_config'));
  expect(files).toHaveLength(1);
  expect(files[0]).toMatch(/\.sql$/);
  const content = readFileSync(join(migrationsDir, files[0]), 'utf8');
  expect(content).toMatch(/CREATE TABLE IF NOT EXISTS oidc_idp_config/i);
  expect(content).toMatch(/SET search_path TO saas/);
});
```

**Test case B — upsert idempotency on same tenantId (AC #2):**

```ts
it('second upsert with the same tenantId issues ON CONFLICT (tenant_id) DO UPDATE', async () => {
  const row = {
    id: 'uuid-1',
    tenant_id: 'tenant-a',
    issuer_url: 'https://idp.example.com',
    client_id: 'client-2',
    encrypted_client_secret: 'enc::secret2',
    allowed_domains: [] as string[],
    enforce_sso: false,
    created_at: new Date(),
    updated_at: new Date(),
  };
  const captured: { sql: string; params: unknown[] }[] = [];
  const repo = new OidcIdpConfigRepository(makeFakePool([row], captured));

  await repo.upsert({
    tenantId: 'tenant-a',
    issuerUrl: 'https://idp.example.com',
    clientId: 'client-1',
    clientSecret: 'secret1',
    allowedDomains: [],
    enforceSso: false,
  });
  const result = await repo.upsert({
    tenantId: 'tenant-a',
    issuerUrl: 'https://idp.example.com',
    clientId: 'client-2',
    clientSecret: 'secret2',
    allowedDomains: [],
    enforceSso: false,
  });

  expect(result.clientId).toBe('client-2');
  expect(captured).toHaveLength(2);
  for (const call of captured) {
    expect(call.sql).toMatch(/ON CONFLICT \(tenant_id\) DO UPDATE/);
  }
});
```

**Test case C — findByTenantId returns null for unknown tenant (AC #3):**

```ts
it('findByTenantId returns null when no row exists for the tenantId', async () => {
  const captured: { sql: string; params: unknown[] }[] = [];
  const repo = new OidcIdpConfigRepository(makeFakePool([], captured));

  const result = await repo.findByTenantId('no-such-tenant');

  expect(result).toBeNull();
});
```

**Test case D — findByTenantId decrypts clientSecret (AC #4):**

```ts
it('findByTenantId returns the decrypted clientSecret', async () => {
  const storedRow = {
    id: 'uuid-1',
    tenant_id: 'tenant-a',
    issuer_url: 'https://idp.example.com',
    client_id: 'client-1',
    encrypted_client_secret: 'enc::my-secret',
    allowed_domains: ['example.com'],
    enforce_sso: true,
    created_at: new Date(),
    updated_at: new Date(),
  };
  const captured: { sql: string; params: unknown[] }[] = [];
  const repo = new OidcIdpConfigRepository(makeFakePool([storedRow], captured));

  const result = await repo.findByTenantId('tenant-a');

  expect(result).not.toBeNull();
  expect(result!.clientSecret).toBe('my-secret');
  expect(fakeEnc.decrypt).toHaveBeenCalledWith('enc::my-secret');
});
```

**Test case E — upsert encrypts clientSecret before writing (AC #5):**

```ts
it('upsert passes the encrypted secret to the database, not the plaintext', async () => {
  const returnedRow = {
    id: 'uuid-1',
    tenant_id: 'tenant-a',
    issuer_url: 'https://idp.example.com',
    client_id: 'client-1',
    encrypted_client_secret: 'enc::plaintext',
    allowed_domains: [] as string[],
    enforce_sso: false,
    created_at: new Date(),
    updated_at: new Date(),
  };
  const captured: { sql: string; params: unknown[] }[] = [];
  const repo = new OidcIdpConfigRepository(makeFakePool([returnedRow], captured));

  await repo.upsert({
    tenantId: 'tenant-a',
    issuerUrl: 'https://idp.example.com',
    clientId: 'client-1',
    clientSecret: 'plaintext',
    allowedDomains: [],
    enforceSso: false,
  });

  expect(fakeEnc.encrypt).toHaveBeenCalledWith('plaintext');
  const [call] = captured;
  // encrypted_client_secret is the 4th positional parameter in the INSERT.
  expect(call.params[3]).toBe('enc::plaintext');
  expect(call.params[3]).not.toBe('plaintext');
});
```

**Test case F — repository and types are exported from the barrel (AC #6):**

```ts
it('OidcIdpConfigRepository and its types are exported from the repositories barrel', async () => {
  const barrel = await import('../../src/db/repositories.js');
  expect(barrel.OidcIdpConfigRepository).toBeDefined();
  // Type exports cannot be checked at runtime; the typecheck command covers them.
});
```

## Verification

```bash
pnpm --filter @bugspotter/backend typecheck
pnpm --filter @bugspotter/backend test:unit
```

(There is no `--testPathPattern` flag in Vitest — that is a Jest flag. `test:unit` runs the fixed `include` list from `vitest.unit.config.ts`; once `tests/db/oidc-idp-config.repository.test.ts` is added to it (constraint 10 / the `vitest.unit.config.ts` change above), plain `test:unit` picks it up. To run just this file locally: `pnpm --filter @bugspotter/backend exec vitest run --config vitest.unit.config.ts tests/db/oidc-idp-config.repository.test.ts`.)

Rollback: Delete the new migration file from `packages/backend/src/db/migrations/`, delete `packages/backend/src/db/repositories/oidc-idp-config.repository.ts` and its test file, revert the two export lines added to `packages/backend/src/db/repositories.ts`, and revert the one-line addition to `vitest.unit.config.ts`. If the migration has already been applied to a live database, execute `DROP TABLE IF EXISTS saas.oidc_idp_config;` manually against that database before removing the migration file, so the migration runner's state and the schema stay in sync.
