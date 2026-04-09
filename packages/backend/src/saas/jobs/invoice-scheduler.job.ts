/**
 * Invoice Scheduler Job.
 * Runs monthly to generate invoices for organizations using invoice billing
 * with active subscriptions nearing their period end.
 */

import type { DatabaseClient } from '../../db/client.js';
import { BILLING_METHOD, SUBSCRIPTION_STATUS, BILLING_STATUS } from '../../db/types.js';
import type { PlanName } from '../../db/types.js';
import { getLogger } from '../../logger.js';
import { nextInvoiceNumber } from '@bugspotter/billing';
import { getPlanPrice, getRegionCurrency } from '../plans.js';

const logger = getLogger();

/** Default payment terms: 15 days from issue */
const PAYMENT_TERMS_DAYS = 15;

/** Add one month with end-of-month clamping (e.g. Jan 31 → Feb 28, not Mar 3). */
function addOneMonth(date: Date): Date {
  const result = new Date(date);
  const targetMonth = result.getMonth() + 1;
  result.setMonth(targetMonth);
  if (result.getMonth() !== targetMonth % 12) {
    result.setDate(0);
  }
  return result;
}

/**
 * Generate invoices for all invoice-billed orgs whose subscription period
 * ends within the next 7 days and don't yet have an invoice for the next period.
 */
export async function runInvoiceSchedulerJob(db: DatabaseClient): Promise<number> {
  // Find organizations with invoice billing + active subscription nearing renewal
  const result = await db.getPool().query<{
    organization_id: string;
    plan_name: string;
    current_period_end: Date;
    data_residency_region: string;
  }>(
    `SELECT s.organization_id, s.plan_name, s.current_period_end, o.data_residency_region
     FROM saas.subscriptions s
     JOIN saas.organizations o ON o.id = s.organization_id
     WHERE o.billing_method = $1
       AND o.subscription_status = $2
       AND s.status = $3
       AND s.current_period_end <= NOW() + INTERVAL '7 days'
       AND NOT EXISTS (
         SELECT 1 FROM saas.invoices i
         WHERE i.organization_id = s.organization_id
           AND i.status != 'canceled'
           AND i.created_at > s.current_period_start
       )`,
    [BILLING_METHOD.INVOICE, SUBSCRIPTION_STATUS.ACTIVE, BILLING_STATUS.ACTIVE]
  );

  if (result.rows.length === 0) {
    return 0;
  }

  let generatedCount = 0;

  for (const row of result.rows) {
    const currency = getRegionCurrency(row.data_residency_region);
    const price = getPlanPrice(row.plan_name as PlanName, currency);

    if (!price || price <= 0) {
      logger.warn(
        `[invoice-scheduler] Skipping org ${row.organization_id}: no price for plan=${row.plan_name} currency=${currency}`
      );
      continue;
    }

    const now = new Date();
    const dueAt = new Date(now);
    dueAt.setDate(dueAt.getDate() + PAYMENT_TERMS_DAYS);

    const periodStart = new Date(row.current_period_end);
    const periodEnd = addOneMonth(periodStart);

    // Wrap number allocation + invoice + line in a transaction
    await db.queryWithTransaction(async (client) => {
      const invoiceNumber = await nextInvoiceNumber(client);

      const invoiceResult = await client.query<{ id: string }>(
        `INSERT INTO saas.invoices (invoice_number, organization_id, amount, currency, status, issued_at, due_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [invoiceNumber, row.organization_id, price, currency, 'sent', now, dueAt]
      );

      const invoiceId = invoiceResult.rows[0].id;

      await client.query(
        `INSERT INTO saas.invoice_lines (invoice_id, description, plan_name, period_start, period_end, quantity, unit_price, amount)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          invoiceId,
          `BugSpotter ${row.plan_name} plan — ${currency} ${price}/month`,
          row.plan_name,
          periodStart,
          periodEnd,
          1,
          price,
          price,
        ]
      );

      logger.info(
        `[invoice-scheduler] Generated invoice ${invoiceNumber} for org ${row.organization_id}`
      );
    });

    generatedCount++;
  }

  logger.info(`[invoice-scheduler] Generated ${generatedCount} invoices`);
  return generatedCount;
}
