/**
 * Intelligence Feedback Service Tests
 *
 * Unit tests for feedback submission (upsert), stats aggregation,
 * and per-bug feedback retrieval.
 */

import { describe, it, expect, vi } from 'vitest';
import { IntelligenceFeedbackService } from '../../../src/services/intelligence/feedback-service.js';
import type { DatabaseClient } from '../../../src/db/client.js';

// ============================================================================
// Helpers
// ============================================================================

function createMockDb(queryResults?: unknown[]): Partial<DatabaseClient> {
  const mockQuery = vi.fn();

  // Set up sequential results if provided
  if (queryResults) {
    for (const result of queryResults) {
      mockQuery.mockResolvedValueOnce(result);
    }
  } else {
    // Default: return empty rows
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

// ============================================================================
// Tests
// ============================================================================

describe('IntelligenceFeedbackService', () => {
  describe('submitFeedback', () => {
    it('inserts feedback and returns id with created=true', async () => {
      const db = createMockDb([{ rows: [{ id: 'fb-1', created: true }] }]);
      const service = new IntelligenceFeedbackService(db as DatabaseClient);

      const result = await service.submitFeedback({
        bugReportId: 'bug-1',
        suggestionBugId: 'suggested-bug-1',
        suggestionType: 'similar_bug',
        rating: 1,
        comment: 'Very helpful',
        userId: 'user-1',
        organizationId: 'org-1',
        projectId: 'proj-1',
      });

      expect(result).toEqual({ id: 'fb-1', created: true });

      const query = getQuery(db);
      expect(query).toHaveBeenCalledTimes(1);
      const [sql, params] = query.mock.calls[0];
      expect(sql).toContain('INSERT INTO');
      expect(sql).toContain('ON CONFLICT');
      expect(params).toEqual([
        'bug-1',
        'suggested-bug-1',
        'similar_bug',
        1,
        'Very helpful',
        'user-1',
        'org-1',
        'proj-1',
      ]);
    });

    it('upserts and returns created=false when vote already exists', async () => {
      const db = createMockDb([{ rows: [{ id: 'fb-1', created: false }] }]);
      const service = new IntelligenceFeedbackService(db as DatabaseClient);

      const result = await service.submitFeedback({
        bugReportId: 'bug-1',
        suggestionBugId: 'suggested-bug-1',
        suggestionType: 'similar_bug',
        rating: -1,
        userId: 'user-1',
        projectId: 'proj-1',
      });

      expect(result).toEqual({ id: 'fb-1', created: false });

      // comment and organizationId should be null when not provided
      const params = getQuery(db).mock.calls[0][1];
      expect(params[4]).toBeNull(); // comment
      expect(params[6]).toBeNull(); // organizationId
    });
  });

  describe('getStats', () => {
    it('returns zero stats when no feedback exists', async () => {
      const db = createMockDb([{ rows: [] }]);
      const service = new IntelligenceFeedbackService(db as DatabaseClient);

      const stats = await service.getStats('proj-1');

      expect(stats).toEqual({
        total_feedback: 0,
        positive_count: 0,
        negative_count: 0,
        accuracy_rate: 0,
        by_type: {},
      });
    });

    it('aggregates stats by suggestion type', async () => {
      const db = createMockDb([
        {
          rows: [
            { suggestion_type: 'similar_bug', total: 10, positive: 7, negative: 3 },
            { suggestion_type: 'duplicate', total: 4, positive: 3, negative: 1 },
          ],
        },
      ]);
      const service = new IntelligenceFeedbackService(db as DatabaseClient);

      const stats = await service.getStats('proj-1');

      expect(stats.total_feedback).toBe(14);
      expect(stats.positive_count).toBe(10);
      expect(stats.negative_count).toBe(4);
      expect(stats.accuracy_rate).toBe(71.43); // (10/14)*100 rounded to 2 decimals
      expect(stats.by_type).toEqual({
        similar_bug: { positive: 7, negative: 3, total: 10 },
        duplicate: { positive: 3, negative: 1, total: 4 },
      });
    });

    it('filters by organizationId when provided', async () => {
      const db = createMockDb([{ rows: [] }]);
      const service = new IntelligenceFeedbackService(db as DatabaseClient);

      await service.getStats('proj-1', 'org-1');

      const [sql, params] = getQuery(db).mock.calls[0];
      expect(sql).toContain('organization_id = $2');
      expect(params).toEqual(['proj-1', 'org-1']);
    });

    it('does not filter by organizationId when not provided', async () => {
      const db = createMockDb([{ rows: [] }]);
      const service = new IntelligenceFeedbackService(db as DatabaseClient);

      await service.getStats('proj-1');

      const [sql, params] = getQuery(db).mock.calls[0];
      expect(sql).not.toContain('organization_id');
      expect(params).toEqual(['proj-1']);
    });
  });

  describe('getFeedbackForBug', () => {
    it('returns feedback entries ordered by created_at DESC', async () => {
      const entries = [
        {
          id: 'fb-2',
          bug_report_id: 'bug-1',
          suggestion_bug_id: 'sug-2',
          suggestion_type: 'mitigation',
          rating: -1,
          comment: null,
          user_id: 'user-2',
          created_at: '2026-03-15T12:00:00Z',
        },
        {
          id: 'fb-1',
          bug_report_id: 'bug-1',
          suggestion_bug_id: 'sug-1',
          suggestion_type: 'similar_bug',
          rating: 1,
          comment: 'Helpful',
          user_id: 'user-1',
          created_at: '2026-03-15T11:00:00Z',
        },
      ];
      const db = createMockDb([{ rows: entries }]);
      const service = new IntelligenceFeedbackService(db as DatabaseClient);

      const result = await service.getFeedbackForBug('bug-1');

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('fb-2');
      expect(result[1].id).toBe('fb-1');

      const [sql, params] = getQuery(db).mock.calls[0];
      expect(sql).toContain('ORDER BY created_at DESC');
      expect(params).toEqual(['bug-1']);
    });

    it('returns empty array when no feedback exists', async () => {
      const db = createMockDb([{ rows: [] }]);
      const service = new IntelligenceFeedbackService(db as DatabaseClient);

      const result = await service.getFeedbackForBug('bug-1');

      expect(result).toEqual([]);
    });
  });
});
