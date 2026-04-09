/**
 * Kaspi Pay provider.
 * Uses Kaspi QR API for payment processing (Kazakhstan market).
 * No official Node SDK — uses raw fetch.
 */

import { createHmac } from 'node:crypto';
import {
  type CheckoutParams,
  type CheckoutResult,
  type PaymentProvider,
  type WebhookEvent,
} from './types.js';
import { isIpAllowed } from '../utils/ip.js';
import { ConfigError, ProviderError, WebhookError } from '../errors.js';

/**
 * Kaspi QR webhook source IP ranges.
 * See Kaspi QR API integration docs — webhook callback IPs.
 */
const KASPI_WEBHOOK_IPS = new Set(['194.187.247.152/29', '194.187.247.160/29']);

function isAllowedKaspiIp(ip: string): boolean {
  if (process.env.KASPI_SKIP_IP_CHECK === 'true') {
    return true;
  }
  return isIpAllowed(ip, KASPI_WEBHOOK_IPS);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new ConfigError(`Missing env var: ${name}`);
  }
  return value;
}

export class KaspiProvider implements PaymentProvider {
  readonly name = 'kaspi' as const;

  async createCheckoutSession(params: CheckoutParams): Promise<CheckoutResult> {
    const apiKey = requireEnv('KASPI_API_KEY');
    const deviceToken = requireEnv('KASPI_DEVICE_TOKEN');
    const orgBin = requireEnv('KASPI_ORG_BIN');
    const apiUrl = process.env.KASPI_API_URL ?? 'https://qrapi-cert-ip.kaspi.kz';

    const response = await fetch(`${apiUrl}/qr/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        DeviceToken: deviceToken,
        Amount: params.price,
        OrganizationBin: orgBin,
        ExternalId: params.organizationId,
        Description: `BugSpotter ${params.planName} plan`,
        Currency: 'KZT',
        ReturnUrl: params.returnUrl,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new ProviderError(`Kaspi API error (${response.status}): ${text}`, response.status);
    }

    const data = (await response.json()) as { QrPaymentId: string; PayUrl: string };

    return {
      checkoutUrl: data.PayUrl,
      externalSubscriptionId: data.QrPaymentId,
    };
  }

  async cancelSubscription(_externalSubscriptionId: string): Promise<void> {
    // Kaspi does not have recurring subscriptions.
    // Cancellation = stop creating the next payment. No API call needed.
  }

  async verifyAndParseWebhook(
    rawBody: Buffer,
    headers: Record<string, string>
  ): Promise<WebhookEvent> {
    // IP allowlist check
    const sourceIp = headers['x-real-ip'] ?? headers['x-forwarded-for']?.split(',')[0]?.trim();
    if (sourceIp && !isAllowedKaspiIp(sourceIp)) {
      throw new WebhookError(`Webhook rejected: untrusted source IP ${sourceIp}`);
    }

    // Signature verification (HMAC-SHA256 of the raw body using the API key).
    // Required by default — opt out with KASPI_SKIP_SIGNATURE_CHECK=true (dev only).
    const signature = headers['signature'] ?? headers['x-kaspi-signature'];
    if (signature) {
      const apiKey = requireEnv('KASPI_API_KEY');
      const expected = createHmac('sha256', apiKey).update(rawBody).digest('hex');
      if (signature !== expected) {
        throw new WebhookError('Webhook rejected: invalid signature');
      }
    } else if (process.env.KASPI_SKIP_SIGNATURE_CHECK !== 'true') {
      throw new WebhookError('Webhook rejected: missing signature header');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody.toString());
    } catch {
      throw new WebhookError('Webhook rejected: malformed JSON body', 400);
    }

    const payload = parsed as {
      QrPaymentId?: string;
      Status?: string;
      ExternalId?: string;
    };

    if (!payload.QrPaymentId || !payload.Status) {
      throw new WebhookError(
        'Webhook rejected: missing required fields (QrPaymentId, Status)',
        400
      );
    }

    return {
      type: payload.Status === 'Success' ? 'payment.succeeded' : 'payment.failed',
      eventId: `${payload.QrPaymentId}:${payload.Status}`,
      externalSubscriptionId: payload.QrPaymentId,
      organizationId: payload.ExternalId,
    };
  }
}
