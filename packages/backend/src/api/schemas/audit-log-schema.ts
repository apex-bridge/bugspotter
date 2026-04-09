/**
 * Audit Log schemas for request/response validation
 */

import { paginationSchema, paginationResponseSchema, sortOrderSchema } from './common-schema.js';

export const auditLogSortByEnum = ['timestamp', 'action', 'resource'] as const;
export const auditLogActionEnum = ['POST', 'PUT', 'PATCH', 'DELETE'] as const;

/** Common querystring for org-scoped audit endpoints */
const orgScopeQuerystring = {
  type: 'object',
  properties: {
    organization_id: { type: 'string', format: 'uuid' },
  },
} as const;

export const auditLogSchema = {
  type: 'object',
  required: ['id', 'action', 'resource', 'timestamp', 'success'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    user_id: { type: 'string', format: 'uuid', nullable: true },
    organization_id: { type: 'string', format: 'uuid', nullable: true },
    action: { type: 'string', enum: auditLogActionEnum },
    resource: { type: 'string' },
    resource_id: { type: 'string', nullable: true },
    ip_address: { type: 'string', nullable: true },
    user_agent: { type: 'string', nullable: true },
    success: { type: 'boolean' },
    error_message: { type: 'string', nullable: true },
    details: { type: 'object', nullable: true },
    timestamp: { type: 'string', format: 'date-time' },
  },
} as const;

export const listAuditLogsSchema = {
  querystring: {
    type: 'object',
    properties: {
      ...paginationSchema.properties,
      organization_id: { type: 'string', format: 'uuid' },
      user_id: { type: 'string', format: 'uuid' },
      action: { type: 'string', enum: auditLogActionEnum },
      resource: { type: 'string', maxLength: 500 },
      success: { type: 'string', enum: ['true', 'false'] },
      start_date: { type: 'string', format: 'date-time' },
      end_date: { type: 'string', format: 'date-time' },
      sort_by: {
        type: 'string',
        enum: auditLogSortByEnum,
        default: 'timestamp',
      },
      sort_order: sortOrderSchema,
    },
  },
  response: {
    200: {
      type: 'object',
      required: ['success', 'data', 'pagination'],
      properties: {
        success: { type: 'boolean', enum: [true] },
        data: {
          type: 'array',
          items: auditLogSchema,
        },
        pagination: paginationResponseSchema,
      },
    },
    400: {
      type: 'object',
      required: ['success', 'error'],
      properties: {
        success: { type: 'boolean', enum: [false] },
        error: { type: 'string' },
      },
    },
    500: {
      type: 'object',
      required: ['success', 'error'],
      properties: {
        success: { type: 'boolean', enum: [false] },
        error: { type: 'string' },
      },
    },
  },
} as const;

export const getAuditLogByIdSchema = {
  querystring: orgScopeQuerystring,
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
      required: ['success', 'data'],
      properties: {
        success: { type: 'boolean', enum: [true] },
        data: auditLogSchema,
      },
    },
    404: {
      type: 'object',
      required: ['success', 'error'],
      properties: {
        success: { type: 'boolean', enum: [false] },
        error: { type: 'string' },
      },
    },
    500: {
      type: 'object',
      required: ['success', 'error'],
      properties: {
        success: { type: 'boolean', enum: [false] },
        error: { type: 'string' },
      },
    },
  },
} as const;

export const getAuditLogStatisticsSchema = {
  querystring: orgScopeQuerystring,
  response: {
    200: {
      type: 'object',
      required: ['success', 'data'],
      properties: {
        success: { type: 'boolean', enum: [true] },
        data: {
          type: 'object',
          required: ['total', 'success', 'failures'],
          properties: {
            total: { type: 'number' },
            success: { type: 'number' },
            failures: { type: 'number' },
            by_action: {
              type: 'array',
              items: {
                type: 'object',
                required: ['action', 'count'],
                properties: {
                  action: { type: 'string' },
                  count: { type: 'number' },
                },
              },
            },
            by_user: {
              type: 'array',
              items: {
                type: 'object',
                required: ['user_id', 'count'],
                properties: {
                  user_id: { type: 'string', format: 'uuid' },
                  count: { type: 'number' },
                },
              },
            },
          },
        },
      },
    },
    500: {
      type: 'object',
      required: ['success', 'error'],
      properties: {
        success: { type: 'boolean', enum: [false] },
        error: { type: 'string' },
      },
    },
  },
} as const;

export const getRecentAuditLogsSchema = {
  querystring: {
    type: 'object',
    properties: {
      organization_id: { type: 'string', format: 'uuid' },
      limit: { type: 'number', minimum: 1, maximum: 500, default: 100 },
    },
  },
  response: {
    200: {
      type: 'object',
      required: ['success', 'data', 'count'],
      properties: {
        success: { type: 'boolean', enum: [true] },
        data: {
          type: 'array',
          items: auditLogSchema,
        },
        count: { type: 'number' },
      },
    },
    500: {
      type: 'object',
      required: ['success', 'error'],
      properties: {
        success: { type: 'boolean', enum: [false] },
        error: { type: 'string' },
      },
    },
  },
} as const;

export const getAuditLogsByUserSchema = {
  params: {
    type: 'object',
    required: ['userId'],
    properties: {
      userId: { type: 'string', format: 'uuid' },
    },
  },
  querystring: {
    type: 'object',
    properties: {
      organization_id: { type: 'string', format: 'uuid' },
      limit: { type: 'number', minimum: 1, maximum: 500, default: 100 },
    },
  },
  response: {
    200: {
      type: 'object',
      required: ['success', 'data', 'count'],
      properties: {
        success: { type: 'boolean', enum: [true] },
        data: {
          type: 'array',
          items: auditLogSchema,
        },
        count: { type: 'number' },
      },
    },
    500: {
      type: 'object',
      required: ['success', 'error'],
      properties: {
        success: { type: 'boolean', enum: [false] },
        error: { type: 'string' },
      },
    },
  },
} as const;
