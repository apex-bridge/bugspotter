/**
 * Organization SSO config route tests (#438).
 *
 * Route-level, with `guard` mocked to a pass-through: the guard middleware has
 * its own tests (tests/api/middleware/authorization.test.ts), so what matters
 * here is that these routes are *wired* with admin gating, plus the handler
 * logic the guard never sees - secret handling, SSRF rejection, and the
 * redirect URI.
 *
 * The client secret is the thing under test throughout. It is encrypted at
 * rest, decrypted on every repository read, and must never reach a response
 * body; and an omitted secret on write means "keep the stored one", never
 * "clear it".
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

const { mockGuard, mockValidateSSRF } = vi.hoisted(() => ({
  mockGuard: vi.fn(),
  mockValidateSSRF: vi.fn(),
}));

vi.mock('../../src/api/authorization/index.js', () => ({
  guard: mockGuard,
}));

vi.mock('../../src/integrations/security/ssrf-validator.js', () => ({
  validateSSRFProtection: mockValidateSSRF,
}));

const { organizationSsoRoutes } = await import('../../src/api/routes/organization-sso.js');
const { config } = await import('../../src/config.js');

const ORG_ID = '11111111-2222-3333-4444-555555555555';
const SSO_URL = `/api/v1/organizations/${ORG_ID}/sso`;

const storedConfig = {
  id: 'row-1',
  tenantId: ORG_ID,
  issuerUrl: 'https://idp.example.com',
  clientId: 'client-abc',
  clientSecret: 'super-secret-value',
  allowedDomains: ['example.com'],
  enforceSso: false,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const validBody = {
  issuerUrl: 'https://idp.example.com',
  clientId: 'client-abc',
  clientSecret: 'a-new-secret',
  allowedDomains: ['example.com'],
  enforceSso: true,
};

let findByTenantId: ReturnType<typeof vi.fn>;
let upsert: ReturnType<typeof vi.fn>;
let server: FastifyInstance;
const originalRedirectBase = config.oidc.redirectBaseUrl;
/**
 * Bodies as the guard sees them - i.e. after schema validation, which is also
 * what the global audit hook later reads off `request.body`.
 */
let bodiesSeenByGuard: unknown[];

async function buildServer() {
  findByTenantId = vi.fn().mockResolvedValue(null);
  upsert = vi.fn().mockImplementation(async (input) => ({ ...storedConfig, ...input }));

  const db = { oidcIdpConfigs: { findByTenantId, upsert } };
  // Must mirror server.ts's ajv options, not Fastify's defaults. The real
  // server sets `removeAdditional: false` deliberately ("Default (true)
  // silently strips extra properties, which can mask injection attempts"), so
  // a bare `Fastify()` here would validate bodies under different rules than
  // production and quietly assert the wrong behaviour for unknown fields.
  const app = Fastify({ ajv: { customOptions: { removeAdditional: false } } });
  organizationSsoRoutes(app, db as never);
  await app.ready();
  return app;
}

beforeEach(async () => {
  vi.clearAllMocks();
  bodiesSeenByGuard = [];
  // Pass-through guard: authorization behaviour is tested elsewhere. It runs
  // as a preHandler, i.e. after schema validation, so recording the body here
  // captures exactly what the audit hook would persist.
  mockGuard.mockReturnValue(async (request: { body?: unknown }) => {
    bodiesSeenByGuard.push(request.body);
  });
  mockValidateSSRF.mockImplementation((url: string) => new URL(url));
  config.oidc.redirectBaseUrl = 'https://api.example.com';
  server = await buildServer();
});

afterEach(async () => {
  config.oidc.redirectBaseUrl = originalRedirectBase;
  await server?.close();
});

describe('authorization wiring', () => {
  it('builds an org-admin guard', () => {
    // One guard instance, shared by both verbs - same shape
    // intelligence-settings.ts uses for its admin routes. Owners satisfy this
    // too: the guard compares role levels (owner > admin > member) rather than
    // testing equality, which is what makes it agree with the page's own
    // canManageSso().
    expect(mockGuard).toHaveBeenCalledTimes(1);
    expect(mockGuard.mock.calls[0][1]).toMatchObject({
      auth: 'user',
      resource: { type: 'organization' },
      orgRole: 'admin',
      action: 'manage',
    });
  });

  it('actually applies it to both verbs', async () => {
    // Asserting the guard was *constructed* proves nothing about it being
    // attached. Rebuild with a denying guard and confirm neither verb runs.
    mockGuard.mockReturnValue(
      async (_request: unknown, reply: { code: (n: number) => { send: (b: unknown) => void } }) => {
        reply.code(403).send({ error: 'Forbidden' });
      }
    );
    const denied = await buildServer();

    try {
      const read = await denied.inject({ method: 'GET', url: SSO_URL });
      const write = await denied.inject({ method: 'PUT', url: SSO_URL, payload: validBody });

      expect(read.statusCode).toBe(403);
      expect(write.statusCode).toBe(403);
      expect(upsert).not.toHaveBeenCalled();
    } finally {
      await denied.close();
    }
  });
});

describe('GET /api/v1/organizations/:id/sso', () => {
  it('returns an empty form rather than 404 for an unconfigured tenant', async () => {
    const res = await server.inject({ method: 'GET', url: SSO_URL });

    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({
      issuerUrl: '',
      clientId: '',
      hasClientSecret: false,
      allowedDomains: [],
      enforceSso: false,
    });
  });

  it('never returns the client secret, only whether one is stored', async () => {
    findByTenantId.mockResolvedValue(storedConfig);

    const res = await server.inject({ method: 'GET', url: SSO_URL });

    expect(res.json().data.hasClientSecret).toBe(true);
    // Assert on the raw payload, not the parsed object: a nested or renamed
    // leak would still show up as the literal secret in the bytes.
    expect(res.payload).not.toContain('super-secret-value');
    expect(res.json().data).not.toHaveProperty('clientSecret');
  });

  it('reports the redirect URI the server would actually send to the IdP', async () => {
    const res = await server.inject({ method: 'GET', url: SSO_URL });

    expect(res.json().data.redirectUri).toBe(
      `https://api.example.com/api/v1/auth/oidc/${ORG_ID}/callback`
    );
  });

  it('reports a null redirect URI when OIDC_REDIRECT_BASE_URL is unset', async () => {
    // The state every deployment is in today: the login route throws a
    // ConfigurationError here, so the UI needs to say so rather than print a
    // URI that would never match.
    config.oidc.redirectBaseUrl = null;

    const res = await server.inject({ method: 'GET', url: SSO_URL });

    expect(res.json().data.redirectUri).toBeNull();
  });
});

describe('PUT /api/v1/organizations/:id/sso', () => {
  const put = (body: Record<string, unknown>) =>
    server.inject({ method: 'PUT', url: SSO_URL, payload: body });

  it('stores a new configuration', async () => {
    const res = await put(validBody);

    expect(res.statusCode).toBe(200);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: ORG_ID, clientSecret: 'a-new-secret', enforceSso: true })
    );
  });

  it('keeps the stored secret when the field is omitted', async () => {
    findByTenantId.mockResolvedValue(storedConfig);
    const { clientSecret: _omitted, ...withoutSecret } = validBody;

    const res = await put(withoutSecret);

    expect(res.statusCode).toBe(200);
    // The whole point of the admin client omitting the key rather than
    // sending '': re-saving the form must not wipe the credential.
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ clientSecret: 'super-secret-value' })
    );
  });

  it('refuses to create a config with no secret at all', async () => {
    const { clientSecret: _omitted, ...withoutSecret } = validBody;

    const res = await put(withoutSecret);

    expect(res.statusCode).toBe(400);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('rejects an empty-string secret instead of storing one', async () => {
    const res = await put({ ...validBody, clientSecret: '' });

    expect(res.statusCode).toBe(400);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('refuses to persist an empty allowedDomains list', async () => {
    // ADR-0044 decision 2 makes the domain check fail closed: the callback
    // rejects every login when the list is empty. Saving one would store a
    // config that can never authenticate anyone, and turning on enforceSso
    // alongside it locks the whole org out - the #408 shape.
    const res = await put({ ...validBody, allowedDomains: [] });

    expect(res.statusCode).toBe(400);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('normalizes domains before storing them', async () => {
    // The callback compares `domain.toLowerCase() === emailDomain` with no
    // trim, so a stored "example.com " matches nothing and rejects every login
    // while looking saved. Duplicates that differ only by case collapse too.
    const res = await put({
      ...validBody,
      allowedDomains: ['  Example.COM  ', 'example.com', 'Other.Example.com'],
    });

    expect(res.statusCode).toBe(200);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ allowedDomains: ['example.com', 'other.example.com'] })
    );
  });

  it('refuses a domain list that is only blanks', async () => {
    // `minItems: 1` sees one element and passes; it is empty by the time it
    // would be stored, which is the same dead config by another route.
    const res = await put({ ...validBody, allowedDomains: ['   '] });

    expect(res.statusCode).toBe(400);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('skips the config read when the secret is supplied', async () => {
    // Only needed to carry forward an omitted secret; on this path it is
    // avoidable load on every save.
    await put(validBody);

    expect(findByTenantId).not.toHaveBeenCalled();
  });

  it('rejects a non-https issuer', async () => {
    const res = await put({ ...validBody, issuerUrl: 'http://idp.example.com' });

    expect(res.statusCode).toBe(400);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('rejects an issuer the SSRF validator refuses', async () => {
    // A tenant admin controls this value and the server fetches it at every
    // login, so the same validator the discovery path uses runs at save time.
    mockValidateSSRF.mockImplementation(() => {
      throw new Error('blocked private address');
    });

    const res = await put({ ...validBody, issuerUrl: 'https://169.254.169.254/' });

    expect(res.statusCode).toBe(400);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('does not echo the secret back in the write response', async () => {
    const res = await put(validBody);

    expect(res.payload).not.toContain('a-new-secret');
    expect(res.json().data.hasClientSecret).toBe(true);
  });

  it('rejects unknown fields outright rather than silently dropping them', async () => {
    // `additionalProperties: false` plus the server's `removeAdditional: false`
    // means ajv fails the request instead of quietly deleting the key. The
    // request never reaches the guard, the handler, or the audit hook that
    // would otherwise persist the body into audit_logs.details.
    const res = await put({ ...validBody, sneaky: 'value' });

    expect(res.statusCode).toBe(400);
    expect(bodiesSeenByGuard).toHaveLength(0);
    expect(upsert).not.toHaveBeenCalled();
  });
});
