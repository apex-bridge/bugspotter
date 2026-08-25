# Spec: SSO — add `GET /api/v1/auth/sso-status` endpoint for pre-auth tenant enforcement check

Linked issue: Refs #414
ADR: docs/adr/0044-sso-oidc-account-linking-and-tenant-boundary.md

**Files touched:**

- `packages/backend/src/api/routes/auth.ts` (changed)
- `packages/backend/tests/api/auth.test.ts` (changed)

**Blocking prerequisites:** none.

## Problem

The login page (#408) needs to know, before first paint, whether the current tenant has made SSO mandatory (`enforce_sso: true`), so it can hide the password fields rather than show them and let a doomed password login fail against the SSO-enforcement guard (`assertSsoNotEnforced`, `packages/backend/src/api/middleware/enforce-sso.ts`). No backend route currently exposes that boolean to an unauthenticated pre-login caller — `packages/backend/src/api/routes/auth.ts` has no `sso-status` route. This gap was discovered while implementing #406 (login SSO status data layer), whose frontend `authService.getSsoStatus()` method calls this endpoint; it is not covered by any of #352 (`oidc_idp_config` schema/repository), #367/#368 (OIDC login initiation/callback), or #394/#395 (`enforce_sso` guard middleware + wiring onto existing endpoints) — all already shipped and merged.

## Out of scope

- The frontend `authService.getSsoStatus()` method and its i18n string — that is #406.
- Wiring this into the login page's UI (fields, button, `useEffect` call) — that is #408.
- The SSO config data layer (`sso-service.ts`, `use-sso-config.ts`) — that is #407.
- The SSO config page and its route — that is #409.
- Backend RBAC/tenant-admin gating (#354, already merged) and backend validation of the config shape (#352).
- The actual OIDC redirect/callback flow — this issue only adds a status read, not a login handshake.
- Any change to `bugspotter-sdk`, `bugspotter-extension`, or `bugspotter-landing`.

## Constraints

1. The route must be **public** (`config: { public: true }`, no auth middleware) — it runs on the pre-login page, before any session exists.
2. Tenant resolution must go through `request.organizationId`, set by the existing tenant-resolution middleware from the request's host/subdomain — same source `GET /api/v1/auth/registration-status` already reads for its own per-tenant fields, and the same source `/login`/`/register`/`/magic-login`'s SSO-enforcement guard reads today. No client-supplied org id, no new tenant-resolution logic.
3. The `enforceSso` value itself must be resolved exactly like `assertSsoNotEnforced` (`packages/backend/src/api/middleware/enforce-sso.ts`) already resolves it for the login-time guard — ADR-0044 Decision 4's saas-vs-selfhosted split, already implemented by #394's `enforce-sso.ts`: in `saas` mode, read the tenant's `oidc_idp_config` row via `db.oidcIdpConfigs.findByTenantId(request.organizationId)`; in `selfhosted` mode (and the unset/unrecognized-`DEPLOYMENT_MODE` fallback), read `config.oidc.enforceSso` (`OIDC_ENFORCE_SSO`). The new route mirrors this branch rather than calling `assertSsoNotEnforced` directly, because that function throws on `true` (it's a login-time gate) where this route must resolve and return the boolean (it's a status read) — same resolution, different shape, kept local to `auth.ts` rather than adding a new shared module for a single route.
4. On the saas hub domain (no `request.organizationId`), resolve to `false`, matching the existing guard's own skip-on-hub-domain behavior at `/login` and `/register`.

## Acceptance criteria

- [ ] `GET /api/v1/auth/sso-status` is reachable without an `Authorization` header and returns `{ success: true, data: { enforceSso: boolean }, timestamp }`
- [ ] In `selfhosted` mode, `enforceSso` reflects `OIDC_ENFORCE_SSO` (`false` when unset, `true` when set) — verified via the existing `createServerWithSsoEnforced` helper, same pattern as the sibling SSO-enforcement (selfhosted mode) tests
- [ ] In `saas` mode, `enforceSso` is resolved from the host-resolved tenant's `oidc_idp_config` row (`db.oidcIdpConfigs.findByTenantId`), not any client-supplied value — verified by a saas-mode test asserting the spy is called with the host-resolved `org.id` and the response reflects the mocked `enforceSso: true`, mirroring the file's existing Test F/G/H saas-mode SSO-enforcement pattern
- [ ] In `saas` mode on the hub domain (no host-resolved tenant), `enforceSso` resolves to `false` rather than throwing or looking up an undefined tenant id

## Changes

### `packages/backend/src/api/routes/auth.ts` (changed)

Add a `GET /api/v1/auth/sso-status` route at the end of `authRoutes()`, right after the existing `GET /api/v1/auth/registration-status` route it mirrors (registered around line 779) — same public/unauthenticated shape, same `request.organizationId` tenant source. Also add a small local response schema, `ssoStatusSchema`, right before the route (kept local to this file rather than promoted into `auth-schema.ts`, since it's a single small schema for one route — mirrors the shape of `registrationStatusSchema`):

```ts
// Append near the top of the file, alongside the other local interfaces/schemas
// (after the RefreshTokenBody interface):
/**
 * Response schema for GET /api/v1/auth/sso-status. Kept local to this
 * file (rather than promoted into auth-schema.ts) since it's a single
 * small schema for one route, not shared — mirrors the shape of
 * registrationStatusSchema in auth-schema.ts without adding a new file
 * to this issue's declared scope.
 */
const ssoStatusSchema = {
  response: {
    200: {
      type: 'object',
      required: ['success', 'data', 'timestamp'],
      properties: {
        success: { type: 'boolean', enum: [true] },
        data: {
          type: 'object',
          required: ['enforceSso'],
          properties: {
            enforceSso: { type: 'boolean' },
          },
        },
        timestamp: { type: 'string', format: 'date-time' },
      },
    },
  },
} as const;

// Append at the end of authRoutes(), after the existing
// GET /api/v1/auth/registration-status route:
/**
 * GET /api/v1/auth/sso-status
 * Public endpoint — returns whether SSO is enforced (mandatory) for the
 * tenant resolved from the request host/subdomain. The login page (#408)
 * uses this to decide whether to hide the password fields before first
 * paint, rather than showing them and letting a doomed password login
 * fail against the SSO-enforcement guard.
 *
 * Resolution mirrors `assertSsoNotEnforced` (enforce-sso.ts, ADR-0044
 * Decision 4): saas mode reads the tenant's oidc_idp_config row via
 * `findByTenantId`, selfhosted mode reads OIDC_ENFORCE_SSO
 * (config.oidc.enforceSso). This route resolves the same boolean
 * instead of throwing — it's a status read, not a login-time gate.
 * Hub domain in saas mode (no request.organizationId) resolves to
 * false, matching the guard's own skip-on-hub-domain behavior at
 * /login and /register above.
 */
fastify.get(
  '/api/v1/auth/sso-status',
  {
    schema: ssoStatusSchema,
    config: { public: true },
  },
  async (request, reply) => {
    const enforceSso =
      process.env.DEPLOYMENT_MODE === 'saas'
        ? request.organizationId
          ? Boolean((await db.oidcIdpConfigs.findByTenantId(request.organizationId))?.enforceSso)
          : false
        : config.oidc.enforceSso;

    return sendSuccess(reply, { enforceSso });
  }
);
```

## Tests

### `packages/backend/tests/api/auth.test.ts` (changed)

Integration-style test file (real Postgres via testcontainers). Add:

- A new `describe('GET /api/v1/auth/sso-status', ...)` block, sibling to the existing `describe('GET /api/v1/auth/registration-status', ...)` block: one case asserting `enforceSso: false` on the default server (`OIDC_ENFORCE_SSO` unset), one case asserting the route is reachable with no `Authorization` header.

```ts
describe('GET /api/v1/auth/sso-status', () => {
  it('should return enforceSso: false when SSO is not enforced (OIDC_ENFORCE_SSO unset)', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/auth/sso-status',
    });

    expect(response.statusCode).toBe(200);
    const json = response.json();
    expect(json.success).toBe(true);
    expect(json.data.enforceSso).toBe(false);
  });

  it('should be accessible without authentication', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/auth/sso-status',
    });

    // No Authorization header — should still work (public endpoint)
    expect(response.statusCode).toBe(200);
  });
});
```

- One case inside the existing `describe('POST /api/v1/auth/{login,register,magic-login} — SSO enforcement (selfhosted mode)', ...)` block, using the already-present `createServerWithSsoEnforced(db, true)` helper:

```ts
it('reports enforceSso: true from GET /sso-status when OIDC_ENFORCE_SSO is set', async () => {
  const ssoServer = await createServerWithSsoEnforced(db, true);
  try {
    const response = await ssoServer.inject({
      method: 'GET',
      url: '/api/v1/auth/sso-status',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.enforceSso).toBe(true);
  } finally {
    await ssoServer.close();
  }
});
```

- Two cases inside the existing `describe('POST /api/v1/auth/{login,register,magic-login} — SSO enforcement (saas mode)', ...)` block (which already builds `saasServer` and uses `withDeploymentMode('saas', ...)`), following the file's own `Test F`/`Test G`/`Test H` labeling convention as `Test I`/`Test J`:

```ts
it("Test I: GET /sso-status resolves enforceSso: true from the tenant's oidc_idp_config row on a host-resolved tenant", async () => {
  const org = await db.organizations.create({
    name: 'SSO Status Org',
    subdomain: 'sso-status-org',
  });
  const spy = vi
    .spyOn(db.oidcIdpConfigs, 'findByTenantId')
    .mockImplementation(async (tenantId) =>
      tenantId === org.id ? ({ enforceSso: true } as never) : null
    );

  try {
    const response = await withDeploymentMode('saas', () =>
      saasServer.inject({
        method: 'GET',
        url: '/api/v1/auth/sso-status',
        headers: { host: `${org.subdomain}.bugspotter.io` },
      })
    );

    expect(response.statusCode).toBe(200);
    expect(response.json().data.enforceSso).toBe(true);
    expect(spy).toHaveBeenCalledWith(org.id);
  } finally {
    spy.mockRestore();
  }
});

it('Test J: GET /sso-status resolves enforceSso: false on the hub domain (no host-resolved tenant)', async () => {
  const response = await withDeploymentMode('saas', () =>
    saasServer.inject({
      method: 'GET',
      url: '/api/v1/auth/sso-status',
    })
  );

  expect(response.statusCode).toBe(200);
  expect(response.json().data.enforceSso).toBe(false);
});
```

## Verification

```bash
pnpm --filter @bugspotter/backend typecheck
pnpm --filter @bugspotter/backend test tests/api/auth.test.ts  # needs Docker (testcontainers Postgres)
```

Rollback: revert the `GET /api/v1/auth/sso-status` route and `ssoStatusSchema` in `auth.ts`, and its test blocks in `auth.test.ts`. Purely additive — nothing calls this route yet outside its own tests (#406's frontend method, which will call it, lands separately).
