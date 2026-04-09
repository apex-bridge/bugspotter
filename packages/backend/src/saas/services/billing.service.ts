/**
 * Billing Service.
 * Queue-based: sends checkout/cancel requests to the payment-service via BullMQ.
 * Handles subscription activation and trial expiration on the backend side.
 */

import type { DatabaseClient } from '../../db/client.js';
import type { PlanName } from '../../db/types.js';
import { BILLING_STATUS, SUBSCRIPTION_STATUS, PLAN_NAME } from '../../db/types.js';
import { AppError } from '../../api/middleware/error.js';
import { getQuotaForPlan, getPlanPrice } from '../plans.js';
import { getQueueManager } from '../../queue/queue-manager.js';
import { QUEUE_NAMES, type PaymentJobData, type PaymentJobResult } from '../../queue/types.js';
import { MessageBrokerTimeoutError } from '@bugspotter/message-broker';
import { getLogger } from '../../logger.js';

const logger = getLogger();

const CHECKOUT_TIMEOUT_MS = 30_000;

/** Add one month, clamping to the last day of the target month. */
function addOneMonth(date: Date): Date {
  const result = new Date(date);
  const targetMonth = result.getMonth() + 1;
  result.setMonth(targetMonth);
  // If the day overflowed (e.g. Jan 31 → Mar 3), clamp to last day of target month
  if (result.getMonth() !== targetMonth % 12) {
    result.setDate(0); // sets to last day of previous month
  }
  return result;
}

/**
 * Classify errors from publishAndWait into user-facing HTTP errors.
 * - Timeout / connection errors → 503 (infrastructure)
 * - Job failure (provider error) → 502 (upstream)
 */
const CONNECTION_ERROR_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'ECONNRESET', 'ETIMEDOUT']);

function isConnectionError(err: unknown): boolean {
  if (typeof err === 'object' && err !== null && 'code' in err) {
    return CONNECTION_ERROR_CODES.has((err as { code: string }).code);
  }
  return false;
}

function classifyPaymentError(err: unknown): never {
  // Timeout from the message broker
  if (err instanceof MessageBrokerTimeoutError) {
    throw new AppError(
      'Payment service did not respond in time. Please try again.',
      503,
      'PaymentServiceTimeout'
    );
  }

  if (isConnectionError(err)) {
    throw new AppError(
      'Payment service is temporarily unavailable. Please try again later.',
      503,
      'PaymentServiceUnavailable'
    );
  }

  // Job failed — this is a provider-side error, forward message
  const message = err instanceof Error ? err.message : String(err);
  throw new AppError(`Payment provider error: ${message}`, 502, 'PaymentProviderError');
}

/** Map data-residency region to billing currency. */
const REGION_CURRENCY: Record<string, string> = {
  KZ: 'KZT',
  RU: 'RUB',
};

export class BillingService {
  constructor(private readonly db: DatabaseClient) {}

  /**
   * Create a checkout session by dispatching to the payment service.
   * Waits for the payment service to return a checkout URL.
   */
  async createCheckout(
    organizationId: string,
    planName: PlanName,
    returnUrl: string
  ): Promise<{ redirectUrl: string }> {
    if (planName === 'trial') {
      throw new AppError('Cannot purchase a trial plan', 400, 'BadRequest');
    }

    const org = await this.db.organizations.findById(organizationId);
    if (!org) {
      throw new AppError(`Organization not found: ${organizationId}`, 404, 'NotFound');
    }

    const currency = REGION_CURRENCY[org.data_residency_region] ?? 'USD';
    const price = getPlanPrice(planName, currency);

    const broker = getQueueManager().getBrokerInstance();

    let result: PaymentJobResult;
    try {
      result = await broker.publishAndWait<PaymentJobData, PaymentJobResult>(
        QUEUE_NAMES.PAYMENTS,
        'create-checkout',
        {
          action: 'checkout',
          organizationId,
          planName,
          returnUrl,
          price,
          currency,
        } satisfies PaymentJobData,
        { timeout: CHECKOUT_TIMEOUT_MS }
      );
    } catch (err) {
      classifyPaymentError(err);
    }

    if (!result.checkoutUrl) {
      throw new AppError(
        'Payment service did not return a checkout URL',
        502,
        'PaymentProviderError'
      );
    }

    // Store the external IDs if available immediately (Stripe returns these at checkout creation).
    // This enables webhook lookup by external ID before the webhook arrives.
    if (result.externalSubscriptionId) {
      const subscription = await this.db.subscriptions.findByOrganizationId(organizationId);
      if (subscription) {
        await this.db.subscriptions.update(subscription.id, {
          external_subscription_id: result.externalSubscriptionId,
          external_customer_id: result.externalCustomerId ?? null,
        });
      } else {
        logger.error('[billing] createCheckout: no subscription record for organization', {
          organizationId,
          externalSubscriptionId: result.externalSubscriptionId,
        });
        throw new AppError(
          'Organization has no subscription record. Please contact support.',
          500,
          'MissingSubscription'
        );
      }
    }

    return { redirectUrl: result.checkoutUrl };
  }

  /**
   * Cancel an organization's subscription via the payment service.
   */
  async cancelSubscription(organizationId: string): Promise<void> {
    const subscription = await this.db.subscriptions.findByOrganizationId(organizationId);
    if (!subscription) {
      throw new AppError(
        `No subscription found for organization: ${organizationId}`,
        404,
        'NotFound'
      );
    }

    // Idempotency: already canceled
    if (subscription.status === BILLING_STATUS.CANCELED) {
      return;
    }

    // Cancel locally first — user intent is clear, don't block on provider.
    await this.db.subscriptions.update(subscription.id, {
      status: BILLING_STATUS.CANCELED,
    });

    await this.db.organizations.updateSubscriptionStatus(
      organizationId,
      SUBSCRIPTION_STATUS.CANCELED
    );

    // Dispatch external cancellation asynchronously with retries.
    // If the payment service is down the job stays in the queue and
    // BullMQ will retry with exponential backoff.
    if (subscription.external_subscription_id) {
      const broker = getQueueManager().getBrokerInstance();

      await broker.publish(
        QUEUE_NAMES.PAYMENTS,
        'cancel-subscription',
        {
          action: 'cancel',
          organizationId,
          externalSubscriptionId: subscription.external_subscription_id,
        } satisfies PaymentJobData,
        {
          attempts: 5,
          backoff: { type: 'exponential', delay: 5_000 },
        }
      );
    }
  }

  /**
   * Sync a provider-initiated cancellation to local DB state.
   * Unlike cancelSubscription(), this does NOT dispatch a cancel job back to the provider,
   * since the provider already knows the subscription is canceled.
   */
  async syncCancellation(organizationId: string): Promise<void> {
    const subscription = await this.db.subscriptions.findByOrganizationId(organizationId);
    if (!subscription) {
      logger.warn('[billing] syncCancellation: no subscription found', { organizationId });
      return;
    }

    if (subscription.status === BILLING_STATUS.CANCELED) {
      return;
    }

    await this.db.subscriptions.update(subscription.id, {
      status: BILLING_STATUS.CANCELED,
    });

    await this.db.organizations.updateSubscriptionStatus(
      organizationId,
      SUBSCRIPTION_STATUS.CANCELED
    );
  }

  /**
   * Activate a subscription after successful payment.
   * Called by the payment-event worker when it receives a payment.succeeded event.
   */
  async activateSubscription(
    externalSubscriptionId: string,
    providerName: string,
    planName: string,
    externalCustomerId?: string,
    organizationId?: string
  ): Promise<void> {
    let subscription = await this.db.subscriptions.findByExternalSubscriptionId(
      providerName,
      externalSubscriptionId
    );

    // Fallback: webhook may arrive before checkout writes the external ID.
    // Use organizationId from the webhook metadata to find the subscription.
    if (!subscription && organizationId) {
      subscription = await this.db.subscriptions.findByOrganizationId(organizationId);
    }

    if (!subscription) {
      logger.warn('[billing] activateSubscription: no subscription found', {
        externalSubscriptionId,
        providerName,
        organizationId,
      });
      return;
    }

    // Idempotency: skip if already active on the same plan
    if (subscription.status === BILLING_STATUS.ACTIVE && subscription.plan_name === planName) {
      return;
    }

    const now = new Date();
    const periodEnd = addOneMonth(now);

    await this.db.subscriptions.update(subscription.id, {
      plan_name: planName as PlanName,
      status: BILLING_STATUS.ACTIVE,
      payment_provider: providerName,
      external_subscription_id: externalSubscriptionId,
      external_customer_id: externalCustomerId ?? null,
      current_period_start: now,
      current_period_end: periodEnd,
      quotas: getQuotaForPlan(planName as PlanName),
    });

    await this.db.organizations.updateSubscriptionStatus(
      subscription.organization_id,
      SUBSCRIPTION_STATUS.ACTIVE
    );
  }

  /**
   * Activate a subscription after an invoice is marked as paid.
   * Unlike activateSubscription() (designed for card provider webhooks),
   * this method looks up the subscription directly by organizationId
   * and always extends the period (no idempotency skip on same plan).
   */
  async activateFromInvoicePayment(
    organizationId: string,
    planName: string,
    invoicePeriodStart?: Date,
    invoicePeriodEnd?: Date
  ): Promise<void> {
    // Validate plan name before casting
    const validPlans = Object.values(PLAN_NAME);
    if (!validPlans.includes(planName as PlanName)) {
      throw new AppError(`Invalid plan name: ${planName}`, 400, 'BadRequest');
    }

    const subscription = await this.db.subscriptions.findByOrganizationId(organizationId);

    if (!subscription) {
      throw new AppError(
        `No subscription found for organization: ${organizationId}`,
        500,
        'InternalServerError'
      );
    }

    // Compute the new billing period.
    // Start from the latest of (current_period_end, invoicePeriodStart, now)
    // to avoid shortening an existing period or setting a period in the past.
    const now = new Date();
    const currentEnd = subscription.current_period_end;

    let periodStart: Date;
    let periodEnd: Date;

    if (invoicePeriodStart && invoicePeriodEnd) {
      // Explicit invoice period — clamp start to at least max(currentEnd, now)
      const floor = currentEnd > now ? currentEnd : now;
      periodStart = floor > invoicePeriodStart ? floor : invoicePeriodStart;
      // Preserve the original duration even when start is clamped.
      // Guard against zero/negative duration (bad data) by falling back to one month.
      const originalDurationMs = invoicePeriodEnd.getTime() - invoicePeriodStart.getTime();
      periodEnd =
        originalDurationMs > 0
          ? new Date(periodStart.getTime() + originalDurationMs)
          : addOneMonth(periodStart);
    } else {
      // No explicit period — extend from the later of (current end, now)
      periodStart = currentEnd > now ? currentEnd : now;
      periodEnd = addOneMonth(periodStart);
    }

    await this.db.subscriptions.update(subscription.id, {
      plan_name: planName as PlanName,
      status: BILLING_STATUS.ACTIVE,
      payment_provider: 'invoice',
      external_subscription_id: null,
      external_customer_id: null,
      current_period_start: periodStart,
      current_period_end: periodEnd,
      quotas: getQuotaForPlan(planName as PlanName),
    });

    await this.db.organizations.updateSubscriptionStatus(
      subscription.organization_id,
      SUBSCRIPTION_STATUS.ACTIVE
    );

    logger.info('[billing] Subscription activated from invoice payment', {
      organizationId,
      planName,
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
    });
  }

  /**
   * Handle a failed payment. Sets subscription to past_due.
   */
  async handlePaymentFailed(externalSubscriptionId: string, providerName: string): Promise<void> {
    const subscription = await this.db.subscriptions.findByExternalSubscriptionId(
      providerName,
      externalSubscriptionId
    );
    if (!subscription) {
      return;
    }

    // Don't regress a terminal or already-degraded state
    const ignoredStatuses: string[] = [BILLING_STATUS.CANCELED, BILLING_STATUS.PAST_DUE];
    if (ignoredStatuses.includes(subscription.status)) {
      return;
    }

    await this.db.subscriptions.update(subscription.id, {
      status: BILLING_STATUS.PAST_DUE,
    });

    await this.db.organizations.updateSubscriptionStatus(
      subscription.organization_id,
      SUBSCRIPTION_STATUS.PAST_DUE
    );
  }

  /**
   * Handle a subscription update from the payment provider (e.g. plan change via portal).
   * Syncs plan name and quotas if the plan has changed.
   */
  async handleSubscriptionUpdated(
    externalSubscriptionId: string,
    providerName: string,
    planName?: string
  ): Promise<void> {
    const subscription = await this.db.subscriptions.findByExternalSubscriptionId(
      providerName,
      externalSubscriptionId
    );
    if (!subscription) {
      return;
    }

    // Only update if the plan actually changed
    if (planName && planName !== subscription.plan_name) {
      await this.db.subscriptions.update(subscription.id, {
        plan_name: planName as PlanName,
        quotas: getQuotaForPlan(planName as PlanName),
      });
    }
  }

  /**
   * Expire trial subscriptions past their end date.
   * Returns the number of expired trials.
   */
  async expireTrials(): Promise<number> {
    return this.db.queryWithTransaction(async (client) => {
      const result = await client.query<{ id: string; organization_id: string }>(
        `UPDATE saas.subscriptions
         SET status = $1, updated_at = NOW()
         WHERE status = $2 AND current_period_end < NOW()
         RETURNING id, organization_id`,
        [BILLING_STATUS.CANCELED, BILLING_STATUS.TRIAL]
      );

      for (const row of result.rows) {
        await this.db.organizations.updateSubscriptionStatus(
          row.organization_id,
          SUBSCRIPTION_STATUS.TRIAL_EXPIRED
        );
      }

      return result.rowCount ?? 0;
    });
  }
}
