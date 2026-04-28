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
   * `canceled`. Idempotent.
   *
   * Returns the just-canceled row, or `null` if there was nothing to
   * cancel (no subscription, or already canceled). The null-on-no-op
   * shape lets callers like the org soft-delete cascade enqueue a
   * provider cancel job *only* when state actually transitioned —
   * matches `BillingService.cancelSubscription`'s idempotency contract
   * and avoids duplicate provider calls / noisy retry loops.
   *
   * Local-state-only by design: doesn't dispatch the external
   * provider cancel, so it's safe to call inside a transaction. The
   * caller is responsible for forwarding to the payments queue.
   */
  async cancelByOrganizationId(organizationId: string): Promise<Subscription | null> {
    const query = `
      UPDATE ${this.schema}.${this.tableName}
      SET status = 'canceled', updated_at = NOW()
      WHERE organization_id = $1 AND status != 'canceled'
      RETURNING *
    `;
    const result = await this.getClient().query(query, [organizationId]);
    return result.rows.length > 0 ? this.deserialize(result.rows[0]) : null;
  }
}
