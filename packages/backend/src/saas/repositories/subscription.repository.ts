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

  /**
   * Cancel an organization's subscription locally — sets status to
   * `canceled`. Idempotent: returns the row unchanged if it's already
   * canceled. Returns null if no subscription exists.
   *
   * Used by the org soft-delete cascade to stop the invoice scheduler
   * (which only generates invoices for subscriptions in active /
   * past_due / incomplete states). The caller is responsible for
   * dispatching any external-provider cancellation (e.g. via the
   * `payments` queue) — this method only mutates local state, so it's
   * safe to call inside a transaction.
   */
  async cancelByOrganizationId(organizationId: string): Promise<Subscription | null> {
    const query = `
      UPDATE ${this.schema}.${this.tableName}
      SET status = 'canceled', updated_at = NOW()
      WHERE organization_id = $1 AND status != 'canceled'
      RETURNING *
    `;
    const result = await this.getClient().query(query, [organizationId]);
    if (result.rows.length > 0) {
      return this.deserialize(result.rows[0]);
    }
    // Either no subscription, or already canceled. Surface the existing
    // row (if any) so the caller can still inspect external IDs etc.
    return this.findByOrganizationId(organizationId);
  }
}
