/**
 * Organization schemas for request/response validation
 */

export const organizationSchema = {
  type: 'object',
  required: [
    'id',
    'name',
    'subdomain',
    'data_residency_region',
    'storage_region',
    'subscription_status',
    'created_at',
    'updated_at',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    name: { type: 'string' },
    subdomain: { type: 'string' },
    data_residency_region: {
      type: 'string',
      enum: ['kz', 'rf', 'eu', 'us', 'global'],
    },
    storage_region: { type: 'string' },
    subscription_status: {
      type: 'string',
      enum: ['trial', 'active', 'past_due', 'canceled', 'trial_expired'],
    },
    trial_ends_at: { type: ['string', 'null'], format: 'date-time' },
    deleted_at: { type: ['string', 'null'], format: 'date-time' },
    deleted_by: { type: ['string', 'null'], format: 'uuid' },
    pending_owner_email: { type: ['string', 'null'], format: 'email' },
    created_at: { type: 'string', format: 'date-time' },
    updated_at: { type: 'string', format: 'date-time' },
  },
} as const;

const successWrapper = (dataSchema: object, statusCode = 200) => ({
  [statusCode]: {
    type: 'object',
    required: ['success', 'data', 'timestamp'],
    properties: {
      success: { type: 'boolean', enum: [true] },
      data: dataSchema,
      timestamp: { type: 'string', format: 'date-time' },
    },
  },
});

const uuidParam = {
  type: 'object',
  required: ['id'],
  properties: {
    id: { type: 'string', format: 'uuid' },
  },
} as const;

export const createOrganizationSchema = {
  body: {
    type: 'object',
    required: ['name', 'subdomain'],
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 255 },
      subdomain: {
        type: 'string',
        minLength: 3,
        maxLength: 63,
        pattern: '^[a-z0-9][a-z0-9-]*[a-z0-9]$',
      },
      data_residency_region: {
        type: 'string',
        enum: ['kz', 'rf', 'eu', 'us', 'global'],
      },
    },
    additionalProperties: false,
  },
  response: successWrapper(organizationSchema, 201),
} as const;

export const getOrganizationSchema = {
  params: uuidParam,
  response: successWrapper(organizationSchema),
} as const;

export const updateOrganizationSchema = {
  params: uuidParam,
  body: {
    type: 'object',
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 255 },
    },
    additionalProperties: false,
    minProperties: 1,
  },
  response: successWrapper(organizationSchema),
} as const;

const resourceUsageSchema = {
  type: 'object',
  required: ['current', 'limit'],
  properties: {
    current: { type: 'number', minimum: 0 },
    limit: { type: 'number', minimum: 0 },
  },
} as const;

const quotaStatusSchema = {
  type: 'object',
  required: ['plan', 'period', 'resources'],
  properties: {
    plan: {
      type: 'string',
      enum: ['trial', 'starter', 'professional', 'enterprise'],
    },
    period: {
      type: 'object',
      required: ['start', 'end'],
      properties: {
        start: { type: 'string', format: 'date-time' },
        end: { type: 'string', format: 'date-time' },
      },
    },
    resources: {
      type: 'object',
      required: [
        'projects',
        'bug_reports',
        'storage_bytes',
        'api_calls',
        'screenshots',
        'session_replays',
      ],
      properties: {
        projects: resourceUsageSchema,
        bug_reports: resourceUsageSchema,
        storage_bytes: resourceUsageSchema,
        api_calls: resourceUsageSchema,
        screenshots: resourceUsageSchema,
        session_replays: resourceUsageSchema,
      },
    },
  },
} as const;

export const getQuotaStatusSchema = {
  params: uuidParam,
  response: successWrapper(quotaStatusSchema),
} as const;

const subscriptionSchema = {
  type: 'object',
  required: [
    'id',
    'organization_id',
    'plan_name',
    'status',
    'current_period_start',
    'current_period_end',
    'quotas',
    'created_at',
    'updated_at',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    organization_id: { type: 'string', format: 'uuid' },
    plan_name: {
      type: 'string',
      enum: ['trial', 'starter', 'professional', 'enterprise'],
    },
    status: {
      type: 'string',
      enum: [
        'trial',
        'active',
        'past_due',
        'canceled',
        'incomplete',
        'incomplete_expired',
        'paused',
      ],
    },
    payment_provider: {
      type: ['string', 'null'],
      enum: ['kaspi', 'yookassa', 'stripe', 'invoice', null],
    },
    external_subscription_id: { type: ['string', 'null'] },
    external_customer_id: { type: ['string', 'null'] },
    current_period_start: { type: 'string', format: 'date-time' },
    current_period_end: { type: 'string', format: 'date-time' },
    quotas: { type: 'object' },
    created_at: { type: 'string', format: 'date-time' },
    updated_at: { type: 'string', format: 'date-time' },
  },
} as const;

export const getSubscriptionSchema = {
  params: uuidParam,
  response: successWrapper(subscriptionSchema),
} as const;

const memberSchema = {
  type: 'object',
  required: ['id', 'organization_id', 'user_id', 'role', 'user_email', 'created_at', 'updated_at'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    organization_id: { type: 'string', format: 'uuid' },
    user_id: { type: 'string', format: 'uuid' },
    role: { type: 'string', enum: ['owner', 'admin', 'member'] },
    user_email: { type: 'string', format: 'email' },
    user_name: { type: ['string', 'null'] },
    created_at: { type: 'string', format: 'date-time' },
    updated_at: { type: 'string', format: 'date-time' },
  },
} as const;

export const listMembersSchema = {
  params: uuidParam,
  response: successWrapper({ type: 'array', items: memberSchema }),
} as const;

export const addMemberSchema = {
  params: uuidParam,
  body: {
    type: 'object',
    required: ['user_id', 'role'],
    properties: {
      user_id: { type: 'string', format: 'uuid' },
      role: { type: 'string', enum: ['admin', 'member'] },
    },
    additionalProperties: false,
  },
  response: successWrapper(memberSchema, 201),
} as const;

const organizationWithMemberCountSchema = {
  type: 'object',
  required: [
    'id',
    'name',
    'subdomain',
    'data_residency_region',
    'storage_region',
    'subscription_status',
    'created_at',
    'updated_at',
    'member_count',
  ],
  properties: {
    ...organizationSchema.properties,
    member_count: { type: 'integer', minimum: 0 },
  },
} as const;

export const listOrganizationsSchema = {
  querystring: {
    type: 'object',
    properties: {
      page: { type: 'integer', minimum: 1, default: 1 },
      limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
      search: { type: 'string', maxLength: 255 },
      subscription_status: {
        type: 'string',
        enum: ['trial', 'active', 'past_due', 'canceled', 'trial_expired'],
      },
      data_residency_region: {
        type: 'string',
        enum: ['kz', 'rf', 'eu', 'us', 'global'],
      },
      include_deleted: { type: 'boolean', default: false },
    },
    additionalProperties: false,
  },
  response: {
    200: {
      type: 'object',
      required: ['success', 'data', 'pagination', 'timestamp'],
      properties: {
        success: { type: 'boolean', enum: [true] },
        data: { type: 'array', items: organizationWithMemberCountSchema },
        pagination: {
          type: 'object',
          required: ['page', 'limit', 'total', 'totalPages'],
          properties: {
            page: { type: 'integer' },
            limit: { type: 'integer' },
            total: { type: 'integer' },
            totalPages: { type: 'integer' },
          },
        },
        timestamp: { type: 'string', format: 'date-time' },
      },
    },
  },
} as const;

export const myOrganizationsSchema = {
  response: successWrapper({ type: 'array', items: organizationSchema }),
} as const;

export const removeMemberSchema = {
  params: {
    type: 'object',
    required: ['id', 'userId'],
    properties: {
      id: { type: 'string', format: 'uuid' },
      userId: { type: 'string', format: 'uuid' },
    },
  },
  response: successWrapper({
    type: 'object',
    required: ['message'],
    properties: {
      message: { type: 'string' },
    },
  }),
} as const;
