import Fastify, { FastifyInstance } from 'fastify';
import { describe, it, expect, vi, type Mock } from 'vitest';

interface MockSimilarityService {
  getBugById: Mock;
  findSimilar: Mock;
}

interface MockAuthService {
  verifyToken: Mock;
}

function buildApp(
  serviceOverrides: Partial<MockSimilarityService> = {},
  authOverrides: Partial<MockAuthService> = {}
): FastifyInstance {
  const app = Fastify();
  const similarityService: MockSimilarityService = {
    getBugById: vi.fn(),
    findSimilar: vi.fn(),
    ...serviceOverrides,
  };
  const authService: MockAuthService = {
    verifyToken: vi.fn(),
    ...authOverrides,
  };
  app.decorate('similarityService', similarityService);
  app.decorate('authService', authService);
  app.register(import('../../../src/routes/bugs/similar.js'));
  return app;
}

describe('GET /api/v1/bugs/:id/similar', () => {
  it('returns 401 when Authorization header is absent', async () => {
    const app = buildApp();
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/api/v1/bugs/bug-123/similar' });

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
      url: '/api/v1/bugs/bug-123/similar',
      headers: { authorization: 'Bearer opaque-credential' },
    });

    expect(res.statusCode).toBe(403);
  });

  it('returns similarity results for an authorised, same-tenant request', async () => {
    const mockResponse = {
      bug_id: 'bug-123',
      is_duplicate: false,
      similar_bugs: [
        {
          bug_id: 'bug-456',
          title: 'Login button unresponsive on Safari',
          description: null,
          status: 'open',
          resolution: null,
          similarity: 0.91,
        },
      ],
      threshold_used: 0.8,
    };
    const app = buildApp(
      {
        getBugById: vi.fn().mockResolvedValue({ id: 'bug-123', tenantId: 'tenant-a' }),
        findSimilar: vi.fn().mockResolvedValue(mockResponse),
      },
      { verifyToken: vi.fn().mockReturnValue({ tenantId: 'tenant-a' }) }
    );
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/bugs/bug-123/similar',
      headers: { authorization: 'Bearer opaque-credential' },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual(mockResponse);
  });
});
