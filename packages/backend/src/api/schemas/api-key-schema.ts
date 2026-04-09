/**
 * API Key management schemas for request/response validation
 * Provides type-safe validation for all API key endpoints
 */

import {
  paginationSchema,
  paginationResponseSchema,
  sortOrderSchema,
  idParamSchema,
} from './common-schema.js';
import { PERMISSION_SCOPE } from '../../db/types.js';

/**
 * API Key base schema (response format)
 */
export const apiKeySchema = {
  type: 'object',
  required: [
    'id',
    'key_prefix',
    'key_suffix',
    'name',
    'type',
    'status',
    'permission_scope',
    'permissions',
    'rate_limit_per_minute',
    'rate_limit_per_hour',
    'rate_limit_per_day',
    'burst_limit',
    'grace_period_days',
    'created_at',
    'updated_at',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    key_prefix: { type: 'string', minLength: 4, maxLength: 8 },
    key_suffix: { type: 'string', minLength: 4, maxLength: 8 },
    name: { type: 'string', minLength: 1, maxLength: 255 },
    description: { type: ['string', 'null'] },
    type: { type: 'string', enum: ['production', 'development', 'test'] },
    status: { type: 'string', enum: ['active', 'expiring', 'expired', 'revoked'] },

    // Permissions
    permission_scope: { type: 'string', enum: Object.values(PERMISSION_SCOPE) },
    permissions: { type: 'array', items: { type: 'string' } },
    allowed_projects: {
      type: ['array', 'null'],
      items: { type: 'string', format: 'uuid' },
    },
    allowed_environments: {
      type: ['array', 'null'],
      items: { type: 'string' },
    },

    // Rate Limiting
    rate_limit_per_minute: { type: 'integer', minimum: 0 },
    rate_limit_per_hour: { type: 'integer', minimum: 0 },
    rate_limit_per_day: { type: 'integer', minimum: 0 },
    burst_limit: { type: 'integer', minimum: 0 },
    per_endpoint_limits: {
      type: ['object', 'null'],
      additionalProperties: { type: 'integer' },
    },

    // Security
    ip_whitelist: {
      type: ['array', 'null'],
      items: { type: 'string', pattern: '^(?:[0-9]{1,3}\\.){3}[0-9]{1,3}(?:/[0-9]{1,2})?$' },
    },
    allowed_origins: {
      type: ['array', 'null'],
      items: { type: 'string' },
    },
    user_agent_pattern: { type: ['string', 'null'] },

    // Lifecycle
    expires_at: { type: ['string', 'null'], format: 'date-time' },
    rotate_at: { type: ['string', 'null'], format: 'date-time' },
    grace_period_days: { type: 'number', minimum: 0, maximum: 90 },
    rotated_from: { type: ['string', 'null'], format: 'uuid' },

    // Audit
    created_by: { type: ['string', 'null'], format: 'uuid' },
    team_id: { type: ['string', 'null'], format: 'uuid' },
    tags: {
      type: ['array', 'null'],
      items: { type: 'string', minLength: 1, maxLength: 50 },
    },

    // Timestamps
    created_at: { type: 'string', format: 'date-time' },
    updated_at: { type: 'string', format: 'date-time' },
    last_used_at: { type: ['string', 'null'], format: 'date-time' },
    revoked_at: { type: ['string', 'null'], format: 'date-time' },
  },
} as const;

/**
 * API Key with usage statistics schema
 */
export const apiKeyWithUsageSchema = {
  type: 'object',
  required: [...apiKeySchema.required, 'usage_stats'],
  properties: {
    ...apiKeySchema.properties,
    usage_stats: {
      type: 'object',
      required: [
        'total_requests',
        'requests_today',
        'requests_this_month',
        'unique_ips',
        'client_error_rate',
        'server_error_rate',
      ],
      properties: {
        total_requests: { type: 'number' },
        requests_today: { type: 'number' },
        requests_this_month: { type: 'number' },
        last_request_at: { type: ['string', 'null'], format: 'date-time' },
        unique_ips: { type: 'number' },
        client_error_rate: { type: 'number', minimum: 0, maximum: 1 },
        server_error_rate: { type: 'number', minimum: 0, maximum: 1 },
      },
    },
  },
} as const;

/**
 * POST /api/v1/api-keys - Create API key
 */
export const createApiKeySchema = {
  body: {
    type: 'object',
    required: ['name', 'type'],
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 255 },
      description: { type: 'string', maxLength: 1000 },
      type: { type: 'string', enum: ['production', 'development', 'test'] },

      // Permissions (optional, defaults applied in service)
      permission_scope: { type: 'string', enum: Object.values(PERMISSION_SCOPE) },
      permissions: {
        type: 'array',
        items: { type: 'string', minLength: 1, maxLength: 100 },
        maxItems: 50,
      },
      allowed_projects: {
        type: 'array',
        items: { type: 'string', format: 'uuid' },
        maxItems: 100,
      },
      allowed_environments: {
        type: 'array',
        items: { type: 'string', enum: ['production', 'staging', 'development', 'test'] },
        maxItems: 4,
      },

      // Rate Limiting (optional, defaults applied in service)
      rate_limit_per_minute: { type: 'integer', minimum: 0, maximum: 10000 },
      rate_limit_per_hour: { type: 'integer', minimum: 0, maximum: 100000 },
      rate_limit_per_day: { type: 'integer', minimum: 0, maximum: 1000000 },
      burst_limit: { type: 'integer', minimum: 0, maximum: 100 },
      per_endpoint_limits: {
        type: 'object',
        additionalProperties: { type: 'integer', minimum: 0 },
        maxProperties: 50,
      },

      // Security (optional)
      ip_whitelist: {
        type: 'array',
        items: { type: 'string', pattern: '^(?:[0-9]{1,3}\\.){3}[0-9]{1,3}(?:/[0-9]{1,2})?$' },
        maxItems: 100,
      },
      allowed_origins: {
        type: 'array',
        items: { type: 'string', maxLength: 255 },
        maxItems: 50,
      },
      user_agent_pattern: { type: 'string', maxLength: 500 },

      // Lifecycle (optional)
      expires_at: { type: 'string', format: 'date-time' },
      rotate_at: { type: 'string', format: 'date-time' },
      grace_period_days: { type: 'number', minimum: 0, maximum: 90 },

      // Audit (optional)
      team_id: { type: 'string', format: 'uuid' },
      tags: {
        type: 'array',
        items: { type: 'string', minLength: 1, maxLength: 50 },
        maxItems: 20,
      },
    },
    additionalProperties: false,
  },
  response: {
    201: {
      type: 'object',
      required: ['success', 'data', 'timestamp'],
      properties: {
        success: { type: 'boolean', enum: [true] },
        data: {
          type: 'object',
          required: ['api_key', 'key_details'],
          properties: {
            api_key: {
              type: 'string',
              pattern: '^bgs_[a-zA-Z0-9_-]{43}$',
              description: 'Full API key (only returned once at creation)',
            },
            key_details: apiKeySchema,
          },
        },
        timestamp: { type: 'string', format: 'date-time' },
      },
    },
  },
} as const;

/**
 * GET /api/v1/api-keys - List API keys
 */
export const listApiKeysSchema = {
  querystring: {
    type: 'object',
    properties: {
      ...paginationSchema.properties,
      status: { type: 'string', enum: ['active', 'expiring', 'expired', 'revoked'] },
      type: { type: 'string', enum: ['production', 'development', 'test'] },
      team_id: { type: 'string', format: 'uuid' },
      created_by: { type: 'string', format: 'uuid' },
      tag: { type: 'string', minLength: 1, maxLength: 50 },
      expires_before: { type: 'string', format: 'date-time' },
      expires_after: { type: 'string', format: 'date-time' },
      search: { type: 'string', minLength: 1, maxLength: 255 },
      sort_by: {
        type: 'string',
        enum: ['created_at', 'updated_at', 'last_used_at', 'name', 'expires_at'],
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
          items: apiKeySchema,
        },
        pagination: paginationResponseSchema,
        timestamp: { type: 'string', format: 'date-time' },
      },
    },
  },
} as const;

/**
 * GET /api/v1/api-keys/:id - Get API key
 */
export const getApiKeySchema = {
  params: idParamSchema,
  response: {
    200: {
      type: 'object',
      required: ['success', 'data', 'timestamp'],
      properties: {
        success: { type: 'boolean', enum: [true] },
        data: apiKeySchema,
        timestamp: { type: 'string', format: 'date-time' },
      },
    },
  },
} as const;

/**
 * PATCH /api/v1/api-keys/:id - Update API key
 */
export const updateApiKeySchema = {
  params: idParamSchema,
  body: {
    type: 'object',
    minProperties: 1,
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 255 },
      description: { type: ['string', 'null'], maxLength: 1000 },
      status: { type: 'string', enum: ['active', 'revoked'] },

      // Permissions
      permission_scope: { type: 'string', enum: Object.values(PERMISSION_SCOPE) },
      permissions: {
        type: 'array',
        items: { type: 'string', minLength: 1, maxLength: 100 },
        maxItems: 50,
      },
      allowed_projects: {
        type: ['array', 'null'],
        items: { type: 'string', format: 'uuid' },
        maxItems: 100,
      },
      allowed_environments: {
        type: ['array', 'null'],
        items: { type: 'string', enum: ['production', 'staging', 'development', 'test'] },
        maxItems: 4,
      },

      // Rate Limiting
      rate_limit_per_minute: { type: 'integer', minimum: 0, maximum: 10000 },
      rate_limit_per_hour: { type: 'integer', minimum: 0, maximum: 100000 },
      rate_limit_per_day: { type: 'integer', minimum: 0, maximum: 1000000 },
      burst_limit: { type: 'integer', minimum: 0, maximum: 100 },
      per_endpoint_limits: {
        type: ['object', 'null'],
        additionalProperties: { type: 'integer', minimum: 0 },
        maxProperties: 50,
      },

      // Security
      ip_whitelist: {
        type: ['array', 'null'],
        items: { type: 'string', pattern: '^(?:[0-9]{1,3}\\.){3}[0-9]{1,3}(?:/[0-9]{1,2})?$' },
        maxItems: 100,
      },
      allowed_origins: {
        type: ['array', 'null'],
        items: { type: 'string', maxLength: 255 },
        maxItems: 50,
      },
      user_agent_pattern: { type: ['string', 'null'], maxLength: 500 },

      // Lifecycle
      expires_at: { type: ['string', 'null'], format: 'date-time' },
      rotate_at: { type: ['string', 'null'], format: 'date-time' },
      grace_period_days: { type: 'number', minimum: 0, maximum: 90 },

      // Audit
      tags: {
        type: ['array', 'null'],
        items: { type: 'string', minLength: 1, maxLength: 50 },
        maxItems: 20,
      },
    },
    additionalProperties: false,
  },
  response: {
    200: {
      type: 'object',
      required: ['success', 'data', 'timestamp'],
      properties: {
        success: { type: 'boolean', enum: [true] },
        data: apiKeySchema,
        timestamp: { type: 'string', format: 'date-time' },
      },
    },
  },
} as const;

/**
 * DELETE /api/v1/api-keys/:id - Revoke API key
 */
export const revokeApiKeySchema = {
  params: idParamSchema,
  response: {
    200: {
      type: 'object',
      required: ['success', 'data', 'timestamp'],
      properties: {
        success: { type: 'boolean', enum: [true] },
        data: {
          type: 'object',
          required: ['message'],
          properties: {
            message: { type: 'string' },
          },
        },
        timestamp: { type: 'string', format: 'date-time' },
      },
    },
  },
} as const;

/**
 * POST /api/v1/api-keys/:id/rotate - Rotate API key
 */
export const rotateApiKeySchema = {
  params: idParamSchema,
  response: {
    200: {
      type: 'object',
      required: ['success', 'data', 'timestamp'],
      properties: {
        success: { type: 'boolean', enum: [true] },
        data: {
          type: 'object',
          required: ['new_api_key', 'key_details'],
          properties: {
            new_api_key: {
              type: 'string',
              pattern: '^bgs_[a-zA-Z0-9_-]{43}$',
              description: 'New API key (only returned once)',
            },
            key_details: apiKeySchema,
          },
        },
        timestamp: { type: 'string', format: 'date-time' },
      },
    },
  },
} as const;

/**
 * GET /api/v1/api-keys/:id/usage - Get usage analytics
 */
export const getApiKeyUsageSchema = {
  params: idParamSchema,
  querystring: {
    type: 'object',
    properties: {
      limit: { type: 'number', minimum: 1, maximum: 1000, default: 100 },
      offset: { type: 'number', minimum: 0, default: 0 },
    },
    additionalProperties: false,
  },
} as const;

/**
 * GET /api/v1/api-keys/:id/audit - Get audit log
 */
export const getApiKeyAuditSchema = {
  params: idParamSchema,
  querystring: {
    type: 'object',
    properties: {
      limit: { type: 'number', minimum: 1, maximum: 500, default: 100 },
      offset: { type: 'number', minimum: 0, default: 0 },
      action: {
        type: 'string',
        enum: [
          'created',
          'updated',
          'rotated',
          'revoked',
          'permissions_changed',
          'rate_limit_changed',
          'accessed',
          'failed_auth',
          'rate_limited',
        ],
      },
      start_date: { type: 'string', format: 'date-time' },
      end_date: { type: 'string', format: 'date-time' },
    },
    additionalProperties: false,
  },
} as const;
