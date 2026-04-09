/**
 * Intelligence Enrichment Service Tests
 *
 * Unit tests for enrichment persistence: upsert, get, version increment, empty results.
 */

import { describe, it, expect, vi } from 'vitest';
import { IntelligenceEnrichmentService } from '../../../src/services/intelligence/enrichment-service.js';
import type { DatabaseClient } from '../../../src/db/client.js';
import type { EnrichBugResponse } from '../../../src/services/intelligence/types.js';

// ============================================================================
// Helpers
// ============================================================================

function createMockDb(queryResults?: unknown[]): Partial<DatabaseClient> {
  const mockQuery = vi.fn();

  if (queryResults) {
    for (const result of queryResults) {
      mockQuery.mockResolvedValueOnce(result);
    }
  } else {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  }

  return {
    getPool: vi.fn().mockReturnValue({
      query: mockQuery,
    }),
  } as unknown as Partial<DatabaseClient>;
}

function getQuery(db: Partial<DatabaseClient>): ReturnType<typeof vi.fn> {
  return (db.getPool!() as { query: ReturnType<typeof vi.fn> }).query;
}

function createEnrichResponse(overrides?: Partial<EnrichBugResponse>): EnrichBugResponse {
  return {
    bug_id: 'bug-1',
    category: 'ui_rendering',
    suggested_severity: 'medium',
    tags: ['css', 'layout'],
    root_cause_summary: 'CSS flexbox overflow not handled',
    affected_components: ['Dashboard', 'Sidebar'],
    confidence: {
      category: 0.92,
      severity: 0.85,
      tags: 0.78,
      root_cause: 0.88,
      components: 0.72,
    },
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('IntelligenceEnrichmentService', () => {
  describe('saveEnrichment', () => {
    it('inserts enrichment and returns row', async () => {
      const savedRow = {
        id: 'enr-1',
        bug_report_id: 'bug-1',
        project_id: 'proj-1',
        organization_id: 'org-1',
        category: 'ui_rendering',
        suggested_severity: 'medium',
        tags: ['css', 'layout'],
        root_cause_summary: 'CSS flexbox overflow not handled',
        affected_components: ['Dashboard', 'Sidebar'],
        confidence_category: 0.92,
        confidence_severity: 0.85,
        confidence_tags: 0.78,
        confidence_root_cause: 0.88,
        confidence_components: 0.72,
        enrichment_version: 1,
        created_at: '2026-03-16T00:00:00Z',
        updated_at: '2026-03-16T00:00:00Z',
      };

      const db = createMockDb([{ rows: [savedRow] }]);
      const service = new IntelligenceEnrichmentService(db as DatabaseClient);
      const response = createEnrichResponse();

      const result = await service.saveEnrichment('bug-1', 'proj-1', 'org-1', response);

      expect(result).toEqual(savedRow);

      const query = getQuery(db);
      expect(query).toHaveBeenCalledTimes(1);
      const [sql, params] = query.mock.calls[0];
      expect(sql).toContain('INSERT INTO');
      expect(sql).toContain('ON CONFLICT');
      expect(sql).toContain('enrichment_version');
      expect(params).toEqual([
        'bug-1',
        'proj-1',
        'org-1',
        'ui_rendering',
        'medium',
        ['css', 'layout'],
        'CSS flexbox overflow not handled',
        ['Dashboard', 'Sidebar'],
        0.92,
        0.85,
        0.78,
        0.88,
        0.72,
      ]);
    });

    it('passes null for organizationId when undefined', async () => {
      const db = createMockDb([{ rows: [{ id: 'enr-1', enrichment_version: 1 }] }]);
      const service = new IntelligenceEnrichmentService(db as DatabaseClient);

      await service.saveEnrichment('bug-1', 'proj-1', undefined, createEnrichResponse());

      const query = getQuery(db);
      const [, params] = query.mock.calls[0];
      // organizationId is the 3rd parameter
      expect(params[2]).toBeNull();
    });

    it('increments version on re-enrichment (upsert)', async () => {
      const savedRow = {
        id: 'enr-1',
        enrichment_version: 2,
      };

      const db = createMockDb([{ rows: [savedRow] }]);
      const service = new IntelligenceEnrichmentService(db as DatabaseClient);

      const result = await service.saveEnrichment(
        'bug-1',
        'proj-1',
        undefined,
        createEnrichResponse()
      );

      expect(result.enrichment_version).toBe(2);

      const query = getQuery(db);
      const [sql] = query.mock.calls[0];
      expect(sql).toContain('enrichment_version + 1');
    });
  });

  describe('getEnrichment', () => {
    it('returns enrichment row when found', async () => {
      const row = { id: 'enr-1', bug_report_id: 'bug-1', category: 'crash' };
      const db = createMockDb([{ rows: [row] }]);
      const service = new IntelligenceEnrichmentService(db as DatabaseClient);

      const result = await service.getEnrichment('bug-1');

      expect(result).toEqual(row);

      const query = getQuery(db);
      const [sql, params] = query.mock.calls[0];
      expect(sql).toContain('WHERE bug_report_id = $1');
      expect(params).toEqual(['bug-1']);
    });

    it('returns null when no enrichment found', async () => {
      const db = createMockDb([{ rows: [] }]);
      const service = new IntelligenceEnrichmentService(db as DatabaseClient);

      const result = await service.getEnrichment('bug-nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('getEnrichmentsByProject', () => {
    it('returns enrichments ordered by updated_at DESC', async () => {
      const rows = [
        { id: 'enr-2', bug_report_id: 'bug-2' },
        { id: 'enr-1', bug_report_id: 'bug-1' },
      ];
      const db = createMockDb([{ rows }]);
      const service = new IntelligenceEnrichmentService(db as DatabaseClient);

      const result = await service.getEnrichmentsByProject('proj-1');

      expect(result).toEqual(rows);
      expect(result).toHaveLength(2);

      const query = getQuery(db);
      const [sql, params] = query.mock.calls[0];
      expect(sql).toContain('WHERE project_id = $1');
      expect(sql).toContain('ORDER BY updated_at DESC');
      expect(params).toEqual(['proj-1']);
    });

    it('returns empty array when no enrichments found', async () => {
      const db = createMockDb([{ rows: [] }]);
      const service = new IntelligenceEnrichmentService(db as DatabaseClient);

      const result = await service.getEnrichmentsByProject('proj-empty');
      expect(result).toEqual([]);
    });
  });
});
