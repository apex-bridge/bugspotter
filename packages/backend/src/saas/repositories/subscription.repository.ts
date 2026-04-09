/**
 * Subscription Repository
 * CRUD operations for saas.subscriptions table
 */

import type { Pool, PoolClient } from 'pg';
import { BaseRepository } from '../../db/repositories/base-repository.js';
import {
  PAYMENT_PROVIDER,
  type Subscription,
  type SubscriptionInsert,
  type SubscriptionUpdate,
} from '../../db/types.js';

const VALID_PROVIDERS = new Set<string>(Object.values(PAYMENT_PROVIDER));

function assertValidProvider(provider: string): void {
  if (!VALID_PROVIDERS.has(provider)) {
    throw new Error(`Unknown payment provider: ${provider}`);
  }
}

export class SubscriptionRepository extends BaseRepository<
  Subscription,
  SubscriptionInsert,
  SubscriptionUpdate
> {
  constructor(pool: Pool | PoolClient) {
    super(pool, 'saas', 'subscriptions', ['quotas']);
  }

  /**
   * Find subscription by organization ID (1:1 relationship)
   */
  async findByOrganizationId(organizationId: string): Promise<Subscription | null> {
    return this.findBy('organization_id', organizationId);
  }

  /**
   * Find subscription by external subscription ID for a specific payment provider.
   */
  async findByExternalSubscriptionId(
    provider: string,
    externalId: string
  ): Promise<Subscription | null> {
    assertValidProvider(provider);
    return this.findByMultiple({
      payment_provider: provider,
      external_subscription_id: externalId,
    });
  }

  /**
   * Find subscription by external customer ID for a specific payment provider.
   */
  async findByExternalCustomerId(
    provider: string,
    externalId: string
  ): Promise<Subscription | null> {
    assertValidProvider(provider);
    return this.findByMultiple({
      payment_provider: provider,
      external_customer_id: externalId,
    });
  }
}
