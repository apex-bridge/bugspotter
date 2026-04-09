/**
 * Self-Service Resolution Service Tests
 *
 * Unit tests for self-service resolution checks, deflection recording,
 * and stats retrieval.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SelfServiceResolutionService } from '../../../src/services/intelligence/self-service.js';
import type { DatabaseClient } from '../../../src/db/client.js';
import type { IntelligenceClient } from '../../../src/services/intelligence/intelligence-client.js';
import type { SearchResponse } from '../../../src/services/intelligence/types.js';
import { getOrgIntelligenceSettings } from '../../../src/services/intelligence/tenant-config.js';

vi.mock('../../../src/services/intelligence/tenant-config.js', async () => {
  const actual = await vi.importActual<
    typeof import('../../../src/services/intelligence/tenant-config.js')
  >('../../../src/services/intelligence/tenant-config.js');
  return {
    ...actual,
    getOrgIntelligenceSettings: vi.fn(),
  };
});

const mockedGetOrgSettings = vi.mocked(getOrgIntelligenceSettings);

// ============================================================================
// Helpers
// ============================================================================

function createMockDb(): {
  db: Partial<DatabaseClient>;
  query: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
  const db = {
    getPool: vi.fn().mockReturnValue({ query }),
  } as unknown as Partial<DatabaseClient>;
  return { db, query };
}

function createMockClient(searchResponse?: Partial<SearchResponse>): Partial<IntelligenceClient> {
  return {
    search: vi.fn().mockResolvedValue({
      results: [],
      total: 0,
      limit: 10,
      offset: 0,
      mode: 'fast',
      query: 'test',
      cached: false,
      ...searchResponse,
    }),
  } as unknown as Partial<IntelligenceClient>;
}

function createSearchResults(count: number, withResolution = true): SearchResponse['results'] {
  return Array.from({ length: count }, (_, i) => ({
    bug_id: `bug-${i + 1}`,
    title: `Bug ${i + 1}`,
    description: `Description ${i + 1}`,
    status: 'resolved',
    resolution: withResolution ? `Fix: do thing ${i + 1}` : null,
    similarity: 0.95 - i * 0.05,
    created_at: '2026-01-01T00:00:00Z',
  }));
}

// ============================================================================
// Tests
// ============================================================================

describe('SelfServiceResolutionService', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('checkForResolutions', () => {
    it('returns matching resolutions from search results', async () => {
      const { db } = createMockDb();
      const client = createMockClient({
        results: createSearchResults(3),
      });

      const service = new SelfServiceResolutionService(
        db as DatabaseClient,
        client as IntelligenceClient
      );

      const result = await service.checkForResolutions('login page crashes', 'project-1');

      expect(result.has_resolution).toBe(true);
      expect(result.matches).toHaveLength(3);
      expect(result.matches[0]).toEqual({
        bug_id: 'bug-1',
        title: 'Bug 1',
        resolution: 'Fix: do thing 1',
        similarity: 0.95,
        status: 'resolved',
      });

      expect(client.search).toHaveBeenCalledWith({
        query: 'login page crashes',
        project_id: 'project-1',
        mode: 'fast',
        limit: 10,
        status: 'resolved',
      });
    });

    it('filters out results without resolution text', async () => {
      const { db } = createMockDb();
      const results = [
        ...createSearchResults(2, true),
        ...createSearchResults(1, false).map((r) => ({
          ...r,
          bug_id: 'no-resolution',
        })),
      ];
      const client = createMockClient({ results });

      const service = new SelfServiceResolutionService(
        db as DatabaseClient,
        client as IntelligenceClient
      );

      const result = await service.checkForResolutions('test', 'project-1');

      expect(result.matches).toHaveLength(2);
      expect(result.matches.every((m) => m.resolution.length > 0)).toBe(true);
    });

    it('returns has_resolution: false when no resolved bugs match', async () => {
      const { db } = createMockDb();
      const client = createMockClient({ results: [] });

      const service = new SelfServiceResolutionService(
        db as DatabaseClient,
        client as IntelligenceClient
      );

      const result = await service.checkForResolutions('test', 'project-1');

      expect(result.has_resolution).toBe(false);
      expect(result.matches).toHaveLength(0);
    });

    it('limits results to 5 matches', async () => {
      const { db } = createMockDb();
      const client = createMockClient({
        results: createSearchResults(10),
      });

      const service = new SelfServiceResolutionService(
        db as DatabaseClient,
        client as IntelligenceClient
      );

      const result = await service.checkForResolutions('test', 'project-1');

      expect(result.matches).toHaveLength(5);
    });
  });

  describe('recordDeflection', () => {
    it('inserts deflection record with hashed description', async () => {
      const { db, query } = createMockDb();
      query.mockResolvedValue({
        rows: [
          {
            id: 'deflection-1',
            organization_id: 'org-1',
            project_id: 'project-1',
            matched_bug_id: 'bug-1',
            description_hash: 'abc123',
            created_at: '2026-01-01T00:00:00Z',
            is_new: true,
          },
        ],
        rowCount: 1,
      });
      const client = createMockClient();

      const service = new SelfServiceResolutionService(
        db as DatabaseClient,
        client as IntelligenceClient
      );

      const result = await service.recordDeflection(
        'project-1',
        'bug-1',
        'My login is broken',
        'org-1'
      );

      expect(result.id).toBe('deflection-1');
      expect(result.matched_bug_id).toBe('bug-1');
      // is_new flag should be stripped from the returned record
      expect((result as Record<string, unknown>).is_new).toBeUndefined();

      expect(query).toHaveBeenCalledTimes(1);
      const [sql, params] = query.mock.calls[0];
      expect(sql).toContain('INSERT INTO');
      expect(sql).toContain('intelligence_deflections');
      expect(params[0]).toBe('org-1');
      expect(params[1]).toBe('project-1');
      expect(params[2]).toBe('bug-1');
      // description_hash is a SHA-256 hex string (64 chars)
      expect(params[3]).toHaveLength(64);
    });

    it('passes null org when no organizationId provided', async () => {
      const { db, query } = createMockDb();
      query.mockResolvedValue({
        rows: [
          {
            id: 'deflection-2',
            organization_id: null,
            project_id: 'project-1',
            matched_bug_id: 'bug-1',
            description_hash: 'def456',
            created_at: '2026-01-01T00:00:00Z',
            is_new: true,
          },
        ],
        rowCount: 1,
      });
      const client = createMockClient();

      const service = new SelfServiceResolutionService(
        db as DatabaseClient,
        client as IntelligenceClient
      );

      await service.recordDeflection('project-1', 'bug-1', 'test');

      const [, params] = query.mock.calls[0];
      expect(params[0]).toBeNull();
    });

    it('returns existing record on duplicate deflection (idempotent)', async () => {
      const { db, query } = createMockDb();
      // CTE query returns the existing row via UNION ALL fallback with is_new: false
      query.mockResolvedValue({
        rows: [
          {
            id: 'existing-deflection',
            organization_id: 'org-1',
            project_id: 'project-1',
            matched_bug_id: 'bug-1',
            description_hash: 'abc123',
            created_at: '2026-01-01T00:00:00Z',
            is_new: false,
          },
        ],
        rowCount: 1,
      });
      const client = createMockClient();

      const service = new SelfServiceResolutionService(
        db as DatabaseClient,
        client as IntelligenceClient
      );

      const result = await service.recordDeflection(
        'project-1',
        'bug-1',
        'My login is broken',
        'org-1'
      );

      expect(result.id).toBe('existing-deflection');
      // Only one query call (atomic CTE)
      expect(query).toHaveBeenCalledTimes(1);
      const [sql] = query.mock.calls[0];
      expect(sql).toContain('ON CONFLICT');
      expect(sql).toContain('NOT EXISTS');
    });
  });

  describe('isEnabled', () => {
    it('returns true by default when no organizationId', async () => {
      const { db } = createMockDb();
      const client = createMockClient();
      const service = new SelfServiceResolutionService(
        db as DatabaseClient,
        client as IntelligenceClient
      );

      const result = await service.isEnabled();
      expect(result).toBe(true);
      expect(mockedGetOrgSettings).not.toHaveBeenCalled();
    });

    it('returns true when org has self-service enabled', async () => {
      mockedGetOrgSettings.mockResolvedValue({
        intelligence_enabled: true,
        intelligence_auto_analyze: true,
        intelligence_auto_enrich: true,
        intelligence_api_key: null,
        intelligence_provider: null,
        intelligence_similarity_threshold: 0.75,
        intelligence_dedup_enabled: true,
        intelligence_dedup_action: 'flag',
        intelligence_self_service_enabled: true,
        intelligence_api_key_provisioned_at: null,
        intelligence_api_key_provisioned_by: null,
      });

      const { db } = createMockDb();
      const client = createMockClient();
      const service = new SelfServiceResolutionService(
        db as DatabaseClient,
        client as IntelligenceClient
      );

      const result = await service.isEnabled('org-1');
      expect(result).toBe(true);
    });

    it('returns false when org has self-service disabled', async () => {
      mockedGetOrgSettings.mockResolvedValue({
        intelligence_enabled: true,
        intelligence_auto_analyze: true,
        intelligence_auto_enrich: true,
        intelligence_api_key: null,
        intelligence_provider: null,
        intelligence_similarity_threshold: 0.75,
        intelligence_dedup_enabled: true,
        intelligence_dedup_action: 'flag',
        intelligence_self_service_enabled: false,
        intelligence_api_key_provisioned_at: null,
        intelligence_api_key_provisioned_by: null,
      });

      const { db } = createMockDb();
      const client = createMockClient();
      const service = new SelfServiceResolutionService(
        db as DatabaseClient,
        client as IntelligenceClient
      );

      const result = await service.isEnabled('org-1');
      expect(result).toBe(false);
    });

    it('falls back to default on org settings error', async () => {
      mockedGetOrgSettings.mockRejectedValue(new Error('DB error'));

      const { db } = createMockDb();
      const client = createMockClient();
      const service = new SelfServiceResolutionService(
        db as DatabaseClient,
        client as IntelligenceClient
      );

      const result = await service.isEnabled('org-1');
      // Default is true
      expect(result).toBe(true);
    });
  });

  describe('getStats', () => {
    it('returns aggregated deflection statistics', async () => {
      const { db, query } = createMockDb();
      // First call: aggregate stats, second call: top matched bugs
      query
        .mockResolvedValueOnce({
          rows: [
            {
              total_deflections: 42,
              deflections_last_7d: 8,
              deflections_last_30d: 25,
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            { bug_id: 'bug-1', deflection_count: 15 },
            { bug_id: 'bug-2', deflection_count: 10 },
          ],
        });
      const client = createMockClient();

      const service = new SelfServiceResolutionService(
        db as DatabaseClient,
        client as IntelligenceClient
      );

      const stats = await service.getStats('project-1');

      expect(stats.total_deflections).toBe(42);
      expect(stats.deflections_last_7d).toBe(8);
      expect(stats.deflections_last_30d).toBe(25);
      expect(stats.top_matched_bugs).toHaveLength(2);
      expect(stats.top_matched_bugs[0]).toEqual({
        bug_id: 'bug-1',
        deflection_count: 15,
      });
    });
  });
});
