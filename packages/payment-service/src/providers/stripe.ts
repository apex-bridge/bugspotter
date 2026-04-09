/**
 * Stripe provider.
 * Uses Stripe SDK for international markets.
 */

import Stripe from 'stripe';
import type { CheckoutParams, CheckoutResult, PaymentProvider, WebhookEvent } from './types.js';
import { ConfigError, ValidationError, WebhookError } from '../errors.js';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new ConfigError(`Missing env var: ${name}`);
  }
  return value;
}

function getPriceId(planName: string): string {
  const map: Record<string, string | undefined> = {
    starter: process.env.STRIPE_PRICE_STARTER,
    professional: process.env.STRIPE_PRICE_PROFESSIONAL,
    enterprise: process.env.STRIPE_PRICE_ENTERPRISE,
  };
  const id = map[planName];
  if (!id) {
    throw new ConfigError(
      `No Stripe price ID for plan: ${planName}. Set STRIPE_PRICE_${planName.toUpperCase()}.`
    );
  }
  return id;
}

/**
 * Extract a string ID from a Stripe expandable field.
 * Stripe fields like `session.subscription` can be `string | Stripe.Subscription | null`.
 */
function extractId(field: string | { id: string } | null | undefined): string | undefined {
  if (typeof field === 'string') {
    return field;
  }
  if (field && typeof field === 'object' && 'id' in field) {
    return field.id;
  }
  return undefined;
}

export class StripeProvider implements PaymentProvider {
  readonly name = 'stripe' as const;
  private stripe: Stripe;

  constructor() {
    this.stripe = new Stripe(requireEnv('STRIPE_SECRET_KEY'));
  }

  async createCheckoutSession(params: CheckoutParams): Promise<CheckoutResult> {
    const session = await this.stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: getPriceId(params.planName), quantity: 1 }],
      success_url: `${params.returnUrl}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: params.returnUrl,
      metadata: {
        organization_id: params.organizationId,
        plan_name: params.planName,
      },
    });

    return {
      checkoutUrl: session.url!,
      externalSubscriptionId: extractId(session.subscription),
      externalCustomerId: extractId(session.customer),
    };
  }

  async cancelSubscription(externalSubscriptionId: string): Promise<void> {
    await this.stripe.subscriptions.cancel(externalSubscriptionId);
  }

  async verifyAndParseWebhook(
    rawBody: Buffer,
    headers: Record<string, string>
  ): Promise<WebhookEvent> {
    const webhookSecret = requireEnv('STRIPE_WEBHOOK_SECRET');
    const sig = headers['stripe-signature'];
    if (!sig) {
      throw new WebhookError('Missing stripe-signature header');
    }

    const event = this.stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        return {
          type: 'payment.succeeded',
          eventId: event.id,
          externalSubscriptionId: extractId(session.subscription) ?? '',
          externalCustomerId: extractId(session.customer),
          organizationId: session.metadata?.organization_id,
          planName: session.metadata?.plan_name,
        };
      }
      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        return {
          type: 'payment.failed',
          eventId: event.id,
          externalSubscriptionId: extractId(invoice.subscription) ?? '',
          externalCustomerId: extractId(invoice.customer),
        };
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        return {
          type: 'subscription.canceled',
          eventId: event.id,
          externalSubscriptionId: sub.id,
          externalCustomerId: extractId(sub.customer),
        };
      }
      case 'customer.subscription.updated': {
        const sub = event.data.object as Stripe.Subscription;
        return {
          type: 'subscription.updated',
          eventId: event.id,
          externalSubscriptionId: sub.id,
          externalCustomerId: extractId(sub.customer),
        };
      }
      default:
        throw new ValidationError(`Unhandled Stripe event type: ${event.type}`);
    }
  }
}
