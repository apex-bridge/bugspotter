/**
 * OIDC Login Initiation Tests (#367)
 *
 * Route-level tests for `GET /api/v1/auth/oidc/:tenantId/login`. Builds its
 * own minimal Fastify instance and registers `oidcRoutes` directly — the
 * same pattern `tests/api/routes/signup.route.test.ts` uses — since
 * `server.ts` wiring is out of scope for this slice (see spec #367).
 *
 * `openid-client`, the SSRF validator, and the cache singleton are all
 * mocked at top level via `vi.mock`/`vi.hoisted` (ES module mocks must be
 * hoisted above module-scope `const` declarations they're referenced from,
 * or referencing them from inside the hoisted factory hits the TDZ).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { oidcRoutes } from '../../src/api/routes/auth-oidc.js';

// ---------------------------------------------------------------------------
// Hoisted mocks — available inside the hoisted vi.mock factories below (a
// plain top-level `const` here would hit the TDZ, since vi.mock is hoisted
// above regular imports/consts).
// ---------------------------------------------------------------------------

const { mockAuthorizationUrlFn, mockCacheService } = vi.hoisted(() => ({
  mockAuthorizationUrlFn: vi.fn(),
  mockCacheService: { get: vi.fn(), set: vi.fn().mockResolvedValue(undefined) },
}));

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

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

const mockOidcIdpConfigs = {
  findByTenantId: vi.fn(),
};

async function buildServer(): Promise<FastifyInstance> {
  const server = Fastify();
  server.decorate('container', {
    db: { oidcIdpConfigs: mockOidcIdpConfigs },
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
