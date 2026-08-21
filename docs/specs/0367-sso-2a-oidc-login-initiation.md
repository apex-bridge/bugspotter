# Spec: SSO 2a/4: OIDC login initiation

Linked issue: Refs #367
ADR: docs/adr/0044-sso-oidc-account-linking-and-tenant-boundary.md

**Files touched:**

- `packages/backend/src/api/services/oidc-service.ts` — new file; IdP discovery + SSRF gating, PKCE/state generation, state storage
- `packages/backend/src/api/routes/auth-oidc.ts` — new file; route module with `GET /api/v1/auth/oidc/:tenantId/login`, registered by direct function call (matching `authRoutes`), not as a Fastify plugin
- `packages/backend/tests/api/auth-oidc.test.ts` — new file; test case A/B below

**Out of scope, follow-up after this merges:** wiring `oidcRoutes(fastify)` into `packages/backend/src/api/server.ts` — a single import + one function call, but it can only be written once this slice's `auth-oidc.ts` actually exists to import from, so it's a small hand-implemented follow-up immediately after this lands, not part of this slice's own scope.

**Blocking prerequisites:**

- #352 — `OidcIdpConfigRepository` and its schema must exist (they do)
- **DI wiring already landed** (2026-08-20, hand-implemented outside the pipeline): `oidcIdpConfigs: OidcIdpConfigRepository` is now in `RepositoryRegistry`/`createRepositories()` (`factory.ts`) and `DatabaseClient` (`client.ts`) — `fastify.container.db.oidcIdpConfigs` is real and usable.
- **`openid-client` v5 already installed** (2026-08-20, hand-implemented outside the pipeline): `packages/backend/package.json`/`pnpm-lock.yaml` now carry `openid-client@5.7.1` (`pnpm --filter @bugspotter/backend add openid-client@^5`), typecheck confirmed clean.
- **Why hand-implemented, twice:** this slice's declared file count reached 7 during review fixes (DI wiring + the missing dependency), over `generate-impl.mjs`'s own hard "do not generate more than 6 files" instruction. The first impl-agent run silently dropped 5 of 7 files rather than erroring; reducing to 5 (removing the already-landed DI wiring) still dropped 2 of 5 on the second run (`package.json`, `server.ts` — always the smallest/most mechanical entries, core logic written correctly both times). Reduced further to exactly 3 files - the core logic the model has now proven it writes reliably - by hand-landing both remaining mechanical pieces (this dependency add, and moving `server.ts`'s wiring to a post-merge follow-up) rather than gambling on a third full retry.

## Problem

Split off #353 as its smaller, lower-risk half (see #367 for why). BugSpotter has no OIDC login path; organizations relying on enterprise IdPs (Okta, Azure AD, Google Workspace) cannot authenticate employees without a local password. This slice implements the login-initiation endpoint: IdP discovery, PKCE code-challenge generation, and CSRF-state storage, per ADR-0044. The callback (token exchange, ID-token validation, account-linking, cookie issuance) is #368, a separate slice.

**Corrected during review (PR #369):** the original monolithic #353 spec this was split from assumed a `fastify.container.ssoProviderRepository` with a `findByTenantSlug()` method and a `fastify.container.cache` — neither exists. `OidcIdpConfigRepository` (real, from #352) exposes `findByTenantId(tenantId)`, not a slug lookup — this codebase has no tenant-slug concept anywhere (grepped, zero hits). And there is no `cache` on `IServiceContainer` at all; the actual pattern this codebase uses is the `getCacheService()` singleton from `src/cache/index.ts`, imported directly where needed, not injected via the container. Both corrected below and reflected in the route path (`:tenantId`, not `:tenant`).

## Out of scope

- The callback endpoint (`GET /api/v1/auth/oidc/:tenantId/callback`) and everything downstream of it — #368.
- `getAndDelete` on `CacheService`/`ICacheProvider` — not needed by login initiation (only `set`), added in #368 where it's actually consumed.
- Self-hosted mode path (no `:tenantId` segment, env-configured IdP) — route structure accommodates it but env-based config lookup is a separate slice.
- Admin UI screens for IdP configuration — separate slice.
- SSO-required enforcement guards — slice 3/4 (#354).

## Constraints

1. `openid-client@5.7.1` is now installed (see "Blocking prerequisites" above) — verified against the installed version: it exposes the class-based v5 API (`Issuer.discover`, `issuer.Client`, `generators.codeVerifier`, `generators.codeChallenge` are all functions), not the v6 functional API (`discovery()`, `randomPKCECodeVerifier()`, which 5.7.1 does not export). Use `Issuer.discover`, `issuer.Client`, and `generators.*` consistently as shown below.
2. PKCE `code_challenge_method: 'S256'` on every authorization request; no implicit flow, no bare authorization code grant without a verifier.
3. `issuerUrl` from saved config AND both `token_endpoint` and `jwks_uri` from the discovery response each validated with `validateSSRFProtection()` immediately before every connection — not cached as pre-approved after first discovery. Verify the exact export name in `packages/backend/src/integrations/security/ssrf-validator.ts` before use; it is ASSUMED to match the name this constraint quotes.
4. CSRF state payload `{ nonce, codeVerifier, redirectUri, tenantId, issuer }` stored via `getCacheService().set()` with ≤10-minute TTL — no new cache method needed for this slice (atomic consumption via `getAndDelete` is #368's concern, added to `CacheService` there).
5. No `fastify.config`/`baseUrl` decoration exists in this codebase — build the redirect URI from the incoming request's origin (`request.protocol`/`request.hostname`), not a config field. `trustProxy` is already enabled on the Fastify instance, so this respects `X-Forwarded-*` headers behind a reverse proxy.
6. `auth-oidc.ts` must not modify any handler registered under `/api/v1/auth/login` or any existing session/token-refresh path; all additions are new route registrations.
7. `oidc-service.ts` must export `discoverIssuerValidated`, `storeOidcState`, and `generators` in a shape #368 can import and extend without modifying this slice's exports (`consumeOidcState` is added by #368, not this slice).
8. `OidcIdpConfigRepository.findByTenantId(tenantId)` takes the tenant/organization id directly — the route param is `:tenantId`, not a slug. Verify against `packages/backend/src/db/repositories/oidc-idp-config.repository.ts` before use (confirmed present at time of writing: `async findByTenantId(tenantId: string): Promise<OidcIdpConfig | null>`).

## Acceptance criteria

- [ ] `GET /api/v1/auth/oidc/:tenantId/login` responds 302 to the IdP authorization URL, the URL includes `code_challenge_method=S256`, and the state payload is retrievable via `getCacheService().get()` with TTL ≤600s — verified by test case A.
- [ ] `GET /api/v1/auth/oidc/:tenantId/login` for an unconfigured tenant responds 404 without calling `validateSSRFProtection` — verified by test case B.

## Changes

`openid-client` is already installed and `oidcIdpConfigs` is already real on `fastify.container.db` — see "Blocking prerequisites" above. No changes needed to `package.json`/`pnpm-lock.yaml`/`factory.ts`/`client.ts` in this slice.

### `packages/backend/src/api/services/oidc-service.ts`

New file. Owns IdP interaction logic so the route handler stays thin. `consumeOidcState` is intentionally NOT included here — #368 adds it once `CacheService.getAndDelete` exists. Cache access goes through the `getCacheService()` singleton, matching this codebase's actual pattern (`src/cache/index.ts`) — not threaded through `fastify.container`, which has no `cache` property.

```ts
// New file — packages/backend/src/api/services/oidc-service.ts
// openid-client@5.7.1 exposes the class-based v5 API (Issuer.discover, issuer.Client,
// generators.*), not the v6 functional API (discovery(), randomPKCECodeVerifier()) —
// verified against the installed version.
import { Issuer, generators } from 'openid-client';
// validateSSRFProtection is a synchronous function returning URL (throws on blocked addresses)
import { validateSSRFProtection } from '../../integrations/security/ssrf-validator.js';
import { getCacheService } from '../../cache/index.js';

const STATE_TTL_SECONDS = 600;

export interface OidcStatePayload {
  nonce: string;
  codeVerifier: string;
  redirectUri: string;
  tenantId: string;
  issuer: string;
}

export async function discoverIssuerValidated(issuerUrl: string) {
  validateSSRFProtection(issuerUrl);
  const issuer = await Issuer.discover(issuerUrl);
  if (!issuer.metadata.token_endpoint || !issuer.metadata.jwks_uri) {
    throw new Error('IdP discovery response missing required endpoints');
  }
  validateSSRFProtection(issuer.metadata.token_endpoint);
  validateSSRFProtection(issuer.metadata.jwks_uri);
  return issuer;
}

export async function storeOidcState(stateKey: string, payload: OidcStatePayload): Promise<void> {
  await getCacheService().set(`oidc:state:${stateKey}`, payload, STATE_TTL_SECONDS);
}

export { generators };
```

### `packages/backend/src/api/routes/auth-oidc.ts`

New file. Route module, not a Fastify plugin — registered by a direct function call from `server.ts` (`oidcRoutes(fastify)`), matching the `authRoutes(fastify, db)` convention this backend uses for every other route module. Only the `login` handler in this slice — #368 appends the `callback` handler to this same file. Repository access is `fastify.container.db.oidcIdpConfigs`, matching `DatabaseClient implements RepositoryRegistry`.

```ts
// New file — packages/backend/src/api/routes/auth-oidc.ts
import type { FastifyInstance } from 'fastify';
import { discoverIssuerValidated, storeOidcState, generators } from '../services/oidc-service.js';

export function oidcRoutes(fastify: FastifyInstance): void {
  fastify.get<{ Params: { tenantId: string } }>(
    '/api/v1/auth/oidc/:tenantId/login',
    async (request, reply) => {
      const { tenantId } = request.params;
      const config = await fastify.container.db.oidcIdpConfigs.findByTenantId(tenantId);
      if (!config) return reply.code(404).send({ error: 'SSO not configured' });

      const redirectUri = `${request.protocol}://${request.hostname}/api/v1/auth/oidc/${tenantId}/callback`;
      const issuer = await discoverIssuerValidated(config.issuerUrl);

      // Verified against openid-client@5.7.1: class-based construction, not the v6 functional API.
      const client = new issuer.Client({ client_id: config.clientId, response_types: ['code'] });
      const state = generators.state();
      const nonce = generators.nonce();
      const codeVerifier = generators.codeVerifier();
      const codeChallenge = generators.codeChallenge(codeVerifier);

      const authUrl = client.authorizationUrl({
        scope: 'openid email profile',
        state,
        nonce,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        redirect_uri: redirectUri,
      });

      await storeOidcState(state, {
        nonce,
        codeVerifier,
        redirectUri,
        tenantId,
        issuer: issuer.metadata.issuer,
      });

      return reply.redirect(authUrl);
    }
  );

  // #368 appends the callback handler here, inside this same oidcRoutes() function.
}
```

`server.ts` wiring is out of scope for this slice — see "Out of scope, follow-up after this merges" above. Once this merges, `oidcRoutes(fastify)` gets called alongside the other route-module calls (e.g. next to `authRoutes(fastify, db)`), not via `fastify.register(...)` — this backend wires its own route modules by direct function call, reserving `fastify.register` for actual Fastify plugins (`@fastify/cors`, `@fastify/jwt`, etc.).

## Tests

### `packages/backend/tests/api/auth-oidc.test.ts`

New file — #368 extends it with callback test cases.

**Test harness — do NOT use `createServer()`.** `server.ts` wiring is out of scope for this slice (see above), so this file must build its own minimal Fastify instance and register `oidcRoutes` directly — the same pattern `tests/api/routes/signup.route.test.ts` already uses (`Fastify()`, register only the plugins actually needed, call the route module function directly, `fastify.decorate('container', mockContainer)` to satisfy `fastify.container.db.oidcIdpConfigs`, matching how `server.ts` itself does `fastify.decorate('container', container)`).

```ts
import Fastify, { type FastifyInstance } from 'fastify';
import { oidcRoutes } from '../../../src/api/routes/auth-oidc.js';

async function buildServer(): Promise<FastifyInstance> {
  const server = Fastify();
  server.decorate('container', {
    db: { oidcIdpConfigs: mockOidcIdpConfigs },
  });
  oidcRoutes(server);
  await server.ready();
  return server;
}
```

**Mock/fixture updates required:**

`openid-client` is an ES module with a named export for `Issuer`; `vi.mock` must appear at top level (not inside a `describe`). The mock `Issuer.discover` must return an object shaped like an `Issuer` with a `Client` constructor and `metadata`.

`getCacheService` (from `../../src/cache/index.js`) must be mocked at top level too, returning an object with `get`/`set` mocks — it is a singleton factory, not something injected via the container, so the test cannot substitute it through `fastify.container`.

The container mock needs `db.oidcIdpConfigs` with a `findByTenantId` mock (not `ssoProviderRepository`/`findByTenantSlug`).

`vi.mock` factories are hoisted above module-scope `const` declarations, so any mock referenced inside a factory (`mockAuthorizationUrlFn`, `MockClient`, `mockCacheService`) must be defined via `vi.hoisted()` first, not a plain top-level `const` — referencing a plain `const` from inside a hoisted factory hits the temporal dead zone and throws `ReferenceError` at import time. This codebase already uses `vi.hoisted` for exactly this reason elsewhere (`tests/api/routes/signup.route.test.ts`).

```ts
// Top-level, using vi.hoisted so these are available inside the hoisted vi.mock factories below
// (a plain `const` here would hit the TDZ — vi.mock is hoisted above it):
const { mockAuthorizationUrlFn, mockCacheService } = vi.hoisted(() => ({
  mockAuthorizationUrlFn: vi.fn(),
  mockCacheService: { get: vi.fn(), set: vi.fn().mockResolvedValue(undefined) },
}));

// Top-level vi.mock calls (must be outside describe blocks):
vi.mock('openid-client', () => {
  const MockClient = vi.fn().mockImplementation(() => ({
    authorizationUrl: mockAuthorizationUrlFn,
  }));
  const mockIssuer = {
    metadata: {
      issuer: 'https://idp.example.com',
      token_endpoint: 'https://idp.example.com/token',
      jwks_uri: 'https://idp.example.com/jwks',
    },
    Client: MockClient,
  };
  return {
    Issuer: { discover: vi.fn().mockResolvedValue(mockIssuer) },
    generators: {
      state: vi.fn().mockReturnValue('mock-state'),
      nonce: vi.fn().mockReturnValue('mock-nonce'),
      codeVerifier: vi.fn().mockReturnValue('mock-verifier'),
      codeChallenge: vi.fn().mockReturnValue('mock-challenge'),
    },
  };
});

vi.mock('../../src/integrations/security/ssrf-validator.js', () => ({
  validateSSRFProtection: vi.fn().mockReturnValue(new URL('https://idp.example.com')),
}));

vi.mock('../../src/cache/index.js', () => ({
  getCacheService: vi.fn(() => mockCacheService),
}));
```

```ts
// Inside beforeEach, since mockAuthorizationUrlFn is now a real vi.fn() shared across tests
// via vi.hoisted (not recreated per-test the way the old closure-scoped version was) — give
// it a fixed, harmless return value; the route only ever reads the resulting redirect target,
// individual tests assert on the CALL arguments (what the route passed in), not on this
// return value's content, since a canned string can't reflect per-call params like the real
// openid-client library's own encoding would:
mockAuthorizationUrlFn.mockReturnValue('https://idp.example.com/auth?mock=1');
```

```ts
// Module scope: buildServer() (defined above) reads mockOidcIdpConfigs by closure.
const mockOidcIdpConfigs = {
  findByTenantId: vi.fn(),
};

describe('OIDC login initiation', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    server = await buildServer();
  });

  afterEach(async () => {
    await server.close();
  });

  // test cases below go inside this describe block
});
```

**Test case A — login redirects with S256 PKCE and stores state (AC #1):**

```ts
it('redirects to IdP with S256 PKCE challenge and stores state in cache', async () => {
  mockOidcIdpConfigs.findByTenantId.mockResolvedValue({
    issuerUrl: 'https://idp.example.com',
    clientId: 'client-1',
    allowedDomains: ['corp.example.com'],
  });

  const res = await server.inject({
    method: 'GET',
    url: '/api/v1/auth/oidc/tenant-abc/login',
  });

  expect(res.statusCode).toBe(302);
  // Assert on what the route PASSED to authorizationUrl(), not on the mock's return value's
  // content — mockAuthorizationUrlFn returns a fixed canned string regardless of its call
  // arguments, so checking the redirect Location for query params only proves the mock
  // string contains them, not that the route actually requested S256/this state.
  expect(mockAuthorizationUrlFn).toHaveBeenCalledWith(
    expect.objectContaining({ code_challenge_method: 'S256', state: 'mock-state' })
  );
  expect(mockCacheService.set).toHaveBeenCalledWith(
    'oidc:state:mock-state',
    expect.objectContaining({ nonce: 'mock-nonce', tenantId: 'tenant-abc' }),
    600
  );
});
```

**Test case B — unconfigured tenant returns 404 (AC #2):**

```ts
it('returns 404 for a tenant with no SSO configuration, without touching SSRF validation', async () => {
  mockOidcIdpConfigs.findByTenantId.mockResolvedValue(null);

  const res = await server.inject({
    method: 'GET',
    url: '/api/v1/auth/oidc/unknown-tenant/login',
  });

  expect(res.statusCode).toBe(404);
  const { validateSSRFProtection } = await import(
    '../../src/integrations/security/ssrf-validator.js'
  );
  expect(validateSSRFProtection).not.toHaveBeenCalled();
});
```

## Verification

```bash
pnpm --filter @bugspotter/backend typecheck
pnpm --filter @bugspotter/backend test:unit -- --reporter=verbose tests/api/auth-oidc.test.ts
```

Rollback: the route file, service file, and server.ts wiring are purely additive — removing the `oidcRoutes(fastify)` call in `packages/backend/src/api/server.ts` fully restores current behavior. The `factory.ts`/`client.ts` DI-wiring addition is also additive (a new registry entry pointing at an already-existing, already-migrated repository class) and safe to leave in place even if the route wiring is reverted.
