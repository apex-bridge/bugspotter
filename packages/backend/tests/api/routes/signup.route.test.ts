/**
 * Signup Route Smoke Tests
 *
 * Route-level verification that cannot be covered by the service-level
 * tests in `tests/saas/signup.service.test.ts`: SELF_SERVICE_SIGNUP_ENABLED
 * gating, honeypot field name, refresh_token cookie shape
 * (domain + SameSite), and JSON-schema request validation.
 *
 * Uses a minimal Fastify instance with the same plugins the real server
 * registers (cookie, rate-limit, jwt) but with a mocked DatabaseClient —
 * so these stay unit tests, runnable without Docker/testcontainers.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import jwt from '@fastify/jwt';
import type { DatabaseClient } from '../../../src/db/client.js';

// ---------------------------------------------------------------------------
// Config mock — uses `vi.hoisted` so the mutable object is available both
// inside the hoisted vi.mock factory AND to individual tests that need to
// flip `selfServiceSignupEnabled` / `cookieDomain` per-case.
// ---------------------------------------------------------------------------

const { mockConfig } = vi.hoisted(() => ({
  mockConfig: {
    auth: {
      allowRegistration: true,
      requireInvitationToRegister: false,
      selfServiceSignupEnabled: true,
      cookieDomain: null as string | null,
    },
    dataResidency: { region: 'kz' },
    jwt: {
      secret: 'test-secret-exactly-32-characters-xxxx',
      expiresIn: '1h',
      refreshExpiresIn: '7d',
    },
    server: { env: 'test' },
  },
}));

vi.mock('../../../src/config.js', () => ({
  config: mockConfig,
}));

vi.mock('../../../src/logger.js', () => ({
  getLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Import AFTER mocks so everything resolves to the mocked config.
import { signupRoutes } from '../../../src/api/routes/signup.js';
import { errorHandler } from '../../../src/api/middleware/error.js';

// ---------------------------------------------------------------------------
// Mock DB — reuses the same shape as the service-level tests, without
// pulling them in directly (keeps the test files independently readable).
// ---------------------------------------------------------------------------

function createHappyMockDb(): DatabaseClient {
  const tx = {
    users: {
      create: vi.fn(async (d: Record<string, unknown>) => ({
        id: 'user-uuid',
        created_at: new Date(),
        ...d,
      })),
    },
    organizations: {
      create: vi.fn(async (d: Record<string, unknown>) => ({
        id: 'org-uuid',
        created_at: new Date(),
        updated_at: new Date(),
        ...d,
      })),
    },
    subscriptions: {
      create: vi.fn(async (d: Record<string, unknown>) => ({
        id: 'sub-uuid',
        created_at: new Date(),
        updated_at: new Date(),
        ...d,
      })),
    },
    organizationMembers: {
      create: vi.fn(async (d: Record<string, unknown>) => ({ id: 'member-uuid', ...d })),
    },
    projects: {
      create: vi.fn(async (d: Record<string, unknown>) => ({
        id: 'project-uuid',
        created_at: new Date(),
        updated_at: new Date(),
        ...d,
      })),
    },
    apiKeys: {
      create: vi.fn(async (d: Record<string, unknown>) => ({
        id: 'apikey-uuid',
        created_at: new Date(),
        updated_at: new Date(),
        ...d,
      })),
      logAudit: vi.fn(async () => undefined),
    },
    emailVerificationTokens: {
      create: vi.fn(async (d: Record<string, unknown>) => ({
        id: 'evt-uuid',
        consumed_at: null,
        created_at: new Date(),
        ...d,
      })),
      findByToken: vi.fn(async () => null),
      consume: vi.fn(async () => true),
      invalidateUnconsumedForUser: vi.fn(async () => 0),
    },
    auditLogs: {
      create: vi.fn(async (d: Record<string, unknown>) => ({
        id: 'audit-uuid',
        timestamp: new Date(),
        ...d,
      })),
    },
  };

  // Extend tx.users with the methods used outside signup() — verifyEmail
  // reads + atomic-stamps; resendVerification locks first, then reads.
  const txUsers = (tx as unknown as { users: Record<string, unknown> }).users;
  txUsers.update = vi.fn(async (id: string, d: Record<string, unknown>) => ({ id, ...d }));
  txUsers.findById = vi.fn(async () => null);
  txUsers.lockForUpdate = vi.fn(async () => undefined);
  txUsers.markEmailVerified = vi.fn(async () => true);

  return {
    users: {
      findByEmail: vi.fn(async () => null),
      findById: vi.fn(async () => null),
    },
    organizations: { isSubdomainAvailable: vi.fn(async () => true) },
    organizationRequests: {
      countRecentByIp: vi.fn(async () => 0),
      findPendingByEmail: vi.fn(async () => null),
      isSubdomainTaken: vi.fn(async () => false),
      isSubdomainReservedByRequest: vi.fn(async () => false),
    },
    transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx)),
  } as unknown as DatabaseClient;
}

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

async function buildServer(db: DatabaseClient): Promise<FastifyInstance> {
  const server = Fastify();
  await server.register(cookie);
  await server.register(rateLimit, {
    max: 10_000, // high enough to not affect these tests
    timeWindow: '1 minute',
  });
  await server.register(jwt, { secret: mockConfig.jwt.secret });
  // Mirror production: an onRequest hook reads the Bearer token (if
  // present) and populates request.authUser. Public routes still work
  // without one — `authUser` is just undefined. We need this for the
  // resend-verification tests, which gate on requireUser.
  const { createAuthMiddleware } = await import('../../../src/api/middleware/auth.js');
  server.addHook('onRequest', createAuthMiddleware(db));
  server.setErrorHandler(errorHandler);
  signupRoutes(server, db);
  await server.ready();
  return server;
}

function validPayload() {
  return {
    email: 'founder@acme.com',
    password: 'correct-horse-battery-staple',
    name: 'Jane Founder',
    company_name: 'Acme Corp',
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/v1/auth/signup (route smoke)', () => {
  let server: FastifyInstance;

  beforeEach(() => {
    mockConfig.auth.selfServiceSignupEnabled = true;
    mockConfig.auth.cookieDomain = null;
  });

  afterEach(async () => {
    if (server) {
      await server.close();
    }
  });

  it('returns 201 + provisioning payload on happy path', async () => {
    server = await buildServer(createHappyMockDb());

    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      payload: validPayload(),
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.user.email).toBe('founder@acme.com');
    expect(body.data.organization.subdomain).toBe('acme-corp');
    expect(body.data.project.name).toBe('Default');
    expect(body.data.api_key).toMatch(/^bgs_/);
    expect(body.data.access_token).toBeTruthy();
  });

  it('returns 403 when SELF_SERVICE_SIGNUP_ENABLED is false', async () => {
    mockConfig.auth.selfServiceSignupEnabled = false;
    server = await buildServer(createHappyMockDb());

    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      payload: validPayload(),
    });

    expect(res.statusCode).toBe(403);
  });

  it('maps the `website` body field to the honeypot and rejects non-empty values with 403', async () => {
    // This verifies the handler-level mapping — the service test covers
    // the honeypot logic itself, but only this test proves the route
    // correctly names the honeypot field `website` in the JSON body.
    server = await buildServer(createHappyMockDb());

    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      payload: { ...validPayload(), website: 'https://bot-filled-this.com' },
    });

    expect(res.statusCode).toBe(403);
  });

  it('emits a host-scoped refresh_token cookie when COOKIE_DOMAIN is unset', async () => {
    mockConfig.auth.cookieDomain = null;
    server = await buildServer(createHappyMockDb());

    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      payload: validPayload(),
    });

    expect(res.statusCode).toBe(201);
    const setCookie = res.headers['set-cookie'];
    const cookieStr = Array.isArray(setCookie) ? setCookie.join('\n') : String(setCookie ?? '');
    expect(cookieStr).toMatch(/refresh_token=/);
    expect(cookieStr).toMatch(/HttpOnly/);
    expect(cookieStr).toMatch(/SameSite=Strict/i);
    expect(cookieStr).not.toMatch(/Domain=/i);
  });

  it('emits a parent-domain refresh_token cookie with SameSite=Lax when COOKIE_DOMAIN is set', async () => {
    mockConfig.auth.cookieDomain = '.kz.bugspotter.io';
    server = await buildServer(createHappyMockDb());

    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      payload: validPayload(),
    });

    expect(res.statusCode).toBe(201);
    const setCookie = res.headers['set-cookie'];
    const cookieStr = Array.isArray(setCookie) ? setCookie.join('\n') : String(setCookie ?? '');
    expect(cookieStr).toMatch(/refresh_token=/);
    expect(cookieStr).toMatch(/Domain=\.kz\.bugspotter\.io/);
    expect(cookieStr).toMatch(/SameSite=Lax/i);
  });

  it('rejects payloads missing required fields with 400', async () => {
    server = await buildServer(createHappyMockDb());

    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      payload: { email: 'no-password@example.com' },
    });

    expect(res.statusCode).toBe(400);
  });
});

describe('POST /api/v1/auth/verify-email (route smoke)', () => {
  let server: FastifyInstance;

  beforeEach(() => {
    mockConfig.auth.selfServiceSignupEnabled = true;
  });

  afterEach(async () => {
    if (server) {
      await server.close();
    }
  });

  it('returns 200 with email_verified=true when the token is valid', async () => {
    const db = createHappyMockDb();
    // Wire findByToken on the in-memory tx object the mock uses.
    // The mock's `transaction` callback is the only path that sees `tx`,
    // so we reach into the same closure's tx by replacing the
    // transaction implementation with one that exposes the same shape.
    const tx = {
      users: {
        update: vi.fn(async (id: string, d: Record<string, unknown>) => ({ id, ...d })),
        // verifyEmail's already-verified guard reads the user. Return
        // an unverified user so we proceed past the guard.
        findById: vi.fn(async () => ({
          id: 'user-uuid',
          email: 'founder@acme.com',
          name: 'Jane',
          email_verified_at: null,
        })),
        lockForUpdate: vi.fn(async () => undefined),
        // Atomic stamp succeeds — happy path.
        markEmailVerified: vi.fn(async () => true),
      },
      emailVerificationTokens: {
        findByToken: vi.fn(async () => ({
          id: 'evt-1',
          user_id: 'user-uuid',
          token: 'a'.repeat(43),
          expires_at: new Date(Date.now() + 60_000),
          consumed_at: null,
          created_at: new Date(),
        })),
        consume: vi.fn(async () => true),
        create: vi.fn(),
        invalidateUnconsumedForUser: vi.fn(),
      },
      auditLogs: {
        create: vi.fn(async () => undefined),
      },
    };
    (db.transaction as ReturnType<typeof vi.fn>).mockImplementation(
      async (cb: (t: unknown) => Promise<unknown>) => cb(tx)
    );

    server = await buildServer(db);

    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/verify-email',
      payload: { token: 'a'.repeat(43) },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.email_verified).toBe(true);
  });

  it('returns 400 for an unknown token', async () => {
    server = await buildServer(createHappyMockDb());

    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/verify-email',
      payload: { token: 'a'.repeat(43) },
    });

    expect(res.statusCode).toBe(400);
  });

  it('returns 403 when SELF_SERVICE_SIGNUP_ENABLED is false', async () => {
    mockConfig.auth.selfServiceSignupEnabled = false;
    server = await buildServer(createHappyMockDb());

    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/verify-email',
      payload: { token: 'a'.repeat(43) },
    });

    expect(res.statusCode).toBe(403);
  });

  it('returns 400 when token is shorter than the minLength', async () => {
    server = await buildServer(createHappyMockDb());

    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/verify-email',
      payload: { token: 'too-short' },
    });

    expect(res.statusCode).toBe(400);
  });
});

describe('POST /api/v1/auth/resend-verification (route smoke)', () => {
  let server: FastifyInstance;

  beforeEach(() => {
    mockConfig.auth.selfServiceSignupEnabled = true;
  });

  afterEach(async () => {
    if (server) {
      await server.close();
    }
  });

  function makeAuthHeader(s: FastifyInstance) {
    // handleJwtAuth (api/middleware/auth/handlers.ts) reads
    // `decoded.userId`. Match that, not `id`.
    return `Bearer ${s.jwt.sign({ userId: 'user-uuid' })}`;
  }

  /**
   * Replace `db.transaction` with one that runs the callback against
   * a tx object whose `users.findById` returns the supplied user
   * shape. The service's `resendVerification` reads via tx (so it
   * sees consistent state under the row lock), so a top-level
   * `db.users.findById` mock wouldn't be exercised.
   */
  function buildResendDb(verified: boolean): DatabaseClient {
    const db = createHappyMockDb();
    const txUser = {
      id: 'user-uuid',
      email: 'founder@acme.com',
      name: 'Jane',
      email_verified_at: verified ? new Date() : null,
    };
    // The auth middleware (handleJwtAuth) reads via db.users.findById,
    // NOT through a transaction — has to succeed before the route
    // body runs at all, otherwise we'd get 401 instead of 200/403.
    (db.users.findById as ReturnType<typeof vi.fn>).mockResolvedValue(txUser);
    const tx = {
      users: {
        lockForUpdate: vi.fn(async () => undefined),
        findById: vi.fn(async () => txUser),
        update: vi.fn(async (id: string, d: Record<string, unknown>) => ({ id, ...d })),
      },
      emailVerificationTokens: {
        invalidateUnconsumedForUser: vi.fn(async () => 0),
        create: vi.fn(async (d: Record<string, unknown>) => ({
          id: 'evt-uuid',
          consumed_at: null,
          created_at: new Date(),
          ...d,
        })),
        findByToken: vi.fn(),
        consume: vi.fn(),
      },
      auditLogs: {
        create: vi.fn(async () => undefined),
      },
    };
    (db.transaction as ReturnType<typeof vi.fn>).mockImplementation(
      async (cb: (t: unknown) => Promise<unknown>) => cb(tx)
    );
    return db;
  }

  it('returns 401 without an Authorization header', async () => {
    server = await buildServer(createHappyMockDb());

    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/resend-verification',
    });

    expect(res.statusCode).toBe(401);
  });

  it('returns 200 + generic message when user is unverified', async () => {
    server = await buildServer(buildResendDb(false));

    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/resend-verification',
      headers: { authorization: makeAuthHeader(server) },
    });

    expect(res.statusCode).toBe(200);
    expect(typeof res.json().data.message).toBe('string');
  });

  it('returns 200 + generic message when user is already verified (no leak)', async () => {
    server = await buildServer(buildResendDb(true));

    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/resend-verification',
      headers: { authorization: makeAuthHeader(server) },
    });

    // SAME response shape and status whether verified or not — prevents
    // a probe that distinguishes unverified accounts from verified ones.
    expect(res.statusCode).toBe(200);
    expect(typeof res.json().data.message).toBe('string');
  });

  it('returns 403 when SELF_SERVICE_SIGNUP_ENABLED is false', async () => {
    mockConfig.auth.selfServiceSignupEnabled = false;
    server = await buildServer(buildResendDb(false));

    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/resend-verification',
      headers: { authorization: makeAuthHeader(server) },
    });

    expect(res.statusCode).toBe(403);
  });
});
