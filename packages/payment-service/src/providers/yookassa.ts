/**
 * YooKassa provider.
 * Uses YooKassa REST API for payment processing (Russia market).
 * No SDK — uses raw fetch with Basic auth.
 */

import {
  type CheckoutParams,
  type CheckoutResult,
  type PaymentProvider,
  type WebhookEvent,
} from './types.js';
import { isIpAllowed } from '../utils/ip.js';
import { ConfigError, ProviderError, WebhookError } from '../errors.js';

const API_URL = 'https://api.yookassa.ru/v3';

/**
 * YooKassa webhook source IP ranges.
 * See: https://yookassa.ru/developers/using-api/webhooks#ip
 */
const YOOKASSA_WEBHOOK_IPS = new Set([
  '185.71.76.0/27',
  '185.71.77.0/27',
  '77.75.153.0/25',
  '77.75.156.11',
  '77.75.156.35',
  '77.75.154.128/25',
  '2a02:5180::/32',
]);

function isAllowedYooKassaIp(ip: string): boolean {
  if (process.env.YOOKASSA_SKIP_IP_CHECK === 'true') {
    return true;
  }
  // IPv6 webhook range check is simplified — allow the documented /32
  if (ip.startsWith('2a02:5180:')) {
    return true;
  }
  return isIpAllowed(ip, YOOKASSA_WEBHOOK_IPS);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new ConfigError(`Missing env var: ${name}`);
  }
  return value;
}

function getAuth(): string {
  const shopId = requireEnv('YOOKASSA_SHOP_ID');
  const secretKey = requireEnv('YOOKASSA_SECRET_KEY');
  return Buffer.from(`${shopId}:${secretKey}`).toString('base64');
}

export class YooKassaProvider implements PaymentProvider {
  readonly name = 'yookassa' as const;

  async createCheckoutSession(params: CheckoutParams): Promise<CheckoutResult> {
    const idempotencyKey = `${params.organizationId}-${params.planName}-${Date.now()}`;

    const response = await fetch(`${API_URL}/payments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${getAuth()}`,
        'Idempotence-Key': idempotencyKey,
      },
      body: JSON.stringify({
        amount: { value: params.price.toFixed(2), currency: params.currency },
        capture: true,
        confirmation: {
          type: 'redirect',
          return_url: params.returnUrl,
        },
        save_payment_method: true,
        description: `BugSpotter ${params.planName} plan`,
        metadata: {
          organization_id: params.organizationId,
          plan_name: params.planName,
        },
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new ProviderError(`YooKassa API error (${response.status}): ${text}`, response.status);
    }

    const data = (await response.json()) as {
      id: string;
      confirmation: { confirmation_url: string };
      payment_method?: { id: string };
    };

    return {
      checkoutUrl: data.confirmation.confirmation_url,
      externalSubscriptionId: data.id,
      externalCustomerId: data.payment_method?.id,
    };
  }

  async cancelSubscription(_externalSubscriptionId: string): Promise<void> {
    // YooKassa autopayments are canceled by not initiating the next charge.
  }

  async verifyAndParseWebhook(
    rawBody: Buffer,
    headers: Record<string, string>
  ): Promise<WebhookEvent> {
    const sourceIp = headers['x-real-ip'] ?? headers['x-forwarded-for']?.split(',')[0]?.trim();
    if (sourceIp && !isAllowedYooKassaIp(sourceIp)) {
      throw new WebhookError(`Webhook rejected: untrusted source IP ${sourceIp}`);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody.toString());
    } catch {
      throw new WebhookError('Webhook rejected: malformed JSON body', 400);
    }

    const payload = parsed as {
      event?: string;
      object?: {
        id?: string;
        status?: string;
        payment_method?: { id: string };
        metadata?: { organization_id?: string; plan_name?: string };
      };
    };

    const event = payload.event;
    const obj = payload.object;
    const objId = obj?.id;

    if (!event || !obj || !objId) {
      throw new WebhookError('Webhook rejected: missing required fields (event, object.id)', 400);
    }
    let type: WebhookEvent['type'];

    switch (event) {
      case 'payment.succeeded':
        type = 'payment.succeeded';
        break;
      case 'payment.canceled':
        type = 'payment.failed';
        break;
      case 'refund.succeeded':
        type = 'subscription.canceled';
        break;
      default:
        type = 'subscription.updated';
    }

    return {
      type,
      eventId: `${event}:${objId}`,
      externalSubscriptionId: objId,
      externalCustomerId: obj.payment_method?.id,
      organizationId: obj.metadata?.organization_id,
      planName: obj.metadata?.plan_name,
    };
  }
}
