# Spec: SSO `enforce_sso` guards on existing auth endpoints

Linked issue: Refs #354
ADR: docs/adr/0044-sso-oidc-account-linking-and-tenant-boundary.md

**Files touched:**

- `packages/backend/src/api/middleware/enforce-sso.ts` (new)
- `packages/backend/src/api/routes/auth.ts` (ASSUMED, not verified — source tree only lists the `api/routes/` directory, not its contents; confirm this is the file containing the `login`, `register`, and `magic-login` handlers via `grep -r "auth/login" packages/backend/src/api/routes/` before implementing)
- `packages/backend/src/api/routes/admin-organizations.ts` (ASSUMED, not verified — confirm this is the file containing the `POST /api/v1/admin/organizations/:id/magic-token` handler; `packages/backend/tests/api/admin-organizations.test.ts` exists, which supports but does not prove this filename)
- `packages/backend/src/config.ts` (add `OIDC_ENFORCE_SSO` selfhosted-mode flag, per CLAUDE.md: "Flags that depend on mode are declared in `packages/backend/src/config.ts`")
- `packages/backend/src/config/types.ts` (add field to the config type)
- `packages/backend/src/config/validators.ts` (parse/validate the new env var)
- `packages/backend/tests/api/auth.test.ts`
- `packages/backend/tests/api/admin-organizations.test.ts`
- `packages/backend/tests/config/validators.test.ts`
- `packages/backend/tests/config.test.ts`

**Blocking prerequisites:** #352 — adds the `oidc_idp_config` repository this guard reads from in `saas` mode; the guard cannot resolve a tenant's `enforce_sso` value without it.

## Problem

Four auth surfaces can currently establish a session for a user whose organization has SSO enforced, silently bypassing the SSO requirement: `/auth/login`, `/auth/register` (mints a session directly, never routes through `/login`), `/auth/magic-login`, and the platform-admin impersonation path `/admin/organizations/:id/magic-token`. PR #345's first review round missed two of these four bypasses because the SSO work was reviewed as part of a sixteen-file diff. Per ADR-0044 Decision 4, this slice is isolated specifically so the enforcement guard on live, existing endpoints gets scrutinized on its own — a wrong guard here either creates a silent security gap (SSO advertised as enforced but not) or breaks password login for tenants who never opted into SSO.

## Out of scope

- Implementing the `oidc_idp_config` repository itself — that is #352.
- The `saas`-mode config-lookup service/caching layer — that is #353; this guard only needs the repository to exist, not the service.
- The OIDC provider integration or login flow itself (token exchange, callback handling, account linking) — covered elsewhere under #265.
- Any admin UI surfacing of `enforce_sso` status — not requested by this issue.
- Work in `bugspotter-sdk`, `bugspotter-extension`, `bugspotter-mcp`, `bugspotter-landing`, or `bugspotter-deploy` — none of the four affected endpoints or the config plumbing live outside `bugspotter-public`.

## Constraints

1. Guard must read `enforce_sso` from the mode-appropriate source per ADR-0044 Decision 4: the tenant's `oidc_idp_config` row in `saas` mode, the `OIDC_ENFORCE_SSO` env var in `selfhosted` mode.
2. Must default to **not enforced** when the config source is absent/unset (missing `oidc_idp_config` row, or `OIDC_ENFORCE_SSO` unset) — the issue explicitly requires this default over throwing.
3. The guard must be applied to all four surfaces, including `/register` (mints a session directly, bypassing `/login`) and the admin `magic-token` impersonation path — these are exactly the two surfaces PR #345's first review round missed.
4. Response shape on block must be exactly `403 {"error":"sso_enforced"}`, identical across all four endpoints, so admin/API consumers can handle it with one branch.
5. This slice only consumes the `oidc_idp_config` repository from #352 — it must not implement repository methods itself.
6. Change must be purely additive/behind-config: password/JWT login behavior for tenants without SSO configured must be unchanged (per the issue's own rollback framing).

## Acceptance criteria

- [ ] `POST /api/v1/auth/login` returns `403 {"error":"sso_enforced"}` when the resolved tenant has `enforce_sso=true` — verified by Test A
- [ ] `POST /api/v1/auth/register` returns `403 {"error":"sso_enforced"}` under the same condition, without minting a session — verified by Test B
- [ ] `POST /api/v1/auth/magic-login` returns `403 {"error":"sso_enforced"}` under the same condition — verified by Test C
- [ ] `POST /api/v1/admin/organizations/:id/magic-token` returns `403 {"error":"sso_enforced"}` when the target org has `enforce_sso=true` — verified by Test D
- [ ] All four endpoints proceed normally (existing success status codes) when `enforce_sso=false` or no `oidc_idp_config` row exists for the tenant — verified by Test E
- [ ] In `selfhosted` mode, an unset `OIDC_ENFORCE_SSO` env var results in enforcement being treated as `false` (no error thrown) — verified by Test F
- [ ] In `selfhosted` mode, `OIDC_ENFORCE_SSO=true` blocks all four endpoints for all users (single-tenant) — verified by Test G

## Changes

### `packages/backend/src/api/middleware/enforce-sso.ts`

New shared guard function called from each of the four handlers; resolves the enforcement flag per deployment mode and throws/returns the standard 403 shape.

**Correction:** the deployment-mode check below must not read `config.deploymentMode` — that field does not exist on `AppConfig` (`packages/backend/src/config/types.ts` has no `deploymentMode`, and `config.ts` never assigns one). Every other mode-dependent default in `config.ts` (e.g. `auth.allowRegistration`, `auth.selfServiceSignupEnabled`) reads `process.env.DEPLOYMENT_MODE` directly — do the same here, or use `getDeploymentConfig()` from `../../saas/config.js` (already imported by `auth.ts`) if a richer accessor is needed. That file wasn't in the verified source set for this review, so its exact return shape (e.g. whether it exposes `.mode`) is unverified.

```ts
// New file
import { config } from '../../config.js';
// ASSUMED, not verified — repository added by #352; confirm exact export path and
// method signature (e.g. `findByTenantId`) against #352's implementation before use.
import type { OidcIdpConfigRepository } from '../../db/repositories/oidc-idp-config.repository.js';

export class SsoEnforcedError extends Error {
  constructor() {
    super('sso_enforced');
  }
}

export async function assertSsoNotEnforced(
  tenantId: string,
  oidcIdpConfigRepository: OidcIdpConfigRepository
): Promise<void> {
  if (process.env.DEPLOYMENT_MODE === 'selfhosted') {
    if (config.oidc.enforceSso) {
      throw new SsoEnforcedError();
    }
    return;
  }

  const idpConfig = await oidcIdpConfigRepository.findByTenantId(tenantId);
  if (idpConfig?.enforce_sso) {
    throw new SsoEnforcedError();
  }
}
```

### `packages/backend/src/config.ts`

**Correction:** the `oidc` section already exists in `config.ts` (it currently holds `redirectBaseUrl`) — add `enforceSso` alongside it, don't gate this on "create the section if none exists."

```ts
// Add to the existing `oidc` section of the config object:
oidc: {
  redirectBaseUrl: process.env.OIDC_REDIRECT_BASE_URL?.trim().replace(/\/+$/, '') || null,
  enforceSso: parseBoolEnv(process.env.OIDC_ENFORCE_SSO, false),
},
```

### `packages/backend/src/config/types.ts`

**Correction:** `AppConfig` already declares `oidc: OidcConfig;`, and `OidcConfig` already exists with a `redirectBaseUrl: string | null` field — add `enforceSso` to that existing interface rather than treating `oidc` as a new root field.

```ts
// Add to the existing OidcConfig interface:
export interface OidcConfig {
  redirectBaseUrl: string | null;
  enforceSso: boolean;
}
```

### `packages/backend/src/config/validators.ts`

```ts
// Append near other boolean env parsers:
export function parseBoolEnv(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) return defaultValue;
  return value.toLowerCase() === 'true';
}
```

### `packages/backend/src/api/routes/auth.ts` (ASSUMED, not verified)

Call the guard at the top of the `login`, `register`, and `magic-login` handlers, before any session is minted.

**Correction:** `authRoutes(fastify, db)` only receives `db: DatabaseClient` — there is no `container` in scope in this file. Use `db.oidcIdpConfigRepository` instead. Whether `db` actually exposes an `oidcIdpConfigRepository` property (added by #352) is unverified — `db/client.ts` was not in the verified source set for this review; confirm against #352's implementation.

```ts
// Insert at the start of the existing login handler, register handler, and
// magic-login handler, after tenant/org resolution and before session creation:
try {
  await assertSsoNotEnforced(resolvedTenantId, db.oidcIdpConfigRepository);
} catch (err) {
  if (err instanceof SsoEnforcedError) {
    return reply.code(403).send({ error: 'sso_enforced' });
  }
  throw err;
}
```

### `packages/backend/src/api/routes/admin-organizations.ts` (ASSUMED, not verified)

Same guard, keyed on the target org id from the route param, inserted before the magic-token handler mints the impersonation token.

**Correction:** same `container` → `db` fix as above — `adminOrganizationRoutes(fastify, db)` only receives `db: DatabaseClient`.

```ts
// Insert at the start of the existing POST /:id/magic-token handler,
// before the impersonation token is created:
try {
  await assertSsoNotEnforced(request.params.id, db.oidcIdpConfigRepository);
} catch (err) {
  if (err instanceof SsoEnforcedError) {
    return reply.code(403).send({ error: 'sso_enforced' });
  }
  throw err;
}
```

## Tests

### `packages/backend/tests/api/auth.test.ts`

**Correction:** this file exercises a real Fastify server (`server: FastifyInstance`) against a real test-database `DatabaseClient` (`beforeAll` calls `createServer({ db, storage, pluginRegistry })`) — there is no service-container/mock-repository fixture anywhere in this file, so "add to the mock container fixture" doesn't apply. Spy on the real repository method per test instead. The `server.inject` calls below also use `server`, not `app` (this file never defines an `app` variable). Test cases B and C (register / magic-login) are moved here from `auth-handlers.test.ts`, which is a pure unit-test file for the API-key/JWT auth _middleware_ functions (`handleNewApiKeyAuth`, `handleJwtAuth`) — it has no Fastify instance, no route registration, and no `app`/`server` to call `.inject` on, so the register/magic-login HTTP-level tests cannot live there.

```ts
// Per-test setup (replaces the "mock container fixture" — db.oidcIdpConfigRepository
// is a real, unmocked property once #352 lands; its existence is unverified here
// since db/client.ts wasn't in the reviewed source set):
beforeEach(() => {
  vi.spyOn(db.oidcIdpConfigRepository, 'findByTenantId').mockResolvedValue(null); // default: not enforced
});
```

**Test case A — `/login` returns 403 when tenant has `enforce_sso=true` (AC #1):**

```ts
it('returns 403 sso_enforced when the tenant enforces SSO', async () => {
  await server.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { email: 'user@example.com', password: 'password123' },
  });

  vi.spyOn(db.oidcIdpConfigRepository, 'findByTenantId').mockResolvedValue({
    enforce_sso: true,
  } as never);

  const response = await server.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email: 'user@example.com', password: 'password123' },
  });

  expect(response.statusCode).toBe(403);
  expect(response.json()).toEqual({ error: 'sso_enforced' });
});
```

**Test case B — `/register` returns 403 without minting a session (AC #2):**

Note: `RegisterBody`/`registerSchema` accept only `email`, `name?`, `password`, `invite_token?` — the file's own "should reject registration with extra properties" test confirms unknown fields (e.g. an `organizationName`) are rejected with 400. Don't include one.

```ts
it('blocks register and does not create a session when SSO is enforced', async () => {
  vi.spyOn(db.oidcIdpConfigRepository, 'findByTenantId').mockResolvedValue({
    enforce_sso: true,
  } as never);

  const response = await server.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { email: 'new@example.com', password: 'password123' },
  });

  expect(response.statusCode).toBe(403);
  expect(response.json()).toEqual({ error: 'sso_enforced' });
  expect(response.cookies).toHaveLength(0);
});
```

**Test case C — `/magic-login` returns 403 (AC #3):**

Note: the tenant for magic-login is only known from the token's `organizationId` claim (decoded inside the handler), so the guard necessarily runs after `fastify.jwt.verify` succeeds. A placeholder string like `'valid-magic-token'` is not a real JWT and would fail verification (→ 401) before the guard ever runs — sign a real magic token instead.

```ts
it('blocks magic-login when SSO is enforced', async () => {
  vi.spyOn(db.oidcIdpConfigRepository, 'findByTenantId').mockResolvedValue({
    enforce_sso: true,
  } as never);

  const magicToken = server.jwt.sign({
    userId: '00000000-0000-0000-0000-000000000003',
    organizationId: '00000000-0000-0000-0000-000000000004',
    type: 'magic',
  });

  const response = await server.inject({
    method: 'POST',
    url: '/api/v1/auth/magic-login',
    payload: { token: magicToken },
  });

  expect(response.statusCode).toBe(403);
  expect(response.json()).toEqual({ error: 'sso_enforced' });
});
```

**Test case E — `/login` succeeds when `enforce_sso=false` or unset (AC #5):**

```ts
it('logs in normally when SSO is not enforced', async () => {
  await server.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { email: 'user2@example.com', password: 'password123' },
  });

  vi.spyOn(db.oidcIdpConfigRepository, 'findByTenantId').mockResolvedValue(null);

  const response = await server.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email: 'user2@example.com', password: 'password123' },
  });

  expect(response.statusCode).toBe(200);
});
```

### `packages/backend/tests/api/admin-organizations.test.ts`

**Correction:** same real-server/real-`db` note as above — spy on `db.oidcIdpConfigRepository` rather than adding to a mock container fixture. `server.inject` (not `app.inject`) and `adminToken` (not `platformAdminToken`) match this file's actual variable names.

```ts
beforeEach(() => {
  vi.spyOn(db.oidcIdpConfigRepository, 'findByTenantId').mockResolvedValue(null);
});
```

**Test case D — admin magic-token impersonation returns 403 (AC #4):**

Note: the `magic-token` route schema requires `params.id` to match `format: uuid` and `body.user_id` to be present (`required: ['user_id']`); a non-UUID id like `'org-123'` or a missing body would fail Fastify schema validation with 400 before the SSO guard ever runs. Since the guard is inserted at the very start of the handler (before the org/membership lookups), it doesn't need a real, existing org — just schema-valid params/body.

```ts
it('blocks admin magic-token impersonation when the target org enforces SSO', async () => {
  vi.spyOn(db.oidcIdpConfigRepository, 'findByTenantId').mockResolvedValue({
    enforce_sso: true,
  } as never);

  const response = await server.inject({
    method: 'POST',
    url: '/api/v1/admin/organizations/00000000-0000-0000-0000-000000000001/magic-token',
    headers: { authorization: `Bearer ${adminToken}` },
    payload: { user_id: '00000000-0000-0000-0000-000000000002' },
  });

  expect(response.statusCode).toBe(403);
  expect(response.json()).toEqual({ error: 'sso_enforced' });
});
```

### `packages/backend/tests/config/validators.test.ts`

**Test case F — `OIDC_ENFORCE_SSO` unset defaults to `false` (AC #6):**

```ts
it('parseBoolEnv defaults to false when OIDC_ENFORCE_SSO is unset', () => {
  expect(parseBoolEnv(undefined, false)).toBe(false);
});

it('parseBoolEnv returns true for "true"', () => {
  expect(parseBoolEnv('true', false)).toBe(true);
});
```

### `packages/backend/tests/config.test.ts`

**Test case G — `selfhosted` mode with `OIDC_ENFORCE_SSO=true` blocks all four endpoints (AC #7):**

**Correction:** there is no `loadConfig()` export — `config.ts` exports a `config` const evaluated at import time. Every other test in this file re-reads it via `vi.resetModules()` + dynamic `import()`; follow that pattern.

```ts
it('exposes oidc.enforceSso=true from OIDC_ENFORCE_SSO in selfhosted mode', async () => {
  process.env.DEPLOYMENT_MODE = 'selfhosted';
  process.env.OIDC_ENFORCE_SSO = 'true';
  vi.resetModules();

  const { config } = await import('../src/config.js');

  expect(config.oidc.enforceSso).toBe(true);
});
```

## Verification

```bash
pnpm --filter @bugspotter/backend typecheck
pnpm --filter @bugspotter/backend test:unit
```

Rollback: revert the guard insertions in the four handlers and the `enforce-sso.ts` middleware file; the `config.ts`/`config/types.ts`/`config/validators.ts` additions are inert (default `false`) when unused and can be left in place or reverted together. All steps are additive behind the `enforce_sso`/`OIDC_ENFORCE_SSO` flag — no data migration or irreversible state change is introduced.
