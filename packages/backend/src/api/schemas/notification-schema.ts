/**
 * Notification schemas for request/response validation
 * Comprehensive Fastify validation for channels, rules, templates, and history
 */

import { CHANNEL_TYPES } from '../../types/notifications.js';
import { paginationSchema, paginationResponseSchema, idParamSchema } from './common-schema.js';

// ============================================================================
// CONSTANTS
// ============================================================================

const PRIORITY_LEVELS = ['critical', 'high', 'medium', 'low'] as const;

// ============================================================================
// CHANNEL SCHEMAS
// ============================================================================

const notificationChannelSchema = {
  type: 'object',
  required: [
    'id',
    'project_id',
    'name',
    'type',
    'config',
    'active',
    'failure_count',
    'created_at',
    'updated_at',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    project_id: { type: 'string', format: 'uuid' },
    name: { type: 'string' },
    type: { type: 'string', enum: CHANNEL_TYPES },
    config: { type: 'object' }, // Specific validation in business logic
    active: { type: 'boolean' },
    last_success_at: { type: ['string', 'null'], format: 'date-time' },
    last_failure_at: { type: ['string', 'null'], format: 'date-time' },
    failure_count: { type: 'number' },
    created_at: { type: 'string', format: 'date-time' },
    updated_at: { type: 'string', format: 'date-time' },
  },
} as const;

export const listChannelsSchema = {
  querystring: {
    type: 'object',
    properties: {
      project_id: { type: 'string', format: 'uuid' },
      type: { type: 'string', enum: CHANNEL_TYPES },
      active: { type: 'boolean' },
      ...paginationSchema.properties,
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
          required: ['channels', 'pagination'],
          properties: {
            channels: {
              type: 'array',
              items: notificationChannelSchema,
            },
            pagination: paginationResponseSchema,
          },
        },
        timestamp: { type: 'string', format: 'date-time' },
      },
    },
  },
} as const;

export const createChannelSchema = {
  body: {
    type: 'object',
    required: ['project_id', 'name', 'type', 'config'],
    properties: {
      project_id: { type: 'string', format: 'uuid' },
      name: { type: 'string', minLength: 1, maxLength: 255 },
      type: { type: 'string', enum: CHANNEL_TYPES },
      config: { type: 'object' }, // Validated by type discriminator
      active: { type: 'boolean', default: true },
    },
    additionalProperties: false,
  },
  response: {
    201: {
      type: 'object',
      required: ['success', 'data', 'timestamp'],
      properties: {
        success: { type: 'boolean', enum: [true] },
        data: notificationChannelSchema,
        timestamp: { type: 'string', format: 'date-time' },
      },
    },
  },
} as const;

export const getChannelSchema = {
  params: idParamSchema,
  response: {
    200: {
      type: 'object',
      required: ['success', 'data', 'timestamp'],
      properties: {
        success: { type: 'boolean', enum: [true] },
        data: notificationChannelSchema,
        timestamp: { type: 'string', format: 'date-time' },
      },
    },
  },
} as const;

export const updateChannelSchema = {
  params: idParamSchema,
  body: {
    type: 'object',
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 255 },
      config: { type: 'object' },
      active: { type: 'boolean' },
    },
    additionalProperties: false,
    minProperties: 1,
  },
  response: {
    200: {
      type: 'object',
      required: ['success', 'data', 'timestamp'],
      properties: {
        success: { type: 'boolean', enum: [true] },
        data: notificationChannelSchema,
        timestamp: { type: 'string', format: 'date-time' },
      },
    },
  },
} as const;

export const deleteChannelSchema = {
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

export const testChannelSchema = {
  params: idParamSchema,
  body: {
    type: 'object',
    properties: {
      test_message: {
        type: 'string',
        maxLength: 500,
        default: 'Test notification from BugSpotter',
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
          required: ['delivered', 'message'],
          properties: {
            delivered: { type: 'boolean' },
            message: { type: 'string' },
            response: { type: 'object' },
            error: { type: 'string' },
          },
        },
        timestamp: { type: 'string', format: 'date-time' },
      },
    },
  },
} as const;

// ============================================================================
// RULE SCHEMAS
// ============================================================================

const triggerConditionSchema = {
  type: 'object',
  required: ['event'],
  properties: {
    event: {
      type: 'string',
      enum: ['new_bug', 'bug_resolved', 'priority_change', 'threshold_reached', 'error_spike'],
    },
    params: {
      type: 'object',
      properties: {
        priority: { type: 'string', enum: PRIORITY_LEVELS },
        threshold: { type: 'number', minimum: 1 },
        // Time window format: <number><unit> where unit is m (minutes), h (hours), or d (days)
        // Examples: "30m" (30 minutes), "2h" (2 hours), "7d" (7 days)
        time_window: { type: 'string', pattern: '^\\d+[mhd]$', maxLength: 10 },
        spike_multiplier: { type: 'number', minimum: 1.5, maximum: 100 },
        from_priority: { type: 'string', enum: PRIORITY_LEVELS },
        to_priority: { type: 'string', enum: PRIORITY_LEVELS },
      },
    },
  },
} as const;

const filterConditionSchema = {
  type: 'object',
  required: ['field', 'operator', 'value'],
  properties: {
    field: {
      type: 'string',
      enum: [
        'project',
        'browser',
        'os',
        'url_pattern',
        'user_email',
        'error_message',
        'priority',
        'status',
      ],
    },
    operator: {
      type: 'string',
      enum: ['equals', 'contains', 'regex', 'in', 'not_in', 'starts_with', 'ends_with'],
    },
    value: {
      oneOf: [
        { type: 'string', maxLength: 1000 },
        { type: 'array', items: { type: 'string', maxLength: 1000 }, maxItems: 100 },
      ],
    },
    case_sensitive: { type: 'boolean' },
  },
} as const;

const throttleConfigSchema = {
  type: 'object',
  properties: {
    max_per_hour: { type: 'number', minimum: 1, maximum: 1000 },
    max_per_day: { type: 'number', minimum: 1, maximum: 10000 },
    group_by: { type: 'string', enum: ['error_signature', 'project', 'user', 'none'] },
    digest_mode: { type: 'boolean' },
    digest_interval_minutes: { type: 'number', minimum: 5, maximum: 1440 },
  },
} as const;

const scheduleConfigSchema = {
  type: 'object',
  required: ['type'],
  properties: {
    type: { type: 'string', enum: ['immediate', 'scheduled', 'business_hours'] },
    timezone: { type: 'string', maxLength: 100 },
    business_hours: {
      type: 'object',
      required: ['start', 'end', 'days'],
      properties: {
        // Time format: HH:MM in 24-hour format (00:00 to 23:59)
        // Examples: "09:00", "17:30", "23:59"
        start: { type: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' },
        end: { type: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' },
        // Days of week: 0 (Sunday) through 6 (Saturday)
        days: {
          type: 'array',
          items: { type: 'number', minimum: 0, maximum: 6 },
          minItems: 1,
          maxItems: 7,
        },
      },
    },
    delay_minutes: { type: 'number', minimum: 0, maximum: 10080 },
  },
} as const;

const notificationRuleSchema = {
  type: 'object',
  required: [
    'id',
    'project_id',
    'name',
    'enabled',
    'triggers',
    'priority',
    'created_at',
    'updated_at',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    project_id: { type: 'string', format: 'uuid' },
    name: { type: 'string' },
    enabled: { type: 'boolean' },
    triggers: {
      type: 'array',
      items: triggerConditionSchema,
      minItems: 1,
    },
    filters: {
      type: ['array', 'null'],
      items: filterConditionSchema,
    },
    throttle: {
      oneOf: [throttleConfigSchema, { type: 'null' }],
    },
    schedule: {
      oneOf: [scheduleConfigSchema, { type: 'null' }],
    },
    priority: { type: 'number', minimum: 0, maximum: 100 },
    created_at: { type: 'string', format: 'date-time' },
    updated_at: { type: 'string', format: 'date-time' },
    channels: {
      type: 'array',
      items: { type: 'string', format: 'uuid' },
    },
  },
} as const;

export const listRulesSchema = {
  querystring: {
    type: 'object',
    properties: {
      project_id: { type: 'string', format: 'uuid' },
      enabled: { type: 'boolean' },
      ...paginationSchema.properties,
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
          required: ['rules', 'pagination'],
          properties: {
            rules: {
              type: 'array',
              items: notificationRuleSchema,
            },
            pagination: paginationResponseSchema,
          },
        },
        timestamp: { type: 'string', format: 'date-time' },
      },
    },
  },
} as const;

export const createRuleSchema = {
  body: {
    type: 'object',
    required: ['project_id', 'name', 'triggers', 'channel_ids'],
    properties: {
      project_id: { type: 'string', format: 'uuid' },
      name: { type: 'string', minLength: 1, maxLength: 255 },
      enabled: { type: 'boolean', default: true },
      triggers: {
        type: 'array',
        items: triggerConditionSchema,
        minItems: 1,
      },
      filters: {
        type: 'array',
        items: filterConditionSchema,
      },
      throttle: throttleConfigSchema,
      schedule: scheduleConfigSchema,
      priority: { type: 'number', minimum: 0, maximum: 100, default: 50 },
      channel_ids: {
        type: 'array',
        items: { type: 'string', format: 'uuid' },
        minItems: 1,
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
        data: notificationRuleSchema,
        timestamp: { type: 'string', format: 'date-time' },
      },
    },
  },
} as const;

export const getRuleSchema = {
  params: idParamSchema,
  response: {
    200: {
      type: 'object',
      required: ['success', 'data', 'timestamp'],
      properties: {
        success: { type: 'boolean', enum: [true] },
        data: notificationRuleSchema,
        timestamp: { type: 'string', format: 'date-time' },
      },
    },
  },
} as const;

export const updateRuleSchema = {
  params: idParamSchema,
  body: {
    type: 'object',
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 255 },
      enabled: { type: 'boolean' },
      triggers: {
        type: 'array',
        items: triggerConditionSchema,
        minItems: 1,
      },
      filters: {
        type: 'array',
        items: filterConditionSchema,
      },
      throttle: throttleConfigSchema,
      schedule: scheduleConfigSchema,
      priority: { type: 'number', minimum: 0, maximum: 100 },
      channel_ids: {
        type: 'array',
        items: { type: 'string', format: 'uuid' },
        minItems: 1,
      },
    },
    additionalProperties: false,
    minProperties: 1,
  },
  response: {
    200: {
      type: 'object',
      required: ['success', 'data', 'timestamp'],
      properties: {
        success: { type: 'boolean', enum: [true] },
        data: notificationRuleSchema,
        timestamp: { type: 'string', format: 'date-time' },
      },
    },
  },
} as const;

export const deleteRuleSchema = {
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

// ============================================================================
// TEMPLATE SCHEMAS
// ============================================================================

const templateVariableSchema = {
  type: 'object',
  required: ['name', 'description', 'example'],
  properties: {
    name: { type: 'string', maxLength: 100 },
    description: { type: 'string', maxLength: 500 },
    example: { type: 'string', maxLength: 500 },
  },
} as const;

const notificationTemplateSchema = {
  type: 'object',
  required: [
    'id',
    'name',
    'channel_type',
    'trigger_type',
    'body',
    'version',
    'is_active',
    'created_at',
    'updated_at',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    name: { type: 'string' },
    channel_type: { type: 'string', enum: CHANNEL_TYPES },
    trigger_type: {
      type: 'string',
      enum: [
        'new_bug',
        'bug_resolved',
        'priority_change',
        'threshold_reached',
        'error_spike',
        'digest',
      ],
    },
    subject: { type: ['string', 'null'] },
    body: { type: 'string' },
    variables: {
      type: ['array', 'null'],
      items: templateVariableSchema,
    },
    recipients: {
      type: ['array', 'null'],
      items: { type: 'string', format: 'email' },
      description: 'Static recipient email addresses (optional, for testing/fixed destinations)',
    },
    version: { type: 'number' },
    is_active: { type: 'boolean' },
    created_at: { type: 'string', format: 'date-time' },
    updated_at: { type: 'string', format: 'date-time' },
  },
} as const;

export const listTemplatesSchema = {
  querystring: {
    type: 'object',
    properties: {
      channel_type: { type: 'string', enum: CHANNEL_TYPES },
      trigger_type: {
        type: 'string',
        enum: [
          'new_bug',
          'bug_resolved',
          'priority_change',
          'threshold_reached',
          'error_spike',
          'digest',
        ],
      },
      is_active: { type: 'boolean' },
      ...paginationSchema.properties,
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
          required: ['templates', 'pagination'],
          properties: {
            templates: {
              type: 'array',
              items: notificationTemplateSchema,
            },
            pagination: paginationResponseSchema,
          },
        },
        timestamp: { type: 'string', format: 'date-time' },
      },
    },
  },
} as const;

export const createTemplateSchema = {
  body: {
    type: 'object',
    required: ['name', 'channel_type', 'trigger_type', 'body'],
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 255 },
      channel_type: { type: 'string', enum: CHANNEL_TYPES },
      trigger_type: {
        type: 'string',
        enum: [
          'new_bug',
          'bug_resolved',
          'priority_change',
          'threshold_reached',
          'error_spike',
          'digest',
        ],
      },
      subject: { type: 'string', maxLength: 500 },
      body: { type: 'string', minLength: 1, maxLength: 10000 },
      variables: {
        type: 'array',
        items: templateVariableSchema,
      },
      recipients: {
        type: 'array',
        items: { type: 'string', format: 'email' },
        description: 'Static recipient email addresses (optional)',
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
        data: notificationTemplateSchema,
        timestamp: { type: 'string', format: 'date-time' },
      },
    },
  },
} as const;

export const getTemplateSchema = {
  params: idParamSchema,
  response: {
    200: {
      type: 'object',
      required: ['success', 'data', 'timestamp'],
      properties: {
        success: { type: 'boolean', enum: [true] },
        data: notificationTemplateSchema,
        timestamp: { type: 'string', format: 'date-time' },
      },
    },
  },
} as const;

export const updateTemplateSchema = {
  params: idParamSchema,
  body: {
    type: 'object',
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 255 },
      subject: { type: 'string', maxLength: 500 },
      body: { type: 'string', minLength: 1, maxLength: 10000 },
      variables: {
        type: 'array',
        items: templateVariableSchema,
      },
      recipients: {
        type: 'array',
        items: { type: 'string', format: 'email' },
        description: 'Static recipient email addresses (optional)',
      },
      is_active: { type: 'boolean' },
    },
    additionalProperties: false,
    minProperties: 1,
  },
  response: {
    200: {
      type: 'object',
      required: ['success', 'data', 'timestamp'],
      properties: {
        success: { type: 'boolean', enum: [true] },
        data: notificationTemplateSchema,
        timestamp: { type: 'string', format: 'date-time' },
      },
    },
  },
} as const;

export const deleteTemplateSchema = {
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

export const previewTemplateSchema = {
  body: {
    type: 'object',
    required: ['template_body', 'context'],
    properties: {
      template_body: { type: 'string', minLength: 1, maxLength: 10000 },
      subject: { type: 'string', maxLength: 500 },
      context: { type: 'object' },
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
          required: ['rendered_body'],
          properties: {
            rendered_subject: { type: 'string' },
            rendered_body: { type: 'string' },
          },
        },
        timestamp: { type: 'string', format: 'date-time' },
      },
    },
  },
} as const;

// ============================================================================
// HISTORY SCHEMAS
// ============================================================================

const notificationHistorySchema = {
  type: 'object',
  required: ['id', 'recipients', 'status', 'attempts', 'created_at'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    channel_id: { type: ['string', 'null'], format: 'uuid' },
    rule_id: { type: ['string', 'null'], format: 'uuid' },
    template_id: { type: ['string', 'null'], format: 'uuid' },
    bug_id: { type: ['string', 'null'], format: 'uuid' },
    recipients: {
      type: 'array',
      items: { type: 'string' },
    },
    payload: { type: ['object', 'null'], additionalProperties: true },
    response: { type: ['object', 'null'], additionalProperties: true },
    status: { type: 'string', enum: ['sent', 'failed', 'pending', 'throttled'] },
    error: { type: ['string', 'null'] },
    attempts: { type: 'number' },
    delivered_at: { type: ['string', 'null'], format: 'date-time' },
    created_at: { type: 'string', format: 'date-time' },
    channel_name: { type: 'string' },
    channel_type: { type: 'string', enum: CHANNEL_TYPES },
    rule_name: { type: 'string' },
    bug_title: { type: 'string' },
  },
} as const;

/**
 * List notification history (organization-scoped)
 * GET /api/v1/organizations/:id/notifications/history
 */
export const listHistorySchema = {
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
      channel_id: { type: 'string', format: 'uuid' },
      rule_id: { type: 'string', format: 'uuid' },
      bug_id: { type: 'string', format: 'uuid' },
      status: { type: 'string', enum: ['sent', 'failed', 'pending', 'throttled'] },
      created_after: { type: 'string', format: 'date-time' },
      created_before: { type: 'string', format: 'date-time' },
      ...paginationSchema.properties,
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
          required: ['history', 'pagination'],
          properties: {
            history: {
              type: 'array',
              items: notificationHistorySchema,
            },
            pagination: paginationResponseSchema,
          },
        },
        timestamp: { type: 'string', format: 'date-time' },
      },
    },
  },
} as const;

/**
 * Get single notification history entry (organization-scoped)
 * GET /api/v1/organizations/:id/notifications/history/:historyId
 */
export const getHistoryItemSchema = {
  params: {
    type: 'object',
    required: ['id', 'historyId'],
    properties: {
      id: { type: 'string', format: 'uuid' },
      historyId: { type: 'string', format: 'uuid' },
    },
  },
  response: {
    200: {
      type: 'object',
      required: ['success', 'data', 'timestamp'],
      properties: {
        success: { type: 'boolean', enum: [true] },
        data: notificationHistorySchema,
        timestamp: { type: 'string', format: 'date-time' },
      },
    },
  },
} as const;
