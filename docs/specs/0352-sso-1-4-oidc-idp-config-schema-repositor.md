# Spec: SSO 1/4: oidc_idp_config schema, repository, and encryption

Linked issue: Refs #352
ADR: docs/adr/0044-sso-oidc-account-linking-and-tenant-boundary.md

**Files touched:**

- `packages/backend/src/db/migrations/<timestamp>_oidc_idp_config.<ext>` (new — exact filename prefix and extension must match existing files in that directory; verify before writing)
- `packages/backend/src/db/repositories/oidc-idp-config.repository.ts` (new)
- `packages/backend/src/db/repositories.ts` (export addition)

**Blocking prerequisites:** none

## Problem

BugSpotter has no database table or data-access layer for per-tenant OIDC/SSO provider configuration. ADR-0044 resolved the design, but slices 2–4 of #265 (login callback, API routes, admin UI) cannot be built without a schema and repository to write against. Every tenant that needs SSO enforcement or OIDC login is blocked until this foundation exists.

## Out of scope

- API routes for reading or writing OIDC provider config (slice 2)
- OIDC login flow, callback handler, or session integration (slice 3)
- Admin UI for SSO configuration (slice 4)
- Any change to existing auth middleware, JWT handling, or share-token behavior
- Migration rollback DDL (the repo convention is additive-only `IF NOT EXISTS`; rollback is a manual table drop documented under Rollback below)

## Constraints

1. The migration must use `CREATE TABLE IF NOT EXISTS` so it is safe to run more than once, consistent with the idempotent-migration convention noted in the ADR index.
2. `tenant_id` must carry a `UNIQUE` constraint at the database level. `upsert()` must rely on that constraint (`ON CONFLICT (tenant_id) DO UPDATE`) rather than a read-before-write guard, so concurrent callers are safe.
3. `encrypted_client_secret` must never hold plaintext. Encryption must happen inside the repository method before the SQL statement executes; the value captured by the query must differ from the caller's input string.
4. The type returned by `findByTenantId` and `upsert` must expose `clientSecret` as the decrypted string, not the cipher envelope, so callers above this layer never handle ciphertext directly.
5. `packages/backend/src/utils/encryption.ts` is confirmed in the source tree. It exports `CredentialEncryption` and `getEncryptionService()`. All `import` paths in the repository file must use `../../utils/encryption.js` (relative to the repository file at `packages/backend/src/db/repositories/`) and all `import` paths in the test file must use `../../src/utils/encryption.js` (relative to the test at `packages/backend/tests/db/`).
6. The `encrypt` and `decrypt` method names on `CredentialEncryption` are **confirmed**: the class exposes `encrypt(plaintext: string): string` and `decrypt(encryptedString: string): string`. No pre-commit verification of these names is required.
7. No API routes, middleware registration, or auth-behavior changes belong in this slice.
8. All new files must pass `pnpm --filter @bugspotter/backend typecheck` without introducing new errors.
9. `packages/backend/src/db/client.ts` imports from `pg` and uses `pg.Pool` directly — there are no Kysely imports in that file. The project uses raw SQL queries via `pg.Pool`, not Kysely. The implementation stubs below use Kysely conventions as a structural reference only; before committing, rewrite all Kysely query-builder calls as raw SQL `pool.query()` calls consistent with the pattern in sibling repositories (e.g. `packages/backend/src/db/repositories/api-key.repository.ts`). The `Kysely<DB>` constructor parameter and the `DB` type import must be replaced with the actual pool type accepted by sibling repository constructors.

## Acceptance criteria

- [ ] Running the migration SQL twice against the same schema produces no error and leaves exactly one `oidc_idp_config` table — verified by test case A.
- [ ] Calling `upsert()` twice with the same `tenantId` but different field values returns the updated row and does not insert a second row — verified by test case B.
- [ ] `findByTenantId()` returns `null` for a `tenantId` that has no row — verified by test case C.
- [ ] `findByTenantId()` returns a record whose `clientSecret` equals the plaintext value originally passed to `upsert()` (constraint C4) — verified by test case D.
- [ ] The value the repository passes to the SQL statement for `encrypted_client_secret` is not equal to the plaintext `clientSecret` supplied by the caller (constraint C3) — verified by test case E.
- [ ] `OidcIdpConfigRepository`, `OidcIdpConfig`, and `OidcIdpConfigUpsertInput` are importable from the `packages/backend/src/db/repositories.ts` barrel — verified by test case F.

## Changes

### `packages/backend/src/db/migrations/<timestamp>_oidc_idp_config.<ext>`

New file. Match the filename prefix format (timestamp, sequential number, or other) and extension (`.ts`, `.sql`, etc.) used by existing files in `packages/backend/src/db/migrations/`. The timestamp must sort after the latest existing migration.

If the project uses raw SQL migrations:

```sql
-- New file — complete content:
CREATE TABLE IF NOT EXISTS oidc_idp_config (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               TEXT        NOT NULL UNIQUE,
  issuer_url              TEXT        NOT NULL,
  client_id               TEXT        NOT NULL,
  encrypted_client_secret TEXT        NOT NULL,
  allowed_domains         TEXT[]      NOT NULL DEFAULT '{}',
  enforce_sso             BOOLEAN     NOT NULL DEFAULT false,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

If the project uses a TypeScript migration runner (e.g. Kysely Migrator):

```ts
// New file — complete content:
import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('oidc_idp_config')
    .ifNotExists()
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('tenant_id', 'text', (col) => col.notNull().unique())
    .addColumn('issuer_url', 'text', (col) => col.notNull())
    .addColumn('client_id', 'text', (col) => col.notNull())
    .addColumn('encrypted_client_secret', 'text', (col) => col.notNull())
    .addColumn('allowed_domains', sql`text[]`, (col) => col.notNull().defaultTo(sql`'{}'::text[]`))
    .addColumn('enforce_sso', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('oidc_idp_config').ifExists().execute();
}
```

### `packages/backend/src/db/repositories/oidc-idp-config.repository.ts`

New file. The encryption import path on line 2 is confirmed (constraint C5). The Kysely query-builder calls must be rewritten in raw pg style before committing (constraint C9).

```ts
// New file — complete content:

// Confirmed path: packages/backend/src/utils/encryption.ts
// CredentialEncryption.encrypt(plaintext: string): string
// CredentialEncryption.decrypt(encryptedString: string): string
import { getEncryptionService } from '../../utils/encryption.js';

// NOTE: This file uses Kysely conventions as a structural reference only.
// The project uses raw pg (pg.Pool) — Kysely is not a dependency.
// Replace Kysely<DB> and all query-builder calls with raw SQL pool.query()
// calls following the pattern in a sibling repository (constraint C9).
import type { Kysely } from 'kysely';
import type { DB } from '../types.js'; // adjust: no Kysely-generated DB type in this project

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

export class OidcIdpConfigRepository {
  constructor(private readonly db: Kysely<DB>) {}

  async findByTenantId(tenantId: string): Promise<OidcIdpConfig | null> {
    const row = await this.db
      .selectFrom('oidc_idp_config')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();

    return row ? this.#fromRow(row) : null;
  }

  async upsert(input: OidcIdpConfigUpsertInput): Promise<OidcIdpConfig> {
    const enc = getEncryptionService();
    const encryptedClientSecret = enc.encrypt(input.clientSecret);

    const row = await this.db
      .insertInto('oidc_idp_config')
      .values({
        tenant_id: input.tenantId,
        issuer_url: input.issuerUrl,
        client_id: input.clientId,
        encrypted_client_secret: encryptedClientSecret,
        allowed_domains: input.allowedDomains,
        enforce_sso: input.enforceSso,
        updated_at: new Date(),
      })
      .onConflict((oc) =>
        oc.column('tenant_id').doUpdateSet({
          issuer_url: input.issuerUrl,
          client_id: input.clientId,
          encrypted_client_secret: encryptedClientSecret,
          allowed_domains: input.allowedDomains,
          enforce_sso: input.enforceSso,
          updated_at: new Date(),
        })
      )
      .returningAll()
      .executeTakeFirstOrThrow();

    return this.#fromRow(row);
  }

  #fromRow(row: {
    id: string;
    tenant_id: string;
    issuer_url: string;
    client_id: string;
    encrypted_client_secret: string;
    allowed_domains: string[];
    enforce_sso: boolean;
    created_at: Date;
    updated_at: Date;
  }): OidcIdpConfig {
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

## Tests

### `packages/backend/tests/db/oidc-idp-config.repository.test.ts`

New file.

**Mock/fixture updates required:**

Before adding test cases, check `packages/backend/tests/db/api-key-repository.test.ts` (and any shared test helper it imports) for the mock DB factory pattern. If a `createMockDb()` or similar helper exists and its return type is a mapped object keyed by table name, add `oidc_idp_config` to that map — a missing key will cause a TypeScript or runtime error when the repository calls `db.selectFrom('oidc_idp_config')` or `db.insertInto('oidc_idp_config')`.

The encryption module must be mocked at the top level of the test file. The import paths below are confirmed (constraint C5):

```ts
// Top of test file — must be at module scope, not inside describe/it:
import { vi, describe, it, expect, beforeEach } from 'vitest';
// NOTE: The project uses raw pg, not Kysely — Kysely<DB> is a placeholder only.
// Replace with the actual pool type accepted by sibling repository constructors (constraint C9).
import type { Kysely } from 'kysely';
import { OidcIdpConfigRepository } from '../../src/db/repositories/oidc-idp-config.repository.js';
import { getEncryptionService } from '../../src/utils/encryption.js';
import type { DB } from '../../src/db/types.js'; // adjust: no Kysely DB type in this project

vi.mock('../../src/utils/encryption.js', () => ({
  getEncryptionService: vi.fn(),
}));

const fakeEnc = {
  encrypt: vi.fn((s: string) => `enc::${s}`),
  decrypt: vi.fn((s: string) => s.replace('enc::', '')),
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getEncryptionService).mockReturnValue(fakeEnc);
});
```

**Test case A — migration contains idempotency guard (AC #1):**

```ts
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

it('migration file uses CREATE TABLE IF NOT EXISTS', () => {
  const migrationsDir = join(__dirname, '../../src/db/migrations');
  const files = readdirSync(migrationsDir).filter((f) => f.includes('oidc_idp_config'));
  expect(files).toHaveLength(1);
  const content = readFileSync(join(migrationsDir, files[0]), 'utf8');
  // For SQL files:
  expect(content).toMatch(/CREATE TABLE IF NOT EXISTS oidc_idp_config/i);
  // For Kysely TS files, replace the assertion above with:
  // expect(content).toMatch(/\.ifNotExists\(\)/);
});
```

**Test case B — upsert idempotency on same tenantId (AC #2):**

```ts
it('second upsert with the same tenantId updates the row rather than inserting', async () => {
  const baseRow = {
    id: 'uuid-1',
    tenant_id: 'tenant-a',
    issuer_url: 'https://idp.example.com',
    client_id: 'client-1',
    encrypted_client_secret: 'enc::secret1',
    allowed_domains: [] as string[],
    enforce_sso: false,
    created_at: new Date(),
    updated_at: new Date(),
  };
  const updatedRow = { ...baseRow, client_id: 'client-2', encrypted_client_secret: 'enc::secret2' };

  const executeTakeFirstOrThrow = vi
    .fn()
    .mockResolvedValueOnce(baseRow)
    .mockResolvedValueOnce(updatedRow);
  const onConflict = vi.fn().mockReturnThis();
  const returningAll = vi.fn().mockReturnValue({ executeTakeFirstOrThrow });
  const values = vi.fn().mockReturnValue({ onConflict, returningAll });
  // onConflict returns the same builder so returningAll is reachable
  onConflict.mockReturnValue({ returningAll });
  const mockDb = { insertInto: vi.fn().mockReturnValue({ values }) } as unknown as Kysely<DB>;

  const repo = new OidcIdpConfigRepository(mockDb);

  const first = await repo.upsert({
    tenantId: 'tenant-a',
    issuerUrl: 'https://idp.example.com',
    clientId: 'client-1',
    clientSecret: 'secret1',
    allowedDomains: [],
    enforceSso: false,
  });
  const second = await repo.upsert({
    tenantId: 'tenant-a',
    issuerUrl: 'https://idp.example.com',
    clientId: 'client-2',
    clientSecret: 'secret2',
    allowedDomains: [],
    enforceSso: false,
  });

  expect(first.clientId).toBe('client-1');
  expect(second.clientId).toBe('client-2');
  expect(onConflict).toHaveBeenCalledTimes(2);
});
```

**Test case C — findByTenantId returns null for unknown tenant (AC #3):**

```ts
it('findByTenantId returns null when no row exists for the tenantId', async () => {
  const executeTakeFirst = vi.fn().mockResolvedValue(undefined);
  const where = vi.fn().mockReturnValue({ executeTakeFirst });
  const selectAll = vi.fn().mockReturnValue({ where });
  const mockDb = { selectFrom: vi.fn().mockReturnValue({ selectAll }) } as unknown as Kysely<DB>;

  const repo = new OidcIdpConfigRepository(mockDb);
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
  const executeTakeFirst = vi.fn().mockResolvedValue(storedRow);
  const where = vi.fn().mockReturnValue({ executeTakeFirst });
  const selectAll = vi.fn().mockReturnValue({ where });
  const mockDb = { selectFrom: vi.fn().mockReturnValue({ selectAll }) } as unknown as Kysely<DB>;

  const repo = new OidcIdpConfigRepository(mockDb);
  const result = await repo.findByTenantId('tenant-a');

  expect(result).not.toBeNull();
  expect(result!.clientSecret).toBe('my-secret');
  expect(fakeEnc.decrypt).toHaveBeenCalledWith('enc::my-secret');
});
```

**Test case E — upsert encrypts clientSecret before writing (AC #5):**

```ts
it('upsert passes the encrypted secret to the database, not the plaintext', async () => {
  let capturedValues: Record<string, unknown> = {};
  const executeTakeFirstOrThrow = vi.fn().mockResolvedValue({
    id: 'uuid-1',
    tenant_id: 'tenant-a',
    issuer_url: 'https://idp.example.com',
    client_id: 'client-1',
    encrypted_client_secret: 'enc::plaintext',
    allowed_domains: [],
    enforce_sso: false,
    created_at: new Date(),
    updated_at: new Date(),
  });
  const returningAll = vi.fn().mockReturnValue({ executeTakeFirstOrThrow });
  const onConflict = vi.fn().mockReturnValue({ returningAll });
  const values = vi.fn().mockImplementation((v) => {
    capturedValues = v;
    return { onConflict };
  });
  const mockDb = { insertInto: vi.fn().mockReturnValue({ values }) } as unknown as Kysely<DB>;

  const repo = new OidcIdpConfigRepository(mockDb);
  await repo.upsert({
    tenantId: 'tenant-a',
    issuerUrl: 'https://idp.example.com',
    clientId: 'client-1',
    clientSecret: 'plaintext',
    allowedDomains: [],
    enforceSso: false,
  });

  expect(fakeEnc.encrypt).toHaveBeenCalledWith('plaintext');
  expect(capturedValues['encrypted_client_secret']).toBe('enc::plaintext');
  expect(capturedValues['encrypted_client_secret']).not.toBe('plaintext');
});
```

**Test case F — repository and types are exported from the barrel (AC #6):**

```ts
it('OidcIdpConfigRepository and its types are exported from the repositories barrel', async () => {
  const barrel = await import('../../src/db/repositories');
  expect(barrel.OidcIdpConfigRepository).toBeDefined();
  // Type exports cannot be checked at runtime; the typecheck command covers them.
});
```

## Verification

```bash
pnpm --filter @bugspotter/backend typecheck
pnpm --filter @bugspotter/backend test:unit -- --testPathPattern oidc-idp-config
```

Rollback: Delete the new migration file from `packages/backend/src/db/migrations/`, delete `packages/backend/src/db/repositories/oidc-idp-config.repository.ts`, and revert the two export lines added to `packages/backend/src/db/repositories.ts`. If the migration has already been applied to a live database, execute `DROP TABLE IF EXISTS oidc_idp_config;` manually against that database before removing the migration file, so the migration runner's state and the schema stay in sync.
