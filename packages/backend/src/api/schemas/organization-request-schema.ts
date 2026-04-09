/**
 * Organization Request schemas for request/response validation
 */

import { paginationSchema, paginationResponseSchema, sortOrderSchema } from './common-schema.js';

export const orgRequestStatusEnum = [
  'pending_verification',
  'verified',
  'approved',
  'rejected',
  'expired',
] as const;

export const dataResidencyEnum = ['kz', 'rf', 'eu', 'us', 'global'] as const;

const orgRequestResponseProperties = {
  id: { type: 'string', format: 'uuid' },
  company_name: { type: 'string' },
  subdomain: { type: 'string' },
  contact_name: { type: 'string' },
  contact_email: { type: 'string' },
  phone: { type: 'string', nullable: true },
  message: { type: 'string', nullable: true },
  data_residency_region: { type: 'string', enum: dataResidencyEnum },
  status: { type: 'string', enum: orgRequestStatusEnum },
  email_verified_at: { type: 'string', format: 'date-time', nullable: true },
  reviewed_by: { type: 'string', format: 'uuid', nullable: true },
  reviewed_at: { type: 'string', format: 'date-time', nullable: true },
  admin_notes: { type: 'string', nullable: true },
  rejection_reason: { type: 'string', nullable: true },
  organization_id: { type: 'string', format: 'uuid', nullable: true },
  created_at: { type: 'string', format: 'date-time' },
  updated_at: { type: 'string', format: 'date-time' },
} as const;

// ============================================================================
// PUBLIC ROUTES
// ============================================================================

/**
 * POST /api/v1/organization-requests — Submit a new request
 */
export const submitOrgRequestSchema = {
  body: {
    type: 'object',
    required: ['company_name', 'subdomain', 'contact_name', 'contact_email'],
    properties: {
      company_name: { type: 'string', minLength: 2, maxLength: 255 },
      subdomain: {
        type: 'string',
        minLength: 3,
        maxLength: 63,
        pattern: '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$',
      },
      contact_name: { type: 'string', minLength: 2, maxLength: 255 },
      contact_email: { type: 'string', format: 'email', maxLength: 255 },
      phone: { type: 'string', maxLength: 50 },
      message: { type: 'string', maxLength: 2000 },
      data_residency_region: {
        type: 'string',
        enum: dataResidencyEnum,
        default: 'kz',
      },
      // Honeypot field — should always be empty. Bots fill it in.
      website: { type: 'string', maxLength: 255 },
    },
    additionalProperties: false,
  },
  response: {
    201: {
      type: 'object',
      required: ['success', 'message', 'timestamp'],
      properties: {
        success: { type: 'boolean', enum: [true] },
        message: { type: 'string' },
        timestamp: { type: 'string', format: 'date-time' },
      },
    },
  },
} as const;

/**
 * POST /api/v1/organization-requests/verify-email — Verify email
 */
export const verifyEmailSchema = {
  body: {
    type: 'object',
    required: ['token'],
    properties: {
      token: { type: 'string', minLength: 64, maxLength: 64, pattern: '^[0-9a-f]{64}$' },
    },
    additionalProperties: false,
  },
  response: {
    200: {
      type: 'object',
      required: ['success', 'message', 'timestamp'],
      properties: {
        success: { type: 'boolean', enum: [true] },
        message: { type: 'string' },
        timestamp: { type: 'string', format: 'date-time' },
      },
    },
  },
} as const;

// ============================================================================
// ADMIN ROUTES
// ============================================================================

/**
 * GET /api/v1/admin/organization-requests — List requests
 */
export const listOrgRequestsSchema = {
  querystring: {
    type: 'object',
    properties: {
      ...paginationSchema.properties,
      status: { type: 'string', enum: orgRequestStatusEnum },
      search: { type: 'string', maxLength: 255 },
      sort_by: {
        type: 'string',
        enum: ['created_at', 'updated_at', 'company_name', 'status'],
        default: 'created_at',
      },
      order: sortOrderSchema,
    },
    additionalProperties: false,
  },
  response: {
    200: {
      type: 'object',
      required: ['success', 'data', 'pagination', 'timestamp'],
      properties: {
        success: { type: 'boolean', enum: [true] },
        data: {
          type: 'array',
          items: {
            type: 'object',
            properties: orgRequestResponseProperties,
          },
        },
        pagination: paginationResponseSchema,
        timestamp: { type: 'string', format: 'date-time' },
      },
    },
  },
} as const;

/**
 * GET /api/v1/admin/organization-requests/:id — Get single request
 */
export const getOrgRequestSchema = {
  params: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'string', format: 'uuid' },
    },
  },
  response: {
    200: {
      type: 'object',
      required: ['success', 'data', 'timestamp'],
      properties: {
        success: { type: 'boolean', enum: [true] },
        data: {
          type: 'object',
          properties: orgRequestResponseProperties,
        },
        timestamp: { type: 'string', format: 'date-time' },
      },
    },
  },
} as const;

/**
 * PATCH /api/v1/admin/organization-requests/:id/approve — Approve request
 */
export const approveOrgRequestSchema = {
  params: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'string', format: 'uuid' },
    },
  },
  body: {
    type: 'object',
    properties: {
      plan: {
        type: 'string',
        enum: ['trial', 'starter', 'professional', 'enterprise'],
      },
      admin_notes: { type: 'string', maxLength: 2000 },
    },
    additionalProperties: false,
  },
  response: {
    200: {
      type: 'object',
      required: ['success', 'data', 'timestamp'],
      properties: {
        success: { type: 'boolean', enum: [true] },
        data: {
          type: 'object',
          properties: orgRequestResponseProperties,
        },
        timestamp: { type: 'string', format: 'date-time' },
      },
    },
  },
} as const;

/**
 * PATCH /api/v1/admin/organization-requests/:id/reject — Reject request
 */
export const rejectOrgRequestSchema = {
  params: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'string', format: 'uuid' },
    },
  },
  body: {
    type: 'object',
    required: ['rejection_reason'],
    properties: {
      rejection_reason: { type: 'string', minLength: 1, maxLength: 2000 },
      admin_notes: { type: 'string', maxLength: 2000 },
    },
    additionalProperties: false,
  },
  response: {
    200: {
      type: 'object',
      required: ['success', 'data', 'timestamp'],
      properties: {
        success: { type: 'boolean', enum: [true] },
        data: {
          type: 'object',
          properties: orgRequestResponseProperties,
        },
        timestamp: { type: 'string', format: 'date-time' },
      },
    },
  },
} as const;

/**
 * DELETE /api/v1/admin/organization-requests/:id — Delete spam/junk
 */
export const deleteOrgRequestSchema = {
  params: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'string', format: 'uuid' },
    },
  },
  response: {
    204: { type: 'null', description: 'Request deleted' },
  },
} as const;
