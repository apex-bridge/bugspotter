/**
 * Dunning Job.
 * Runs on a schedule to mark overdue invoices and update org subscription status.
 */

import type { DatabaseClient } from '../../db/client.js';
import { getLogger } from '../../logger.js';

const logger = getLogger();

/**
 * Find all invoices that are 'sent' with due_at < now, mark them 'overdue',
 * and set the organization's subscription_status to 'past_due'.
 * Uses batch updates in a single transaction for efficiency.
 */
export async function runDunningJob(db: DatabaseClient): Promise<number> {
  const result = await db.queryWithTransaction(async (client) => {
    // Mark overdue invoices and collect affected org IDs in a single CTE
    const updateResult = await client.query<{ organization_id: string }>(`
      WITH updated_invoices AS (
        UPDATE saas.invoices
        SET status = 'overdue', updated_at = NOW()
        WHERE status = 'sent' AND due_at < NOW()
        RETURNING organization_id
      )
      SELECT DISTINCT organization_id FROM updated_invoices
    `);

    if (updateResult.rowCount && updateResult.rowCount > 0) {
      const organizationIds = updateResult.rows.map((r) => r.organization_id);
      await client.query(
        `UPDATE saas.organizations SET subscription_status = 'past_due', updated_at = NOW()
         WHERE id = ANY($1::uuid[])`,
        [organizationIds]
      );
    }

    return updateResult.rowCount ?? 0;
  });

  if (result > 0) {
    logger.info(`[dunning] Marked ${result} invoices as overdue`);
  }
  return result;
}
