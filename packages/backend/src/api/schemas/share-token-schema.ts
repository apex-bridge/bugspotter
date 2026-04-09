/**
 * Share Token schemas for request/response validation
 * Validates share token operations (create, validate, delete)
 */

import {
  MIN_SHARE_TOKEN_EXPIRATION_HOURS,
  MAX_SHARE_TOKEN_EXPIRATION_HOURS,
  DEFAULT_SHARE_TOKEN_EXPIRATION_HOURS,
  MIN_SHARE_TOKEN_PASSWORD_LENGTH,
  MAX_SHARE_TOKEN_PASSWORD_LENGTH,
} from '@bugspotter/types';

/**
 * Core share token object schema
 */
export const shareTokenSchema = {
  type: 'object',
  required: ['id', 'bug_report_id', 'token', 'expires_at', 'view_count', 'created_at'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    bug_report_id: { type: 'string', format: 'uuid' },
    token: { type: 'string', minLength: 32 },
    expires_at: { type: 'string', format: 'date-time' },
    password_hash: { type: 'string', nullable: true },
    view_count: { type: 'integer', minimum: 0 },
    created_by: { type: 'string', format: 'uuid', nullable: true },
    created_at: { type: 'string', format: 'date-time' },
  },
} as const;

/**
 * Schema for creating a new share token
 * POST /api/bug-reports/:id/share
 */
export const createShareTokenSchema = {
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
      // Expiration time in hours (default: 24 hours, max: 720 hours = 30 days)
      expires_in_hours: {
        type: 'integer',
        minimum: MIN_SHARE_TOKEN_EXPIRATION_HOURS,
        maximum: MAX_SHARE_TOKEN_EXPIRATION_HOURS,
        default: DEFAULT_SHARE_TOKEN_EXPIRATION_HOURS,
      },
      // Optional password protection (plain text - will be hashed server-side)
      password: {
        type: 'string',
        minLength: MIN_SHARE_TOKEN_PASSWORD_LENGTH,
        maxLength: MAX_SHARE_TOKEN_PASSWORD_LENGTH,
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
          required: ['token', 'expires_at', 'share_url'],
          properties: {
            token: { type: 'string', minLength: 32 },
            expires_at: { type: 'string', format: 'date-time' },
            share_url: { type: 'string', format: 'uri' },
            password_protected: { type: 'boolean' },
          },
        },
        timestamp: { type: 'string', format: 'date-time' },
      },
    },
  },
} as const;

/**
 * Schema for accessing a shared replay
 * GET /api/share/:token
 */
export const getSharedReplaySchema = {
  params: {
    type: 'object',
    required: ['token'],
    properties: {
      token: { type: 'string', minLength: 32, maxLength: 256 },
    },
  },
  querystring: {
    type: 'object',
    properties: {
      // Password if token is password-protected (plain text)
      password: {
        type: 'string',
        minLength: MIN_SHARE_TOKEN_PASSWORD_LENGTH,
        maxLength: MAX_SHARE_TOKEN_PASSWORD_LENGTH,
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
        data: {
          type: 'object',
          required: ['bug_report', 'replay_url', 'share_info'],
          properties: {
            bug_report: {
              type: 'object',
              required: ['id', 'title', 'status', 'priority', 'created_at'],
              properties: {
                id: { type: 'string', format: 'uuid' },
                title: { type: 'string' },
                description: { type: 'string', nullable: true },
                status: { type: 'string' },
                priority: { type: 'string' },
                created_at: { type: 'string', format: 'date-time' },
              },
            },
            session: {
              type: 'object',
              nullable: true,
              properties: {
                id: { type: 'string', format: 'uuid' },
                viewport: {
                  type: 'object',
                  required: ['width', 'height'],
                  properties: {
                    width: { type: 'number' },
                    height: { type: 'number' },
                  },
                },
                // WARNING: Session events use additionalProperties: true for rrweb compatibility
                // rrweb event structure is dynamic and changes across versions
                // Additional validation should be performed at application layer for security
                events: {
                  type: 'object',
                  required: ['type'],
                  additionalProperties: true, // Allow rrweb dynamic properties
                  properties: {
                    type: { type: 'string', enum: ['rrweb', 'metadata'] },
                    // WARNING: Array items accept any structure for rrweb compatibility
                    // Malformed or malicious data could pass validation
                    // Application layer MUST sanitize before rendering
                    recordedEvents: {
                      type: 'array',
                      items: { type: 'object', additionalProperties: true },
                    },
                    // WARNING: Console logs are security-sensitive user data
                    // Schema permits any properties for forward compatibility
                    // Expected: { level: string, message: string, timestamp: number }
                    console: {
                      type: 'array',
                      items: { type: 'object', additionalProperties: true },
                    },
                    // WARNING: Network requests contain URLs and may include sensitive data
                    // Schema permits any properties for forward compatibility
                    // Expected: { url: string, method: string, status: number, timestamp: number }
                    network: {
                      type: 'array',
                      items: { type: 'object', additionalProperties: true },
                    },
                    metadata: { type: 'object', additionalProperties: true },
                  },
                },
              },
            },
            replay_url: { type: 'string', format: 'uri' },
            share_info: {
              type: 'object',
              required: ['view_count', 'expires_at', 'password_protected'],
              properties: {
                view_count: { type: 'integer', minimum: 0 },
                expires_at: { type: 'string', format: 'date-time' },
                password_protected: { type: 'boolean' },
              },
            },
          },
        },
        timestamp: { type: 'string', format: 'date-time' },
      },
    },
  },
} as const;

/**
 * Schema for revoking a share token
 * DELETE /api/share/:token
 */
export const deleteShareTokenSchema = {
  params: {
    type: 'object',
    required: ['token'],
    properties: {
      token: { type: 'string', minLength: 32, maxLength: 256 },
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
 * Schema for getting the active share token for a bug report
 * GET /api/v1/replays/:id/share
 */
export const getActiveShareTokenSchema = {
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
          required: [
            'id',
            'token',
            'expires_at',
            'share_url',
            'password_protected',
            'view_count',
            'created_at',
          ],
          properties: {
            id: { type: 'string', format: 'uuid' },
            token: { type: 'string', minLength: 32 },
            expires_at: { type: 'string', format: 'date-time' },
            share_url: { type: 'string', format: 'uri' },
            password_protected: { type: 'boolean' },
            view_count: { type: 'integer', minimum: 0 },
            created_by: { type: 'string', format: 'uuid', nullable: true },
            created_at: { type: 'string', format: 'date-time' },
          },
        },
        timestamp: { type: 'string', format: 'date-time' },
      },
    },
  },
} as const;

/**
 * Schema for listing all share tokens for a bug report
 * GET /api/bug-reports/:id/shares
 */
export const listShareTokensSchema = {
  params: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'string', format: 'uuid' },
    },
  },
  querystring: {
    type: 'object',
    properties: {
      // Filter to only active (non-expired) tokens
      active_only: { type: 'boolean', default: false },
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
          required: ['tokens', 'stats'],
          properties: {
            tokens: {
              type: 'array',
              items: {
                type: 'object',
                required: ['id', 'token', 'expires_at', 'view_count', 'created_at'],
                properties: {
                  id: { type: 'string', format: 'uuid' },
                  token: { type: 'string', minLength: 32 },
                  expires_at: { type: 'string', format: 'date-time' },
                  password_protected: { type: 'boolean' },
                  view_count: { type: 'integer', minimum: 0 },
                  created_by: { type: 'string', format: 'uuid', nullable: true },
                  created_at: { type: 'string', format: 'date-time' },
                  is_expired: { type: 'boolean' },
                },
              },
            },
            stats: {
              type: 'object',
              required: ['count', 'active_count', 'total_views'],
              properties: {
                count: { type: 'integer', minimum: 0 },
                active_count: { type: 'integer', minimum: 0 },
                total_views: { type: 'integer', minimum: 0 },
              },
            },
          },
        },
        timestamp: { type: 'string', format: 'date-time' },
      },
    },
  },
} as const;
