/**
 * OIDC Login Initiation + Callback Tests (#367 + #368)
 *
 * Route-level tests for `GET /api/v1/auth/oidc/:tenantId/login` (#367) and
 * `GET /api/v1/auth/oidc/:tenantId/callback` (#368). Builds its own minimal
 * Fastify instance and registers `oidcRoutes` directly — the same pattern
 * `tests/api/routes/signup.route.test.ts` uses — since `server.ts` wiring is
 * out of scope for this slice (see spec #368).
 *
 * `openid-client`, the SSRF validator, the DNS-pinning helper, and the
 * cache singleton are all mocked at top level via `vi.mock`/`vi.hoisted`
 * (ES module mocks must be hoisted above module-scope `const`
 * declarations they're referenced from, or referencing them from inside
 * the hoisted factory hits the TDZ).
 *
 * `OIDC_REDIRECT_BASE_URL` and `JWT_SECRET` are populated by
 * `tests/setup-unit-env.ts` — the login route throws a `ConfigurationError`
 * rather than deriving `redirect_uri` from request headers when the former
 * is unset; the callback route's session issuance needs a real JWT secret
 * for `fastify.jwt.sign()` to work, so `@fastify/jwt` and `@fastify/cookie`
 * are registered on the test server exactly like the real server does
 * (`src/api/server.ts`) — omitting either makes `issueOidcCookie()` throw
 * (`reply.setCookie is not a function` / `fastify.jwt.sign is not a
 * function`), which the Fastify default error handler turns into an
 * unhandled 500 on every cookie-issuing branch (happy path, state-reuse's
 * first call, same-tenant link, new-user create) while leaving pure-401
 * branches unaffected — precisely the four-test failure shape hit by the
 * impl-agent run this file replaces.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import { oidcRoutes } from '../../src/api/routes/auth-oidc.js';
import { config } from '../../src/config.js';

// ---------------------------------------------------------------------------
// Hoisted mocks — available inside the hoisted vi.mock factories below (a
// plain top-level `const` here would hit the TDZ, since vi.mock is hoisted
// above regular imports/consts).
// ---------------------------------------------------------------------------

const { mockAuthorizationUrlFn, mockCacheService, mockPinHostnameToIp, mockCallbackFn } =
  vi.hoisted(() => ({
    mockAuthorizationUrlFn: vi.fn(),
    mockCacheService: {
      get: vi.fn(),
      set: vi.fn().mockResolvedValue(undefined),
      getAndDelete: vi.fn(),
    },
    mockPinHostnameToIp: vi.fn(),
    mockCallbackFn: vi.fn(),
  }));

vi.mock('openid-client', () => {
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
  // `Issuer` here is a plain mock object (not a real class) — `discover` is
  // reassigned per-call inside oidc-service.ts's `custom.http_options` dance,
  // which just sets/reads a property on whatever `Issuer` is, so a plain
  // object works fine as long as `custom.http_options` is a defined key.
  return {
    Issuer: { discover: vi.fn().mockResolvedValue(mockIssuer) },
    generators: {
      state: vi.fn().mockReturnValue('mock-state'),
      nonce: vi.fn().mockReturnValue('mock-nonce'),
      codeVerifier: vi.fn().mockReturnValue('mock-verifier'),
      codeChallenge: vi.fn().mockReturnValue('mock-challenge'),
    },
    custom: { http_options: Symbol('http_options') },
  };
});

vi.mock('../../src/integrations/security/ssrf-validator.js', () => ({
  validateSSRFProtection: vi.fn().mockReturnValue(new URL('https://idp.example.com')),
}));

// Real DNS-rebinding pinning is exercised by hardened-http.ts's own unit
// tests — here we just need discoverIssuerValidated() to not attempt a
// real DNS lookup for the fake `idp.example.com` host.
vi.mock('../../src/integrations/security/hardened-http.js', () => ({
  pinHostnameToIp: mockPinHostnameToIp,
}));

vi.mock('../../src/cache/index.js', () => ({
  getCacheService: vi.fn(() => mockCacheService),
}));

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

const mockOidcIdpConfigs = {
  findByTenantId: vi.fn(),
};

const mockUsers = {
  findByEmail: vi.fn(),
  create: vi.fn(),
};

const mockOrganizationMembers = {
  findMembership: vi.fn(),
  createWithUser: vi.fn(),
};

// The new-user branch wraps its two calls in db.transaction(async tx => ...) — the mock
// just invokes the callback with the same users/organizationMembers mocks as `tx`, so
// mockUsers.create / mockOrganizationMembers.createWithUser assertions still work unchanged.
const mockTransaction = vi.fn((callback: (tx: unknown) => unknown) =>
  callback({ users: mockUsers, organizationMembers: mockOrganizationMembers })
);

async function buildServer(): Promise<FastifyInstance> {
  const server = Fastify();
  // Mirrors src/api/server.ts's real plugin registration for the pieces the
  // callback route's session issuance depends on (setCookie + jwt.sign) —
  // a minimal server missing either turns every cookie-issuing branch into
  // an unhandled 500 instead of the intended 2xx/401.
  await server.register(cookie);
  await server.register(jwt, { secret: config.jwt.secret });
  server.decorate('container', {
    db: {
      oidcIdpConfigs: mockOidcIdpConfigs,
      users: mockUsers,
      organizationMembers: mockOrganizationMembers,
      transaction: mockTransaction,
    },
  });
  oidcRoutes(server);
  await server.ready();
  return server;
}

describe('GET /api/v1/auth/oidc/:tenantId/login', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    // mockAuthorizationUrlFn is a real vi.fn() shared across tests via
    // vi.hoisted (not recreated per test) — give it a fixed, harmless
    // return value; tests assert on the CALL arguments (what the route
    // passed in), not on this return value's content, since a canned
    // string can't reflect per-call params like the real library's own
    // encoding would.
    mockAuthorizationUrlFn.mockReturnValue('https://idp.example.com/auth?mock=1');
    mockCacheService.set.mockResolvedValue(undefined);
    mockPinHostnameToIp.mockResolvedValue({
      ip: '93.184.216.34',
      family: 4,
      lookup: vi.fn(),
    });
    server = await buildServer();
  });

  afterEach(async () => {
    await server.close();
  });

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
    // Assert on what the route PASSED to authorizationUrl(), not on the mock's
    // return value's content — mockAuthorizationUrlFn returns a fixed canned
    // string regardless of its call arguments, so checking the redirect
    // Location for query params would only prove the mock string contains
    // them, not that the route actually requested S256/this state.
    expect(mockAuthorizationUrlFn).toHaveBeenCalledWith(
      expect.objectContaining({ code_challenge_method: 'S256', state: 'mock-state' })
    );
    expect(mockCacheService.set).toHaveBeenCalledWith(
      'oidc:state:mock-state',
      expect.objectContaining({ nonce: 'mock-nonce', tenantId: 'tenant-abc' }),
      600
    );

    // Regression guard: a change that silently drops the SSRF gate (URL
    // validation or the DNS-rebinding pin) shouldn't be able to pass this
    // test while still returning a 302 — assert both were actually invoked,
    // not just that the redirect happened.
    const { validateSSRFProtection } = await import(
      '../../src/integrations/security/ssrf-validator.js'
    );
    expect(validateSSRFProtection).toHaveBeenCalledWith('https://idp.example.com');
    expect(mockPinHostnameToIp).toHaveBeenCalledWith('idp.example.com');
  });

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
});

describe('GET /api/v1/auth/oidc/:tenantId/callback', () => {
  let server: FastifyInstance;

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

  beforeEach(async () => {
    vi.clearAllMocks();
    mockPinHostnameToIp.mockResolvedValue({
      ip: '93.184.216.34',
      family: 4,
      lookup: vi.fn(),
    });
    const { validateSSRFProtection } = await import(
      '../../src/integrations/security/ssrf-validator.js'
    );
    vi.mocked(validateSSRFProtection).mockReturnValue(new URL('https://idp.example.com'));
    server = await buildServer();
  });

  afterEach(async () => {
    await server.close();
  });

  // --- A: happy path ---------------------------------------------------

  it('valid callback with email_verified:true for same-tenant member issues cookie', async () => {
    mockCacheService.getAndDelete.mockResolvedValue(validPayload);
    mockOidcIdpConfigs.findByTenantId.mockResolvedValue(validConfig);
    mockCallbackFn.mockResolvedValue(validTokenSet);
    mockUsers.findByEmail.mockResolvedValue({ id: 'user-1' });
    mockOrganizationMembers.findMembership.mockResolvedValue({ id: 'mem-1' });

    const res = await server.inject({
      method: 'GET',
      url: '/api/v1/auth/oidc/tenant-abc/callback?code=c&state=s',
    });

    expect(res.statusCode).toBeLessThan(400);
    expect(res.headers['set-cookie']).toMatch(/refresh_token=/);
    // Regression guard: openid-client@5.7.1's callback() throws "state missing from
    // the response" when checks.state is set but params.state isn't (verified against
    // node_modules/openid-client's actual lib/client.js) — mockCallbackFn being fully
    // mocked means a statusCode assertion alone can't catch a dropped `state` in the
    // params object, so assert on the actual call arguments too.
    expect(mockCallbackFn).toHaveBeenCalledWith(
      'http://app/cb',
      expect.objectContaining({ code: 'c', state: 's' }),
      expect.objectContaining({ state: 's' })
    );
  });

  // --- B: tampered signature --------------------------------------------

  it('returns 401 when openid-client throws on bad signature', async () => {
    mockCacheService.getAndDelete.mockResolvedValue(validPayload);
    mockOidcIdpConfigs.findByTenantId.mockResolvedValue(validConfig);
    mockCallbackFn.mockRejectedValue(new Error('JWSSignatureVerificationFailed'));

    const res = await server.inject({
      method: 'GET',
      url: '/api/v1/auth/oidc/tenant-abc/callback?code=c&state=s',
    });

    expect(res.statusCode).toBe(401);
  });

  // --- C: expired ID token (same shape as B) -----------------------------

  it('returns 401 when openid-client throws on an expired ID token', async () => {
    mockCacheService.getAndDelete.mockResolvedValue(validPayload);
    mockOidcIdpConfigs.findByTenantId.mockResolvedValue(validConfig);
    mockCallbackFn.mockRejectedValue(new Error('RPError: id_token expired'));

    const res = await server.inject({
      method: 'GET',
      url: '/api/v1/auth/oidc/tenant-abc/callback?code=c&state=s',
    });

    expect(res.statusCode).toBe(401);
  });

  // --- D: wrong iss (same shape as B) -------------------------------------

  it('returns 401 when openid-client throws on unexpected iss', async () => {
    mockCacheService.getAndDelete.mockResolvedValue(validPayload);
    mockOidcIdpConfigs.findByTenantId.mockResolvedValue(validConfig);
    mockCallbackFn.mockRejectedValue(new Error('RPError: unexpected iss value'));

    const res = await server.inject({
      method: 'GET',
      url: '/api/v1/auth/oidc/tenant-abc/callback?code=c&state=s',
    });

    expect(res.statusCode).toBe(401);
  });

  // --- E: wrong aud (same shape as B) -------------------------------------

  it('returns 401 when openid-client throws on unexpected aud', async () => {
    mockCacheService.getAndDelete.mockResolvedValue(validPayload);
    mockOidcIdpConfigs.findByTenantId.mockResolvedValue(validConfig);
    mockCallbackFn.mockRejectedValue(new Error('RPError: aud mismatch'));

    const res = await server.inject({
      method: 'GET',
      url: '/api/v1/auth/oidc/tenant-abc/callback?code=c&state=s',
    });

    expect(res.statusCode).toBe(401);
  });

  // --- F: replayed state ---------------------------------------------------

  it('returns 401 on second use of the same state (state consumed after first callback)', async () => {
    mockCacheService.getAndDelete.mockResolvedValueOnce(validPayload).mockResolvedValueOnce(null);
    mockOidcIdpConfigs.findByTenantId.mockResolvedValue(validConfig);
    mockCallbackFn.mockResolvedValue(validTokenSet);
    mockUsers.findByEmail.mockResolvedValue({ id: 'user-1' });
    mockOrganizationMembers.findMembership.mockResolvedValue({ id: 'mem-1' });

    const first = await server.inject({
      method: 'GET',
      url: '/api/v1/auth/oidc/tenant-abc/callback?code=c&state=s',
    });
    const second = await server.inject({
      method: 'GET',
      url: '/api/v1/auth/oidc/tenant-abc/callback?code=c&state=s',
    });

    expect(first.statusCode).toBeLessThan(400);
    expect(second.statusCode).toBe(401);
    expect(mockCacheService.getAndDelete).toHaveBeenCalledTimes(2);
  });

  // --- G: email_verified false/absent (same shape as H) -------------------

  it('returns 401 without any users repository call when email_verified is false', async () => {
    mockCacheService.getAndDelete.mockResolvedValue(validPayload);
    mockOidcIdpConfigs.findByTenantId.mockResolvedValue(validConfig);
    mockCallbackFn.mockResolvedValue({
      claims: () => ({ email: 'alice@corp.example.com', email_verified: false, sub: 'sub-1' }),
    });

    const res = await server.inject({
      method: 'GET',
      url: '/api/v1/auth/oidc/tenant-abc/callback?code=c&state=s',
    });

    expect(res.statusCode).toBe(401);
    expect(mockUsers.findByEmail).not.toHaveBeenCalled();
  });

  it('returns 401 without any users repository call when email_verified is absent', async () => {
    mockCacheService.getAndDelete.mockResolvedValue(validPayload);
    mockOidcIdpConfigs.findByTenantId.mockResolvedValue(validConfig);
    mockCallbackFn.mockResolvedValue({
      claims: () => ({ email: 'alice@corp.example.com', sub: 'sub-1' }),
    });

    const res = await server.inject({
      method: 'GET',
      url: '/api/v1/auth/oidc/tenant-abc/callback?code=c&state=s',
    });

    expect(res.statusCode).toBe(401);
    expect(mockUsers.findByEmail).not.toHaveBeenCalled();
  });

  it('returns 401 instead of a 500 when the email claim is a non-string truthy value', async () => {
    mockCacheService.getAndDelete.mockResolvedValue(validPayload);
    mockOidcIdpConfigs.findByTenantId.mockResolvedValue(validConfig);
    // A truthy, non-empty, non-string claim (e.g. a malformed/malicious IdP response)
    // passes a bare `!claims.email` check and would previously reach `.split('@')`
    // outside the try/catch, throwing an unhandled 500 instead of the generic 401
    // every other rejection in this handler returns.
    mockCallbackFn.mockResolvedValue({
      claims: () => ({ email: 12345, email_verified: true, sub: 'sub-1' }),
    });

    const res = await server.inject({
      method: 'GET',
      url: '/api/v1/auth/oidc/tenant-abc/callback?code=c&state=s',
    });

    expect(res.statusCode).toBe(401);
    expect(mockUsers.findByEmail).not.toHaveBeenCalled();
  });

  // --- H: allowedDomains fail-closed ---------------------------------------

  it('returns 401 before any user lookup when allowedDomains is empty', async () => {
    mockCacheService.getAndDelete.mockResolvedValue(validPayload);
    mockOidcIdpConfigs.findByTenantId.mockResolvedValue({
      ...validConfig,
      allowedDomains: [],
    });
    mockCallbackFn.mockResolvedValue(validTokenSet);

    const res = await server.inject({
      method: 'GET',
      url: '/api/v1/auth/oidc/tenant-abc/callback?code=c&state=s',
    });

    expect(res.statusCode).toBe(401);
    expect(mockUsers.findByEmail).not.toHaveBeenCalled();
  });

  it('returns 401 before any user lookup when the email has no @ domain to match', async () => {
    mockCacheService.getAndDelete.mockResolvedValue(validPayload);
    mockOidcIdpConfigs.findByTenantId.mockResolvedValue(validConfig);
    mockCallbackFn.mockResolvedValue({
      claims: () => ({ email: 'not-an-email', email_verified: true, sub: 'sub-1' }),
    });

    const res = await server.inject({
      method: 'GET',
      url: '/api/v1/auth/oidc/tenant-abc/callback?code=c&state=s',
    });

    expect(res.statusCode).toBe(401);
    expect(mockUsers.findByEmail).not.toHaveBeenCalled();
  });

  it('links the account when allowedDomains has a mixed-case entry matching the lowercased email domain', async () => {
    mockCacheService.getAndDelete.mockResolvedValue(validPayload);
    mockOidcIdpConfigs.findByTenantId.mockResolvedValue({
      ...validConfig,
      allowedDomains: ['Corp.Example.Com'],
    });
    mockCallbackFn.mockResolvedValue(validTokenSet); // email: alice@corp.example.com
    mockUsers.findByEmail.mockResolvedValue({ id: 'user-1' });
    mockOrganizationMembers.findMembership.mockResolvedValue({ id: 'mem-1' });

    const res = await server.inject({
      method: 'GET',
      url: '/api/v1/auth/oidc/tenant-abc/callback?code=c&state=s',
    });

    expect(res.statusCode).toBeLessThan(400);
    expect(res.headers['set-cookie']).toMatch(/refresh_token=/);
  });

  // --- I: cross-tenant match rejected --------------------------------------

  it('returns 401 when email matches a user who has no membership in the requested tenant', async () => {
    mockCacheService.getAndDelete.mockResolvedValue({ ...validPayload, tenantId: 'tenant-abc' });
    mockOidcIdpConfigs.findByTenantId.mockResolvedValue(validConfig);
    mockCallbackFn.mockResolvedValue(validTokenSet); // email: alice@corp.example.com
    mockUsers.findByEmail.mockResolvedValue({ id: 'user-1' });
    mockOrganizationMembers.findMembership.mockResolvedValue(null); // not a member of this tenant

    const res = await server.inject({
      method: 'GET',
      url: '/api/v1/auth/oidc/tenant-abc/callback?code=c&state=s',
    });

    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).error).toBe('Authentication failed');
    // Must not expose which tenant the user belongs to, and must not create
    // a duplicate global user for an email that already exists.
    expect(mockUsers.create).not.toHaveBeenCalled();
  });

  // --- J: same-tenant link (no new user row) -------------------------------

  it('links the existing account when email matches a member of the requested tenant', async () => {
    mockCacheService.getAndDelete.mockResolvedValue(validPayload);
    mockOidcIdpConfigs.findByTenantId.mockResolvedValue(validConfig);
    mockCallbackFn.mockResolvedValue(validTokenSet);
    mockUsers.findByEmail.mockResolvedValue({ id: 'user-1' });
    mockOrganizationMembers.findMembership.mockResolvedValue({ id: 'mem-1' });

    const res = await server.inject({
      method: 'GET',
      url: '/api/v1/auth/oidc/tenant-abc/callback?code=c&state=s',
    });

    expect(res.statusCode).toBeLessThan(400);
    expect(res.headers['set-cookie']).toMatch(/refresh_token=/);
    // Proves the "link" branch reused the existing user row instead of the
    // new-user-create branch.
    expect(mockUsers.create).not.toHaveBeenCalled();
    expect(mockOrganizationMembers.createWithUser).not.toHaveBeenCalled();
  });

  // --- K: no existing user creates a new user + membership -----------------

  it('creates a new user and membership when no existing user matches the email', async () => {
    mockCacheService.getAndDelete.mockResolvedValue(validPayload);
    mockOidcIdpConfigs.findByTenantId.mockResolvedValue(validConfig);
    mockCallbackFn.mockResolvedValue(validTokenSet);
    mockUsers.findByEmail.mockResolvedValue(null);
    mockUsers.create.mockResolvedValue({ id: 'new-user-1', email: 'alice@corp.example.com' });
    mockOrganizationMembers.createWithUser.mockResolvedValue({ id: 'mem-new' });

    const res = await server.inject({
      method: 'GET',
      url: '/api/v1/auth/oidc/tenant-abc/callback?code=c&state=s',
    });

    expect(res.statusCode).toBeLessThan(400);
    expect(res.headers['set-cookie']).toMatch(/refresh_token=/);
    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(mockUsers.create).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'alice@corp.example.com' })
    );
    expect(mockOrganizationMembers.createWithUser).toHaveBeenCalledWith(
      'tenant-abc',
      'new-user-1',
      'member'
    );
  });

  it('returns 401 and rolls back when membership creation returns null for a new user', async () => {
    mockCacheService.getAndDelete.mockResolvedValue(validPayload);
    mockOidcIdpConfigs.findByTenantId.mockResolvedValue(validConfig);
    mockCallbackFn.mockResolvedValue(validTokenSet);
    mockUsers.findByEmail.mockResolvedValue(null);
    mockUsers.create.mockResolvedValue({ id: 'new-user-1', email: 'alice@corp.example.com' });
    mockOrganizationMembers.createWithUser.mockResolvedValue(null);

    const res = await server.inject({
      method: 'GET',
      url: '/api/v1/auth/oidc/tenant-abc/callback?code=c&state=s',
    });

    expect(res.statusCode).toBe(401);
  });

  // --- L: SSRF rejection on internal token_endpoint ------------------------

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

    const res = await server.inject({
      method: 'GET',
      url: '/api/v1/auth/oidc/tenant-abc/callback?code=c&state=s',
    });

    expect(res.statusCode).toBe(401);
    expect(mockCallbackFn).not.toHaveBeenCalled();
  });

  // --- M: SSRF rejection on internal jwks_uri (same shape as L) ------------

  it('rejects when discovered jwks_uri resolves to an internal address', async () => {
    const { validateSSRFProtection } = await import(
      '../../src/integrations/security/ssrf-validator.js'
    );
    vi.mocked(validateSSRFProtection)
      .mockReturnValueOnce(new URL('https://idp.example.com')) // issuerUrl passes
      .mockReturnValueOnce(new URL('https://idp.example.com/token')) // token_endpoint passes
      .mockImplementationOnce(() => {
        throw new Error('SSRF: private address');
      }); // jwks_uri fails

    mockCacheService.getAndDelete.mockResolvedValue(validPayload);
    mockOidcIdpConfigs.findByTenantId.mockResolvedValue(validConfig);

    const res = await server.inject({
      method: 'GET',
      url: '/api/v1/auth/oidc/tenant-abc/callback?code=c&state=s',
    });

    expect(res.statusCode).toBe(401);
    expect(mockCallbackFn).not.toHaveBeenCalled();
  });

  // --- N: issuer mismatch between state and re-discovery -------------------

  it('returns 401 when the re-discovered issuer does not match the issuer stored in state', async () => {
    mockCacheService.getAndDelete.mockResolvedValue({
      ...validPayload,
      issuer: 'https://old-idp.example.com',
    });
    mockOidcIdpConfigs.findByTenantId.mockResolvedValue(validConfig);
    // discoverIssuerValidated resolves the mocked Issuer, whose metadata.issuer is
    // 'https://idp.example.com' — does not match the state's 'https://old-idp.example.com'

    const res = await server.inject({
      method: 'GET',
      url: '/api/v1/auth/oidc/tenant-abc/callback?code=c&state=s',
    });

    expect(res.statusCode).toBe(401);
    expect(mockCallbackFn).not.toHaveBeenCalled();
  });

  // --- Additional edge cases: missing query params / IdP error passthrough -

  it('returns 401 without consuming state when the IdP redirects with an error param', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/api/v1/auth/oidc/tenant-abc/callback?error=access_denied',
    });

    expect(res.statusCode).toBe(401);
    expect(mockCacheService.getAndDelete).not.toHaveBeenCalled();
  });

  it('returns 401 for a tenant mismatch between the callback URL and the stored state', async () => {
    mockCacheService.getAndDelete.mockResolvedValue({ ...validPayload, tenantId: 'other-tenant' });

    const res = await server.inject({
      method: 'GET',
      url: '/api/v1/auth/oidc/tenant-abc/callback?code=c&state=s',
    });

    expect(res.statusCode).toBe(401);
    expect(mockOidcIdpConfigs.findByTenantId).not.toHaveBeenCalled();
  });
});
