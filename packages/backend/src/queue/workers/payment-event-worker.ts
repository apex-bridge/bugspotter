/**
 * Payment Event Worker.
 * Consumes normalized payment events from the payment-service via the "payment-events" queue.
 * Routes events to BillingService methods to update the database.
 */

import type { Redis } from 'ioredis';
import type { DatabaseClient } from '../../db/client.js';
import type { IStorageService } from '../../storage/types.js';
import { BillingService } from '../../saas/services/billing.service.js';
import type { IWorkerHost } from '@bugspotter/message-broker';
import { createWorker } from './worker-factory.js';
import type { PaymentEventJobData } from '../types.js';
import { QUEUE_NAMES } from '../types.js';
import { getLogger } from '../../logger.js';

const logger = getLogger();

export function createPaymentEventWorker(
  db: DatabaseClient,
  _storage: IStorageService,
  connection: Redis
): IWorkerHost<PaymentEventJobData, void> {
  const billingService = new BillingService(db);

  const worker = createWorker<PaymentEventJobData, void, typeof QUEUE_NAMES.PAYMENT_EVENTS>({
    name: QUEUE_NAMES.PAYMENT_EVENTS,
    processor: async (job) => {
      const {
        type,
        externalSubscriptionId,
        externalCustomerId,
        organizationId,
        planName,
        provider,
      } = job.data;

      logger.info('[payment-event-worker] Processing event', {
        type,
        externalSubscriptionId,
        provider,
      });

      switch (type) {
        case 'payment.succeeded':
          if (planName) {
            await billingService.activateSubscription(
              externalSubscriptionId,
              provider,
              planName,
              externalCustomerId,
              organizationId
            );
          } else {
            logger.warn(
              '[payment-event-worker] payment.succeeded missing planName — subscription not activated',
              {
                externalSubscriptionId,
                provider,
              }
            );
          }
          break;

        case 'payment.failed':
          await billingService.handlePaymentFailed(externalSubscriptionId, provider);
          break;

        case 'subscription.canceled': {
          const subscription = await db.subscriptions.findByExternalSubscriptionId(
            provider,
            externalSubscriptionId
          );
          if (subscription) {
            await billingService.syncCancellation(subscription.organization_id);
          }
          break;
        }

        case 'subscription.updated':
          await billingService.handleSubscriptionUpdated(
            externalSubscriptionId,
            provider,
            planName
          );
          break;
      }
    },
    connection,
    workerType: QUEUE_NAMES.PAYMENT_EVENTS,
  });

  return worker;
}
