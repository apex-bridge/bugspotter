/**
 * Payment Worker — consumes jobs from the "payments" BullMQ queue.
 * Processes checkout and cancel requests using the configured provider.
 */

import type { Redis } from 'ioredis';
import { BullMQWorkerHost } from '@bugspotter/message-broker';
import type { IJobHandle, IWorkerHost } from '@bugspotter/message-broker';
import type { PaymentProvider } from './providers/types.js';
import { ValidationError } from './errors.js';

export interface PaymentJobData {
  action: 'checkout' | 'cancel';
  organizationId: string;
  planName?: string;
  returnUrl?: string;
  externalSubscriptionId?: string;
  price?: number;
  currency?: string;
}

export interface PaymentJobResult {
  checkoutUrl?: string;
  externalSubscriptionId?: string;
  externalCustomerId?: string;
}

export function startPaymentWorker(
  provider: PaymentProvider,
  connection: Redis
): IWorkerHost<PaymentJobData, PaymentJobResult> {
  const worker = new BullMQWorkerHost<PaymentJobData, PaymentJobResult>({
    queue: 'payments',
    processor: async (job: IJobHandle<PaymentJobData>) => {
      const { action } = job.data;

      switch (action) {
        case 'checkout': {
          const { organizationId, planName, returnUrl, price, currency } = job.data;
          if (!planName || !returnUrl) {
            throw new ValidationError('checkout requires planName and returnUrl');
          }
          if (price === undefined || price <= 0) {
            throw new ValidationError('checkout requires a positive price');
          }
          if (!currency || !/^[A-Z]{3}$/.test(currency)) {
            throw new ValidationError('checkout requires a valid 3-letter currency code');
          }

          const result = await provider.createCheckoutSession({
            organizationId,
            planName,
            returnUrl,
            price,
            currency,
          });

          return {
            checkoutUrl: result.checkoutUrl,
            externalSubscriptionId: result.externalSubscriptionId,
            externalCustomerId: result.externalCustomerId,
          };
        }

        case 'cancel': {
          const { externalSubscriptionId } = job.data;
          if (!externalSubscriptionId) {
            throw new ValidationError('cancel requires externalSubscriptionId');
          }
          await provider.cancelSubscription(externalSubscriptionId);
          return {};
        }

        default: {
          const _exhaustive: never = action;
          throw new ValidationError(`Unknown action: ${_exhaustive}`);
        }
      }
    },
    connection,
    concurrency: 5,
  });

  worker.on('failed', (job, err) => {
    console.error(`[payment-worker] Job ${job?.id} failed:`, err.message);
  });

  return worker;
}
