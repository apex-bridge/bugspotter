/**
 * Analytics Routes Tests
 *
 * Regression guard for a long-standing bug where the response schema
 * declared `data: { type: 'object' }` with no `properties` /
 * `additionalProperties`, causing fast-json-stringify to strip every
 * field from `data` on the wire (`{"success":true,"data":{}}`).
 *
 * These tests exercise the routes through a real Fastify instance so
 * the response serializer actually runs — that's the layer the bug
 * lived in, and the layer the existing service/scope/auth unit tests
 * never crossed.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { analyticsRoutes } from '../../src/api/routes/analytics.js';
import type { AnalyticsService } from '../../src/analytics/analytics-service.js';
import type { DatabaseClient } from '../../src/db/client.js';

// Mock requireUser to attach a stub authUser
vi.mock('../../src/api/middleware/auth.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/api/middleware/auth.js')>();
  return {
    ...actual,
    requireUser: async (request: import('fastify').FastifyRequest) => {
      (request as unknown as { authUser: unknown }).authUser = {
        id: 'test-user-id',
        email: 'admin@example.com',
        role: 'admin',
      };
    },
  };
});

// Mock the analytics auth + scope so the test focuses on the routes/serializer
vi.mock('../../src/analytics/analytics-auth.js', () => ({
  requireAnalyticsAccess: () => async () => {},
}));

vi.mock('../../src/analytics/analytics-scope.js', () => ({
  resolveAnalyticsScope: async () => ({ organizationIds: null }),
}));

// Mock the org-role middleware used by the org-param routes
vi.mock('../../src/api/middleware/org-access.js', () => ({
  requireOrgRole: () => async () => {},
}));

// Realistic payloads returned by the service — exactly what we expect the
// wire response's `data` field to equal.
const DASHBOARD_METRICS = {
  bug_reports: {
    by_status: { open: 3, in_progress: 1, resolved: 2, closed: 0, total: 6 },
    by_priority: { low: 1, medium: 2, high: 2, critical: 1 },
  },
  projects: { total: 2, total_reports: 6, avg_reports_per_project: 3 },
  users: { total: 4 },
  time_series: [{ date: '2026-05-20', count: 2 }],
  top_projects: [{ id: 'proj-1', name: 'Acme', report_count: 4 }],
};

const TREND = {
  days: 7,
  trend: [
    { date: '2026-05-20', total: 2, open: 1, in_progress: 0, resolved: 1, closed: 0 },
    { date: '2026-05-21', total: 1, open: 1, in_progress: 0, resolved: 0, closed: 0 },
  ],
};

const PROJECT_STATS = [
  {
    id: 'proj-1',
    name: 'Acme',
    created_at: new Date('2026-01-01T00:00:00Z'),
    total_reports: 4,
    open_reports: 2,
    in_progress_reports: 1,
    resolved_reports: 1,
    closed_reports: 0,
    critical_reports: 1,
    last_report_at: new Date('2026-05-22T00:00:00Z'),
  },
];

function createMockAnalyticsService(): AnalyticsService {
  return {
    getDashboardMetrics: vi.fn().mockResolvedValue(DASHBOARD_METRICS),
    getReportTrend: vi.fn().mockResolvedValue(TREND),
    getProjectStats: vi.fn().mockResolvedValue(PROJECT_STATS),
  } as unknown as AnalyticsService;
}

describe('Analytics Routes — response body shape', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = Fastify({ logger: false });
    const analytics = createMockAnalyticsService();
    const db = {} as unknown as DatabaseClient;
    analyticsRoutes(server, analytics, db);
    await server.ready();
  });

  afterEach(async () => {
    await server.close();
  });

  // --- Flat routes ----------------------------------------------------------

  describe('GET /api/v1/analytics/dashboard', () => {
    it('returns the full dashboard payload (not an empty {})', async () => {
      const res = await server.inject({ method: 'GET', url: '/api/v1/analytics/dashboard' });
      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(json.success).toBe(true);
      // Guards against the historical regression where every field was stripped.
      expect(json.data).toEqual(DASHBOARD_METRICS);
      expect(json.data.bug_reports.by_status.total).toBe(6);
      expect(Array.isArray(json.data.time_series)).toBe(true);
      expect(Array.isArray(json.data.top_projects)).toBe(true);
    });
  });

  describe('GET /api/v1/analytics/reports/trend', () => {
    it('returns the trend payload with days and a populated trend array', async () => {
      const res = await server.inject({
        method: 'GET',
        url: '/api/v1/analytics/reports/trend?days=7',
      });
      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(json.success).toBe(true);
      expect(json.data.days).toBe(7);
      expect(json.data.trend).toHaveLength(2);
      expect(json.data.trend[0]).toMatchObject({
        date: '2026-05-20',
        total: 2,
        open: 1,
        resolved: 1,
      });
    });
  });

  describe('GET /api/v1/analytics/projects/stats', () => {
    it('returns an array of project rows with all fields populated (not [{},{}])', async () => {
      const res = await server.inject({
        method: 'GET',
        url: '/api/v1/analytics/projects/stats',
      });
      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(json.success).toBe(true);
      expect(Array.isArray(json.data)).toBe(true);
      expect(json.data).toHaveLength(1);
      // Pre-fix, fast-json-stringify reduced each item to `{}`.
      expect(json.data[0].id).toBe('proj-1');
      expect(json.data[0].name).toBe('Acme');
      expect(json.data[0].total_reports).toBe(4);
      expect(json.data[0].critical_reports).toBe(1);
    });
  });

  // --- Org-param routes -----------------------------------------------------
  //
  // Same response-schema bug existed here too. One spot-check per route is
  // enough to lock the contract — handlers are nearly identical to the flat
  // routes and share the schema definitions.

  const orgId = '00000000-0000-4000-8000-000000000001';

  describe('GET /api/v1/organizations/:id/analytics/dashboard', () => {
    it('returns the full dashboard payload for the org', async () => {
      const res = await server.inject({
        method: 'GET',
        url: `/api/v1/organizations/${orgId}/analytics/dashboard`,
      });
      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(json.data).toEqual(DASHBOARD_METRICS);
    });
  });

  describe('GET /api/v1/organizations/:id/analytics/reports/trend', () => {
    it('returns trend with days + populated trend array', async () => {
      const res = await server.inject({
        method: 'GET',
        url: `/api/v1/organizations/${orgId}/analytics/reports/trend?days=7`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.trend).toHaveLength(2);
    });
  });

  describe('GET /api/v1/organizations/:id/analytics/projects/stats', () => {
    it('returns an array of project rows with all fields populated', async () => {
      const res = await server.inject({
        method: 'GET',
        url: `/api/v1/organizations/${orgId}/analytics/projects/stats`,
      });
      expect(res.statusCode).toBe(200);
      const data = res.json().data;
      expect(data).toHaveLength(1);
      expect(data[0].name).toBe('Acme');
      expect(data[0].total_reports).toBe(4);
    });
  });
});
