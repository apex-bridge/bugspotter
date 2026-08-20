# Spec: SSO 2a/4: OIDC login initiation

Linked issue: Refs #367
ADR: docs/adr/0044-sso-oidc-account-linking-and-tenant-boundary.md

**Files touched:**

- `packages/backend/src/api/services/oidc-service.ts` — new file; IdP discovery + SSRF gating, PKCE/state generation, state storage
- `packages/backend/src/api/routes/auth-oidc.ts` — new file; route module with `GET /api/v1/auth/oidc/:tenant/login`, registered by direct function call (matching `authRoutes`), not as a Fastify plugin
- `packages/backend/src/api/server.ts` — call `oidcRoutes(fastify)` alongside the other route-module calls

**Blocking prerequisites:**

- #352 — SSO provider config repository and schema must exist before `auth-oidc.ts` can look up `issuerUrl`, `clientId`, and `allowedDomains`

## Problem

Split off #353 as its smaller, lower-risk half (see #367 for why). BugSpotter has no OIDC login path; organizations relying on enterprise IdPs (Okta, Azure AD, Google Workspace) cannot authenticate employees without a local password. This slice implements the login-initiation endpoint: IdP discovery, PKCE code-challenge generation, and CSRF-state storage, per ADR-0044. The callback (token exchange, ID-token validation, account-linking, cookie issuance) is #368, a separate slice.

## Out of scope

- The callback endpoint (`GET /api/v1/auth/oidc/:tenant/callback`) and everything downstream of it — #368.
- `getAndDelete` on the cache interface — not needed by login initiation (only `set`), added in #368 where it's actually consumed.
- Self-hosted mode path (no `:tenant` segment, env-configured IdP) — route structure accommodates it but env-based config lookup is a separate slice.
- Admin UI screens for IdP configuration — separate slice.
- SSO-required enforcement guards — slice 3/4 (#354).

## Constraints

1. `openid-client` v5 API throughout — the issue names `Issuer.discover()` but v5 ships a functional API as its primary surface; implementer must verify which surface the installed package version exposes (`Issuer.discover` class-based or `discovery()` functional) and use it consistently.
2. PKCE `code_challenge_method: 'S256'` on every authorization request; no implicit flow, no bare authorization code grant without a verifier.
3. `issuerUrl` from saved config AND both `token_endpoint` and `jwks_uri` from the discovery response each validated with `validateSSRFProtection()` immediately before every connection — not cached as pre-approved after first discovery. Verify the exact export name in `packages/backend/src/integrations/security/ssrf-validator.ts` before use; it is ASSUMED to match the name this constraint quotes.
4. CSRF state payload `{ nonce, codeVerifier, redirectUri, tenantId, issuer }` stored in Redis with ≤10-minute TTL via the existing `ICacheProvider.set()` — no new cache method needed for this slice (consumption via `getAndDelete` is #368's concern).
5. No `fastify.config`/`baseUrl` decoration exists in this codebase — build the redirect URI from the incoming request's origin (`request.protocol`/`request.hostname`), not a config field. `trustProxy` is already enabled on the Fastify instance, so this respects `X-Forwarded-*` headers behind a reverse proxy.
6. `auth-oidc.ts` must not modify any handler registered under `/api/v1/auth/login` or any existing session/token-refresh path; all additions are new route registrations.
7. `oidc-service.ts` must export `discoverIssuerValidated`, `storeOidcState`, and `generators` in a shape #368 can import and extend without modifying this slice's exports (`consumeOidcState` is added by #368, not this slice).

## Acceptance criteria

- [ ] `GET /api/v1/auth/oidc/:tenant/login` responds 302 to the IdP authorization URL, the URL includes `code_challenge_method=S256`, and the state payload is in Redis with TTL ≤600s — verified by test case A.
- [ ] `GET /api/v1/auth/oidc/:tenant/login` for an unconfigured tenant responds 404 without calling `validateSSRFProtection` — verified by test case B.

## Changes

### `packages/backend/src/api/services/oidc-service.ts`

New file. Owns IdP interaction logic so the route handler stays thin. `consumeOidcState` is intentionally NOT included here — #368 adds it once `ICacheProvider.getAndDelete` exists.

```ts
// New file — packages/backend/src/api/services/oidc-service.ts
// IMPORTANT: verify the openid-client v5 import surface before finalizing these imports.
// If the package exposes a functional API (discovery(), randomPKCECodeVerifier(), etc.)
// rather than the class-based Issuer.discover(), rewrite discoverIssuerValidated accordingly.
import { Issuer, generators } from 'openid-client';
// validateSSRFProtection is a synchronous function returning URL (throws on blocked addresses)
import { validateSSRFProtection } from '../../integrations/security/ssrf-validator.js';
import type { ICacheProvider } from '../../cache/types.js';

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

export async function storeOidcState(
  cache: ICacheProvider,
  stateKey: string,
  payload: OidcStatePayload
): Promise<void> {
  await cache.set(`oidc:state:${stateKey}`, payload, STATE_TTL_SECONDS);
}

export { generators };
```

### `packages/backend/src/api/routes/auth-oidc.ts`

New file. Route module, not a Fastify plugin — registered by a direct function call from `server.ts` (`oidcRoutes(fastify)`), matching the `authRoutes(fastify, db)` convention this backend uses for every other route module. Only the `login` handler in this slice — #368 appends the `callback` handler to this same file.

```ts
// New file — packages/backend/src/api/routes/auth-oidc.ts
import type { FastifyInstance } from 'fastify';
import { discoverIssuerValidated, storeOidcState, generators } from '../services/oidc-service.js';

export function oidcRoutes(fastify: FastifyInstance): void {
  fastify.get<{ Params: { tenant: string } }>(
    '/api/v1/auth/oidc/:tenant/login',
    async (request, reply) => {
      const { tenant } = request.params;
      // ASSUMED: ssoProviderRepository added by #352 — verify container key and method name
      const config = await fastify.container.ssoProviderRepository.findByTenantSlug(tenant);
      if (!config) return reply.code(404).send({ error: 'SSO not configured' });

      const redirectUri = `${request.protocol}://${request.hostname}/api/v1/auth/oidc/${tenant}/callback`;
      const issuer = await discoverIssuerValidated(config.issuerUrl);

      // ASSUMED: openid-client v5 Client construction — verify v5 class vs functional API
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

      await storeOidcState(fastify.container.cache, state, {
        nonce,
        codeVerifier,
        redirectUri,
        tenantId: config.tenantId,
        issuer: issuer.metadata.issuer,
      });

      return reply.redirect(authUrl);
    }
  );

  // #368 appends the callback handler here, inside this same oidcRoutes() function.
}
```

### `packages/backend/src/api/server.ts`

Call `oidcRoutes(fastify)` alongside the other route-module calls (e.g. next to `authRoutes(fastify, db)`), not via `fastify.register(...)` — this backend wires its own route modules by direct function call, reserving `fastify.register` for actual Fastify plugins (`@fastify/cors`, `@fastify/jwt`, etc.).

```ts
// Append after the existing authRoutes(fastify, db) call (verify insertion point):
import { oidcRoutes } from './routes/auth-oidc.js';
// ...
oidcRoutes(fastify);
```

## Tests

### `packages/backend/tests/api/auth-oidc.test.ts`

New file — #368 extends it with callback test cases.

**Mock/fixture updates required:**

`openid-client` is an ES module with a named export for `Issuer`; `vi.mock` must appear at top level (not inside a `describe`). The mock `Issuer.discover` must return an object shaped like an `Issuer` with a `Client` constructor and `metadata`.

The container mock must include `ssoProviderRepository` and `cache` (with `set`). If a `createMockContainer()` helper exists in the test suite, add those keys there explicitly — missing keys cause TypeErrors at runtime, not TypeScript errors.

```ts
// Top-level vi.mock calls (must be outside describe blocks):
vi.mock('openid-client', () => {
  const mockAuthorizationUrlFn = vi.fn().mockReturnValue('https://idp.example.com/auth?state=s1');
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
```

```ts
// Shared fixture setup inside beforeEach:
const mockCache = {
  get: vi.fn(),
  set: vi.fn().mockResolvedValue(undefined),
  delete: vi.fn().mockResolvedValue(undefined),
};

const mockSsoProviderRepository = {
  findByTenantSlug: vi.fn(),
};
```

**Test case A — login redirects with S256 PKCE and stores state (AC #1):**

```ts
it('redirects to IdP with S256 PKCE challenge and stores state in cache', async () => {
  mockSsoProviderRepository.findByTenantSlug.mockResolvedValue({
    issuerUrl: 'https://idp.example.com',
    clientId: 'client-1',
    tenantId: 'tenant-abc',
    allowedDomains: ['corp.example.com'],
  });

  const res = await fastify.inject({
    method: 'GET',
    url: '/api/v1/auth/oidc/acme/login',
  });

  expect(res.statusCode).toBe(302);
  expect(res.headers.location).toContain('code_challenge_method=S256');
  expect(mockCache.set).toHaveBeenCalledWith(
    'oidc:state:mock-state',
    expect.objectContaining({ nonce: 'mock-nonce' }),
    600
  );
});
```

**Test case B — unconfigured tenant returns 404 (AC #2):**

```ts
it('returns 404 for a tenant with no SSO configuration, without touching SSRF validation', async () => {
  mockSsoProviderRepository.findByTenantSlug.mockResolvedValue(null);

  const res = await fastify.inject({
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

Rollback: purely additive (a new route file + one new route-module wiring call in `server.ts`). Removing the `oidcRoutes(fastify)` call in `packages/backend/src/api/server.ts` fully restores current behavior.
