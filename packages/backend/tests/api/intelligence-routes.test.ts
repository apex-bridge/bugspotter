/**
 * Intelligence Routes Tests
 * Tests for per-org client resolution in intelligence proxy routes.
 *
 * Key behavior under test:
 * - Routes resolve the per-org IntelligenceClient via clientFactory
 * - Returns 503 when org context exists but no per-org client available
 * - Falls back to global client only when no org context or no factory (self-hosted / backward compat)
 * - Health endpoint always uses the global client
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { intelligenceRoutes } from '../../src/api/routes/intelligence.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock auth middleware to be passthrough
vi.mock('../../src/api/middleware/auth.js', () => ({
  requireAuth: async () => {},
}));

// Mock guard middleware to attach project with organization_id
const MOCK_ORG_ID = '0ae3f3af-4eea-400b-b8f5-39958c546c70';
const mockGuardImpl = vi.fn((request: any) => {
  request.project = { id: request.params?.projectId, organization_id: MOCK_ORG_ID };
});
vi.mock('../../src/api/authorization/index.js', () => ({
  guard: () => async (request: any) => mockGuardImpl(request),
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
// Helper: create mock IntelligenceClient
// ---------------------------------------------------------------------------
function createMockClient(overrides = {}) {
  return {
    healthCheck: vi.fn().mockResolvedValue(true),
    getCircuitState: vi.fn().mockReturnValue({ state: 'closed', failureCount: 0 }),
    getSimilarBugs: vi.fn().mockResolvedValue({
      bug_id: 'bug-1',
      is_duplicate: false,
      similar_bugs: [],
      threshold_used: 0.75,
    }),
    getMitigation: vi.fn().mockResolvedValue({
      bug_id: 'bug-1',
      mitigation_suggestion: 'Try restarting the service',
      based_on_similar_bugs: true,
    }),
    search: vi.fn().mockResolvedValue({
      results: [],
      total: 0,
      limit: 10,
      offset: 0,
      mode: 'fast',
      query: 'test',
      cached: false,
    }),
    ask: vi.fn().mockResolvedValue({
      answer: 'The issue is...',
      provider: 'ollama',
      model: 'llama3.1:8b',
    }),
    submitEventFeedback: vi.fn().mockResolvedValue({
      feedback_id: 'fb-1',
    }),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helper: create mock client factory
// ---------------------------------------------------------------------------
function createMockClientFactory(orgClient: any = null) {
  return {
    getClientForOrg: vi.fn().mockResolvedValue(orgClient),
  };
}

// ---------------------------------------------------------------------------
// Helper: create mock DB (minimal for route registration)
// ---------------------------------------------------------------------------
function createMockDb() {
  return {
    projects: {
      findById: vi.fn().mockResolvedValue({ id: 'proj-1', organization_id: MOCK_ORG_ID }),
      getUserRole: vi.fn().mockResolvedValue('admin'),
    },
    organizations: {
      findById: vi.fn().mockResolvedValue({ id: MOCK_ORG_ID, settings: {} }),
    },
  } as any;
}

// ---------------------------------------------------------------------------
// Test suites
// ---------------------------------------------------------------------------

const PROJECT_ID = 'c4c6dbfb-2e28-40d9-bc25-f4e5812b5ae0';
const BUG_ID = '44886e38-41e7-4b57-8dc8-df3e869e3a15';

describe('Intelligence Routes - Per-Org Client Resolution', () => {
  let app: FastifyInstance;
  let globalClient: ReturnType<typeof createMockClient>;
  let orgClient: ReturnType<typeof createMockClient>;
  let clientFactory: ReturnType<typeof createMockClientFactory>;
  let mockDb: ReturnType<typeof createMockDb>;

  beforeEach(async () => {
    app = Fastify();
    globalClient = createMockClient();
    orgClient = createMockClient();
    clientFactory = createMockClientFactory(orgClient);
    mockDb = createMockDb();

    intelligenceRoutes(app, globalClient, mockDb, clientFactory as any);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('health endpoint', () => {
    it('always uses the global client', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/intelligence/health',
      });

      expect(res.statusCode).toBe(200);
      expect(globalClient.healthCheck).toHaveBeenCalled();
      expect(clientFactory.getClientForOrg).not.toHaveBeenCalled();
    });
  });

  describe('similar bugs endpoint', () => {
    it('uses per-org client when available', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/intelligence/projects/${PROJECT_ID}/bugs/${BUG_ID}/similar`,
      });

      expect(res.statusCode).toBe(200);
      expect(clientFactory.getClientForOrg).toHaveBeenCalledWith(MOCK_ORG_ID);
      expect(orgClient.getSimilarBugs).toHaveBeenCalledWith(
        BUG_ID,
        expect.objectContaining({ projectId: PROJECT_ID })
      );
      expect(globalClient.getSimilarBugs).not.toHaveBeenCalled();
    });

    it('returns 503 with "temporarily unavailable" when factory throws', async () => {
      clientFactory.getClientForOrg.mockRejectedValue(new Error('DB connection failed'));

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/intelligence/projects/${PROJECT_ID}/bugs/${BUG_ID}/similar`,
      });

      expect(res.statusCode).toBe(503);
      expect(res.json().message).toContain('temporarily unavailable');
      expect(globalClient.getSimilarBugs).not.toHaveBeenCalled();
    });

    it('returns 503 with "not configured" when per-org client is null', async () => {
      clientFactory.getClientForOrg.mockResolvedValue(null);

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/intelligence/projects/${PROJECT_ID}/bugs/${BUG_ID}/similar`,
      });

      expect(res.statusCode).toBe(503);
      expect(res.json().message).toContain('not configured');
    });

    it('uses the client-supplied threshold and does not look up the org setting', async () => {
      await app.inject({
        method: 'GET',
        url: `/api/v1/intelligence/projects/${PROJECT_ID}/bugs/${BUG_ID}/similar?threshold=0.9`,
      });
      expect(orgClient.getSimilarBugs).toHaveBeenCalledWith(
        BUG_ID,
        expect.objectContaining({ threshold: 0.9 })
      );
      expect(mockDb.organizations.findById).not.toHaveBeenCalled();
    });

    it('falls back to the org threshold when the client omits one', async () => {
      mockDb.organizations.findById.mockResolvedValue({
        id: MOCK_ORG_ID,
        settings: { intelligence_similarity_threshold: 0.7 },
      });
      await app.inject({
        method: 'GET',
        url: `/api/v1/intelligence/projects/${PROJECT_ID}/bugs/${BUG_ID}/similar`,
      });
      expect(orgClient.getSimilarBugs).toHaveBeenCalledWith(
        BUG_ID,
        expect.objectContaining({ threshold: 0.7 })
      );
      expect(mockDb.organizations.findById).toHaveBeenCalledWith(MOCK_ORG_ID);
    });

    it('omits threshold entirely when neither client nor org has one set', async () => {
      // mockDb.organizations.findById resolves { settings: {} } by default (set in beforeEach)
      await app.inject({
        method: 'GET',
        url: `/api/v1/intelligence/projects/${PROJECT_ID}/bugs/${BUG_ID}/similar`,
      });
      expect(orgClient.getSimilarBugs).toHaveBeenCalledWith(
        BUG_ID,
        expect.objectContaining({ threshold: undefined })
      );
    });

    it('omits threshold when the org setting is explicitly null', async () => {
      mockDb.organizations.findById.mockResolvedValue({
        id: MOCK_ORG_ID,
        settings: { intelligence_similarity_threshold: null },
      });
      await app.inject({
        method: 'GET',
        url: `/api/v1/intelligence/projects/${PROJECT_ID}/bugs/${BUG_ID}/similar`,
      });
      expect(orgClient.getSimilarBugs).toHaveBeenCalledWith(
        BUG_ID,
        expect.objectContaining({ threshold: undefined })
      );
    });

    it('does not attempt an org lookup when there is no organization_id (self-hosted)', async () => {
      mockGuardImpl.mockImplementationOnce((request: any) => {
        request.project = { id: 'proj-1', organization_id: null };
      });
      const selfHostedApp = Fastify();
      const selfHostedDb = createMockDb();
      intelligenceRoutes(selfHostedApp, globalClient, selfHostedDb); // no clientFactory - self-hosted path
      await selfHostedApp.ready();
      try {
        await selfHostedApp.inject({
          method: 'GET',
          url: `/api/v1/intelligence/projects/${PROJECT_ID}/bugs/${BUG_ID}/similar`,
        });
      } finally {
        await selfHostedApp.close();
      }
      expect(selfHostedDb.organizations.findById).not.toHaveBeenCalled();
      expect(globalClient.getSimilarBugs).toHaveBeenCalledWith(
        BUG_ID,
        expect.objectContaining({ threshold: undefined })
      );
    });
  });

  // NOTE: Mitigation endpoint moved to intelligence-mitigation.ts (async pipeline).
  // Queue triggering: tests/api/utils/mitigation-trigger.test.ts
  // Job validation: tests/queue/job-definitions.test.ts
  // Route-level GET/POST tests: not yet covered (future addition)

  describe('search endpoint', () => {
    it('uses per-org client when available', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/intelligence/projects/${PROJECT_ID}/search`,
        payload: { query: 'login error' },
      });

      expect(res.statusCode).toBe(200);
      expect(clientFactory.getClientForOrg).toHaveBeenCalledWith(MOCK_ORG_ID);
      expect(orgClient.search).toHaveBeenCalled();
      expect(globalClient.search).not.toHaveBeenCalled();
    });

    it('returns 503 when per-org client is null', async () => {
      clientFactory.getClientForOrg.mockResolvedValue(null);

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/intelligence/projects/${PROJECT_ID}/search`,
        payload: { query: 'login error' },
      });

      expect(res.statusCode).toBe(503);
      expect(globalClient.search).not.toHaveBeenCalled();
    });
  });

  describe('ask endpoint', () => {
    it('uses per-org client when available', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/intelligence/projects/${PROJECT_ID}/ask`,
        payload: { question: 'What causes this bug?' },
      });

      expect(res.statusCode).toBe(200);
      expect(clientFactory.getClientForOrg).toHaveBeenCalledWith(MOCK_ORG_ID);
      expect(orgClient.ask).toHaveBeenCalled();
      expect(globalClient.ask).not.toHaveBeenCalled();
    });

    it('returns 503 when per-org client is null', async () => {
      clientFactory.getClientForOrg.mockResolvedValue(null);

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/intelligence/projects/${PROJECT_ID}/ask`,
        payload: { question: 'What causes this bug?' },
      });

      expect(res.statusCode).toBe(503);
      expect(globalClient.ask).not.toHaveBeenCalled();
    });
  });

  describe('event-feedback endpoint', () => {
    const EVENT_ID = '11111111-2222-4333-8444-555555555555';

    it('uses per-org client when available', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/intelligence/projects/${PROJECT_ID}/event-feedback`,
        payload: { event_id: EVENT_ID, verdict: 'correct' },
      });

      expect(res.statusCode).toBe(200);
      expect(clientFactory.getClientForOrg).toHaveBeenCalledWith(MOCK_ORG_ID);
      expect(orgClient.submitEventFeedback).toHaveBeenCalled();
      expect(globalClient.submitEventFeedback).not.toHaveBeenCalled();
    });

    it('forwards server-derived user_ref (null in this unauth harness) on a clean payload — deterministic success-path check that the handler always sources user_ref via getAuditUserId', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/intelligence/projects/${PROJECT_ID}/event-feedback`,
        payload: { event_id: EVENT_ID, verdict: 'incorrect', note: 'looks wrong' },
      });

      expect(res.statusCode).toBe(200);
      expect(orgClient.submitEventFeedback).toHaveBeenCalledWith(
        expect.objectContaining({
          event_id: EVENT_ID,
          verdict: 'incorrect',
          user_ref: null,
          note: 'looks wrong',
        })
      );
    });

    it('derives user_ref server-side and IGNORES any body-supplied user_ref — even if a caller spoofs the field, the upstream sees only the value from getAuditUserId(request)', async () => {
      // With no JWT / api-key user authenticated in this test harness,
      // getAuditUserId(request) returns null. The body-supplied user_ref must
      // NEVER reach the upstream, regardless of whether the framework strips
      // unknown fields silently or rejects them with 400 — the contract is
      // about the value that lands at the upstream, not about the HTTP code.
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/intelligence/projects/${PROJECT_ID}/event-feedback`,
        payload: {
          event_id: EVENT_ID,
          verdict: 'incorrect',
          note: 'looks wrong',
          user_ref: 'attacker-supplied-victim-id',
        },
      });

      // Whichever the framework chose (200 with strip OR 400 reject), the
      // attacker value must never reach the upstream.
      if (res.statusCode === 200) {
        expect(orgClient.submitEventFeedback).toHaveBeenCalledWith(
          expect.objectContaining({
            event_id: EVENT_ID,
            verdict: 'incorrect',
            user_ref: null,
            note: 'looks wrong',
          })
        );
        // Defensive: explicitly verify the spoofed value never showed up.
        const call = orgClient.submitEventFeedback.mock.calls[0][0];
        expect(call.user_ref).not.toBe('attacker-supplied-victim-id');
      } else {
        expect(res.statusCode).toBe(400);
        expect(orgClient.submitEventFeedback).not.toHaveBeenCalled();
      }
    });
  });
});

describe('Intelligence Routes - Without Client Factory (backward compat)', () => {
  let app: FastifyInstance;
  let globalClient: ReturnType<typeof createMockClient>;

  beforeEach(async () => {
    app = Fastify();
    globalClient = createMockClient();

    // No clientFactory passed — should use global client for everything
    intelligenceRoutes(app, globalClient, createMockDb());
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('uses global client for similar bugs when no factory', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/intelligence/projects/${PROJECT_ID}/bugs/${BUG_ID}/similar`,
    });

    expect(res.statusCode).toBe(200);
    expect(globalClient.getSimilarBugs).toHaveBeenCalled();
  });

  it('uses global client for search when no factory', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/intelligence/projects/${PROJECT_ID}/search`,
      payload: { query: 'test query' },
    });

    expect(res.statusCode).toBe(200);
    expect(globalClient.search).toHaveBeenCalled();
  });
});

describe('Intelligence Routes - resolveClient edge cases', () => {
  it('health endpoint does not call clientFactory even when factory is provided', async () => {
    const app = Fastify();
    const globalClient = createMockClient();
    const clientFactory = createMockClientFactory(createMockClient());

    intelligenceRoutes(app, globalClient, createMockDb(), clientFactory as any);
    await app.ready();

    await app.inject({ method: 'GET', url: '/api/v1/intelligence/health' });

    expect(clientFactory.getClientForOrg).not.toHaveBeenCalled();
    expect(globalClient.healthCheck).toHaveBeenCalled();

    await app.close();
  });
});
