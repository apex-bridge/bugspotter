import { Pool, PoolClient } from 'pg';
import { getLogger } from '../../logger.js';

const logger = getLogger();

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Exponential backoff delays for retry scheduling (in minutes)
 * Retry 1: 1 minute
 * Retry 2: 5 minutes
 * Retry 3: 30 minutes
 * Retry 4: 2 hours (120 minutes)
 * Retry 5+: 12 hours (720 minutes)
 */
const RETRY_BACKOFF_MINUTES = [1, 5, 30, 120, 720] as const;

// Base repository pattern - stores pool/client for query execution
abstract class BaseRepository {
  protected pool: Pool | PoolClient;

  constructor(pool: Pool | PoolClient) {
    this.pool = pool;
  }
}

// ============================================================================
// TYPES
// ============================================================================

export type OutboxStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'dead_letter';

export interface TicketCreationOutboxEntry {
  id: string;
  bug_report_id: string;
  project_id: string;
  integration_id: string;
  platform: string;
  rule_id: string;
  payload: Record<string, unknown>; // JSONB payload for external API
  status: OutboxStatus;
  retry_count: number;
  max_retries: number;
  scheduled_at: Date;
  next_retry_at: Date | null;
  external_ticket_id: string | null;
  external_ticket_url: string | null;
  error_message: string | null;
  created_at: Date;
  updated_at: Date;
  processed_at: Date | null;
  idempotency_key: string;
}

export interface CreateOutboxEntryData {
  bug_report_id: string;
  project_id: string;
  integration_id: string;
  platform: string;
  rule_id: string;
  payload: Record<string, unknown>;
  scheduled_at?: Date;
  max_retries?: number;
}

export interface OutboxProcessingResult {
  external_ticket_id: string;
  external_ticket_url: string;
}

// ============================================================================
// REPOSITORY
// ============================================================================

export class TicketCreationOutboxRepository extends BaseRepository {
  constructor(pool: Pool | PoolClient) {
    super(pool);
  }

  /**
   * Create new outbox entry (within transaction)
   * Idempotency key format: {bug_report_id}:{rule_id}:{timestamp}
   */
  async create(data: CreateOutboxEntryData): Promise<TicketCreationOutboxEntry> {
    const idempotencyKey = `${data.bug_report_id}:${data.rule_id}:${Date.now()}`;

    const query = `
      INSERT INTO ticket_creation_outbox (
        bug_report_id,
        project_id,
        integration_id,
        platform,
        rule_id,
        payload,
        scheduled_at,
        max_retries,
        idempotency_key
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `;

    const values = [
      data.bug_report_id,
      data.project_id,
      data.integration_id,
      data.platform,
      data.rule_id,
      JSON.stringify(data.payload),
      data.scheduled_at || new Date(),
      data.max_retries || 3,
      idempotencyKey,
    ];

    const result = await this.pool.query<TicketCreationOutboxEntry>(query, values);
    return this.parseOutboxEntry(result.rows[0]);
  }

  /**
   * Find pending entries ready for processing
   * Returns entries with status 'pending' or 'failed' where scheduled_at <= NOW
   */
  async findPending(limit: number = 10): Promise<TicketCreationOutboxEntry[]> {
    const query = `
      SELECT * FROM ticket_creation_outbox
      WHERE status IN ('pending', 'failed')
        AND scheduled_at <= NOW()
      ORDER BY scheduled_at ASC
      LIMIT $1
    `;

    const result = await this.pool.query<TicketCreationOutboxEntry>(query, [limit]);
    return result.rows.map((row) => this.parseOutboxEntry(row));
  }

  /**
   * Find entry by ID
   */
  async findById(id: string): Promise<TicketCreationOutboxEntry | null> {
    const query = `SELECT * FROM ticket_creation_outbox WHERE id = $1`;
    const result = await this.pool.query<TicketCreationOutboxEntry>(query, [id]);
    return result.rows[0] ? this.parseOutboxEntry(result.rows[0]) : null;
  }

  /**
   * Find entries by bug report ID
   */
  async findByBugReport(bugReportId: string): Promise<TicketCreationOutboxEntry[]> {
    const query = `
      SELECT * FROM ticket_creation_outbox
      WHERE bug_report_id = $1
      ORDER BY created_at DESC
    `;

    const result = await this.pool.query<TicketCreationOutboxEntry>(query, [bugReportId]);
    return result.rows.map((row) => this.parseOutboxEntry(row));
  }

  /**
   * Mark entry as processing (prevents duplicate processing)
   */
  async markProcessing(id: string): Promise<void> {
    const query = `
      UPDATE ticket_creation_outbox
      SET status = 'processing',
          updated_at = NOW()
      WHERE id = $1
        AND status IN ('pending', 'failed')
    `;

    const result = await this.pool.query(query, [id]);

    if (result.rowCount === 0) {
      logger.warn('Failed to mark outbox entry as processing (already processed or not found)', {
        id,
      });
    }
  }

  /**
   * Mark entry as completed (successful ticket creation)
   */
  async markCompleted(id: string, result: OutboxProcessingResult): Promise<void> {
    const query = `
      UPDATE ticket_creation_outbox
      SET status = 'completed',
          external_ticket_id = $2,
          external_ticket_url = $3,
          processed_at = NOW(),
          updated_at = NOW()
      WHERE id = $1
    `;

    await this.pool.query(query, [id, result.external_ticket_id, result.external_ticket_url]);

    logger.info('Outbox entry marked as completed', {
      id,
      externalTicketId: result.external_ticket_id,
    });
  }

  /**
   * Mark entry as failed with retry scheduling
   * Uses exponential backoff: 1min, 5min, 30min, 2h, 12h
   * Returns the updated entry (with new status, retry_count, etc.)
   */
  async markFailed(id: string, error: string): Promise<TicketCreationOutboxEntry> {
    const entry = await this.findById(id);
    if (!entry) {
      throw new Error(`Outbox entry not found: ${id}`);
    }

    const newRetryCount = entry.retry_count + 1;
    const maxRetries = entry.max_retries;

    // Calculate next retry delay using exponential backoff
    const delayMinutes =
      RETRY_BACKOFF_MINUTES[Math.min(newRetryCount - 1, RETRY_BACKOFF_MINUTES.length - 1)];

    const nextRetryAt = new Date(Date.now() + delayMinutes * 60 * 1000);
    const newStatus = newRetryCount >= maxRetries ? 'dead_letter' : 'failed';

    const query = `
      UPDATE ticket_creation_outbox
      SET status = $2,
          retry_count = $3,
          next_retry_at = $4,
          scheduled_at = $5,
          error_message = $6,
          updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `;

    const result = await this.pool.query<TicketCreationOutboxEntry>(query, [
      id,
      newStatus,
      newRetryCount,
      nextRetryAt,
      newStatus === 'dead_letter' ? entry.scheduled_at : nextRetryAt, // Don't reschedule dead letters
      error,
    ]);

    const updatedEntry = this.parseOutboxEntry(result.rows[0]);

    if (newStatus === 'dead_letter') {
      logger.error('Outbox entry moved to dead letter queue (max retries exhausted)', {
        id,
        retryCount: newRetryCount,
        maxRetries,
        error,
      });
    } else {
      logger.warn('Outbox entry marked as failed (will retry)', {
        id,
        retryCount: newRetryCount,
        maxRetries,
        nextRetryAt,
        error,
      });
    }

    return updatedEntry;
  }

  /**
   * Get dead letter queue entries (for admin monitoring)
   */
  async getDeadLetterQueue(limit: number = 100): Promise<TicketCreationOutboxEntry[]> {
    const query = `
      SELECT * FROM ticket_creation_outbox
      WHERE status = 'dead_letter'
      ORDER BY updated_at DESC
      LIMIT $1
    `;

    const result = await this.pool.query<TicketCreationOutboxEntry>(query, [limit]);
    return result.rows.map((row) => this.parseOutboxEntry(row));
  }

  /**
   * Manually retry a dead letter entry (admin action)
   */
  async retryDeadLetter(id: string): Promise<void> {
    const query = `
      UPDATE ticket_creation_outbox
      SET status = 'pending',
          retry_count = 0,
          scheduled_at = NOW(),
          next_retry_at = NULL,
          error_message = NULL,
          updated_at = NOW()
      WHERE id = $1
        AND status = 'dead_letter'
    `;

    const result = await this.pool.query(query, [id]);

    if (result.rowCount === 0) {
      throw new Error(`Dead letter entry not found or already retried: ${id}`);
    }

    logger.info('Dead letter entry manually retried', { id });
  }

  /**
   * Get outbox statistics (for monitoring)
   */
  async getStats(): Promise<{
    pending: number;
    processing: number;
    completed: number;
    failed: number;
    dead_letter: number;
    avg_retry_count: number;
  }> {
    const query = `
      SELECT
        COUNT(*) FILTER (WHERE status = 'pending') as pending,
        COUNT(*) FILTER (WHERE status = 'processing') as processing,
        COUNT(*) FILTER (WHERE status = 'completed') as completed,
        COUNT(*) FILTER (WHERE status = 'failed') as failed,
        COUNT(*) FILTER (WHERE status = 'dead_letter') as dead_letter,
        COALESCE(AVG(retry_count) FILTER (WHERE status IN ('failed', 'dead_letter')), 0) as avg_retry_count
      FROM ticket_creation_outbox
    `;

    const result = await this.pool.query(query);
    return {
      pending: parseInt(result.rows[0].pending, 10),
      processing: parseInt(result.rows[0].processing, 10),
      completed: parseInt(result.rows[0].completed, 10),
      failed: parseInt(result.rows[0].failed, 10),
      dead_letter: parseInt(result.rows[0].dead_letter, 10),
      avg_retry_count: parseFloat(result.rows[0].avg_retry_count),
    };
  }

  /**
   * Parse database row to properly typed entry (handles JSONB parsing)
   */
  private parseOutboxEntry(row: any): TicketCreationOutboxEntry {
    return {
      ...row,
      payload: typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload,
      scheduled_at: new Date(row.scheduled_at as string | number | Date),
      next_retry_at: row.next_retry_at
        ? new Date(row.next_retry_at as string | number | Date)
        : null,
      created_at: new Date(row.created_at as string | number | Date),
      updated_at: new Date(row.updated_at as string | number | Date),
      processed_at: row.processed_at ? new Date(row.processed_at as string | number | Date) : null,
    };
  }
}
