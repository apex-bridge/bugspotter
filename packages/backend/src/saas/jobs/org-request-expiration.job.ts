/**
 * Organization Request Expiration Job.
 * Runs on a schedule to expire unverified organization requests
 * older than 24 hours.
 */

import type { DatabaseClient } from '../../db/client.js';
import { getLogger } from '../../logger.js';

const logger = getLogger();

/** Expire unverified requests older than 24 hours */
const EXPIRATION_HOURS = 24;

export async function runOrgRequestExpirationJob(db: DatabaseClient): Promise<number> {
  const expiredCount = await db.organizationRequests.expireUnverified(EXPIRATION_HOURS);

  if (expiredCount > 0) {
    logger.info(`[org-request-expiration] Expired ${expiredCount} unverified requests`);
  }

  return expiredCount;
}
