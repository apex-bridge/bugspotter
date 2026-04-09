/**
 * Intelligence Feedback Service
 *
 * Tracks user feedback on intelligence suggestions (similar bugs, mitigations,
 * duplicate detections). Provides accuracy stats for measuring suggestion quality.
 */

import { getLogger } from '../../logger.js';
import type { DatabaseClient } from '../../db/client.js';

const logger = getLogger();

// ============================================================================
// Types
// ============================================================================

export interface SubmitFeedbackInput {
  bugReportId: string;
  suggestionBugId: string;
  suggestionType: 'similar_bug' | 'mitigation' | 'duplicate';
  rating: 1 | -1;
  comment?: string;
  userId: string;
  organizationId?: string;
  projectId: string;
}

export interface FeedbackEntry {
  id: string;
  bug_report_id: string;
  suggestion_bug_id: string;
  suggestion_type: string;
  rating: number;
  comment: string | null;
  user_id: string | null;
  created_at: string;
}

export interface FeedbackTypeStat {
  positive: number;
  negative: number;
  total: number;
}

export interface FeedbackStats {
  total_feedback: number;
  positive_count: number;
  negative_count: number;
  accuracy_rate: number;
  by_type: Record<string, FeedbackTypeStat>;
}

// ============================================================================
// Service
// ============================================================================

const SCHEMA = 'application';
const TABLE = 'intelligence_feedback';

export class IntelligenceFeedbackService {
  constructor(private readonly db: DatabaseClient) {}

  /**
   * Submit feedback on an intelligence suggestion.
   * Uses upsert — a user can change their vote on the same suggestion.
   */
  async submitFeedback(input: SubmitFeedbackInput): Promise<{ id: string; created: boolean }> {
    const query = `
      INSERT INTO ${SCHEMA}.${TABLE}
        (bug_report_id, suggestion_bug_id, suggestion_type, rating, comment, user_id, organization_id, project_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (bug_report_id, suggestion_bug_id, user_id)
      DO UPDATE SET
        rating = EXCLUDED.rating,
        comment = EXCLUDED.comment
      RETURNING id, (xmax = 0) AS created
    `;

    const result = await this.db
      .getPool()
      .query(query, [
        input.bugReportId,
        input.suggestionBugId,
        input.suggestionType,
        input.rating,
        input.comment ?? null,
        input.userId,
        input.organizationId ?? null,
        input.projectId,
      ]);

    const row = result.rows[0];

    logger.info('Intelligence feedback submitted', {
      feedbackId: row.id,
      bugReportId: input.bugReportId,
      suggestionBugId: input.suggestionBugId,
      rating: input.rating,
      created: row.created,
    });

    return { id: row.id, created: row.created };
  }

  /**
   * Get aggregate feedback stats for a project.
   */
  async getStats(projectId: string, organizationId?: string): Promise<FeedbackStats> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    conditions.push(`project_id = $${params.push(projectId)}`);

    if (organizationId) {
      conditions.push(`organization_id = $${params.push(organizationId)}`);
    }

    const whereClause = conditions.join(' AND ');

    // Aggregate query: total, positive, negative, grouped by suggestion_type
    const query = `
      SELECT
        suggestion_type,
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE rating = 1)::int AS positive,
        COUNT(*) FILTER (WHERE rating = -1)::int AS negative
      FROM ${SCHEMA}.${TABLE}
      WHERE ${whereClause}
      GROUP BY suggestion_type
    `;

    const result = await this.db.getPool().query(query, params);

    let totalFeedback = 0;
    let positiveCount = 0;
    let negativeCount = 0;
    const byType: Record<string, FeedbackTypeStat> = {};

    for (const row of result.rows) {
      const total = row.total;
      const positive = row.positive;
      const negative = row.negative;

      totalFeedback += total;
      positiveCount += positive;
      negativeCount += negative;

      byType[row.suggestion_type] = { positive, negative, total };
    }

    return {
      total_feedback: totalFeedback,
      positive_count: positiveCount,
      negative_count: negativeCount,
      accuracy_rate:
        totalFeedback > 0 ? Math.round((positiveCount / totalFeedback) * 10000) / 100 : 0,
      by_type: byType,
    };
  }

  /**
   * Get all feedback entries for a specific bug report.
   */
  async getFeedbackForBug(bugReportId: string): Promise<FeedbackEntry[]> {
    const query = `
      SELECT id, bug_report_id, suggestion_bug_id, suggestion_type,
             rating, comment, user_id, created_at
      FROM ${SCHEMA}.${TABLE}
      WHERE bug_report_id = $1
      ORDER BY created_at DESC
    `;

    const result = await this.db.getPool().query(query, [bugReportId]);
    return result.rows;
  }
}
