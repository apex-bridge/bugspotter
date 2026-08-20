# Spec: SSO 2b/4: OIDC callback, account-linking, and session issuance

Linked issue: Refs #368
ADR: docs/adr/0044-sso-oidc-account-linking-and-tenant-boundary.md

**Files touched:**

- `packages/backend/src/cache/types.ts` — add `getAndDelete` to `ICacheProvider` interface
- `packages/backend/src/cache/redis-cache.ts` — implement `getAndDelete` via Redis 7 native `GETDEL`
- `packages/backend/src/cache/memory-cache.ts` — implement `getAndDelete` (get + delete, sufficient for in-process test cache)
- `packages/backend/src/cache/cache-service.ts` — add `getAndDelete` to `CacheService` (the actual class routes consume via `getCacheService()` — it does not implement `ICacheProvider` directly, it's a two-tier orchestrator over `RedisCache`/`MemoryCache` with its own method set)
- `packages/backend/src/api/services/oidc-service.ts` — edit; add `consumeOidcState`
- `packages/backend/src/api/routes/auth-oidc.ts` — edit; add `GET /api/v1/auth/oidc/:tenantId/callback` handler to the `oidcRoutes()` function #367 created
- `packages/backend/tests/api/auth-oidc.test.ts` — edit; test cases A–N below

**Blocking prerequisites:**

- #367 — creates `oidc-service.ts` and `auth-oidc.ts` (with the `login` handler and `oidcRoutes()` shell) that this slice extends, and wires `fastify.container.db.oidcIdpConfigs` into the DI container. Must merge and be implemented first.

## Problem

Split off #353 as its larger, security-critical half (see #367 for why the split happened, and #367's own spec for the login-initiation half this depends on). This slice implements the callback endpoint: atomic CSRF-state consumption, ID-token validation, tenant-scoped account-linking (ADR-0044 Decision 1 — the fix for a real cross-tenant account-takeover path: `users.email` is globally unique but `oidc_idp_config` is per-tenant, so a naive email match could let one tenant's IdP assert an email belonging to a different tenant's user), and refresh-token cookie issuance.

**Corrected during review (PR #370), same root cause as #367's correction:** `fastify.container.cache` doesn't exist, and `CacheService` (the real thing `getCacheService()` returns) doesn't implement `ICacheProvider` — it wraps `RedisCache`/`MemoryCache` with its own `get`/`set`/`delete` methods and needs its own `getAndDelete` added, not just the lower-level providers'. `userRepository`/`membershipRepository` container keys were also wrong — the real registry keys (verified in `factory.ts`) are `users` and `organizationMembers`, and `organizationMembers` has no direct "find by user and tenant" method matching the original signature — the closest real methods are `findMembership(organizationId, userId)` and `createWithUser(organizationId, userId, role)`. All corrected below.

## Out of scope

- The login-initiation endpoint (`GET /api/v1/auth/oidc/:tenantId/login`) — #367, already merged/implemented as a prerequisite.
- Self-hosted mode path (no `:tenantId` segment, env-configured IdP) — route structure accommodates it but env-based config lookup is a separate slice.
- Admin UI screens for IdP configuration — separate slice.
- SSO-required enforcement guards (blocking non-SSO login for SSO-mandated tenants) — slice 3/4 (#354).
- RP-initiated logout — not in ADR-0044 scope.
- Provider-specific claim normalization beyond `sub`, `email`, `email_verified`, `name`.
- The exact shape of `UserInsert`/`users.create()`'s required fields for an OIDC-only user (e.g. whether `password_hash` must be nullable) — ASSUMED compatible, implementer must verify against the live schema/migration before finalizing the new-user branch.

## Constraints

1. `openid-client` v5 API throughout, matching #367's usage — the `Client` construction and `callback()` method name must be verified against the installed package version, consistent with how #367 already resolved this for `authorizationUrl()`.
2. `email_verified === true` (strict boolean) verified on ID-token claims before any user lookup; if absent or `false`, return 401 immediately without touching the database.
3. CSRF state payload consumed with Redis 7's native `GETDEL` command (single atomic round-trip) via the new `CacheService.getAndDelete()`, which must bypass its L1 memory-cache read path and go straight to the Redis tier for the atomicity guarantee — checking L1 first would reintroduce the exact race this exists to prevent (two concurrent requests both reading a still-present L1 copy before either deletes it). Best-effort clear the L1 copy afterward for hygiene; correctness relies only on the Redis `GETDEL`. A pipeline `GET` + `DEL` is not sufficient. The callback handler must re-validate the stored `issuer` against the freshly re-discovered `issuer.metadata.issuer` before proceeding (ADR-0044: the state is bound to the issuer, not just checked for existence) — a mismatch fails with the same generic 401.
4. `issuerUrl` from saved config AND both `token_endpoint` and `jwks_uri` from the discovery response each validated with `validateSSRFProtection()` immediately before every connection — reuses `discoverIssuerValidated` from #367, which already does this; do not re-implement or skip it.
5. `allowedDomains`: fail-closed if the field is absent, null, or empty — reject with 401 before any user lookup. Domain comparison uses `email.split('@')[1]`; enforced on every branch (same-tenant link, cross-tenant reject, new-user create).
6. Account-linking (ADR-0044 Decision 1): email match with an existing membership in this tenant (`organizationMembers.findMembership(tenantId, existingUser.id)`) → link (reuse existing user row, no insert); email match but no membership in this tenant → 401 with generic message (must not reveal which tenant owns the address); no user match at all → create user (`users.create(...)`, fields ASSUMED — see Out of scope) + `organizationMembers.createWithUser(tenantId, newUser.id, 'member')`.
7. Cookie issued in the callback must match the refresh-token cookie in `packages/backend/src/api/routes/auth.ts` exactly — cookie name `refresh_token` (not `refreshToken`), options built via `buildRefreshCookieOptions()` from `packages/backend/src/api/utils/auth-cookies.ts` (`HttpOnly`/`Secure`/`SameSite`/`COOKIE_DOMAIN` all come from that helper). Do not introduce a second cookie format.
8. `getAndDelete` must be added to `ICacheProvider` (`packages/backend/src/cache/types.ts`) and implemented in both `redis-cache.ts` and `memory-cache.ts`, AND to `CacheService` (`cache-service.ts`) which delegates to them — routes only ever call `getCacheService()`, never the lower-level providers directly. `ICacheProvider.get()` is generic (`get<T>(key): Promise<T | null>`) and `RedisCache` handles JSON serialization internally while `MemoryCache` stores the value as-is — `getAndDelete` must follow that same generic shape.
9. `auth-oidc.ts`'s callback handler must be added inside the existing `oidcRoutes()` function #367 created, not as a separate exported function — the route module keeps one registration entry point.
10. `OrganizationMemberRepository.createWithUser` uses `ON CONFLICT (organization_id, user_id) DO NOTHING` and returns `null` on conflict — handle a `null` return from the new-user branch (should not occur given the "no existing user" precondition, but do not assume the query result is always non-null).

## Acceptance criteria

- [ ] Callback with valid PKCE exchange, unexpired token, correct `iss`/`aud`/`nonce`, and `email_verified: true` for a known same-tenant member issues a refresh-token cookie matching the `auth.ts` format and responds 302 or 200 — verified by test case A.
- [ ] Callback with a tampered ID-token signature returns 401 — verified by test case B.
- [ ] Callback with an expired ID token returns 401 — verified by test case C.
- [ ] Callback with wrong `iss` returns 401 — verified by test case D.
- [ ] Callback with wrong `aud` returns 401 — verified by test case E.
- [ ] Second callback using the same `state` value returns 401; proves the state row was deleted after first use, not merely checked — verified by test case F.
- [ ] Callback with `email_verified: false` (or absent) returns 401 without any `users` repository call — verified by test case G.
- [ ] Callback where `allowedDomains` is null/empty returns 401 without any `users` repository call — verified by test case H.
- [ ] Callback where the email matches a user with no membership in the requested tenant returns 401 with a generic message — verified by test case I.
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

### `packages/backend/src/cache/cache-service.ts`

`CacheService` is the class routes actually consume via `getCacheService()` — it wraps `RedisCache`/`MemoryCache` and does not implement `ICacheProvider` directly, so it needs its own `getAndDelete`, modeled on the existing `get`/`delete` methods' two-tier fan-out but going straight to Redis for the atomicity guarantee (see Constraint 3).

```ts
// Append inside the CacheService class body, after the existing delete method:
/**
 * Atomically get and delete a key - for one-time-use values like CSRF state.
 * Deliberately does NOT check the L1 memory cache first: the atomicity guarantee
 * comes from Redis's single-round-trip GETDEL, and reading L1 first would
 * reintroduce the race this method exists to prevent (two concurrent requests
 * both reading a still-present L1 copy before either deletes it).
 */
async getAndDelete<T>(key: string): Promise<T | null> {
  if (this.redisCache) {
    const value = await this.redisCache.getAndDelete<T>(key);
    if (this.memoryCache) {
      // Best-effort L1 cleanup; correctness relies only on the Redis GETDEL above.
      await this.memoryCache.delete(key).catch(() => {});
    }
    return value;
  }
  if (this.memoryCache) {
    return this.memoryCache.getAndDelete<T>(key);
  }
  return null;
}
```

### `packages/backend/src/api/services/oidc-service.ts`

Edit the file #367 created — add `consumeOidcState`, which was deliberately left out of that slice since `CacheService.getAndDelete` didn't exist yet.

```ts
// Append after storeOidcState:
export async function consumeOidcState(stateKey: string): Promise<OidcStatePayload | null> {
  return getCacheService().getAndDelete<OidcStatePayload>(`oidc:state:${stateKey}`);
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
  Params: { tenantId: string };
  Querystring: { code?: string; state?: string; error?: string };
}>('/api/v1/auth/oidc/:tenantId/callback', async (request, reply) => {
  const { tenantId } = request.params;
  const { code, state: stateParam, error: idpError } = request.query;

  if (idpError || !code || !stateParam) {
    return reply.code(401).send({ error: 'Authentication failed' });
  }

  const statePayload = await consumeOidcState(stateParam);
  if (!statePayload) return reply.code(401).send({ error: 'Authentication failed' });
  if (statePayload.tenantId !== tenantId) {
    return reply.code(401).send({ error: 'Authentication failed' });
  }

  const config = await fastify.container.db.oidcIdpConfigs.findByTenantId(tenantId);
  if (!config) return reply.code(401).send({ error: 'Authentication failed' });

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

  const existingUser = await fastify.container.db.users.findByEmail(claims.email);
  if (existingUser) {
    const membership = await fastify.container.db.organizationMembers.findMembership(
      tenantId,
      existingUser.id
    );
    if (!membership) return reply.code(401).send({ error: 'Authentication failed' });
    return issueOidcCookie(fastify, reply, existingUser.id, tenantId);
  }

  // ASSUMED: UserInsert's required fields for an OIDC-only user — verify against the live
  // schema before finalizing (e.g. whether password_hash must be nullable).
  const newUser = await fastify.container.db.users.create({
    email: claims.email,
    name: typeof claims.name === 'string' ? claims.name : undefined,
  });
  const created = await fastify.container.db.organizationMembers.createWithUser(
    tenantId,
    newUser.id,
    'member'
  );
  if (!created) return reply.code(401).send({ error: 'Authentication failed' });
  return issueOidcCookie(fastify, reply, newUser.id, tenantId);
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

Edit the file #367 created — extend its top-level `vi.mock('openid-client', ...)` to also provide a `callback` mock on the client, extend the `getCacheService` mock with `getAndDelete`, and add the callback test cases below.

**Mock/fixture updates required:**

Extend the `openid-client` mock's `MockClient` to include a `callback` mock function (`mockCallbackFn`), extend `mockCacheService` (from #367's mock) with `getAndDelete`, and extend the container mock to add `db.users` (`findByEmail`, `create`) and `db.organizationMembers` (`findMembership`, `createWithUser`).

`mockCallbackFn` is referenced from inside the same hoisted `vi.mock('openid-client', ...)` factory #367 created, so it must be added to #367's `vi.hoisted()` call, not declared as a separate plain `const` — the same temporal-dead-zone reasoning #367's own spec now documents applies here too.

```ts
// Extend #367's vi.hoisted() call to also produce mockCallbackFn:
const { mockAuthorizationUrlFn, mockCacheService, mockCallbackFn } = vi.hoisted(() => ({
  mockAuthorizationUrlFn: vi.fn(),
  mockCacheService: {
    get: vi.fn(),
    set: vi.fn().mockResolvedValue(undefined),
    getAndDelete: vi.fn(),
  },
  mockCallbackFn: vi.fn(),
}));

// Extend the existing top-level vi.mock('openid-client', ...) block from #367:
// add the callback mock to MockClient's implementation:
const MockClient = vi.fn().mockImplementation(() => ({
  authorizationUrl: mockAuthorizationUrlFn, // from #367
  callback: mockCallbackFn,
}));
```

```ts
// mockCacheService.getAndDelete is already provided by the vi.hoisted() extension above —
// no separate mutation needed here.

const mockUsers = {
  findByEmail: vi.fn(),
  create: vi.fn(),
};

const mockOrganizationMembers = {
  findMembership: vi.fn(),
  createWithUser: vi.fn(),
};
// container.db.users = mockUsers, container.db.organizationMembers = mockOrganizationMembers

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
  mockCacheService.getAndDelete.mockResolvedValue(validPayload);
  mockOidcIdpConfigs.findByTenantId.mockResolvedValue(validConfig); // from #367's fixtures
  mockCallbackFn.mockResolvedValue(validTokenSet);
  mockUsers.findByEmail.mockResolvedValue({ id: 'user-1' });
  mockOrganizationMembers.findMembership.mockResolvedValue({ id: 'mem-1' });

  const res = await fastify.inject({
    method: 'GET',
    url: '/api/v1/auth/oidc/tenant-abc/callback?code=c&state=s',
  });

  expect(res.statusCode).toBeLessThan(400);
  expect(res.headers['set-cookie']).toMatch(/refresh_token=/);
});
```

**Test case B — tampered signature rejected (AC #2):**

```ts
it('returns 401 when openid-client throws on bad signature', async () => {
  mockCacheService.getAndDelete.mockResolvedValue(validPayload);
  mockOidcIdpConfigs.findByTenantId.mockResolvedValue(validConfig);
  mockCallbackFn.mockRejectedValue(new Error('JWSSignatureVerificationFailed'));

  const res = await fastify.inject({
    method: 'GET',
    url: '/api/v1/auth/oidc/tenant-abc/callback?code=c&state=s',
  });

  expect(res.statusCode).toBe(401);
});
```

**Test case F — replayed state rejected, proves atomic consumption (AC #6):**

```ts
it('returns 401 on second use of the same state (state consumed after first callback)', async () => {
  mockCacheService.getAndDelete.mockResolvedValueOnce(validPayload).mockResolvedValueOnce(null);
  mockOidcIdpConfigs.findByTenantId.mockResolvedValue(validConfig);
  mockCallbackFn.mockResolvedValue(validTokenSet);
  mockUsers.findByEmail.mockResolvedValue({ id: 'user-1' });
  mockOrganizationMembers.findMembership.mockResolvedValue({ id: 'mem-1' });

  const first = await fastify.inject({
    method: 'GET',
    url: '/api/v1/auth/oidc/tenant-abc/callback?code=c&state=s',
  });
  const second = await fastify.inject({
    method: 'GET',
    url: '/api/v1/auth/oidc/tenant-abc/callback?code=c&state=s',
  });

  expect(first.statusCode).toBeLessThan(400);
  expect(second.statusCode).toBe(401);
  expect(mockCacheService.getAndDelete).toHaveBeenCalledTimes(2);
});
```

**Test case I — cross-tenant match rejected (AC #9):**

```ts
it('returns 401 when email matches a user who has no membership in the requested tenant', async () => {
  mockCacheService.getAndDelete.mockResolvedValue({ ...validPayload, tenantId: 'tenant-abc' });
  mockOidcIdpConfigs.findByTenantId.mockResolvedValue(validConfig);
  mockCallbackFn.mockResolvedValue(validTokenSet); // email: alice@corp.example.com
  mockUsers.findByEmail.mockResolvedValue({ id: 'user-1' });
  mockOrganizationMembers.findMembership.mockResolvedValue(null); // not a member of this tenant

  const res = await fastify.inject({
    method: 'GET',
    url: '/api/v1/auth/oidc/tenant-abc/callback?code=c&state=s',
  });

  expect(res.statusCode).toBe(401);
  expect(JSON.parse(res.body).error).toBe('Authentication failed');
  // Must not expose which tenant the user belongs to
});
```

**Test case H — `allowedDomains` fail-closed (AC #8):**

```ts
it('returns 401 before any user lookup when allowedDomains is empty', async () => {
  mockCacheService.getAndDelete.mockResolvedValue(validPayload);
  mockOidcIdpConfigs.findByTenantId.mockResolvedValue({
    ...validConfig,
    allowedDomains: [],
  });
  mockCallbackFn.mockResolvedValue(validTokenSet);

  const res = await fastify.inject({
    method: 'GET',
    url: '/api/v1/auth/oidc/tenant-abc/callback?code=c&state=s',
  });

  expect(res.statusCode).toBe(401);
  expect(mockUsers.findByEmail).not.toHaveBeenCalled();
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

  mockCacheService.getAndDelete.mockResolvedValue(validPayload);
  mockOidcIdpConfigs.findByTenantId.mockResolvedValue(validConfig);

  const res = await fastify.inject({
    method: 'GET',
    url: '/api/v1/auth/oidc/tenant-abc/callback?code=c&state=s',
  });

  expect(res.statusCode).toBe(401);
  expect(mockCallbackFn).not.toHaveBeenCalled();
});
```

**Test case N — issuer mismatch between state and re-discovery rejected (AC #14):**

```ts
it('returns 401 when the re-discovered issuer does not match the issuer stored in state', async () => {
  mockCacheService.getAndDelete.mockResolvedValue({
    ...validPayload,
    issuer: 'https://old-idp.example.com',
  });
  mockOidcIdpConfigs.findByTenantId.mockResolvedValue(validConfig);
  // discoverIssuerValidated resolves the mocked Issuer, whose metadata.issuer is
  // 'https://idp.example.com' — does not match the state's 'https://old-idp.example.com'

  const res = await fastify.inject({
    method: 'GET',
    url: '/api/v1/auth/oidc/tenant-abc/callback?code=c&state=s',
  });

  expect(res.statusCode).toBe(401);
  expect(mockCallbackFn).not.toHaveBeenCalled();
});
```

Test cases C, D, E, G, J, K, and M follow the same shape as B, B, B, H, A (existing-user-with-membership branch), A (no-match-creates-new-user branch, asserting `mockUsers.create` and `mockOrganizationMembers.createWithUser` were called), and L respectively (differing only in the mocked rejection/claim value) — implement all fourteen acceptance criteria, not only the seven shown above in full.

## Verification

```bash
pnpm --filter @bugspotter/backend typecheck
pnpm --filter @bugspotter/backend test:unit -- --reporter=verbose tests/api/auth-oidc.test.ts
pnpm --filter @bugspotter/backend test:unit -- --reporter=verbose tests/cache/
```

Rollback: purely additive (extends `auth-oidc.ts` with a second route handler, adds `getAndDelete` to the cache interface/implementations/service). Removing the callback route registration and the `getAndDelete` cache methods fully restores current behavior. No data migration beyond #352's schema, which has its own rollback path.
