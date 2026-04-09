/**
 * Integration Rule Validation Schemas
 * Fastify schemas for validating integration rule requests and responses
 */

export const filterConditionSchema = {
  type: 'object',
  required: ['field', 'operator', 'value'],
  properties: {
    field: {
      type: 'string',
      enum: [
        'priority',
        'status',
        'browser',
        'os',
        'url_pattern',
        'user_email',
        'error_message',
        'project',
        'console_level',
        'console_message',
        'network_status',
        'network_url',
      ],
    },
    operator: {
      type: 'string',
      enum: ['equals', 'contains', 'regex', 'in', 'not_in', 'starts_with', 'ends_with'],
    },
    value: {
      anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
    },
    case_sensitive: {
      type: 'boolean',
    },
  },
} as const;

export const throttleConfigSchema = {
  type: 'object',
  properties: {
    max_per_hour: {
      type: 'number',
      minimum: 1,
    },
    max_per_day: {
      type: 'number',
      minimum: 1,
    },
    group_by: {
      type: 'string',
      enum: ['user', 'url', 'error_type'],
    },
    digest_mode: {
      type: 'boolean',
    },
    digest_interval_minutes: {
      type: 'number',
      minimum: 1,
    },
  },
} as const;

export const fieldMappingsSchema = {
  type: 'object',
  additionalProperties: true,
} as const;

export const attachmentConfigSchema = {
  type: 'object',
  properties: {
    screenshot: {
      type: 'object',
      required: ['enabled'],
      properties: {
        enabled: { type: 'boolean' },
      },
    },
    console: {
      type: 'object',
      required: ['enabled'],
      properties: {
        enabled: { type: 'boolean' },
        levels: {
          type: 'array',
          items: { type: 'string', enum: ['error', 'warn', 'info', 'debug', 'log'] },
        },
        maxEntries: { type: 'number', minimum: 1, maximum: 1000 },
      },
    },
    network: {
      type: 'object',
      required: ['enabled'],
      properties: {
        enabled: { type: 'boolean' },
        failedOnly: { type: 'boolean' },
        includeBodies: { type: 'boolean' },
        maxEntries: { type: 'number', minimum: 1, maximum: 1000 },
        redactHeaders: {
          type: 'array',
          items: { type: 'string' },
        },
      },
    },
    replay: {
      type: 'object',
      required: ['enabled'],
      properties: {
        enabled: { type: 'boolean' },
        mode: { type: 'string', enum: ['link', 'attach', 'both'] },
        expiryHours: { type: 'number', minimum: 1, maximum: 8760 },
      },
    },
  },
} as const;

export const integrationRuleSchema = {
  type: 'object',
  required: [
    'id',
    'project_id',
    'integration_id',
    'name',
    'enabled',
    'priority',
    'filters',
    'auto_create',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    project_id: { type: 'string', format: 'uuid' },
    integration_id: { type: 'string', format: 'uuid' },
    name: { type: 'string', minLength: 1, maxLength: 255 },
    enabled: { type: 'boolean' },
    priority: { type: 'number' },
    filters: {
      type: 'array',
      items: filterConditionSchema,
    },
    throttle: {
      oneOf: [{ type: 'null' }, throttleConfigSchema],
    },
    auto_create: { type: 'boolean' },
    field_mappings: {
      oneOf: [{ type: 'null' }, fieldMappingsSchema],
    },
    description_template: {
      type: ['null', 'string'],
      maxLength: 10000,
    },
    attachment_config: {
      oneOf: [{ type: 'null' }, attachmentConfigSchema],
    },
    created_at: { type: 'string', format: 'date-time' },
    updated_at: { type: 'string', format: 'date-time' },
  },
} as const;

export const createIntegrationRuleSchema = {
  body: {
    type: 'object',
    required: ['name', 'filters'],
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 255 },
      enabled: { type: 'boolean' },
      priority: { type: 'number' },
      filters: {
        type: 'array',
        items: filterConditionSchema,
      },
      throttle: {
        oneOf: [{ type: 'null' }, throttleConfigSchema],
      },
      auto_create: { type: 'boolean' },
      field_mappings: {
        oneOf: [{ type: 'null' }, fieldMappingsSchema],
      },
      description_template: {
        type: ['null', 'string'],
        maxLength: 10000,
      },
      attachment_config: {
        oneOf: [{ type: 'null' }, attachmentConfigSchema],
      },
    },
    additionalProperties: false,
  },
  params: {
    type: 'object',
    required: ['platform', 'projectId'],
    properties: {
      platform: { type: 'string' },
      projectId: { type: 'string', format: 'uuid' },
    },
  },
  response: {
    201: {
      type: 'object',
      required: ['success', 'data'],
      properties: {
        success: { type: 'boolean' },
        data: integrationRuleSchema,
      },
    },
  },
} as const;

export const updateIntegrationRuleSchema = {
  body: {
    type: 'object',
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 255 },
      enabled: { type: 'boolean' },
      priority: { type: 'number' },
      filters: {
        type: 'array',
        items: filterConditionSchema,
      },
      throttle: {
        oneOf: [{ type: 'null' }, throttleConfigSchema],
      },
      auto_create: { type: 'boolean' },
      field_mappings: {
        oneOf: [{ type: 'null' }, fieldMappingsSchema],
      },
      description_template: {
        type: ['null', 'string'],
        maxLength: 10000,
      },
      attachment_config: {
        oneOf: [{ type: 'null' }, attachmentConfigSchema],
      },
    },
    additionalProperties: false,
  },
  params: {
    type: 'object',
    required: ['platform', 'projectId', 'ruleId'],
    properties: {
      platform: { type: 'string' },
      projectId: { type: 'string', format: 'uuid' },
      ruleId: { type: 'string', format: 'uuid' },
    },
  },
  response: {
    200: {
      type: 'object',
      required: ['success', 'data'],
      properties: {
        success: { type: 'boolean' },
        data: integrationRuleSchema,
      },
    },
  },
} as const;

export const listIntegrationRulesSchema = {
  params: {
    type: 'object',
    required: ['platform', 'projectId'],
    properties: {
      platform: { type: 'string' },
      projectId: { type: 'string', format: 'uuid' },
    },
  },
  response: {
    200: {
      type: 'object',
      required: ['success', 'data'],
      properties: {
        success: { type: 'boolean' },
        data: {
          type: 'array',
          items: integrationRuleSchema,
        },
      },
    },
  },
} as const;

export const deleteIntegrationRuleSchema = {
  params: {
    type: 'object',
    required: ['platform', 'projectId', 'ruleId'],
    properties: {
      platform: { type: 'string' },
      projectId: { type: 'string', format: 'uuid' },
      ruleId: { type: 'string', format: 'uuid' },
    },
  },
  response: {
    200: {
      type: 'object',
      required: ['success', 'message'],
      properties: {
        success: { type: 'boolean' },
        message: { type: 'string' },
      },
    },
  },
} as const;

export const copyIntegrationRuleSchema = {
  params: {
    type: 'object',
    required: ['platform', 'projectId', 'ruleId'],
    properties: {
      platform: { type: 'string' },
      projectId: { type: 'string', format: 'uuid' },
      ruleId: { type: 'string', format: 'uuid' },
    },
  },
  body: {
    type: 'object',
    required: ['targetProjectId'],
    properties: {
      targetProjectId: { type: 'string', format: 'uuid' },
      targetIntegrationId: { type: 'string', format: 'uuid' },
    },
    additionalProperties: false,
  },
  response: {
    201: {
      type: 'object',
      required: ['success', 'data'],
      properties: {
        success: { type: 'boolean' },
        message: { type: 'string' },
        data: {
          type: 'object',
          properties: {
            rule: integrationRuleSchema,
          },
        },
      },
    },
  },
} as const;
