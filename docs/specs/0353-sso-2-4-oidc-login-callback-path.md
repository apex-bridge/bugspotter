# Spec: SSO 2/4: OIDC login/callback path

Linked issue: Refs #353
ADR: docs/adr/0044-sso-oidc-account-linking-and-tenant-boundary.md

**Files touched:**

- `packages/backend/src/cache/types.ts` — add `getAndDelete` to cache interface
- `packages/backend/src/cache/redis-cache.ts` — implement `getAndDelete` via Redis 7 native `GETDEL`
- `packages/backend/src/cache/memory-cache.ts` — implement `getAndDelete` (get + delete, sufficient for in-process test cache)
- `packages/backend/src/api/services/oidc-service.ts` — new file; IdP discovery + SSRF gating, PKCE/state generation, atomic state consumption
- `packages/backend/src/api/routes/auth-oidc.ts` — new file; route module with `GET /api/v1/auth/oidc/:tenant/login` and `GET /api/v1/auth/oidc/:tenant/callback`, registered by direct function call (matching `authRoutes`), not as a Fastify plugin
- `packages/backend/src/api/server.ts` — call `oidcRoutes(fastify)` alongside the other route-module calls

**Blocking prerequisites:**

- #352 — SSO provider config repository and schema must exist before `auth-oidc.ts` can look up `issuerUrl`, `clientId`, `clientSecret`, and `allowedDomains`

## Problem

BugSpotter has no OIDC login path; organizations relying on enterprise IdPs (Okta, Azure AD, Google Workspace) cannot authenticate employees without a local password. ADR-0044 ratified the cross-tenant account-linking boundary and the SSRF-on-discovered-endpoints requirement; this slice enforces that design at runtime: the `login` redirect to IdP, the `callback` ID-token validation and account-linking, and atomic CSRF-state consumption that defeats replay attacks. SSO-configured tenants that landed #352 have no usable login flow without this slice.

## Out of scope

- Self-hosted mode path (no `:tenant` segment, env-configured IdP) — route structure accommodates it but env-based config lookup is a separate slice.
- Admin UI screens for IdP configuration — separate slice.
- SSO-required enforcement guards (blocking non-SSO login for SSO-mandated tenants) — slice 3/4.
- RP-initiated logout — not in ADR-0044 scope.
- Provider-specific claim normalization beyond `sub`, `email`, `email_verified`, `name`.

## Constraints

1. `openid-client` v5 API throughout — the issue names `Issuer.discover()` but v5 ships a functional API as its primary surface; implementer must verify which surface the installed package version exposes (`Issuer.discover` class-based or `discovery()` functional) and use it consistently throughout `oidc-service.ts` and `auth-oidc.ts`.
2. PKCE `code_challenge_method: 'S256'` on every authorization request; no implicit flow, no bare authorization code grant without a verifier.
3. `email_verified === true` (strict boolean) verified on ID-token claims before any user lookup; if absent or `false`, return 401 immediately without touching the database.
4. CSRF state payload `{ nonce, codeVerifier, redirectUri, tenantId, issuer }` stored in Redis with ≤10-minute TTL and consumed with Redis 7's native `GETDEL` command (single atomic round-trip); a pipeline `GET` + `DEL` is not sufficient — two commands under concurrent requests can both read before either deletes. The callback handler must re-validate the stored `issuer` against the freshly re-discovered `issuer.metadata.issuer` before proceeding (ADR-0044: the state is bound to the issuer, not just checked for existence) — a mismatch fails with the same generic 401.
5. `issuerUrl` from saved config AND both `token_endpoint` and `jwks_uri` from the discovery response each validated with `validateSSRFProtection()` immediately before every connection — not cached as pre-approved after first discovery. Verify the exact export name in `packages/backend/src/integrations/security/ssrf-validator.ts` before use; it is ASSUMED to match the name the issue quotes.
6. `allowed_domains`: fail-closed if the field is absent, null, or empty — reject with 401 before any user lookup. Domain comparison uses `email.split('@')[1]`; enforced on every branch (same-tenant link, cross-tenant reject, new-user create).
7. Account-linking (ADR-0044 Decision 1): email match in same tenant → link (reuse existing user row, no insert); email match in a different tenant → 401 with generic message (must not reveal which tenant owns the address); no match → create user + add membership.
8. Cookie issued in the callback must match the refresh-token cookie in `packages/backend/src/api/routes/auth.ts` exactly — cookie name `refresh_token` (not `refreshToken`), options built via `buildRefreshCookieOptions()` from `packages/backend/src/api/utils/auth-cookies.ts` (`HttpOnly`/`Secure`/`SameSite`/`COOKIE_DOMAIN` all come from that helper). Do not introduce a second cookie format.
9. `getAndDelete` must be added to the exported cache interface in `packages/backend/src/cache/types.ts` (the interface name is `ICacheProvider`) and implemented in both `redis-cache.ts` and `memory-cache.ts` before `oidc-service.ts` compiles.
10. `auth-oidc.ts` must not modify any handler registered under `/api/v1/auth/login` or any existing session/token-refresh path; all additions are new route registrations.

## Acceptance criteria

- [ ] `GET /api/v1/auth/oidc/:tenant/login` responds 302 to the IdP authorization URL, the URL includes `code_challenge_method=S256`, and the state payload is in Redis with TTL ≤600 s — verified by test case A.
- [ ] Callback with valid PKCE exchange, unexpired token, correct `iss`/`aud`/`nonce`, and `email_verified: true` for a known same-tenant member issues a refresh-token cookie matching the `auth.ts` format and responds 302 or 200 — verified by test case B.
- [ ] Callback with a tampered ID-token signature returns 401 — verified by test case C.
- [ ] Callback with an expired ID token returns 401 — verified by test case D.
- [ ] Callback with wrong `iss` returns 401 — verified by test case E.
- [ ] Callback with wrong `aud` returns 401 — verified by test case F.
- [ ] Second callback using the same `state` value returns 401; proves the state row was deleted after first use, not merely checked — verified by test case G.
- [ ] Callback with `email_verified: false` (or absent) returns 401 without any `userRepository` call — verified by test case H.
- [ ] Callback where `allowedDomains` is null/empty returns 401 without any `userRepository` call — verified by test case I.
- [ ] Callback where the email matches a user belonging to a different tenant returns 401 with a generic message — verified by test case J.
- [ ] Callback where the email matches a user with membership in the correct tenant links the account (no new user row) and issues a cookie — verified by test case K.
- [ ] Callback where no existing user matches the email creates a new user + membership and issues a cookie — verified by test case L.
- [ ] Callback where `token_endpoint` from `Issuer.discover()` resolves to an RFC-1918 address (e.g. `http://169.254.169.254/token`) is rejected by `validateSSRFProtection` before the token exchange — verified by test case M.
- [ ] Callback where `jwks_uri` from discovery resolves to an internal host is rejected by `validateSSRFProtection` — verified by test case N.

## Changes

### `packages/backend/src/cache/types.ts`

Add `getAndDelete` to the `ICacheProvider` interface.

`ICacheProvider.get()` is generic (`get<T>(key): Promise<T | null>`) and `RedisCache` handles JSON serialization internally while `MemoryCache` stores the value as-is — `getAndDelete` must follow that same generic shape, not return a raw `string` that callers then `JSON.parse` themselves.

```ts
// Append to ICacheProvider, after the existing `delete` declaration:
getAndDelete<T>(key: string): Promise<T | null>;
```

### `packages/backend/src/cache/redis-cache.ts`

Add `getAndDelete` using the Redis 7 `GETDEL` command, mirroring the existing `get()` method's JSON parsing and error handling. Verify the ioredis method name (`getdel` lowercase) against the installed ioredis version.

```ts
// Append inside the RedisCache class body, after the existing delete method:
async getAndDelete<T>(key: string): Promise<T | null> {
  const redis = await this.getConnection();
  const fullKey = this.buildKey(key);
  const data = await redis.getdel(fullKey);
  if (data === null) return null;
  try {
    return JSON.parse(data) as T;
  } catch (parseError) {
    logger.error('Redis cache JSON parse error', {
      key,
      error: parseError instanceof Error ? parseError.message : 'Unknown error',
    });
    return null;
  }
}
```

### `packages/backend/src/cache/memory-cache.ts`

```ts
// Append inside the MemoryCache class body, after the existing delete method:
async getAndDelete<T>(key: string): Promise<T | null> {
  const value = await this.get<T>(key);
  await this.delete(key);
  return value;
}
```

### `packages/backend/src/api/services/oidc-service.ts`

New file. Owns all IdP interaction logic so the route handler stays thin.

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

export async function consumeOidcState(
  cache: ICacheProvider,
  stateKey: string
): Promise<OidcStatePayload | null> {
  return cache.getAndDelete<OidcStatePayload>(`oidc:state:${stateKey}`);
}

export { generators };
```

### `packages/backend/src/api/routes/auth-oidc.ts`

New file. Route module, not a Fastify plugin — registered by a direct function call from `server.ts` (`oidcRoutes(fastify)`), matching the `authRoutes(fastify, db)` convention this backend uses for every other route module. All sensitive decisions delegated to `oidc-service.ts`.

```ts
// New file — packages/backend/src/api/routes/auth-oidc.ts
import type { FastifyInstance } from 'fastify';
import {
  discoverIssuerValidated,
  storeOidcState,
  consumeOidcState,
  generators,
} from '../services/oidc-service.js';

export function oidcRoutes(fastify: FastifyInstance): void {
  fastify.get<{ Params: { tenant: string } }>(
    '/api/v1/auth/oidc/:tenant/login',
    async (request, reply) => {
      const { tenant } = request.params;
      // ASSUMED: ssoProviderRepository added by #352 — verify container key and method name
      const config = await fastify.container.ssoProviderRepository.findByTenantSlug(tenant);
      if (!config) return reply.code(404).send({ error: 'SSO not configured' });

      // No `fastify.config`/`baseUrl` decoration exists in this codebase — server.ts imports
      // `config` as a plain module, it isn't decorated onto the fastify instance, and there's
      // no config.server.baseUrl field. Build the redirect URI from the incoming request's
      // origin instead, which is also correct per-tenant-subdomain in saas mode. `trustProxy`
      // is already enabled on the Fastify instance (`config.server.trustProxy` in server.ts),
      // so request.protocol/hostname respect X-Forwarded-* headers behind a reverse proxy.
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

  fastify.get<{
    Params: { tenant: string };
    Querystring: { code?: string; state?: string; error?: string };
  }>('/api/v1/auth/oidc/:tenant/callback', async (request, reply) => {
    const { tenant } = request.params;
    const { code, state: stateParam, error: idpError } = request.query;

    if (idpError || !code || !stateParam) {
      return reply.code(401).send({ error: 'Authentication failed' });
    }

    const statePayload = await consumeOidcState(fastify.container.cache, stateParam);
    if (!statePayload) return reply.code(401).send({ error: 'Authentication failed' });

    const config = await fastify.container.ssoProviderRepository.findByTenantSlug(tenant);
    if (!config || config.tenantId !== statePayload.tenantId) {
      return reply.code(401).send({ error: 'Authentication failed' });
    }

    const issuer = await discoverIssuerValidated(config.issuerUrl);
    // Bind the callback to the same IdP the login step discovered (ADR-0044: the CSRF state
    // is bound to the issuer, not just checked for existence). Without this, a tenant's IdP
    // config could change between login and callback and the stored state would still be
    // honored against a different issuer than the one the user actually authenticated with.
    if (issuer.metadata.issuer !== statePayload.issuer) {
      return reply.code(401).send({ error: 'Authentication failed' });
    }
    // ASSUMED: openid-client v5 Client construction — verify v5 API
    const client = new issuer.Client({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      response_types: ['code'],
    });

    // openid-client validates iss/aud/nonce/exp/JWKS signature internally on callback()
    // ASSUMED: verify method name is `callback` in the installed v5 build
    const tokenSet = await client.callback(
      statePayload.redirectUri,
      { code },
      { state: stateParam, nonce: statePayload.nonce, code_verifier: statePayload.codeVerifier }
    );
    const claims = tokenSet.claims();

    if (claims.email_verified !== true)
      return reply.code(401).send({ error: 'Authentication failed' });
    if (!claims.email) return reply.code(401).send({ error: 'Authentication failed' });

    if (!config.allowedDomains?.length)
      return reply.code(401).send({ error: 'Authentication failed' });
    const emailDomain = claims.email.split('@')[1];
    if (!config.allowedDomains.includes(emailDomain)) {
      return reply.code(401).send({ error: 'Authentication failed' });
    }

    // ASSUMED: userRepository / membershipRepository container keys — verify against #352 output
    const existingUser = await fastify.container.userRepository.findByEmail(claims.email);
    if (existingUser) {
      const membership = await fastify.container.membershipRepository.findByUserAndTenant(
        existingUser.id,
        statePayload.tenantId
      );
      if (!membership) return reply.code(401).send({ error: 'Authentication failed' });
      return issueOidcCookie(fastify, reply, existingUser.id, statePayload.tenantId);
    }

    const newUser = await fastify.container.userRepository.createWithOidcProfile({
      email: claims.email,
      sub: claims.sub,
      name: typeof claims.name === 'string' ? claims.name : undefined,
      tenantId: statePayload.tenantId,
    });
    return issueOidcCookie(fastify, reply, newUser.id, statePayload.tenantId);
  });
}

// Cookie must match auth.ts exactly: name `refresh_token`, options built via
// buildRefreshCookieOptions() from packages/backend/src/api/utils/auth-cookies.ts.
// Do not introduce a new cookie name, flag set, or COOKIE_DOMAIN behavior — reuse the helper.
async function issueOidcCookie(
  _fastify: unknown,
  _reply: unknown,
  _userId: string,
  _tenantId: string
) {
  throw new Error(
    'Placeholder — implement by calling buildRefreshCookieOptions() and setting refresh_token'
  );
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

**Mock/fixture updates required:**

`openid-client` is an ES module with a named export for `Issuer`; `vi.mock` must appear at top level (not inside a `describe`). The mock `Issuer.discover` must return an object shaped like an `Issuer` with a `Client` constructor and `metadata`; missing `metadata.token_endpoint` or `jwks_uri` will cause the validation path to throw rather than fail cleanly.

The container mock must include `ssoProviderRepository`, `cache` (with `getAndDelete`), `userRepository`, and `membershipRepository`. If a `createMockContainer()` helper exists in the test suite, add those four keys there explicitly — missing keys cause TypeErrors at runtime, not TypeScript errors.

```ts
// Top-level vi.mock calls (must be outside describe blocks):
vi.mock('openid-client', () => {
  const mockCallbackFn = vi.fn();
  const mockAuthorizationUrlFn = vi.fn().mockReturnValue('https://idp.example.com/auth?state=s1');
  const MockClient = vi.fn().mockImplementation(() => ({
    authorizationUrl: mockAuthorizationUrlFn,
    callback: mockCallbackFn,
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
  getAndDelete: vi.fn(),
};

const mockSsoProviderRepository = {
  findByTenantSlug: vi.fn(),
};

const mockUserRepository = {
  findByEmail: vi.fn(),
  createWithOidcProfile: vi.fn(),
};

const mockMembershipRepository = {
  findByUserAndTenant: vi.fn(),
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

**Test case B — happy path callback issues refresh-token cookie (AC #2):**

```ts
it('valid callback with email_verified:true for same-tenant member issues cookie', async () => {
  const payload = {
    nonce: 'mock-nonce',
    codeVerifier: 'mock-verifier',
    redirectUri: 'http://app/cb',
    tenantId: 'tenant-abc',
    issuer: 'https://idp.example.com',
  };
  mockCache.getAndDelete.mockResolvedValue(payload);
  mockSsoProviderRepository.findByTenantSlug.mockResolvedValue({
    issuerUrl: 'https://idp.example.com',
    clientId: 'c',
    clientSecret: 's',
    tenantId: 'tenant-abc',
    allowedDomains: ['corp.example.com'],
  });
  vi.mocked(require('openid-client').Issuer.discover).mockResolvedValue({
    ...mockIssuer,
    Client: MockClientReturningClaims({
      email: 'alice@corp.example.com',
      email_verified: true,
      sub: 'sub-1',
    }),
  });
  mockUserRepository.findByEmail.mockResolvedValue({ id: 'user-1' });
  mockMembershipRepository.findByUserAndTenant.mockResolvedValue({ id: 'mem-1' });

  const res = await fastify.inject({
    method: 'GET',
    url: '/api/v1/auth/oidc/acme/callback?code=c&state=s',
  });

  expect(res.statusCode).toBeLessThan(400);
  expect(res.headers['set-cookie']).toMatch(/refresh_token=/);
});
```

**Test case C — tampered signature rejected (AC #3):**

```ts
it('returns 401 when openid-client throws on bad signature', async () => {
  mockCache.getAndDelete.mockResolvedValue(validPayload);
  mockSsoProviderRepository.findByTenantSlug.mockResolvedValue(validConfig);
  vi.mocked(MockClientInstance.callback).mockRejectedValue(
    new Error('JWSSignatureVerificationFailed')
  );

  const res = await fastify.inject({
    method: 'GET',
    url: '/api/v1/auth/oidc/acme/callback?code=c&state=s',
  });

  expect(res.statusCode).toBe(401);
});
```

**Test case G — replayed state rejected, proves atomic consumption (AC #7):**

```ts
it('returns 401 on second use of the same state (state consumed after first callback)', async () => {
  // First call: state is present
  mockCache.getAndDelete.mockResolvedValueOnce(validPayload).mockResolvedValueOnce(null); // second call: already deleted

  mockSsoProviderRepository.findByTenantSlug.mockResolvedValue(validConfig);
  vi.mocked(MockClientInstance.callback).mockResolvedValue(validTokenSet);
  mockUserRepository.findByEmail.mockResolvedValue({ id: 'user-1' });
  mockMembershipRepository.findByUserAndTenant.mockResolvedValue({ id: 'mem-1' });

  const first = await fastify.inject({
    method: 'GET',
    url: '/api/v1/auth/oidc/acme/callback?code=c&state=s',
  });
  const second = await fastify.inject({
    method: 'GET',
    url: '/api/v1/auth/oidc/acme/callback?code=c&state=s',
  });

  expect(first.statusCode).toBeLessThan(400);
  expect(second.statusCode).toBe(401);
  expect(mockCache.getAndDelete).toHaveBeenCalledTimes(2);
});
```

**Test case J — cross-tenant match rejected (AC #10):**

```ts
it('returns 401 when email matches a user who has no membership in the requested tenant', async () => {
  mockCache.getAndDelete.mockResolvedValue({ ...validPayload, tenantId: 'tenant-abc' });
  mockSsoProviderRepository.findByTenantSlug.mockResolvedValue({
    ...validConfig,
    tenantId: 'tenant-abc',
  });
  vi.mocked(MockClientInstance.callback).mockResolvedValue(validTokenSet); // email: alice@corp.example.com
  mockUserRepository.findByEmail.mockResolvedValue({ id: 'user-1' });
  mockMembershipRepository.findByUserAndTenant.mockResolvedValue(null); // not a member of this tenant

  const res = await fastify.inject({
    method: 'GET',
    url: '/api/v1/auth/oidc/acme/callback?code=c&state=s',
  });

  expect(res.statusCode).toBe(401);
  expect(JSON.parse(res.body).error).toBe('Authentication failed');
  // Must not expose which tenant the user belongs to
});
```

**Test case I — `allowed_domains` fail-closed (AC #9):**

```ts
it('returns 401 before any user lookup when allowedDomains is empty', async () => {
  mockCache.getAndDelete.mockResolvedValue(validPayload);
  mockSsoProviderRepository.findByTenantSlug.mockResolvedValue({
    ...validConfig,
    allowedDomains: [],
  });
  vi.mocked(MockClientInstance.callback).mockResolvedValue(validTokenSet);

  const res = await fastify.inject({
    method: 'GET',
    url: '/api/v1/auth/oidc/acme/callback?code=c&state=s',
  });

  expect(res.statusCode).toBe(401);
  expect(mockUserRepository.findByEmail).not.toHaveBeenCalled();
});
```

**Test case M — SSRF rejection on internal `token_endpoint` (AC #13):**

```ts
it('rejects when discovered token_endpoint resolves to an internal address', async () => {
  const { validateSSRFProtection } = await import(
    '../../src/integrations/security/ssrf-validator.js'
  );
  vi.mocked(validateSSRFProtection)
    .mockReturnValueOnce(new URL('https://idp.example.com')) // issuerUrl passes
    .mockImplementationOnce(() => {
      throw new Error('SSRF: private address');
    }); // token_endpoint fails

  mockCache.getAndDelete.mockResolvedValue(validPayload);
  mockSsoProviderRepository.findByTenantSlug.mockResolvedValue(validConfig);

  const res = await fastify.inject({
    method: 'GET',
    url: '/api/v1/auth/oidc/acme/callback?code=c&state=s',
  });

  expect(res.statusCode).toBe(401);
  expect(MockClientInstance.callback).not.toHaveBeenCalled();
});
```

## Verification

```bash
pnpm --filter @bugspotter/backend typecheck
pnpm --filter @bugspotter/backend test:unit -- --reporter=verbose tests/api/auth-oidc.test.ts
pnpm --filter @bugspotter/backend test:unit -- --reporter=verbose tests/cache/
```

Rollback: the new routes (`/api/v1/auth/oidc/:tenant/login` and `/api/v1/auth/oidc/:tenant/callback`) are purely additive; removing the `oidcRoutes(fastify)` call in `packages/backend/src/api/server.ts` fully restores current behavior. The `getAndDelete` addition to the cache interface and implementations is also additive. No data migration beyond #352's schema, which has its own rollback path.
