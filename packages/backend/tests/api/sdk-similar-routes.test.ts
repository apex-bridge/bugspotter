/**
 * Unit tests for the SDK-facing `/api/v1/sdk/similar` endpoint.
 *
 * The contract under test:
 *  - Happy path: top-N matches above the SDK threshold are returned
 *    with the narrow public-facing projection (no description / no
 *    resolution / no timestamps).
 *  - Soft-fail surface: intelligence not configured / factory throws
 *    / search throws — all return `{ matches: [] }` with status 200,
 *    NEVER 503. The widget can't degrade gracefully if the probe
 *    surfaces errors to the user.
 *  - Similarity threshold filters below-floor matches client-side
 *    of the probe (intelligence /search doesn't enforce it).
 *  - Limit is bounded between 1 and 5, defaults to 3.
 *  - Per-org client is preferred over the global one when both are
 *    available — mirrors the admin-route pattern.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { sdkSimilarRoutes } from '../../src/api/routes/sdk-similar.js';

// ---------------------------------------------------------------------------
// Mocks: replace auth middleware with passthroughs that attach an
// authProject the route can read. Mirrors the SDK ingest path —
// `requireProject` sets `authProject`, `requireApiKeyPermission` is a no-op
// for ingest-only keys that hold `reports:write`.
// ---------------------------------------------------------------------------

const PROJECT_ID = 'c4c6dbfb-2e28-40d9-bc25-f4e5812b5ae0';
const ORG_ID = '0ae3f3af-4eea-400b-b8f5-39958c546c70';

vi.mock('../../src/api/middleware/auth.js', () => ({
  requireProject: async (request: any) => {
    request.authProject = { id: PROJECT_ID, organization_id: ORG_ID };
  },
  requireApiKeyPermission: () => async () => {},
}));

vi.mock('../../src/logger.js', () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSearchResult(
  overrides: Partial<{
    bug_id: string;
    title: string;
    status: string;
    similarity: number;
    description: string | null;
    resolution: string | null;
  }> = {}
) {
  return {
    bug_id: overrides.bug_id ?? 'bug-xyz',
    title: overrides.title ?? 'similar bug',
    description: overrides.description ?? 'desc that should not leak',
    status: overrides.status ?? 'closed',
    resolution: overrides.resolution ?? 'fixed in v2.3',
    similarity: overrides.similarity ?? 0.82,
    created_at: '2026-05-22T00:00:00Z',
  };
}

function createMockClient(searchImpl?: (req: unknown) => unknown) {
  return {
    search: vi.fn().mockImplementation((req) => {
      if (searchImpl) {
        return Promise.resolve(searchImpl(req));
      }
      return Promise.resolve({
        results: [makeSearchResult()],
        total: 1,
        limit: 3,
        offset: 0,
        mode: 'fast',
        query: 'q',
        cached: false,
      });
    }),
  } as any;
}

function createMockDb() {
  return {} as any;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('SDK similar endpoint', () => {
  let app: FastifyInstance;
  let globalClient: ReturnType<typeof createMockClient>;

  beforeEach(async () => {
    app = Fastify();
    globalClient = createMockClient();
    sdkSimilarRoutes(app, globalClient, createMockDb());
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('happy path', () => {
    it('returns matches with the narrow projection (no description/resolution/timestamps)', async () => {
      globalClient.search.mockResolvedValueOnce({
        results: [
          makeSearchResult({
            bug_id: 'bug-1',
            title: 'login button broken on Firefox',
            status: 'closed',
            similarity: 0.91,
          }),
        ],
        total: 1,
        limit: 3,
        offset: 0,
        mode: 'fast',
        query: 'login',
        cached: false,
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/sdk/similar',
        payload: { title: 'login broken' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json().data;
      expect(body.matches).toHaveLength(1);
      expect(body.matches[0]).toEqual({
        canonical_id: 'bug-1',
        title: 'login button broken on Firefox',
        status: 'closed',
        similarity: 0.91,
      });
      // Explicit no-leak assertions: an ingest-only key MUST NOT see
      // description / resolution / created_at via this endpoint.
      expect(body.matches[0]).not.toHaveProperty('description');
      expect(body.matches[0]).not.toHaveProperty('resolution');
      expect(body.matches[0]).not.toHaveProperty('created_at');
    });

    it('passes title + project_id + mode=fast to intelligence search', async () => {
      await app.inject({
        method: 'POST',
        url: '/api/v1/sdk/similar',
        payload: { title: 'cannot submit form' },
      });

      expect(globalClient.search).toHaveBeenCalledWith({
        query: 'cannot submit form',
        project_id: PROJECT_ID,
        mode: 'fast',
        limit: 3,
      });
    });
  });

  describe('threshold filter', () => {
    it('drops matches below the SDK floor (0.6) even though intelligence returned them', async () => {
      globalClient.search.mockResolvedValueOnce({
        results: [
          makeSearchResult({ bug_id: 'high', similarity: 0.82 }),
          makeSearchResult({ bug_id: 'low', similarity: 0.45 }),
          makeSearchResult({ bug_id: 'borderline', similarity: 0.59 }),
          makeSearchResult({ bug_id: 'just-in', similarity: 0.61 }),
        ],
        total: 4,
        limit: 3,
        offset: 0,
        mode: 'fast',
        query: 'x',
        cached: false,
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/sdk/similar',
        payload: { title: 'something broken' },
      });

      const ids = res.json().data.matches.map((m: { canonical_id: string }) => m.canonical_id);
      expect(ids).toEqual(['high', 'just-in']);
    });
  });

  describe('limit', () => {
    it('defaults to 3 when not provided', async () => {
      await app.inject({
        method: 'POST',
        url: '/api/v1/sdk/similar',
        payload: { title: 'broken thing' },
      });
      expect(globalClient.search).toHaveBeenCalledWith(expect.objectContaining({ limit: 3 }));
    });

    it('respects an explicit limit of 1', async () => {
      await app.inject({
        method: 'POST',
        url: '/api/v1/sdk/similar',
        payload: { title: 'broken thing', limit: 1 },
      });
      expect(globalClient.search).toHaveBeenCalledWith(expect.objectContaining({ limit: 1 }));
    });

    it('rejects a limit above the SDK ceiling (5) at the schema layer', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/sdk/similar',
        payload: { title: 'broken thing', limit: 50 },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('soft-fail surface (the launch-critical contract)', () => {
    it('returns empty matches (200) when the intelligence search throws', async () => {
      globalClient.search.mockRejectedValueOnce(new Error('intelligence down'));

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/sdk/similar',
        payload: { title: 'whatever' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().data.matches).toEqual([]);
    });

    it('returns empty matches (200) when intelligence is not configured for the org', async () => {
      // Factory exists but returns null for this org (Option C in the
      // admin-side resolveClient — but the SDK route soft-fails here
      // instead of 503).
      const factory = { getClientForOrg: vi.fn().mockResolvedValue(null) };
      const app2 = Fastify();
      sdkSimilarRoutes(app2, globalClient, createMockDb(), factory as any);
      await app2.ready();

      const res = await app2.inject({
        method: 'POST',
        url: '/api/v1/sdk/similar',
        payload: { title: 'whatever' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().data.matches).toEqual([]);
      // Global client should NOT have been used as a fallback when
      // factory existed but returned null — that branch means the org
      // explicitly hasn't enabled intelligence.
      expect(globalClient.search).not.toHaveBeenCalled();
      await app2.close();
    });

    it('returns empty matches (200) when the factory itself throws', async () => {
      const factory = {
        getClientForOrg: vi.fn().mockRejectedValue(new Error('DB connection lost')),
      };
      const app2 = Fastify();
      sdkSimilarRoutes(app2, globalClient, createMockDb(), factory as any);
      await app2.ready();

      const res = await app2.inject({
        method: 'POST',
        url: '/api/v1/sdk/similar',
        payload: { title: 'whatever' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().data.matches).toEqual([]);
      await app2.close();
    });
  });

  describe('input validation', () => {
    it('soft-fails (200 + empty matches) for a title shorter than 5 chars', async () => {
      // Matches the file's "probe never errors to the widget" contract:
      // short / whitespace-only titles produce empty matches, not 400.
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/sdk/similar',
        payload: { title: 'hi' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.matches).toEqual([]);
      expect(globalClient.search).not.toHaveBeenCalled();
    });

    it('soft-fails (200 + empty matches) for a whitespace-only title', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/sdk/similar',
        payload: { title: '          ' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.matches).toEqual([]);
      expect(globalClient.search).not.toHaveBeenCalled();
    });
  });
});
