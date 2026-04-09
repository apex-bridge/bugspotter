/**
 * Billing API routes.
 * Checkout and cancel endpoints. Owner only.
 */

import type { FastifyInstance } from 'fastify';
import type { DatabaseClient } from '../../db/client.js';
import type { PlanName } from '../../db/types.js';
import { BillingService } from '../../saas/services/billing.service.js';
import { getPlansConfig } from '../../saas/plans.js';
import { requireUser } from '../middleware/auth.js';
import { requireTenantOrgRole } from '../middleware/org-access.js';
import { sendSuccess } from '../utils/response.js';
import {
  createCheckoutSchema,
  cancelSubscriptionSchema,
  getPlansSchema,
} from '../schemas/billing-schema.js';

interface CheckoutBody {
  plan_name: PlanName;
  return_url: string;
}

export function billingRoutes(fastify: FastifyInstance, db: DatabaseClient) {
  const billing = new BillingService(db);

  /**
   * GET /api/v1/billing/plans
   * Public endpoint — returns available plans with prices and quotas.
   */
  fastify.get(
    '/api/v1/billing/plans',
    { schema: getPlansSchema, config: { public: true } },
    async (_request, reply) => {
      return sendSuccess(reply, { plans: getPlansConfig() });
    }
  );

  /**
   * POST /api/v1/billing/checkout
   * Create a checkout session for upgrading. Owner only.
   */
  fastify.post<{ Body: CheckoutBody }>(
    '/api/v1/billing/checkout',
    {
      schema: createCheckoutSchema,
      preHandler: [requireUser, requireTenantOrgRole(db, 'owner')],
    },
    async (request, reply) => {
      const organizationId = request.organizationId!;
      const { plan_name, return_url } = request.body;

      const result = await billing.createCheckout(organizationId, plan_name, return_url);
      return sendSuccess(reply, { redirect_url: result.redirectUrl });
    }
  );

  /**
   * POST /api/v1/billing/cancel
   * Cancel the current subscription. Owner only.
   */
  fastify.post(
    '/api/v1/billing/cancel',
    {
      schema: cancelSubscriptionSchema,
      preHandler: [requireUser, requireTenantOrgRole(db, 'owner')],
    },
    async (request, reply) => {
      const organizationId = request.organizationId!;
      await billing.cancelSubscription(organizationId);
      return sendSuccess(reply, { message: 'Subscription canceled' });
    }
  );
}
