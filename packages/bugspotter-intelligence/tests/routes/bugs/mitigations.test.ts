import Fastify, { FastifyInstance } from 'fastify';
import { describe, it, expect, vi, type Mock } from 'vitest';

interface MockMitigationService {
  getBugById: Mock;
  findMitigations: Mock;
}

interface MockAuthService {
  verifyToken: Mock;
}

function buildApp(
  serviceOverrides: Partial<MockMitigationService> = {},
  authOverrides: Partial<MockAuthService> = {}
): FastifyInstance {
  const app = Fastify();
  const mitigationService: MockMitigationService = {
    getBugById: vi.fn(),
    findMitigations: vi.fn(),
    ...serviceOverrides,
  };
  const authService: MockAuthService = {
    verifyToken: vi.fn(),
    ...authOverrides,
  };
  app.decorate('mitigationService', mitigationService);
  app.decorate('authService', authService);
  app.register(import('../../../src/routes/bugs/mitigations.js'));
  return app;
}

describe('GET /api/v1/bugs/:id/mitigations', () => {
  it('returns 401 when Authorization header is absent', async () => {
    const app = buildApp();
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/api/v1/bugs/bug-123/mitigations' });

    expect(res.statusCode).toBe(401);
  });

  it('returns 403 when the bug belongs to a different tenant', async () => {
    const app = buildApp(
      { getBugById: vi.fn().mockResolvedValue({ id: 'bug-123', tenantId: 'tenant-b' }) },
      { verifyToken: vi.fn().mockReturnValue({ tenantId: 'tenant-a' }) }
    );
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/bugs/bug-123/mitigations',
      headers: { authorization: 'Bearer opaque-credential' },
    });

    expect(res.statusCode).toBe(403);
  });

  it('returns 401 when verifyToken succeeds but yields no tenantId, even for an unscoped bug', async () => {
    // Regression test: without an explicit tenantId check, `undefined !==
    // undefined` is false, so a credential that verifies but carries no
    // tenantId would pass the ownership check against any bug that also
    // has no tenantId — an auth bypass.
    const app = buildApp(
      { getBugById: vi.fn().mockResolvedValue({ id: 'bug-123', tenantId: undefined }) },
      { verifyToken: vi.fn().mockReturnValue({}) }
    );
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/bugs/bug-123/mitigations',
      headers: { authorization: 'Bearer opaque-credential' },
    });

    expect(res.statusCode).toBe(401);
  });

  it('returns mitigation results for an authorised, same-tenant request', async () => {
    const mockResponse = {
      bug_id: 'bug-123',
      mitigation_suggestion: 'Sanitize user input before passing to query builder',
      based_on_similar_bugs: true,
    };
    const app = buildApp(
      {
        getBugById: vi.fn().mockResolvedValue({ id: 'bug-123', tenantId: 'tenant-a' }),
        findMitigations: vi.fn().mockResolvedValue(mockResponse),
      },
      { verifyToken: vi.fn().mockReturnValue({ tenantId: 'tenant-a' }) }
    );
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/bugs/bug-123/mitigations',
      headers: { authorization: 'Bearer opaque-credential' },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual(mockResponse);
  });
});
