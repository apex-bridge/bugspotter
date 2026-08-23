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
2. **Guard-vs-404 ordering in `admin-organizations.ts`, left undecided in #392's spec — resolved here.** The real handler (`admin-organizations.ts:519` onward) currently runs, in order: `db.organizations.findById(id)` (404 if missing) → `magic_login_enabled` check (400) → `db.users.findById(user_id)` (404) → membership check. The question: should the SSO guard run before or after the org lookup? Resolution: **before**, matching the other three endpoints (guard is always the first thing every guarded handler does, unconditionally) - this is safe and doesn't leak organization existence, because `assertSsoNotEnforced` is a no-op for a nonexistent tenant: `db.oidcIdpConfigs.findByTenantId` on a nonexistent org id resolves `null` (no matching row), so the guard resolves without throwing exactly as if SSO were simply not configured, and the handler proceeds to its existing `db.organizations.findById` check, which still 404s normally. A real org with `enforce_sso=true` gets the 403 immediately, before any other business-rule check (`magic_login_enabled`, user lookup, membership) - the same "guard first, unconditionally" shape already used for `/login`, `/register`, and `/magic-login`. Verified by Test D and the new Test L below. **This no-op-for-unknown-tenant property is specific to `saas` mode's per-tenant repository lookup** (see #394's `enforce-sso.ts`) - `selfhosted` mode's branch reads a single global `config.oidc.enforceSso` flag with no per-tenant awareness at all, so Test D/L below must actually exercise the `saas`-mode branch to prove this property, not just assert against whatever mode the shared test server happens to run in (see the test-harness correction below).
3. **Tenant source for the guard call, left as a placeholder in #392's spec — resolved here.** `/login` and `/register` key on `request.organizationId` (optional; unset on the hub domain, where the existing `assertUserBelongsToTenant`/`isPasswordResetEnabledForRequest` helpers already no-op rather than require a tenant) - the guard is skipped when no tenant is resolved, since there is no specific tenant's `enforce_sso` to check on the hub domain. `/magic-login` keys on `decoded.organizationId` from the verified JWT claim instead, once the handler's own existing claim-shape check (`!decoded.organizationId || typeof ... !== 'string'`) has confirmed it's a real string - not `request.organizationId`, which the handler's own comment already documents as intentionally unset for hub-domain magic-logins and, more importantly, is not authoritative for which tenant a magic link was minted for (the existing tenant-match gate treats the token's own claim as the source of truth, not the request's resolved subdomain). No handler in `auth.ts` has a `resolvedTenantId` symbol; that name doesn't exist in this file.

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
2. Response shape on block must be exactly `403 {"error":"sso_enforced"}`, identical across all four endpoints, so admin/API consumers can handle it with one branch. Construct this from `SsoEnforcedError`'s own `.message` (see #394) at each of the four call sites - `reply.code(403).send({ error: err.message })` inside the narrowed `err instanceof SsoEnforcedError` branch - not a hand-typed `'sso_enforced'` literal, so the four stay in sync with the guard's own identifier if #394 ever changes it.
3. Guard call must be the first thing every guarded handler does, before any other business-rule check, session minting, or impersonation-token creation — including, in `admin-organizations.ts`, before the target organization's own existence is checked (see the resolved ordering decision above).
4. Change must be purely additive/behind-config: password/JWT login behavior for tenants without SSO configured must be unchanged (per the issue's own rollback framing).

## Acceptance criteria

- [ ] `POST /api/v1/auth/login` returns `403 {"error":"sso_enforced"}` when the resolved tenant has `enforce_sso=true` — verified by Test A (selfhosted, `OIDC_ENFORCE_SSO`) and Test F (saas mode, proves the guard is keyed on the host-resolved `request.organizationId`)
- [ ] `POST /api/v1/auth/register` returns `403 {"error":"sso_enforced"}` under the same condition, without minting a session — verified by Test B (selfhosted) and Test G (saas mode, same tenant-source proof as Test F)
- [ ] `POST /api/v1/auth/magic-login` returns `403 {"error":"sso_enforced"}` under the same condition — verified by Test C (selfhosted) and Test H (saas mode, proves the guard is keyed on the JWT's `decoded.organizationId`, not `request.organizationId`)
- [ ] `POST /api/v1/admin/organizations/:id/magic-token` returns `403 {"error":"sso_enforced"}` when the target org has `enforce_sso=true`, before the org-existence/magic-login-enabled/user-existence checks run — verified by Test D
- [ ] All four endpoints proceed normally (existing success/404 status codes) when `enforce_sso=false` or no `oidc_idp_config` row exists for the tenant — verified by Test E (all three `auth.ts` endpoints, `OIDC_ENFORCE_SSO` unset and explicit `false`) and Test M (admin magic-token, explicit `enforceSso: false` row)
- [ ] `POST /api/v1/admin/organizations/:id/magic-token` against a nonexistent organization id still returns `404` (not `403`) — the guard's no-op-for-unknown-tenant behavior doesn't mask the existing not-found check — verified by Test L

## Changes

### `packages/backend/src/api/routes/auth.ts` (ASSUMED, not verified)

Call the guard at the top of the `login`, `register`, and `magic-login` handlers, before any session is minted. Each handler has a different real tenant source (see correction 3 above) - there is no single generic snippet that works for all three.

**Correction:** `authRoutes(fastify, db)` only receives `db: DatabaseClient` — there is no `container` in scope in this file. Use `db.oidcIdpConfigs` (not `db.oidcIdpConfigRepository`, which does not exist).

**`/login`** — insert as the first statement in the handler, before `checkLockoutStatus`/`db.users.findByEmail`:

**Correction (review): do not gate the guard call on `request.organizationId` being truthy.** Selfhosted requests never set `request.organizationId` (saas-mode tenant middleware isn't registered under `DEPLOYMENT_MODE=selfhosted`), but `assertSsoNotEnforced`'s selfhosted branch ignores its `tenantId` argument entirely and reads `config.oidc.enforceSso` instead (see #394's `assertSsoNotEnforced`, which takes `tenantId: string` and only touches it on the `=== 'saas'` branch). A bare `if (request.organizationId)` gate therefore skips the guard on every selfhosted request regardless of `OIDC_ENFORCE_SSO`, silently defeating enforcement and contradicting Test A/B below, which require selfhosted `OIDC_ENFORCE_SSO=true` to 403. Skip the call only in the one case correction 3 above actually describes — `saas` mode with no tenant resolved (the hub domain) — not unconditionally on a falsy `request.organizationId`.

```ts
async (request, reply) => {
  // Skip only on the saas hub domain (no tenant resolved) - matching the
  // existing assertUserBelongsToTenant/isPasswordResetEnabledForRequest
  // no-op-on-hub-domain pattern. This is always false in selfhosted mode,
  // so the guard always runs there and reads config.oidc.enforceSso via
  // its own branch, independent of request.organizationId.
  const skipGuard = process.env.DEPLOYMENT_MODE === 'saas' && !request.organizationId;
  if (!skipGuard) {
    try {
      await assertSsoNotEnforced(request.organizationId ?? '', db.oidcIdpConfigs);
    } catch (err) {
      if (err instanceof SsoEnforcedError) {
        return reply.code(403).send({ error: err.message });
      }
      throw err;
    }
  }

  const { email, password } = request.body;
  // ...existing handler body unchanged...
```

**`/register`** — same pattern, inserted before the existing `config.auth.allowRegistration` check (constraint 3 requires the guard be the first business-rule check, and `allowRegistration` is itself one). Same correction as `/login` above applies: gate `skipGuard` on `saas` mode with no resolved tenant, not on a bare `request.organizationId` truthiness check.

```ts
async (request, reply) => {
  const skipGuard = process.env.DEPLOYMENT_MODE === 'saas' && !request.organizationId;
  if (!skipGuard) {
    try {
      await assertSsoNotEnforced(request.organizationId ?? '', db.oidcIdpConfigs);
    } catch (err) {
      if (err instanceof SsoEnforcedError) {
        return reply.code(403).send({ error: err.message });
      }
      throw err;
    }
  }

  if (!config.auth.allowRegistration) {
    // ...existing handler body unchanged...
```

**`/magic-login`** — insert after the existing tenant-match gate (the point where `decoded.organizationId` is both claim-validated and confirmed to match the request's own tenant, if any) and before `db.organizations.findById`:

```ts
// Insert immediately after the existing:
//   if (request.organizationId !== undefined && request.organizationId !== decoded.organizationId) { throw ... }
// block, and before the existing db.organizations.findById(decoded.organizationId) call.
// decoded.organizationId is guaranteed a validated string here (the handler's
// own earlier check already rejects a missing/non-string claim).
try {
  await assertSsoNotEnforced(decoded.organizationId, db.oidcIdpConfigs);
} catch (err) {
  if (err instanceof SsoEnforcedError) {
    return reply.code(403).send({ error: err.message });
  }
  throw err;
}
```

This sits inside the handler's existing outer `try { ... } catch (error) { ... }` (which only special-cases JWT verification errors and rethrows everything else) - the guard's own inner catch `return`s directly on `SsoEnforcedError`, so it never reaches the outer catch.

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
    return reply.code(403).send({ error: err.message });
  }
  throw err;
}
```

## Tests

### `packages/backend/tests/api/auth.test.ts`

**Correction:** this file exercises a real Fastify server (`server: FastifyInstance`) against a real test-database `DatabaseClient` (`beforeAll` calls `createServer({ db, storage, pluginRegistry })`) — there is no service-container/mock-repository fixture anywhere in this file, so "add to the mock container fixture" doesn't apply. The `server.inject` calls below also use `server`, not `app` (this file never defines an `app` variable). Test cases B and C (register / magic-login) are moved here from `auth-handlers.test.ts`, which is a pure unit-test file for the API-key/JWT auth _middleware_ functions (`handleNewApiKeyAuth`, `handleJwtAuth`) — it has no Fastify instance, no route registration, and no `app`/`server` to call `.inject` on, so the register/magic-login HTTP-level tests cannot live there.

**Correction (test harness cannot drive the guard as originally written):** spying on `db.oidcIdpConfigs` here has no effect. `tests/setup.ts` sets `DEPLOYMENT_MODE=selfhosted` globally (it's the `globalSetup` for the default `vitest.config.ts` this file runs under), and #394's `assertSsoNotEnforced` only calls `oidcIdpConfigs.findByTenantId` on its `=== 'saas'` branch; in `selfhosted` mode it reads `config.oidc.enforceSso` (from `OIDC_ENFORCE_SSO`, evaluated once at `config.ts` import time) and never touches the repository. Separately, `/login` and `/register` would never even see a `request.organizationId` on the default `server`: saas-mode tenant middleware is only registered when `createServer()` is built under `DEPLOYMENT_MODE=saas` (`server.ts:99-100`), and `server` here was built under `selfhosted`. `selfhosted` is also the representative mode for these three endpoints regardless of that wrinkle — they're the single-tenant password/magic-link surfaces an actual self-hosted deployment uses `OIDC_ENFORCE_SSO` on. Drive the guard through that env var instead, following this file's own existing `createServerWithRegistration`/`createServerWithInvitationRequired` pattern (env var + `vi.resetModules()` + a freshly re-imported `createServer`) rather than mocking the repository:

```ts
// Mirrors createServerWithRegistration above — same file, same pattern.
async function createServerWithSsoEnforced(db: DatabaseClient, enforced: boolean) {
  const original = process.env.OIDC_ENFORCE_SSO;
  process.env.OIDC_ENFORCE_SSO = String(enforced);
  vi.resetModules();

  const { createServer: freshCreateServer } = await import('../../src/api/server.js');
  const server = await freshCreateServer({
    db,
    storage: createMockStorage(),
    pluginRegistry: createMockPluginRegistry(),
  });
  await server.ready();

  // Restore env var — doesn't affect the already-created server.
  process.env.OIDC_ENFORCE_SSO = original;
  vi.resetModules();

  return server;
}
```

**Test case A — `/login` returns 403 when SSO is enforced (AC #1):**

```ts
it('returns 403 sso_enforced when the deployment enforces SSO', async () => {
  // Register on the default server first (OIDC_ENFORCE_SSO=false there),
  // so the user exists before ssoServer's guard blocks the login attempt.
  await server.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { email: 'user@example.com', password: 'password123' },
  });

  const ssoServer = await createServerWithSsoEnforced(db, true);
  try {
    const response = await ssoServer.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'user@example.com', password: 'password123' },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: 'sso_enforced' });
  } finally {
    await ssoServer.close();
  }
});
```

**Test case B — `/register` returns 403 without minting a session (AC #2):**

Note: `RegisterBody`/`registerSchema` accept only `email`, `name?`, `password`, `invite_token?` — the file's own "should reject registration with extra properties" test confirms unknown fields (e.g. an `organizationName`) are rejected with 400. Don't include one.

```ts
it('blocks register and does not create a session when SSO is enforced', async () => {
  const ssoServer = await createServerWithSsoEnforced(db, true);
  try {
    const response = await ssoServer.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: 'new@example.com', password: 'password123' },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: 'sso_enforced' });
    expect(response.cookies).toHaveLength(0);
  } finally {
    await ssoServer.close();
  }
});
```

**Test case C — `/magic-login` returns 403 (AC #3):**

Note: the tenant for magic-login is only known from the token's `organizationId` claim (decoded inside the handler), so the guard necessarily runs after `fastify.jwt.verify` succeeds. A placeholder string like `'valid-magic-token'` is not a real JWT and would fail verification (→ 401) before the guard ever runs — sign a real magic token instead. `selfhosted` mode's guard branch ignores the `organizationId`/`tenantId` argument entirely (it only reads `config.oidc.enforceSso`), so the claim's actual value doesn't affect the outcome here — it's still required so the handler's existing claim-shape/tenant-match checks upstream of the guard pass first.

```ts
it('blocks magic-login when SSO is enforced', async () => {
  const ssoServer = await createServerWithSsoEnforced(db, true);
  try {
    const magicToken = ssoServer.jwt.sign({
      userId: '00000000-0000-0000-0000-000000000003',
      organizationId: '00000000-0000-0000-0000-000000000004',
      type: 'magic',
    });

    const response = await ssoServer.inject({
      method: 'POST',
      url: '/api/v1/auth/magic-login',
      payload: { token: magicToken },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: 'sso_enforced' });
  } finally {
    await ssoServer.close();
  }
});
```

**Test case E — all three `auth.ts` endpoints proceed normally when SSO is not enforced (AC #5):**

The original single-test version only covered `/login` with `OIDC_ENFORCE_SSO` unset. This covers all three endpoints, plus the explicit `OIDC_ENFORCE_SSO=false` case alongside the default-unset case:

```ts
it('logs in normally when SSO is not enforced (OIDC_ENFORCE_SSO unset)', async () => {
  // The default `server` from beforeAll never sets OIDC_ENFORCE_SSO, so
  // config.oidc.enforceSso is already false — no extra server needed.
  await server.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { email: 'user2@example.com', password: 'password123' },
  });

  const response = await server.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email: 'user2@example.com', password: 'password123' },
  });

  expect(response.statusCode).toBe(200);
});

it('registers normally when OIDC_ENFORCE_SSO is explicitly false', async () => {
  const ssoOffServer = await createServerWithSsoEnforced(db, false);
  try {
    const response = await ssoOffServer.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: 'user3@example.com', password: 'password123' },
    });

    expect(response.statusCode).toBe(201);
  } finally {
    await ssoOffServer.close();
  }
});

it('logs in via magic-login normally when SSO is not enforced', async () => {
  // Seed a user + magic_login_enabled org directly, following the same
  // pattern as tests/integration/magic-login.integration.test.ts.
  const user = await db.users.create({
    email: 'magic-ok@example.com',
    name: null,
    password_hash: null,
    role: 'user',
  });
  const org = await db.organizations.create({
    name: 'Magic OK Org',
    subdomain: 'magic-ok-org',
    settings: { magic_login_enabled: true },
  });
  await db.organizationMembers.create({
    organization_id: org.id,
    user_id: user.id,
    role: 'member',
  });

  const magicToken = server.jwt.sign({ userId: user.id, organizationId: org.id, type: 'magic' });

  const response = await server.inject({
    method: 'POST',
    url: '/api/v1/auth/magic-login',
    payload: { token: magicToken },
  });

  expect(response.statusCode).toBe(200);
});
```

**Test cases F/G/H — saas-mode tenant-source proof for AC #1–#3 (review gap):** Tests A–C above only ever exercise `selfhosted` mode's branch of `assertSsoNotEnforced`, which reads the global `config.oidc.enforceSso` flag and never touches its `tenantId`/repository arguments (see the harness correction above) — so a regression that passed the wrong tenant id (or the wrong repository) into the guard call would still pass all three. Each case below conditions the `db.oidcIdpConfigs.findByTenantId` spy on the _specific_ tenant id the guard is expected to pass; a wrong id makes the spy return `null` (guard no-ops, request proceeds) instead of `{ enforceSso: true }`, so the test fails on status code rather than on the spy call assertion alone — both are asserted for a precise failure signal. These three share one `saas`-mode server, built the same way the file's own existing `POST /api/v1/auth/login — SaaS org-access revocation` describe block (above) builds its `saasServer` — `DEPLOYMENT_MODE=saas` + `resetDeploymentConfig()` + `vi.resetModules()` + a freshly re-imported `createServer`, then restore:

```ts
describe('POST /api/v1/auth/{login,register,magic-login} — SSO enforcement (saas mode)', () => {
  let saasServer: FastifyInstance;

  beforeAll(async () => {
    const originalMode = process.env.DEPLOYMENT_MODE;
    process.env.DEPLOYMENT_MODE = 'saas';
    const { resetDeploymentConfig } = await import('../../src/saas/config.js');
    resetDeploymentConfig();
    vi.resetModules();

    const { createServer: freshCreateServer } = await import('../../src/api/server.js');
    saasServer = await freshCreateServer({
      db,
      storage: createMockStorage(),
      pluginRegistry: createMockPluginRegistry(),
    });
    await saasServer.ready();

    // Restore env var — the already-created saasServer has its config baked in.
    process.env.DEPLOYMENT_MODE = originalMode;
    resetDeploymentConfig();
    vi.resetModules();
  });

  afterAll(async () => {
    await saasServer.close();
  });

  it('Test F: blocks /login on a host-resolved tenant, keyed on request.organizationId', async () => {
    // subscription_status defaults to 'trial' (in ACTIVE_STATUSES), so the
    // tenant middleware resolves this subdomain instead of 403ing first.
    const org = await db.organizations.create({
      name: 'SSO Login Org',
      subdomain: 'sso-login-org',
    });
    const spy = vi
      .spyOn(db.oidcIdpConfigs, 'findByTenantId')
      .mockImplementation(async (tenantId) =>
        tenantId === org.id ? ({ enforceSso: true } as never) : null
      );

    try {
      const response = await saasServer.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        headers: { host: `${org.subdomain}.bugspotter.io` },
        payload: { email: 'someone@example.com', password: 'password123' },
      });

      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({ error: 'sso_enforced' });
      expect(spy).toHaveBeenCalledWith(org.id);
    } finally {
      spy.mockRestore();
    }
  });

  it('Test G: blocks /register on a host-resolved tenant, before allowRegistration/invite checks', async () => {
    const org = await db.organizations.create({
      name: 'SSO Register Org',
      subdomain: 'sso-register-org',
    });
    const spy = vi
      .spyOn(db.oidcIdpConfigs, 'findByTenantId')
      .mockImplementation(async (tenantId) =>
        tenantId === org.id ? ({ enforceSso: true } as never) : null
      );

    try {
      // No invite_token: saas mode's default requireInvitationToRegister
      // would otherwise reject this with 403 InvitationRequired, but the
      // guard runs first (constraint 3) and short-circuits before that
      // check is ever reached — this also proves the ordering, not just
      // the tenant source.
      const response = await saasServer.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        headers: { host: `${org.subdomain}.bugspotter.io` },
        payload: { email: 'newuser@example.com', password: 'password123' },
      });

      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({ error: 'sso_enforced' });
      expect(spy).toHaveBeenCalledWith(org.id);
    } finally {
      spy.mockRestore();
    }
  });

  it('Test H: blocks /magic-login keyed on decoded.organizationId, not request.organizationId', async () => {
    const tenantId = '00000000-0000-0000-0000-000000000005';
    const spy = vi
      .spyOn(db.oidcIdpConfigs, 'findByTenantId')
      .mockImplementation(async (id) => (id === tenantId ? ({ enforceSso: true } as never) : null));

    try {
      const magicToken = saasServer.jwt.sign({
        userId: '00000000-0000-0000-0000-000000000006',
        organizationId: tenantId,
        type: 'magic',
      });

      // No host header override: the injected default host resolves no
      // subdomain in saas mode, so request.organizationId stays undefined
      // and the handler's own tenant-match gate no-ops. The guard must
      // still block using decoded.organizationId from the token claim —
      // proving the guard reads the claim, not request.organizationId
      // (which is a different, and here absent, value).
      const response = await saasServer.inject({
        method: 'POST',
        url: '/api/v1/auth/magic-login',
        payload: { token: magicToken },
      });

      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({ error: 'sso_enforced' });
      expect(spy).toHaveBeenCalledWith(tenantId);
    } finally {
      spy.mockRestore();
    }
  });
});
```

### `packages/backend/tests/api/admin-organizations.test.ts`

**Correction:** same real-server/real-`db` note as above — `server.inject` (not `app.inject`) and `adminToken` (not `platformAdminToken`) match this file's actual variable names. This file's `import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';` (line 6) does not include `vi` — add it, since the fix below needs `vi.spyOn` and `vi.resetModules`.

**Correction (test harness — different fix than `auth.test.ts`, not the same one repeated):** the "no-op for a nonexistent tenant" property Test D/L below exist to prove is specific to `saas` mode's per-tenant `db.oidcIdpConfigs.findByTenantId` lookup (see the resolved ordering decision at the top of this spec) — `selfhosted` mode's guard branch is a single global flag with no per-tenant concept at all, so it cannot exercise this property regardless of how it's mocked. Unlike `auth.test.ts`'s three endpoints, this one genuinely needs a `saas`-mode server. This file's own `server` is built under the same global `selfhosted` `tests/setup.ts` as `auth.test.ts`, so build a dedicated `saas`-mode server the same way `auth.test.ts`'s existing `POST /api/v1/auth/login — SaaS org-access revocation` describe block already does (`DEPLOYMENT_MODE=saas` + `resetDeploymentConfig()` + `vi.resetModules()` + a freshly re-imported `createServer`, then restore):

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
```

**Test case D — admin magic-token impersonation returns 403, before other checks (AC #4).** **Test case L — nonexistent organization still 404s, not masked by the guard (AC #6, the ordering decision's safety property).** **Test case M — an existing but disabled `enforceSso: false` row also proceeds normally (AC #5, the admin endpoint's share of the success-path coverage Test E covers for the other three, and distinct from Test L's "no row at all" case).**

Note: the `magic-token` route schema requires `params.id` to match `format: uuid` and `body.user_id` to be present (`required: ['user_id']`); a non-UUID id like `'org-123'` or a missing body would fail Fastify schema validation with 400 before the SSO guard ever runs. Since the guard is inserted at the very start of the handler (before the org/membership lookups), Tests D/L don't need a real, existing org — just schema-valid params/body. This also proves the ordering decision above: the org id used in L is never created in the test database, so if the guard ran _after_ `db.organizations.findById`, it would 404 regardless of the guard, not exercise the guard's no-op path at all.

**Correction (review): bind each mock to the exact route organization id, and give Test M a real success path.** As originally written, D/L/M each used `mockResolvedValue(...)` unconditionally — the mock returns the same value for _any_ argument, so a handler bug that passed the wrong id (e.g. `request.body.user_id` instead of `request.params.id`) into `assertSsoNotEnforced` would still pass. Follow the same `mockImplementation` + `toHaveBeenCalledWith(id)` pattern Tests F/G/H above already use, keyed on each test's specific org id, for D and L too. L's `expect(spy).toHaveBeenCalledWith(orgId)` also closes the gap CodeRabbit flagged: without it, a missing or reordered guard would produce the identical 404 (the org genuinely doesn't exist) without ever proving the guard ran at all. M's original version reused L's nonexistent org id, so its 404 was indistinguishable from "org not found" and never actually exercised an `enforceSso:false` row on a real, existing org reaching the handler's normal success path — rewritten below to create a real org (`POST /api/v1/admin/organizations` with `owner_user_id`, which atomically creates an `OWNER` membership too, per `OrganizationService.adminCreateOrganization`), enable `magic_login_enabled` via the existing `PATCH .../magic-login-status` endpoint, and assert a genuine `200` with a minted token.

```ts
describe('POST /:id/magic-token — SSO enforcement (saas mode)', () => {
  let saasServer: FastifyInstance;

  beforeAll(async () => {
    const originalMode = process.env.DEPLOYMENT_MODE;
    process.env.DEPLOYMENT_MODE = 'saas';
    const { resetDeploymentConfig } = await import('../../src/saas/config.js');
    resetDeploymentConfig();
    vi.resetModules();

    const { createServer: freshCreateServer } = await import('../../src/api/server.js');
    saasServer = await freshCreateServer({
      db,
      storage: createMockStorage(),
      pluginRegistry: createMockPluginRegistry(),
    });
    await saasServer.ready();

    // Restore env var — the already-created saasServer has its config baked in.
    // adminToken (from the outer beforeEach) validates on saasServer too: it's
    // a JWT signed against the shared JWT_SECRET, and the admin user it names
    // lives in `db`, which both server instances share.
    process.env.DEPLOYMENT_MODE = originalMode;
    resetDeploymentConfig();
    vi.resetModules();
  });

  afterAll(async () => {
    await saasServer.close();
  });

  it('blocks admin magic-token impersonation when the target org enforces SSO, before the org lookup', async () => {
    const orgId = '00000000-0000-0000-0000-000000000001';
    const spy = vi
      .spyOn(db.oidcIdpConfigs, 'findByTenantId')
      .mockImplementation(async (id) => (id === orgId ? ({ enforceSso: true } as never) : null));

    try {
      const response = await saasServer.inject({
        method: 'POST',
        url: `/api/v1/admin/organizations/${orgId}/magic-token`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { user_id: '00000000-0000-0000-0000-000000000002' },
      });

      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({ error: 'sso_enforced' });
      expect(spy).toHaveBeenCalledWith(orgId);
    } finally {
      spy.mockRestore();
    }
  });

  it('still 404s for a nonexistent organization rather than leaking a 403', async () => {
    const orgId = '00000000-0000-0000-0000-000000000099';
    // no row -> no-op; a wrong-id call would also resolve null here, so the
    // toHaveBeenCalledWith below is what actually proves the guard ran with
    // the right id rather than being skipped or reordered.
    const spy = vi
      .spyOn(db.oidcIdpConfigs, 'findByTenantId')
      .mockImplementation(async (id) => (id === orgId ? null : ({ enforceSso: true } as never)));

    try {
      const response = await saasServer.inject({
        method: 'POST',
        url: `/api/v1/admin/organizations/${orgId}/magic-token`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { user_id: '00000000-0000-0000-0000-000000000002' },
      });

      expect(response.statusCode).toBe(404);
      expect(spy).toHaveBeenCalledWith(orgId);
    } finally {
      spy.mockRestore();
    }
  });

  it('proceeds to a real success response when an existing org has an enforceSso:false config row', async () => {
    // Real org + real OWNER membership (adminCreateOrganization creates both
    // atomically from owner_user_id), plus magic_login_enabled - unlike the
    // old version of this test (which reused Test L's nonexistent org id),
    // this actually reaches the handler's normal body: org lookup succeeds,
    // magic_login_enabled is true, regularUserId is a member, so a passing
    // guard genuinely proves the enforceSso:false path, not an unrelated 404.
    const subdomain = `sso-off-org-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const createResponse = await saasServer.inject({
      method: 'POST',
      url: '/api/v1/admin/organizations',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { name: 'SSO Off Org', subdomain, owner_user_id: regularUserId },
    });
    const orgId = createResponse.json().data.id;
    createdOrgIds.push(orgId);

    await saasServer.inject({
      method: 'PATCH',
      url: `/api/v1/admin/organizations/${orgId}/magic-login-status`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { enabled: true },
    });

    const spy = vi
      .spyOn(db.oidcIdpConfigs, 'findByTenantId')
      .mockImplementation(async (id) => (id === orgId ? ({ enforceSso: false } as never) : null));

    try {
      const response = await saasServer.inject({
        method: 'POST',
        url: `/api/v1/admin/organizations/${orgId}/magic-token`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { user_id: regularUserId },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().data.token).toBeTypeOf('string');
      expect(spy).toHaveBeenCalledWith(orgId);
    } finally {
      spy.mockRestore();
    }
  });
});
```

## Verification

**Correction:** `test:unit` (`vitest.unit.config.ts`) does not include `tests/api/auth.test.ts` or `tests/api/admin-organizations.test.ts` - its `include` list only has `tests/api/auth-handlers.test.ts` from this directory. Both files are integration-style (real Fastify server, real testcontainers Postgres via `tests/setup.ts`) and only run under the default config (`vitest.config.ts`, invoked by the plain `test` script), which needs Docker.

```bash
pnpm --filter @bugspotter/backend typecheck
pnpm --filter @bugspotter/backend test -- tests/api/auth.test.ts tests/api/admin-organizations.test.ts
```

Rollback: revert the guard-call insertions in the four handlers. Additive/behind-config — password/JWT login is unchanged when the guard isn't invoked. No data migration or irreversible state change is introduced.
