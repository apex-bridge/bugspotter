/**
 * Trial Expiration Job.
 * Runs on a schedule to expire trial subscriptions past their end date.
 */

import type { DatabaseClient } from '../../db/client.js';
import { BillingService } from '../services/billing.service.js';
import { getLogger } from '../../logger.js';

const logger = getLogger();

export async function runTrialExpirationJob(db: DatabaseClient): Promise<number> {
  const billing = new BillingService(db);
  const expiredCount = await billing.expireTrials();

  if (expiredCount > 0) {
    logger.info(`[trial-expiration] Expired ${expiredCount} trial subscriptions`);
  }

  return expiredCount;
}
