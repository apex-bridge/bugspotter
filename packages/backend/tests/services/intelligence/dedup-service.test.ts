/**
 * Intelligence Dedup Service Tests
 *
 * Unit tests for duplicate detection actions: flag, auto_close, idempotency,
 * org settings resolution, error handling.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IntelligenceDedupService } from '../../../src/services/intelligence/dedup-service.js';
import type { DatabaseClient } from '../../../src/db/client.js';
import type { SimilarBug } from '../../../src/services/intelligence/types.js';
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

function createMockDb(rowCount = 1): Partial<DatabaseClient> {
  const mockQuery = vi.fn().mockResolvedValue({ rows: [], rowCount });

  return {
    getPool: vi.fn().mockReturnValue({
      query: mockQuery,
    }),
  } as unknown as Partial<DatabaseClient>;
}

function getQuery(db: Partial<DatabaseClient>): ReturnType<typeof vi.fn> {
  return (db.getPool!() as { query: ReturnType<typeof vi.fn> }).query;
}

function createSimilarBugs(count = 1): SimilarBug[] {
  return Array.from({ length: count }, (_, i) => ({
    bug_id: `canonical-bug-${i + 1}`,
    title: `Similar bug ${i + 1}`,
    description: `Description ${i + 1}`,
    status: 'open',
    resolution: null,
    similarity: 0.95 - i * 0.05,
  }));
}

// ============================================================================
// Tests
// ============================================================================

describe('IntelligenceDedupService', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('applyDedupAction', () => {
    it('returns applied: false when isDuplicate is false', async () => {
      const db = createMockDb();
      const service = new IntelligenceDedupService(db as DatabaseClient);

      const result = await service.applyDedupAction('bug-1', false, createSimilarBugs());

      expect(result).toEqual({
        action: 'flag',
        applied: false,
        duplicateOf: null,
        statusChanged: false,
      });
      expect(getQuery(db)).not.toHaveBeenCalled();
    });

    it('returns applied: false when similarBugs is empty', async () => {
      const db = createMockDb();
      const service = new IntelligenceDedupService(db as DatabaseClient);

      const result = await service.applyDedupAction('bug-1', true, []);

      expect(result).toEqual({
        action: 'flag',
        applied: false,
        duplicateOf: null,
        statusChanged: false,
      });
      expect(getQuery(db)).not.toHaveBeenCalled();
    });

    it('flags duplicate with correct SQL (default action, no org)', async () => {
      const db = createMockDb(1);
      const service = new IntelligenceDedupService(db as DatabaseClient);

      const result = await service.applyDedupAction('bug-1', true, createSimilarBugs());

      expect(result).toEqual({
        action: 'flag',
        applied: true,
        duplicateOf: 'canonical-bug-1',
        statusChanged: false,
      });

      const query = getQuery(db);
      expect(query).toHaveBeenCalledTimes(1);
      const [sql, params] = query.mock.calls[0];
      expect(sql).toContain('UPDATE');
      expect(sql).toContain('duplicate_of = $1');
      expect(sql).toContain('WHERE id = $2 AND duplicate_of IS NULL');
      expect(sql).not.toContain("status = 'closed'");
      expect(params).toEqual(['canonical-bug-1', 'bug-1']);
    });

    it('auto-closes duplicate with correct SQL when org setting is auto_close', async () => {
      mockedGetOrgSettings.mockResolvedValue({
        intelligence_enabled: true,
        intelligence_auto_analyze: true,
        intelligence_auto_enrich: true,
        intelligence_api_key: null,
        intelligence_provider: null,
        intelligence_similarity_threshold: 0.75,
        intelligence_dedup_enabled: true,
        intelligence_dedup_action: 'auto_close',
        intelligence_self_service_enabled: true,
        intelligence_api_key_provisioned_at: null,
        intelligence_api_key_provisioned_by: null,
      });

      const db = createMockDb(1);
      const service = new IntelligenceDedupService(db as DatabaseClient);

      const result = await service.applyDedupAction('bug-1', true, createSimilarBugs(), 'org-1');

      expect(result).toEqual({
        action: 'auto_close',
        applied: true,
        duplicateOf: 'canonical-bug-1',
        statusChanged: true,
      });

      const query = getQuery(db);
      const [sql, params] = query.mock.calls[0];
      expect(sql).toContain('duplicate_of = $1');
      expect(sql).toContain("status = 'closed'");
      expect(sql).toContain('WHERE id = $2 AND duplicate_of IS NULL');
      expect(params).toEqual(['canonical-bug-1', 'bug-1']);
    });

    it('uses top similar bug as canonical (highest similarity)', async () => {
      const db = createMockDb(1);
      const service = new IntelligenceDedupService(db as DatabaseClient);
      const similarBugs = createSimilarBugs(3);

      await service.applyDedupAction('bug-1', true, similarBugs);

      const query = getQuery(db);
      const [, params] = query.mock.calls[0];
      expect(params[0]).toBe('canonical-bug-1');
    });

    it('returns applied: false when bug already marked (rowCount = 0)', async () => {
      const db = createMockDb(0);
      const service = new IntelligenceDedupService(db as DatabaseClient);

      const result = await service.applyDedupAction('bug-1', true, createSimilarBugs());

      expect(result.applied).toBe(false);
      expect(result.duplicateOf).toBeNull();
    });

    it('falls back to default action when no organizationId', async () => {
      const db = createMockDb(1);
      const service = new IntelligenceDedupService(db as DatabaseClient);

      const result = await service.applyDedupAction('bug-1', true, createSimilarBugs());

      // Default is 'flag'
      expect(result.action).toBe('flag');
      expect(mockedGetOrgSettings).not.toHaveBeenCalled();
    });

    it('falls back to default action on org settings error', async () => {
      mockedGetOrgSettings.mockRejectedValue(new Error('DB error'));

      const db = createMockDb(1);
      const service = new IntelligenceDedupService(db as DatabaseClient);

      const result = await service.applyDedupAction('bug-1', true, createSimilarBugs(), 'org-1');

      // Falls back to default 'flag' instead of throwing
      expect(result.action).toBe('flag');
      expect(result.applied).toBe(true);
    });

    it('returns applied: false when dedup is disabled for org', async () => {
      mockedGetOrgSettings.mockResolvedValue({
        intelligence_enabled: true,
        intelligence_auto_analyze: true,
        intelligence_auto_enrich: true,
        intelligence_api_key: null,
        intelligence_provider: null,
        intelligence_similarity_threshold: 0.75,
        intelligence_dedup_enabled: false,
        intelligence_dedup_action: 'flag',
        intelligence_self_service_enabled: true,
        intelligence_api_key_provisioned_at: null,
        intelligence_api_key_provisioned_by: null,
      });

      const db = createMockDb(1);
      const service = new IntelligenceDedupService(db as DatabaseClient);

      const result = await service.applyDedupAction('bug-1', true, createSimilarBugs(), 'org-1');

      expect(result).toEqual({
        action: 'flag',
        applied: false,
        duplicateOf: null,
        statusChanged: false,
      });
      expect(getQuery(db)).not.toHaveBeenCalled();
    });

    it('filters out self-references (bug cannot be duplicate of itself)', async () => {
      const db = createMockDb(1);
      const service = new IntelligenceDedupService(db as DatabaseClient);

      // Only similar bug is the bug itself
      const selfRef: SimilarBug[] = [
        {
          bug_id: 'bug-1',
          title: 'Same bug',
          description: 'Desc',
          status: 'open',
          resolution: null,
          similarity: 0.99,
        },
      ];

      const result = await service.applyDedupAction('bug-1', true, selfRef);

      expect(result.applied).toBe(false);
      expect(result.duplicateOf).toBeNull();
      expect(getQuery(db)).not.toHaveBeenCalled();
    });

    it('picks correct canonical after filtering self-reference', async () => {
      const db = createMockDb(1);
      const service = new IntelligenceDedupService(db as DatabaseClient);

      const bugs: SimilarBug[] = [
        {
          bug_id: 'bug-1',
          title: 'Self',
          description: 'Desc',
          status: 'open',
          resolution: null,
          similarity: 0.99,
        },
        {
          bug_id: 'canonical-bug-1',
          title: 'Other',
          description: 'Desc',
          status: 'open',
          resolution: null,
          similarity: 0.9,
        },
      ];

      const result = await service.applyDedupAction('bug-1', true, bugs);

      expect(result.applied).toBe(true);
      expect(result.duplicateOf).toBe('canonical-bug-1');
    });

    it('respects org flag action setting', async () => {
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

      const db = createMockDb(1);
      const service = new IntelligenceDedupService(db as DatabaseClient);

      const result = await service.applyDedupAction('bug-1', true, createSimilarBugs(), 'org-1');

      expect(result.action).toBe('flag');
      expect(result.statusChanged).toBe(false);
    });
  });
});
