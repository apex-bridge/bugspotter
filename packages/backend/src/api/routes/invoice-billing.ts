/**
 * Invoice Billing API routes.
 * B2B legal entity billing: invoices, legal details, acts.
 */

import type { FastifyInstance } from 'fastify';
import type { DatabaseClient } from '../../db/client.js';
import type { BillingRegionRegistry } from '@bugspotter/billing';
import { requireUser, requirePlatformAdmin } from '../middleware/auth.js';
import { requireTenantOrgRole } from '../middleware/org-access.js';
import { sendSuccess } from '../utils/response.js';
import { AppError, ValidationError } from '../middleware/error.js';
import { BillingService } from '../../saas/services/billing.service.js';

/** Sanitize a filename for use in Content-Disposition header */
function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}
import {
  listInvoicesSchema,
  getInvoiceSchema,
  getInvoicePdfSchema,
  markInvoicePaidSchema,
  getLegalDetailsSchema,
  saveLegalDetailsSchema,
  getActPdfSchema,
} from '../schemas/invoice-billing-schema.js';

interface ListInvoicesQuery {
  page?: number;
  limit?: number;
}

interface SaveLegalDetailsBody {
  company_name: string;
  details: Record<string, unknown>;
}

export function invoiceBillingRoutes(
  fastify: FastifyInstance,
  db: DatabaseClient,
  billingRegistry?: BillingRegionRegistry
) {
  const billing = new BillingService(db);
  // -------------------------------------------------------------------------
  // Invoices
  // -------------------------------------------------------------------------

  /**
   * GET /api/v1/billing/invoices
   * List invoices for current organization. Owner only.
   */
  fastify.get<{ Querystring: ListInvoicesQuery }>(
    '/api/v1/billing/invoices',
    {
      schema: listInvoicesSchema,
      preHandler: [requireUser, requireTenantOrgRole(db, 'owner')],
    },
    async (request, reply) => {
      const organizationId = request.organizationId!;
      const { page = 1, limit = 20 } = request.query;

      const result = await db.invoices.listByOrganization(organizationId, { page, limit });
      return sendSuccess(reply, result);
    }
  );

  /**
   * GET /api/v1/billing/invoices/:id
   * Get single invoice with line items. Org member access.
   */
  fastify.get<{ Params: { id: string } }>(
    '/api/v1/billing/invoices/:id',
    {
      schema: getInvoiceSchema,
      preHandler: [requireUser, requireTenantOrgRole(db, 'member')],
    },
    async (request, reply) => {
      const invoice = await db.invoices.findById(request.params.id);
      if (!invoice || invoice.organization_id !== request.organizationId) {
        throw new AppError('Invoice not found', 404, 'NotFound');
      }

      const lines = await db.invoiceLines.findByInvoiceId(invoice.id);
      const act = await db.acts.findByInvoiceId(invoice.id);

      return sendSuccess(reply, { invoice, lines, act });
    }
  );

  /**
   * GET /api/v1/billing/invoices/:id/pdf
   * Download invoice PDF. Org member access.
   */
  fastify.get<{ Params: { id: string } }>(
    '/api/v1/billing/invoices/:id/pdf',
    {
      schema: getInvoicePdfSchema,
      preHandler: [requireUser, requireTenantOrgRole(db, 'member')],
    },
    async (request, reply) => {
      const invoice = await db.invoices.findById(request.params.id);
      if (!invoice || invoice.organization_id !== request.organizationId) {
        throw new AppError('Invoice not found', 404, 'NotFound');
      }

      const org = request.organization;
      if (!org) {
        throw new AppError('Organization not found', 404, 'NotFound');
      }

      const plugin = billingRegistry?.getPlugin(org.data_residency_region);
      if (!plugin) {
        throw new AppError('PDF generation not available for this region', 501, 'NotImplemented');
      }

      const pool = db.getPool();
      const result = await plugin.generateInvoicePdf(invoice.id, pool);

      reply.header('Content-Type', 'application/pdf');
      reply.header(
        'Content-Disposition',
        `attachment; filename="${sanitizeFilename(result.filename)}"`
      );
      return reply.send(result.pdfBuffer);
    }
  );

  /**
   * POST /api/v1/billing/invoices/:id/mark-paid
   * Admin marks invoice as paid. Platform admin only.
   */
  fastify.post<{ Params: { id: string } }>(
    '/api/v1/billing/invoices/:id/mark-paid',
    {
      schema: markInvoicePaidSchema,
      preHandler: [requirePlatformAdmin()],
    },
    async (request, reply) => {
      const invoice = await db.invoices.findById(request.params.id);
      if (!invoice) {
        throw new AppError('Invoice not found', 404, 'NotFound');
      }

      if (invoice.status === 'paid') {
        return sendSuccess(reply, { message: 'Invoice already paid' });
      }

      if (invoice.status === 'canceled') {
        throw new AppError('Cannot pay a canceled invoice', 400, 'BadRequest');
      }

      // Validate invoice has a plan line item before making any changes.
      const lines = await db.invoiceLines.findByInvoiceId(invoice.id);
      const planLine = lines.find((l) => l.plan_name);
      if (!planLine?.plan_name) {
        throw new AppError(
          'Invoice has no plan line item — cannot activate subscription',
          500,
          'InternalServerError'
        );
      }

      // Activate subscription first (throws on failure).
      // If this succeeds but the invoice update below fails, the subscription
      // is still active (acceptable — admin can retry marking paid).
      await billing.activateFromInvoicePayment(
        invoice.organization_id,
        planLine.plan_name,
        planLine.period_start ?? undefined,
        planLine.period_end ?? undefined
      );

      await db.invoices.update(invoice.id, {
        status: 'paid',
        paid_at: new Date(),
      });

      return sendSuccess(reply, { message: 'Invoice marked as paid' });
    }
  );

  /**
   * GET /api/v1/admin/billing/invoices/:organizationId
   * List invoices for a specific organization. Platform admin only.
   */
  fastify.get<{ Params: { organizationId: string }; Querystring: ListInvoicesQuery }>(
    '/api/v1/admin/billing/invoices/:organizationId',
    {
      schema: {
        params: {
          type: 'object',
          properties: { organizationId: { type: 'string', format: 'uuid' } },
          required: ['organizationId'],
        },
        querystring: {
          type: 'object',
          properties: {
            page: { type: 'integer', minimum: 1, default: 1 },
            limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
          },
        },
      },
      preHandler: [requirePlatformAdmin()],
    },
    async (request, reply) => {
      const { organizationId } = request.params;
      const { page = 1, limit = 20 } = request.query;

      const result = await db.invoices.listByOrganization(organizationId, { page, limit });
      return sendSuccess(reply, result);
    }
  );

  // -------------------------------------------------------------------------
  // Legal Details
  // -------------------------------------------------------------------------

  /**
   * GET /api/v1/billing/legal-details
   * Get legal entity for current organization. Any org member can view.
   */
  fastify.get(
    '/api/v1/billing/legal-details',
    {
      schema: getLegalDetailsSchema,
      preHandler: [requireUser, requireTenantOrgRole(db, 'member')],
    },
    async (request, reply) => {
      const organizationId = request.organizationId!;
      const entity = await db.legalEntities.findByOrganizationId(organizationId);
      return sendSuccess(reply, { legal_entity: entity });
    }
  );

  /**
   * POST /api/v1/billing/legal-details
   * Create or update legal entity. Owner only.
   * Details JSONB is validated by the regional billing plugin when available.
   */
  fastify.post<{ Body: SaveLegalDetailsBody }>(
    '/api/v1/billing/legal-details',
    {
      schema: saveLegalDetailsSchema,
      preHandler: [requireUser, requireTenantOrgRole(db, 'owner')],
    },
    async (request, reply) => {
      const organizationId = request.organizationId!;
      const { company_name, details } = request.body;

      // Validate details via regional billing plugin
      if (billingRegistry) {
        const org = request.organization;
        if (!org) {
          throw new AppError('Organization not found', 404, 'NotFound');
        }
        const plugin = billingRegistry.getPlugin(org.data_residency_region);
        if (plugin) {
          const validationErrors = plugin.validateLegalEntity(company_name, details);
          if (validationErrors.length > 0) {
            throw new ValidationError('Invalid legal details', validationErrors);
          }
        }
      }

      const entity = await db.legalEntities.upsert({
        organization_id: organizationId,
        company_name,
        details,
      });

      return sendSuccess(reply, { legal_entity: entity });
    }
  );

  // -------------------------------------------------------------------------
  // Acts
  // -------------------------------------------------------------------------

  /**
   * GET /api/v1/billing/acts/:id/pdf
   * Download act PDF. Org member access.
   */
  fastify.get<{ Params: { id: string } }>(
    '/api/v1/billing/acts/:id/pdf',
    {
      schema: getActPdfSchema,
      preHandler: [requireUser, requireTenantOrgRole(db, 'member')],
    },
    async (request, reply) => {
      const act = await db.acts.findByIdForOrganization(request.params.id, request.organizationId!);
      if (!act) {
        throw new AppError('Act not found', 404, 'NotFound');
      }

      const org = request.organization;
      if (!org) {
        throw new AppError('Organization not found', 404, 'NotFound');
      }

      const plugin = billingRegistry?.getPlugin(org.data_residency_region);
      if (!plugin) {
        throw new AppError('PDF generation not available for this region', 501, 'NotImplemented');
      }

      const pool = db.getPool();
      const result = await plugin.generateActPdf(act.id, pool);

      reply.header('Content-Type', 'application/pdf');
      reply.header(
        'Content-Disposition',
        `attachment; filename="${sanitizeFilename(result.filename)}"`
      );
      return reply.send(result.pdfBuffer);
    }
  );
}
