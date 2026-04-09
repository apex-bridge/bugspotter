/**
 * Payment provider interface and shared types.
 * Every provider (Kaspi, YooKassa, Stripe) implements PaymentProvider.
 */

export type PaymentProviderName = 'kaspi' | 'yookassa' | 'stripe';

export interface CheckoutParams {
  organizationId: string;
  planName: string;
  returnUrl: string;
  price: number;
  currency: string;
}

export interface CheckoutResult {
  checkoutUrl: string;
  externalSubscriptionId?: string;
  externalCustomerId?: string;
}

export interface WebhookEvent {
  type: 'payment.succeeded' | 'payment.failed' | 'subscription.canceled' | 'subscription.updated';
  eventId: string;
  externalSubscriptionId: string;
  externalCustomerId?: string;
  organizationId?: string;
  planName?: string;
}

export interface PaymentProvider {
  readonly name: PaymentProviderName;
  createCheckoutSession(params: CheckoutParams): Promise<CheckoutResult>;
  cancelSubscription(externalSubscriptionId: string): Promise<void>;
  verifyAndParseWebhook(rawBody: Buffer, headers: Record<string, string>): Promise<WebhookEvent>;
}
