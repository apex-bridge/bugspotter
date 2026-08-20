# Spec: SSO 2b/4: OIDC callback, account-linking, and session issuance

Linked issue: Refs #368
ADR: docs/adr/0044-sso-oidc-account-linking-and-tenant-boundary.md

**Files touched:**

- `packages/backend/src/cache/types.ts` — add `getAndDelete` to cache interface
- `packages/backend/src/cache/redis-cache.ts` — implement `getAndDelete` via Redis 7 native `GETDEL`
- `packages/backend/src/cache/memory-cache.ts` — implement `getAndDelete` (get + delete, sufficient for in-process test cache)
- `packages/backend/src/api/services/oidc-service.ts` — edit; add `consumeOidcState`
- `packages/backend/src/api/routes/auth-oidc.ts` — edit; add `GET /api/v1/auth/oidc/:tenant/callback` handler to the `oidcRoutes()` function #367 created

**Blocking prerequisites:**

- #367 — creates `oidc-service.ts` and `auth-oidc.ts` (with the `login` handler and `oidcRoutes()` shell) that this slice extends. Must merge and be implemented first.

## Problem

Split off #353 as its larger, security-critical half (see #367 for why the split happened, and #367's own spec for the login-initiation half this depends on). This slice implements the callback endpoint: atomic CSRF-state consumption, ID-token validation, tenant-scoped account-linking (ADR-0044 Decision 1 — the fix for a real cross-tenant account-takeover path: `users.email` is globally unique but `oidc_idp_config` is per-tenant, so a naive email match could let one tenant's IdP assert an email belonging to a different tenant's user), and refresh-token cookie issuance.

## Out of scope

- The login-initiation endpoint (`GET /api/v1/auth/oidc/:tenant/login`) — #367, already merged/implemented as a prerequisite.
- Self-hosted mode path (no `:tenant` segment, env-configured IdP) — route structure accommodates it but env-based config lookup is a separate slice.
- Admin UI screens for IdP configuration — separate slice.
- SSO-required enforcement guards (blocking non-SSO login for SSO-mandated tenants) — slice 3/4 (#354).
- RP-initiated logout — not in ADR-0044 scope.
- Provider-specific claim normalization beyond `sub`, `email`, `email_verified`, `name`.

## Constraints

1. `openid-client` v5 API throughout, matching #367's usage — the `Client` construction and `callback()` method name must be verified against the installed package version, consistent with how #367 already resolved this for `authorizationUrl()`.
2. `email_verified === true` (strict boolean) verified on ID-token claims before any user lookup; if absent or `false`, return 401 immediately without touching the database.
3. CSRF state payload consumed with Redis 7's native `GETDEL` command (single atomic round-trip) via the new `ICacheProvider.getAndDelete()`; a pipeline `GET` + `DEL` is not sufficient — two commands under concurrent requests can both read before either deletes. The callback handler must re-validate the stored `issuer` against the freshly re-discovered `issuer.metadata.issuer` before proceeding (ADR-0044: the state is bound to the issuer, not just checked for existence) — a mismatch fails with the same generic 401.
4. `issuerUrl` from saved config AND both `token_endpoint` and `jwks_uri` from the discovery response each validated with `validateSSRFProtection()` immediately before every connection — reuses `discoverIssuerValidated` from #367, which already does this; do not re-implement or skip it.
5. `allowed_domains`: fail-closed if the field is absent, null, or empty — reject with 401 before any user lookup. Domain comparison uses `email.split('@')[1]`; enforced on every branch (same-tenant link, cross-tenant reject, new-user create).
6. Account-linking (ADR-0044 Decision 1): email match in same tenant → link (reuse existing user row, no insert); email match in a different tenant → 401 with generic message (must not reveal which tenant owns the address); no match → create user + add membership.
7. Cookie issued in the callback must match the refresh-token cookie in `packages/backend/src/api/routes/auth.ts` exactly — cookie name `refresh_token` (not `refreshToken`), options built via `buildRefreshCookieOptions()` from `packages/backend/src/api/utils/auth-cookies.ts` (`HttpOnly`/`Secure`/`SameSite`/`COOKIE_DOMAIN` all come from that helper). Do not introduce a second cookie format.
8. `getAndDelete` must be added to the exported cache interface in `packages/backend/src/cache/types.ts` (the interface name is `ICacheProvider`) and implemented in both `redis-cache.ts` and `memory-cache.ts` before `oidc-service.ts` compiles. `ICacheProvider.get()` is generic (`get<T>(key): Promise<T | null>`) and `RedisCache` handles JSON serialization internally while `MemoryCache` stores the value as-is — `getAndDelete` must follow that same generic shape, not return a raw `string` that callers then `JSON.parse` themselves.
9. `auth-oidc.ts`'s callback handler must be added inside the existing `oidcRoutes()` function #367 created, not as a separate exported function — the route module keeps one registration entry point.

## Acceptance criteria

- [ ] Callback with valid PKCE exchange, unexpired token, correct `iss`/`aud`/`nonce`, and `email_verified: true` for a known same-tenant member issues a refresh-token cookie matching the `auth.ts` format and responds 302 or 200 — verified by test case A.
- [ ] Callback with a tampered ID-token signature returns 401 — verified by test case B.
- [ ] Callback with an expired ID token returns 401 — verified by test case C.
- [ ] Callback with wrong `iss` returns 401 — verified by test case D.
- [ ] Callback with wrong `aud` returns 401 — verified by test case E.
- [ ] Second callback using the same `state` value returns 401; proves the state row was deleted after first use, not merely checked — verified by test case F.
- [ ] Callback with `email_verified: false` (or absent) returns 401 without any `userRepository` call — verified by test case G.
- [ ] Callback where `allowedDomains` is null/empty returns 401 without any `userRepository` call — verified by test case H.
- [ ] Callback where the email matches a user belonging to a different tenant returns 401 with a generic message — verified by test case I.
- [ ] Callback where the email matches a user with membership in the correct tenant links the account (no new user row) and issues a cookie — verified by test case J.
- [ ] Callback where no existing user matches the email creates a new user + membership and issues a cookie — verified by test case K.
- [ ] Callback where `token_endpoint` from `Issuer.discover()` resolves to an RFC-1918 address (e.g. `http://169.254.169.254/token`) is rejected by `validateSSRFProtection` before the token exchange — verified by test case L.
- [ ] Callback where `jwks_uri` from discovery resolves to an internal host is rejected by `validateSSRFProtection` — verified by test case M.
- [ ] Callback where the re-discovered issuer does not match the issuer stored in the state payload returns 401 — verified by test case N.

## Changes

### `packages/backend/src/cache/types.ts`

Add `getAndDelete` to the `ICacheProvider` interface.

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

Edit the file #367 created — add `consumeOidcState`, which was deliberately left out of that slice since `ICacheProvider.getAndDelete` didn't exist yet.

```ts
// Append after storeOidcState:
export async function consumeOidcState(
  cache: ICacheProvider,
  stateKey: string
): Promise<OidcStatePayload | null> {
  return cache.getAndDelete<OidcStatePayload>(`oidc:state:${stateKey}`);
}
```

### `packages/backend/src/api/routes/auth-oidc.ts`

Edit the file #367 created — add the callback handler inside the existing `oidcRoutes()` function, at the point marked `// #368 appends the callback handler here`.

```ts
// Add this import alongside the existing ones from '../services/oidc-service.js':
import { consumeOidcState } from '../services/oidc-service.js';

// Insert inside oidcRoutes(), where the file currently has the comment
// "#368 appends the callback handler here, inside this same oidcRoutes() function.":
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
  // ASSUMED: openid-client v5 Client construction — verify v5 API, consistent with #367
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

// Add this helper at the bottom of the file, outside oidcRoutes():
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

## Tests

### `packages/backend/tests/api/auth-oidc.test.ts`

Edit the file #367 created — extend its top-level `vi.mock('openid-client', ...)` to also provide a `callback` mock on the client, and add the callback test cases below.

**Mock/fixture updates required:**

Extend the `openid-client` mock's `MockClient` to include a `callback` mock function (`mockCallbackFn`), and extend the container mock to add `cache.getAndDelete`, `userRepository`, and `membershipRepository`. If a `createMockContainer()` helper exists in the test suite, add those keys there explicitly — missing keys cause TypeErrors at runtime, not TypeScript errors.

```ts
// Extend the existing top-level vi.mock('openid-client', ...) block from #367:
// add a callback mock to MockClient's implementation:
const mockCallbackFn = vi.fn();
const MockClient = vi.fn().mockImplementation(() => ({
  authorizationUrl: mockAuthorizationUrlFn, // from #367
  callback: mockCallbackFn,
}));
```

```ts
// Extend the shared fixture setup inside beforeEach (added to #367's mockCache, etc.):
mockCache.getAndDelete = vi.fn();

const mockUserRepository = {
  findByEmail: vi.fn(),
  createWithOidcProfile: vi.fn(),
};

const mockMembershipRepository = {
  findByUserAndTenant: vi.fn(),
};

const validPayload = {
  nonce: 'mock-nonce',
  codeVerifier: 'mock-verifier',
  redirectUri: 'http://app/cb',
  tenantId: 'tenant-abc',
  issuer: 'https://idp.example.com',
};

const validConfig = {
  issuerUrl: 'https://idp.example.com',
  clientId: 'c',
  clientSecret: 's',
  tenantId: 'tenant-abc',
  allowedDomains: ['corp.example.com'],
};

const validTokenSet = {
  claims: () => ({
    email: 'alice@corp.example.com',
    email_verified: true,
    sub: 'sub-1',
  }),
};
```

**Test case A — happy path callback issues refresh-token cookie (AC #1):**

```ts
it('valid callback with email_verified:true for same-tenant member issues cookie', async () => {
  mockCache.getAndDelete.mockResolvedValue(validPayload);
  mockSsoProviderRepository.findByTenantSlug.mockResolvedValue(validConfig);
  mockCallbackFn.mockResolvedValue(validTokenSet);
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

**Test case B — tampered signature rejected (AC #2):**

```ts
it('returns 401 when openid-client throws on bad signature', async () => {
  mockCache.getAndDelete.mockResolvedValue(validPayload);
  mockSsoProviderRepository.findByTenantSlug.mockResolvedValue(validConfig);
  mockCallbackFn.mockRejectedValue(new Error('JWSSignatureVerificationFailed'));

  const res = await fastify.inject({
    method: 'GET',
    url: '/api/v1/auth/oidc/acme/callback?code=c&state=s',
  });

  expect(res.statusCode).toBe(401);
});
```

**Test case F — replayed state rejected, proves atomic consumption (AC #6):**

```ts
it('returns 401 on second use of the same state (state consumed after first callback)', async () => {
  mockCache.getAndDelete.mockResolvedValueOnce(validPayload).mockResolvedValueOnce(null);
  mockSsoProviderRepository.findByTenantSlug.mockResolvedValue(validConfig);
  mockCallbackFn.mockResolvedValue(validTokenSet);
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

**Test case I — cross-tenant match rejected (AC #9):**

```ts
it('returns 401 when email matches a user who has no membership in the requested tenant', async () => {
  mockCache.getAndDelete.mockResolvedValue({ ...validPayload, tenantId: 'tenant-abc' });
  mockSsoProviderRepository.findByTenantSlug.mockResolvedValue({
    ...validConfig,
    tenantId: 'tenant-abc',
  });
  mockCallbackFn.mockResolvedValue(validTokenSet); // email: alice@corp.example.com
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

**Test case H — `allowed_domains` fail-closed (AC #8):**

```ts
it('returns 401 before any user lookup when allowedDomains is empty', async () => {
  mockCache.getAndDelete.mockResolvedValue(validPayload);
  mockSsoProviderRepository.findByTenantSlug.mockResolvedValue({
    ...validConfig,
    allowedDomains: [],
  });
  mockCallbackFn.mockResolvedValue(validTokenSet);

  const res = await fastify.inject({
    method: 'GET',
    url: '/api/v1/auth/oidc/acme/callback?code=c&state=s',
  });

  expect(res.statusCode).toBe(401);
  expect(mockUserRepository.findByEmail).not.toHaveBeenCalled();
});
```

**Test case L — SSRF rejection on internal `token_endpoint` (AC #12):**

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
  expect(mockCallbackFn).not.toHaveBeenCalled();
});
```

**Test case N — issuer mismatch between state and re-discovery rejected (AC #14):**

```ts
it('returns 401 when the re-discovered issuer does not match the issuer stored in state', async () => {
  mockCache.getAndDelete.mockResolvedValue({
    ...validPayload,
    issuer: 'https://old-idp.example.com',
  });
  mockSsoProviderRepository.findByTenantSlug.mockResolvedValue(validConfig);
  // discoverIssuerValidated resolves the mocked Issuer, whose metadata.issuer is
  // 'https://idp.example.com' — does not match the state's 'https://old-idp.example.com'

  const res = await fastify.inject({
    method: 'GET',
    url: '/api/v1/auth/oidc/acme/callback?code=c&state=s',
  });

  expect(res.statusCode).toBe(401);
  expect(mockCallbackFn).not.toHaveBeenCalled();
});
```

Test cases C, D, E, G, K, and M follow the same shape as B, B, B, H, A, and L respectively (differing only in the mocked rejection/claim value) — implement all fourteen acceptance criteria, not only the seven shown above in full.

## Verification

```bash
pnpm --filter @bugspotter/backend typecheck
pnpm --filter @bugspotter/backend test:unit -- --reporter=verbose tests/api/auth-oidc.test.ts
pnpm --filter @bugspotter/backend test:unit -- --reporter=verbose tests/cache/
```

Rollback: purely additive (extends `auth-oidc.ts` with a second route handler, adds `getAndDelete` to the cache interface/implementations). Removing the callback route registration and the `getAndDelete` cache methods fully restores current behavior. No data migration beyond #352's schema, which has its own rollback path.
