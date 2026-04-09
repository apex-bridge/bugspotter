/**
 * Billing request/response schemas for Fastify validation.
 */

export const createCheckoutSchema = {
  body: {
    type: 'object',
    required: ['plan_name', 'return_url'],
    properties: {
      plan_name: {
        type: 'string',
        enum: ['starter', 'professional', 'enterprise'],
      },
      return_url: { type: 'string', format: 'uri' },
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
          required: ['redirect_url'],
          properties: {
            redirect_url: { type: 'string' },
          },
        },
        timestamp: { type: 'string', format: 'date-time' },
      },
    },
  },
} as const;

export const getPlansSchema = {
  response: {
    200: {
      type: 'object',
      required: ['success', 'data', 'timestamp'],
      properties: {
        success: { type: 'boolean', enum: [true] },
        data: {
          type: 'object',
          required: ['plans'],
          properties: {
            plans: {
              type: 'array',
              items: {
                type: 'object',
                required: ['name', 'prices', 'quotas'],
                properties: {
                  name: { type: 'string' },
                  prices: { type: 'object', additionalProperties: { type: 'number' } },
                  quotas: { type: 'object', additionalProperties: { type: 'number' } },
                },
              },
            },
          },
        },
        timestamp: { type: 'string', format: 'date-time' },
      },
    },
  },
} as const;

export const cancelSubscriptionSchema = {
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
