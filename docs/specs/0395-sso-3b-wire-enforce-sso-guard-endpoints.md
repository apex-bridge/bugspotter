# Spec: SSO 3b/4 wire `enforce_sso` guard onto existing auth endpoints

Linked issue: Refs #395
ADR: docs/adr/0044-sso-oidc-account-linking-and-tenant-boundary.md

**Files touched:**

- `packages/backend/src/api/routes/auth.ts` (ASSUMED, not verified — source tree only lists the `api/routes/` directory, not its contents; confirm this is the file containing the `login`, `register`, and `magic-login` handlers via `grep -r "auth/login" packages/backend/src/api/routes/` before implementing — already independently confirmed correct during this issue's split review)
- `packages/backend/src/api/routes/admin-organizations.ts` (ASSUMED, not verified — confirm this is the file containing the `POST /api/v1/admin/organizations/:id/magic-token` handler — already independently confirmed correct during this issue's split review: the route registration is at `admin-organizations.ts:519`, not `auth.ts`, whose only "magic-token" match is an unrelated comment)
- `packages/backend/tests/api/auth.test.ts`
- `packages/backend/tests/api/admin-organizations.test.ts`

**Blocking prerequisites:** #394 — builds `assertSsoNotEnforced`/`SsoEnforcedError` in `enforce-sso.ts` and the `config.oidc.enforceSso` flag this half calls; must merge and be implemented first. #352 (already merged) — the `oidc_idp_config` repository the guard reads from.

**Split note:** this is half B of #354 (Refs #354), split from that issue's combined spec (PR #392) after it was blocked by `check-spec-scope.mjs`'s hard 6-file gate (10 files declared against a 6-file cap). Hand-extracted directly from PR #392's own already-drafted spec content, then corrected against a direct review of the real merged #352 code (see "Corrections from #392" below) - not regenerated from scratch, to avoid reintroducing grounding errors and another spec-agent timeout (same reasoning #367/#368's split from #353 used). Half A (the guard itself) is #394.

**Corrections from #392's original combined spec**, found during review of PR #392 (Copilot) and independently verified here against the real merged `#352` code:

1. The repository accessor on `DatabaseClient` is `db.oidcIdpConfigs`, not `db.oidcIdpConfigRepository` — confirmed at `packages/backend/src/db/client.ts:221`. #392's spec used the wrong accessor name in the wiring code and both test files; fixed throughout below.
2. **Guard-vs-404 ordering in `admin-organizations.ts`, left undecided in #392's spec — resolved here.** The real handler (`admin-organizations.ts:519` onward) currently runs, in order: `db.organizations.findById(id)` (404 if missing) → `magic_login_enabled` check (400) → `db.users.findById(user_id)` (404) → membership check. The question: should the SSO guard run before or after the org lookup? Resolution: **before**, matching the other three endpoints (guard is always the first thing every guarded handler does, unconditionally) - this is safe and doesn't leak organization existence, because `assertSsoNotEnforced` is a no-op for a nonexistent tenant: `db.oidcIdpConfigs.findByTenantId` on a nonexistent org id resolves `null` (no matching row), so the guard resolves without throwing exactly as if SSO were simply not configured, and the handler proceeds to its existing `db.organizations.findById` check, which still 404s normally. A real org with `enforce_sso=true` gets the 403 immediately, before any other business-rule check (`magic_login_enabled`, user lookup, membership) - the same "guard first, unconditionally" shape already used for `/login`, `/register`, and `/magic-login`. Verified by Test D and the new Test L below.

## Problem

Four auth surfaces can currently establish a session for a user whose organization has SSO enforced, silently bypassing the SSO requirement: `/auth/login`, `/auth/register` (mints a session directly, never routes through `/login`), `/auth/magic-login`, and the platform-admin impersonation path `/admin/organizations/:id/magic-token`. PR #345's first review round missed two of these four bypasses because the SSO work was reviewed as part of a sixteen-file diff. Per ADR-0044 Decision 4, this slice is isolated specifically so the enforcement guard on live, existing endpoints gets scrutinized on its own — a wrong guard here either creates a silent security gap (SSO advertised as enforced but not) or breaks password login for tenants who never opted into SSO. Splitting the guard's own logic into #394 keeps this half to pure wiring: no middleware-internals noise, just "is every one of the four surfaces actually calling the guard, correctly."

## Out of scope

- The guard's own logic, deployment-mode resolution, and config plumbing — that is #394.
- Implementing the `oidc_idp_config` repository itself — that is #352 (already merged).
- The `saas`-mode config-lookup service/caching layer — that is #353; this guard only needs the repository to exist, not the service.
- The OIDC provider integration or login flow itself (token exchange, callback handling, account linking) — covered elsewhere under #265.
- Any admin UI surfacing of `enforce_sso` status — not requested by this issue.
- Work in `bugspotter-sdk`, `bugspotter-extension`, `bugspotter-mcp`, `bugspotter-landing`, or `bugspotter-deploy` — none of the four affected endpoints live outside `bugspotter-public`.

## Constraints

1. The guard must be applied to all four surfaces, including `/register` (mints a session directly, bypassing `/login`) and the admin `magic-token` impersonation path — these are exactly the two surfaces PR #345's first review round missed.
2. Response shape on block must be exactly `403 {"error":"sso_enforced"}`, identical across all four endpoints, so admin/API consumers can handle it with one branch. Construct this from `SsoEnforcedError`'s message (see #394) at each of the four call sites, not a hand-typed literal, so the four stay in sync with the guard's own identifier.
3. Guard call must be the first thing every guarded handler does, before any other business-rule check, session minting, or impersonation-token creation — including, in `admin-organizations.ts`, before the target organization's own existence is checked (see the resolved ordering decision above).
4. Change must be purely additive/behind-config: password/JWT login behavior for tenants without SSO configured must be unchanged (per the issue's own rollback framing).

## Acceptance criteria

- [ ] `POST /api/v1/auth/login` returns `403 {"error":"sso_enforced"}` when the resolved tenant has `enforce_sso=true` — verified by Test A
- [ ] `POST /api/v1/auth/register` returns `403 {"error":"sso_enforced"}` under the same condition, without minting a session — verified by Test B
- [ ] `POST /api/v1/auth/magic-login` returns `403 {"error":"sso_enforced"}` under the same condition — verified by Test C
- [ ] `POST /api/v1/admin/organizations/:id/magic-token` returns `403 {"error":"sso_enforced"}` when the target org has `enforce_sso=true`, before the org-existence/magic-login-enabled/user-existence checks run — verified by Test D
- [ ] All four endpoints proceed normally (existing success/404 status codes) when `enforce_sso=false` or no `oidc_idp_config` row exists for the tenant — verified by Test E
- [ ] `POST /api/v1/admin/organizations/:id/magic-token` against a nonexistent organization id still returns `404` (not `403`) — the guard's no-op-for-unknown-tenant behavior doesn't mask the existing not-found check — verified by Test L

## Changes

### `packages/backend/src/api/routes/auth.ts` (ASSUMED, not verified)

Call the guard at the top of the `login`, `register`, and `magic-login` handlers, before any session is minted.

**Correction:** `authRoutes(fastify, db)` only receives `db: DatabaseClient` — there is no `container` in scope in this file. Use `db.oidcIdpConfigs` (not `db.oidcIdpConfigRepository`, which does not exist).

```ts
// Insert at the start of the existing login handler, register handler, and
// magic-login handler, after tenant/org resolution and before session creation:
try {
  await assertSsoNotEnforced(resolvedTenantId, db.oidcIdpConfigs);
} catch (err) {
  if (err instanceof SsoEnforcedError) {
    return reply.code(403).send({ error: 'sso_enforced' });
  }
  throw err;
}
```

### `packages/backend/src/api/routes/admin-organizations.ts` (ASSUMED, not verified)

Same guard, keyed on the target org id from the route param, inserted as the very first statement in the handler — before `db.organizations.findById`, per the resolved ordering decision above.

**Correction:** same `container` → `db` fix as above — `adminOrganizationRoutes(fastify, db)` only receives `db: DatabaseClient`. Use `db.oidcIdpConfigs`, not `db.oidcIdpConfigRepository`.

```ts
// Insert as the first statement in the existing POST /:id/magic-token handler,
// before db.organizations.findById and everything after it:
try {
  await assertSsoNotEnforced(request.params.id, db.oidcIdpConfigs);
} catch (err) {
  if (err instanceof SsoEnforcedError) {
    return reply.code(403).send({ error: 'sso_enforced' });
  }
  throw err;
}
```

## Tests

### `packages/backend/tests/api/auth.test.ts`

**Correction:** this file exercises a real Fastify server (`server: FastifyInstance`) against a real test-database `DatabaseClient` (`beforeAll` calls `createServer({ db, storage, pluginRegistry })`) — there is no service-container/mock-repository fixture anywhere in this file, so "add to the mock container fixture" doesn't apply. Spy on `db.oidcIdpConfigs` (not `db.oidcIdpConfigRepository`) per test instead. The `server.inject` calls below also use `server`, not `app` (this file never defines an `app` variable). Test cases B and C (register / magic-login) are moved here from `auth-handlers.test.ts`, which is a pure unit-test file for the API-key/JWT auth _middleware_ functions (`handleNewApiKeyAuth`, `handleJwtAuth`) — it has no Fastify instance, no route registration, and no `app`/`server` to call `.inject` on, so the register/magic-login HTTP-level tests cannot live there.

```ts
// Per-test setup (replaces the "mock container fixture" — db.oidcIdpConfigs
// is a real, unmocked property from #352):
beforeEach(() => {
  vi.spyOn(db.oidcIdpConfigs, 'findByTenantId').mockResolvedValue(null); // default: not enforced
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

  vi.spyOn(db.oidcIdpConfigs, 'findByTenantId').mockResolvedValue({
    enforceSso: true,
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
  vi.spyOn(db.oidcIdpConfigs, 'findByTenantId').mockResolvedValue({
    enforceSso: true,
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
  vi.spyOn(db.oidcIdpConfigs, 'findByTenantId').mockResolvedValue({
    enforceSso: true,
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

  vi.spyOn(db.oidcIdpConfigs, 'findByTenantId').mockResolvedValue(null);

  const response = await server.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email: 'user2@example.com', password: 'password123' },
  });

  expect(response.statusCode).toBe(200);
});
```

### `packages/backend/tests/api/admin-organizations.test.ts`

**Correction:** same real-server/real-`db` note as above — spy on `db.oidcIdpConfigs` (not `db.oidcIdpConfigRepository`) rather than adding to a mock container fixture. `server.inject` (not `app.inject`) and `adminToken` (not `platformAdminToken`) match this file's actual variable names.

```ts
beforeEach(() => {
  vi.spyOn(db.oidcIdpConfigs, 'findByTenantId').mockResolvedValue(null);
});
```

**Test case D — admin magic-token impersonation returns 403, before other checks (AC #4):**

Note: the `magic-token` route schema requires `params.id` to match `format: uuid` and `body.user_id` to be present (`required: ['user_id']`); a non-UUID id like `'org-123'` or a missing body would fail Fastify schema validation with 400 before the SSO guard ever runs. Since the guard is inserted at the very start of the handler (before the org/membership lookups), it doesn't need a real, existing org — just schema-valid params/body. This also proves the ordering decision above: the org id used here is never created in the test database, so if the guard ran _after_ `db.organizations.findById`, this would 404, not 403.

```ts
it('blocks admin magic-token impersonation when the target org enforces SSO, before the org lookup', async () => {
  vi.spyOn(db.oidcIdpConfigs, 'findByTenantId').mockResolvedValue({
    enforceSso: true,
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

**Test case L — nonexistent organization still 404s, not masked by the guard (AC #6, the ordering decision's safety property):**

```ts
it('still 404s for a nonexistent organization rather than leaking a 403', async () => {
  // findByTenantId is not mocked to return an enforceSso row for this id -
  // the default beforeEach mock (null) already models "no config for this tenant",
  // which is also exactly what a nonexistent org's id resolves to.
  const response = await server.inject({
    method: 'POST',
    url: '/api/v1/admin/organizations/00000000-0000-0000-0000-000000000099/magic-token',
    headers: { authorization: `Bearer ${adminToken}` },
    payload: { user_id: '00000000-0000-0000-0000-000000000002' },
  });

  expect(response.statusCode).toBe(404);
});
```

## Verification

```bash
pnpm --filter @bugspotter/backend typecheck
pnpm --filter @bugspotter/backend test:unit
```

Rollback: revert the guard-call insertions in the four handlers. Additive/behind-config — password/JWT login is unchanged when the guard isn't invoked. No data migration or irreversible state change is introduced.
