/**
 * BillingService Unit Tests
 * Covers subscription lifecycle, payment job orchestration, error classification,
 * idempotency, and edge cases.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BillingService } from '../../src/saas/services/billing.service.js';
import { BILLING_STATUS, SUBSCRIPTION_STATUS, PLAN_NAME } from '../../src/db/types.js';
import type { DatabaseClient } from '../../src/db/client.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../src/logger.js', () => ({
  getLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const mockBroker = {
  publish: vi.fn().mockResolvedValue('job-1'),
  publishAndWait: vi.fn(),
};

vi.mock('../../src/queue/queue-manager.js', () => ({
  getQueueManager: () => ({
    getBrokerInstance: () => mockBroker,
  }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockDb() {
  return {
    subscriptions: {
      findByOrganizationId: vi.fn(),
      findByExternalSubscriptionId: vi.fn(),
      update: vi.fn().mockResolvedValue(undefined),
    },
    organizations: {
      findById: vi.fn(),
      updateSubscriptionStatus: vi.fn().mockResolvedValue(undefined),
    },
    queryWithTransaction: vi.fn(),
  } as unknown as DatabaseClient;
}

function makeSubscription(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sub-1',
    organization_id: 'org-1',
    plan_name: PLAN_NAME.STARTER,
    status: BILLING_STATUS.ACTIVE,
    payment_provider: 'stripe',
    external_subscription_id: 'ext-sub-1',
    external_customer_id: 'ext-cust-1',
    current_period_start: new Date('2025-01-01'),
    current_period_end: new Date('2025-02-01'),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BillingService', () => {
  let db: ReturnType<typeof createMockDb>;
  let service: BillingService;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    service = new BillingService(db as unknown as DatabaseClient);
  });

  // =========================================================================
  // createCheckout
  // =========================================================================

  describe('createCheckout', () => {
    it('rejects trial plan purchase', async () => {
      await expect(
        service.createCheckout('org-1', PLAN_NAME.TRIAL, 'https://x.com/return')
      ).rejects.toThrow('Cannot purchase a trial plan');
    });

    it('throws 404 when organization not found', async () => {
      (db.organizations.findById as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      await expect(
        service.createCheckout('org-missing', PLAN_NAME.STARTER, 'https://x.com/return')
      ).rejects.toThrow('Organization not found');
    });

    it('dispatches checkout job with correct currency for KZ region', async () => {
      (db.organizations.findById as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'org-1',
        data_residency_region: 'KZ',
      });
      mockBroker.publishAndWait.mockResolvedValue({
        checkoutUrl: 'https://pay.example.com/session',
        externalSubscriptionId: 'ext-1',
      });
      (db.subscriptions.findByOrganizationId as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeSubscription()
      );

      const result = await service.createCheckout(
        'org-1',
        PLAN_NAME.STARTER,
        'https://x.com/return'
      );

      expect(result.redirectUrl).toBe('https://pay.example.com/session');
      expect(mockBroker.publishAndWait).toHaveBeenCalledWith(
        'payments',
        'create-checkout',
        expect.objectContaining({
          action: 'checkout',
          currency: 'KZT',
          price: 4_990,
        }),
        expect.objectContaining({ timeout: 30_000 })
      );
    });

    it('defaults to USD for unknown region', async () => {
      (db.organizations.findById as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'org-1',
        data_residency_region: 'US',
      });
      mockBroker.publishAndWait.mockResolvedValue({
        checkoutUrl: 'https://pay.example.com/session',
      });

      await service.createCheckout('org-1', PLAN_NAME.STARTER, 'https://x.com/return');

      expect(mockBroker.publishAndWait).toHaveBeenCalledWith(
        'payments',
        'create-checkout',
        expect.objectContaining({ currency: 'USD', price: 9 }),
        expect.objectContaining({ timeout: 30_000 })
      );
    });

    it('throws 502 when payment service returns no checkout URL', async () => {
      (db.organizations.findById as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'org-1',
        data_residency_region: 'US',
      });
      mockBroker.publishAndWait.mockResolvedValue({});

      await expect(
        service.createCheckout('org-1', PLAN_NAME.STARTER, 'https://x.com/return')
      ).rejects.toThrow('did not return a checkout URL');
    });

    it('stores external IDs when returned at checkout', async () => {
      (db.organizations.findById as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'org-1',
        data_residency_region: 'US',
      });
      mockBroker.publishAndWait.mockResolvedValue({
        checkoutUrl: 'https://pay.example.com/session',
        externalSubscriptionId: 'ext-sub-99',
        externalCustomerId: 'ext-cust-99',
      });
      const sub = makeSubscription();
      (db.subscriptions.findByOrganizationId as ReturnType<typeof vi.fn>).mockResolvedValue(sub);

      await service.createCheckout('org-1', PLAN_NAME.STARTER, 'https://x.com/return');

      expect(db.subscriptions.update).toHaveBeenCalledWith(sub.id, {
        external_subscription_id: 'ext-sub-99',
        external_customer_id: 'ext-cust-99',
      });
    });

    it('throws 500 when no subscription record exists for external ID storage', async () => {
      (db.organizations.findById as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'org-1',
        data_residency_region: 'US',
      });
      mockBroker.publishAndWait.mockResolvedValue({
        checkoutUrl: 'https://pay.example.com/session',
        externalSubscriptionId: 'ext-sub-99',
      });
      (db.subscriptions.findByOrganizationId as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      await expect(
        service.createCheckout('org-1', PLAN_NAME.STARTER, 'https://x.com/return')
      ).rejects.toThrow('no subscription record');
    });
  });

  // =========================================================================
  // cancelSubscription
  // =========================================================================

  describe('cancelSubscription', () => {
    it('throws 404 when no subscription exists', async () => {
      (db.subscriptions.findByOrganizationId as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      await expect(service.cancelSubscription('org-1')).rejects.toThrow('No subscription found');
    });

    it('is idempotent for already-canceled subscriptions', async () => {
      (db.subscriptions.findByOrganizationId as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeSubscription({ status: BILLING_STATUS.CANCELED })
      );

      await service.cancelSubscription('org-1');

      expect(db.subscriptions.update).not.toHaveBeenCalled();
      expect(mockBroker.publish).not.toHaveBeenCalled();
    });

    it('updates local DB and dispatches cancel job', async () => {
      const sub = makeSubscription();
      (db.subscriptions.findByOrganizationId as ReturnType<typeof vi.fn>).mockResolvedValue(sub);

      await service.cancelSubscription('org-1');

      expect(db.subscriptions.update).toHaveBeenCalledWith(sub.id, {
        status: BILLING_STATUS.CANCELED,
      });
      expect(db.organizations.updateSubscriptionStatus).toHaveBeenCalledWith(
        'org-1',
        SUBSCRIPTION_STATUS.CANCELED
      );
      expect(mockBroker.publish).toHaveBeenCalledWith(
        'payments',
        'cancel-subscription',
        expect.objectContaining({
          action: 'cancel',
          externalSubscriptionId: sub.external_subscription_id,
        }),
        expect.objectContaining({ attempts: 5 })
      );
    });

    it('skips queue dispatch when no external subscription ID', async () => {
      const sub = makeSubscription({ external_subscription_id: null });
      (db.subscriptions.findByOrganizationId as ReturnType<typeof vi.fn>).mockResolvedValue(sub);

      await service.cancelSubscription('org-1');

      expect(db.subscriptions.update).toHaveBeenCalled();
      expect(mockBroker.publish).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // syncCancellation
  // =========================================================================

  describe('syncCancellation', () => {
    it('no-ops when subscription not found', async () => {
      (db.subscriptions.findByOrganizationId as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      await service.syncCancellation('org-1');

      expect(db.subscriptions.update).not.toHaveBeenCalled();
    });

    it('no-ops when already canceled', async () => {
      (db.subscriptions.findByOrganizationId as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeSubscription({ status: BILLING_STATUS.CANCELED })
      );

      await service.syncCancellation('org-1');

      expect(db.subscriptions.update).not.toHaveBeenCalled();
    });

    it('updates local state without dispatching to provider', async () => {
      const sub = makeSubscription();
      (db.subscriptions.findByOrganizationId as ReturnType<typeof vi.fn>).mockResolvedValue(sub);

      await service.syncCancellation('org-1');

      expect(db.subscriptions.update).toHaveBeenCalledWith(sub.id, {
        status: BILLING_STATUS.CANCELED,
      });
      expect(db.organizations.updateSubscriptionStatus).toHaveBeenCalledWith(
        'org-1',
        SUBSCRIPTION_STATUS.CANCELED
      );
      // Must NOT dispatch a cancel job back to payment-service
      expect(mockBroker.publish).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // activateSubscription
  // =========================================================================

  describe('activateSubscription', () => {
    it('activates by external subscription ID', async () => {
      const sub = makeSubscription({ status: BILLING_STATUS.TRIAL });
      (db.subscriptions.findByExternalSubscriptionId as ReturnType<typeof vi.fn>).mockResolvedValue(
        sub
      );

      await service.activateSubscription('ext-sub-1', 'stripe', 'professional', 'ext-cust-1');

      expect(db.subscriptions.update).toHaveBeenCalledWith(
        sub.id,
        expect.objectContaining({
          plan_name: 'professional',
          status: BILLING_STATUS.ACTIVE,
          payment_provider: 'stripe',
          external_subscription_id: 'ext-sub-1',
          external_customer_id: 'ext-cust-1',
        })
      );
      expect(db.organizations.updateSubscriptionStatus).toHaveBeenCalledWith(
        sub.organization_id,
        SUBSCRIPTION_STATUS.ACTIVE
      );
    });

    it('falls back to organizationId when external lookup fails', async () => {
      (db.subscriptions.findByExternalSubscriptionId as ReturnType<typeof vi.fn>).mockResolvedValue(
        null
      );
      const sub = makeSubscription({ status: BILLING_STATUS.TRIAL });
      (db.subscriptions.findByOrganizationId as ReturnType<typeof vi.fn>).mockResolvedValue(sub);

      await service.activateSubscription('ext-sub-new', 'kaspi', 'starter', undefined, 'org-1');

      expect(db.subscriptions.findByOrganizationId).toHaveBeenCalledWith('org-1');
      expect(db.subscriptions.update).toHaveBeenCalledWith(
        sub.id,
        expect.objectContaining({
          plan_name: 'starter',
          status: BILLING_STATUS.ACTIVE,
        })
      );
    });

    it('no-ops when no subscription found at all', async () => {
      (db.subscriptions.findByExternalSubscriptionId as ReturnType<typeof vi.fn>).mockResolvedValue(
        null
      );
      (db.subscriptions.findByOrganizationId as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      await service.activateSubscription('ext-sub-1', 'stripe', 'starter', undefined, 'org-1');

      expect(db.subscriptions.update).not.toHaveBeenCalled();
    });

    it('is idempotent when already active on same plan', async () => {
      const sub = makeSubscription({ status: BILLING_STATUS.ACTIVE, plan_name: 'starter' });
      (db.subscriptions.findByExternalSubscriptionId as ReturnType<typeof vi.fn>).mockResolvedValue(
        sub
      );

      await service.activateSubscription('ext-sub-1', 'stripe', 'starter');

      expect(db.subscriptions.update).not.toHaveBeenCalled();
    });

    it('re-activates when plan changes even if already active', async () => {
      const sub = makeSubscription({ status: BILLING_STATUS.ACTIVE, plan_name: 'starter' });
      (db.subscriptions.findByExternalSubscriptionId as ReturnType<typeof vi.fn>).mockResolvedValue(
        sub
      );

      await service.activateSubscription('ext-sub-1', 'stripe', 'professional');

      expect(db.subscriptions.update).toHaveBeenCalledWith(
        sub.id,
        expect.objectContaining({ plan_name: 'professional' })
      );
    });

    it('sets period dates with addOneMonth clamping', async () => {
      const sub = makeSubscription({ status: BILLING_STATUS.TRIAL });
      (db.subscriptions.findByExternalSubscriptionId as ReturnType<typeof vi.fn>).mockResolvedValue(
        sub
      );

      vi.useFakeTimers();
      vi.setSystemTime(new Date('2025-01-31T12:00:00Z'));

      await service.activateSubscription('ext-sub-1', 'stripe', 'starter');

      const updateCall = (db.subscriptions.update as ReturnType<typeof vi.fn>).mock.calls[0][1];
      // Jan 31 + 1 month should clamp to Feb 28 (2025 is not a leap year)
      expect(updateCall.current_period_end.getMonth()).toBe(1); // February
      expect(updateCall.current_period_end.getDate()).toBe(28);

      vi.useRealTimers();
    });
  });

  // =========================================================================
  // handlePaymentFailed
  // =========================================================================

  describe('handlePaymentFailed', () => {
    it('no-ops when subscription not found', async () => {
      (db.subscriptions.findByExternalSubscriptionId as ReturnType<typeof vi.fn>).mockResolvedValue(
        null
      );

      await service.handlePaymentFailed('ext-sub-1', 'stripe');

      expect(db.subscriptions.update).not.toHaveBeenCalled();
    });

    it('sets active subscription to past_due', async () => {
      const sub = makeSubscription({ status: BILLING_STATUS.ACTIVE });
      (db.subscriptions.findByExternalSubscriptionId as ReturnType<typeof vi.fn>).mockResolvedValue(
        sub
      );

      await service.handlePaymentFailed('ext-sub-1', 'stripe');

      expect(db.subscriptions.update).toHaveBeenCalledWith(sub.id, {
        status: BILLING_STATUS.PAST_DUE,
      });
      expect(db.organizations.updateSubscriptionStatus).toHaveBeenCalledWith(
        sub.organization_id,
        SUBSCRIPTION_STATUS.PAST_DUE
      );
    });

    it('does not regress canceled subscription', async () => {
      const sub = makeSubscription({ status: BILLING_STATUS.CANCELED });
      (db.subscriptions.findByExternalSubscriptionId as ReturnType<typeof vi.fn>).mockResolvedValue(
        sub
      );

      await service.handlePaymentFailed('ext-sub-1', 'stripe');

      expect(db.subscriptions.update).not.toHaveBeenCalled();
    });

    it('does not regress already past_due subscription', async () => {
      const sub = makeSubscription({ status: BILLING_STATUS.PAST_DUE });
      (db.subscriptions.findByExternalSubscriptionId as ReturnType<typeof vi.fn>).mockResolvedValue(
        sub
      );

      await service.handlePaymentFailed('ext-sub-1', 'stripe');

      expect(db.subscriptions.update).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // handleSubscriptionUpdated
  // =========================================================================

  describe('handleSubscriptionUpdated', () => {
    it('no-ops when subscription not found', async () => {
      (db.subscriptions.findByExternalSubscriptionId as ReturnType<typeof vi.fn>).mockResolvedValue(
        null
      );

      await service.handleSubscriptionUpdated('ext-sub-1', 'stripe', 'professional');

      expect(db.subscriptions.update).not.toHaveBeenCalled();
    });

    it('updates plan and quotas when plan changed', async () => {
      const sub = makeSubscription({ plan_name: 'starter' });
      (db.subscriptions.findByExternalSubscriptionId as ReturnType<typeof vi.fn>).mockResolvedValue(
        sub
      );

      await service.handleSubscriptionUpdated('ext-sub-1', 'stripe', 'professional');

      expect(db.subscriptions.update).toHaveBeenCalledWith(
        sub.id,
        expect.objectContaining({ plan_name: 'professional' })
      );
    });

    it('no-ops when plan is the same', async () => {
      const sub = makeSubscription({ plan_name: 'starter' });
      (db.subscriptions.findByExternalSubscriptionId as ReturnType<typeof vi.fn>).mockResolvedValue(
        sub
      );

      await service.handleSubscriptionUpdated('ext-sub-1', 'stripe', 'starter');

      expect(db.subscriptions.update).not.toHaveBeenCalled();
    });

    it('no-ops when planName is undefined', async () => {
      const sub = makeSubscription();
      (db.subscriptions.findByExternalSubscriptionId as ReturnType<typeof vi.fn>).mockResolvedValue(
        sub
      );

      await service.handleSubscriptionUpdated('ext-sub-1', 'stripe');

      expect(db.subscriptions.update).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // activateFromInvoicePayment
  // =========================================================================

  describe('activateFromInvoicePayment', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('throws 400 on invalid plan name', async () => {
      await expect(service.activateFromInvoicePayment('org-1', 'nonexistent-plan')).rejects.toThrow(
        expect.objectContaining({ statusCode: 400 })
      );

      expect(db.subscriptions.update).not.toHaveBeenCalled();
    });

    it('throws 500 when no subscription found', async () => {
      (db.subscriptions.findByOrganizationId as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      await expect(service.activateFromInvoicePayment('org-1', PLAN_NAME.STARTER)).rejects.toThrow(
        expect.objectContaining({ statusCode: 500 })
      );
    });

    it('activates subscription with invoice period dates', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2025-01-20T00:00:00Z'));

      const sub = makeSubscription({
        status: BILLING_STATUS.TRIAL,
        current_period_end: new Date('2025-01-15'),
      });
      (db.subscriptions.findByOrganizationId as ReturnType<typeof vi.fn>).mockResolvedValue(sub);

      await service.activateFromInvoicePayment(
        'org-1',
        PLAN_NAME.STARTER,
        new Date('2025-02-01'),
        new Date('2025-03-01')
      );

      expect(db.subscriptions.update).toHaveBeenCalledWith(
        sub.id,
        expect.objectContaining({
          plan_name: PLAN_NAME.STARTER,
          status: BILLING_STATUS.ACTIVE,
          payment_provider: 'invoice',
          external_subscription_id: null,
          external_customer_id: null,
          current_period_start: new Date('2025-02-01'),
          current_period_end: new Date('2025-03-01'),
        })
      );
      expect(db.organizations.updateSubscriptionStatus).toHaveBeenCalledWith(
        'org-1',
        SUBSCRIPTION_STATUS.ACTIVE
      );
    });

    it('clamps period start to current_period_end to avoid shortening', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2025-02-15T00:00:00Z'));

      const sub = makeSubscription({
        status: BILLING_STATUS.ACTIVE,
        current_period_end: new Date('2025-03-15'),
      });
      (db.subscriptions.findByOrganizationId as ReturnType<typeof vi.fn>).mockResolvedValue(sub);

      // Invoice is for Feb 1 - Mar 1, but subscription already extends to Mar 15
      await service.activateFromInvoicePayment(
        'org-1',
        PLAN_NAME.STARTER,
        new Date('2025-02-01'),
        new Date('2025-03-01')
      );

      const updateCall = (db.subscriptions.update as ReturnType<typeof vi.fn>).mock.calls[0][1];
      // Start should be clamped to current_period_end (Mar 15)
      expect(updateCall.current_period_start).toEqual(new Date('2025-03-15'));
      // End should preserve the 28-day duration from the original invoice period
      // Mar 15 + 28 days = Apr 12
      expect(updateCall.current_period_end).toEqual(new Date('2025-04-12'));
    });

    it('avoids zero-length period on stale invoice', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2025-05-01T00:00:00Z'));

      const sub = makeSubscription({
        status: BILLING_STATUS.ACTIVE,
        current_period_end: new Date('2025-06-01'),
      });
      (db.subscriptions.findByOrganizationId as ReturnType<typeof vi.fn>).mockResolvedValue(sub);

      // Very old invoice — both dates are before current_period_end
      await service.activateFromInvoicePayment(
        'org-1',
        PLAN_NAME.STARTER,
        new Date('2025-01-01'),
        new Date('2025-02-01')
      );

      const updateCall = (db.subscriptions.update as ReturnType<typeof vi.fn>).mock.calls[0][1];
      // Start should be clamped to current_period_end (Jun 1 > now May 1)
      expect(updateCall.current_period_start).toEqual(new Date('2025-06-01'));
      // End should extend by original 31-day duration: Jun 1 + 31 days = Jul 2
      expect(updateCall.current_period_end).toEqual(new Date('2025-07-02'));
    });

    it('falls back to addOneMonth when invoice has zero/negative duration', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2025-03-15T00:00:00Z'));

      const sub = makeSubscription({
        status: BILLING_STATUS.ACTIVE,
        current_period_end: new Date('2025-03-01'),
      });
      (db.subscriptions.findByOrganizationId as ReturnType<typeof vi.fn>).mockResolvedValue(sub);

      // Bad data: end == start (zero duration), but dates are in the future
      await service.activateFromInvoicePayment(
        'org-1',
        PLAN_NAME.STARTER,
        new Date('2025-04-01'),
        new Date('2025-04-01')
      );

      const updateCall = (db.subscriptions.update as ReturnType<typeof vi.fn>).mock.calls[0][1];
      expect(updateCall.current_period_start).toEqual(new Date('2025-04-01'));
      // Should fall back to addOneMonth(Apr 1) = May 1
      expect(updateCall.current_period_end).toEqual(new Date('2025-05-01'));
    });

    it('clamps period to now when both invoice and subscription are in the past', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2025-06-15T00:00:00Z'));

      const sub = makeSubscription({
        status: BILLING_STATUS.ACTIVE,
        current_period_end: new Date('2025-03-01'),
      });
      (db.subscriptions.findByOrganizationId as ReturnType<typeof vi.fn>).mockResolvedValue(sub);

      // Invoice period is also in the past
      await service.activateFromInvoicePayment(
        'org-1',
        PLAN_NAME.STARTER,
        new Date('2025-02-01'),
        new Date('2025-03-01')
      );

      const updateCall = (db.subscriptions.update as ReturnType<typeof vi.fn>).mock.calls[0][1];
      // Start should be clamped to now (Jun 15 > currentEnd Mar 1 > invoiceStart Feb 1)
      expect(updateCall.current_period_start).toEqual(new Date('2025-06-15T00:00:00Z'));
      // End should preserve 28-day duration: Jun 15 + 28 days = Jul 13
      expect(updateCall.current_period_end).toEqual(new Date('2025-07-13T00:00:00Z'));
    });

    it('nulls out external provider IDs when switching to invoice', async () => {
      const sub = makeSubscription({
        status: BILLING_STATUS.ACTIVE,
        payment_provider: 'stripe',
        external_subscription_id: 'sub_stripe_123',
        external_customer_id: 'cus_stripe_456',
      });
      (db.subscriptions.findByOrganizationId as ReturnType<typeof vi.fn>).mockResolvedValue(sub);

      await service.activateFromInvoicePayment('org-1', PLAN_NAME.STARTER);

      expect(db.subscriptions.update).toHaveBeenCalledWith(
        sub.id,
        expect.objectContaining({
          payment_provider: 'invoice',
          external_subscription_id: null,
          external_customer_id: null,
        })
      );
    });

    it('extends from now when no invoice period provided', async () => {
      const sub = makeSubscription({
        status: BILLING_STATUS.TRIAL,
        current_period_end: new Date('2025-01-01'),
      });
      (db.subscriptions.findByOrganizationId as ReturnType<typeof vi.fn>).mockResolvedValue(sub);

      vi.useFakeTimers();
      vi.setSystemTime(new Date('2025-03-15T12:00:00Z'));

      await service.activateFromInvoicePayment('org-1', PLAN_NAME.STARTER);

      const updateCall = (db.subscriptions.update as ReturnType<typeof vi.fn>).mock.calls[0][1];
      expect(updateCall.current_period_start).toEqual(new Date('2025-03-15T12:00:00Z'));
      // Should be roughly one month later
      expect(updateCall.current_period_end.getMonth()).toBe(3); // April
    });
  });

  // =========================================================================
  // awaitPaymentJob error classification (tested indirectly via createCheckout)
  // =========================================================================

  describe('payment job error classification', () => {
    beforeEach(() => {
      (db.organizations.findById as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'org-1',
        data_residency_region: 'US',
      });
    });

    it('classifies connection errors as 503', async () => {
      const err = new Error('connection refused');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (err as any).code = 'ECONNREFUSED';
      mockBroker.publishAndWait.mockRejectedValue(err);

      await expect(
        service.createCheckout('org-1', PLAN_NAME.STARTER, 'https://x.com/return')
      ).rejects.toThrow(expect.objectContaining({ statusCode: 503 }));
    });

    it('classifies job failures as 502', async () => {
      mockBroker.publishAndWait.mockRejectedValue(new Error('Stripe API error'));

      await expect(
        service.createCheckout('org-1', PLAN_NAME.STARTER, 'https://x.com/return')
      ).rejects.toThrow(expect.objectContaining({ statusCode: 502 }));
    });

    it('classifies timeout as 503', async () => {
      // Broker throws a timeout error when publishAndWait exceeds the timeout
      mockBroker.publishAndWait.mockRejectedValue(
        new (await import('@bugspotter/message-broker')).MessageBrokerTimeoutError(
          'payments',
          30000
        )
      );

      await expect(
        service.createCheckout('org-1', PLAN_NAME.STARTER, 'https://x.com/return')
      ).rejects.toThrow(
        expect.objectContaining({ statusCode: 503, error: 'PaymentServiceTimeout' })
      );
    });
  });
});
