/**
 * Provider factory — creates the single payment provider based on PAYMENT_PROVIDER env var.
 */

import type { PaymentProvider, PaymentProviderName } from './types.js';
import { ConfigError } from '../errors.js';
import { KaspiProvider } from './kaspi.js';
import { YooKassaProvider } from './yookassa.js';
import { StripeProvider } from './stripe.js';

export function createProvider(): PaymentProvider {
  const name = process.env.PAYMENT_PROVIDER as PaymentProviderName | undefined;

  switch (name) {
    case 'kaspi':
      return new KaspiProvider();
    case 'yookassa':
      return new YooKassaProvider();
    case 'stripe':
      return new StripeProvider();
    default:
      throw new ConfigError(
        `PAYMENT_PROVIDER must be set to "kaspi", "yookassa", or "stripe". Got: "${name ?? '(not set)'}"`
      );
  }
}
