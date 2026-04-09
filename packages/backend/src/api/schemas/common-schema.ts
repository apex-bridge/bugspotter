/**
 * Common schemas used across multiple routes
 */

export const paginationSchema = {
  type: 'object',
  properties: {
    page: { type: 'number', minimum: 1, default: 1 },
    limit: { type: 'number', minimum: 1, maximum: 100, default: 20 },
  },
} as const;

export const paginationResponseSchema = {
  type: 'object',
  required: ['page', 'limit', 'total', 'totalPages'],
  properties: {
    page: { type: 'number' },
    limit: { type: 'number' },
    total: { type: 'number' },
    totalPages: { type: 'number' },
  },
} as const;

export const errorResponseSchema = {
  type: 'object',
  required: ['success', 'error', 'message', 'statusCode', 'timestamp'],
  properties: {
    success: { type: 'boolean', enum: [false] },
    error: { type: 'string' },
    message: { type: 'string' },
    statusCode: { type: 'number' },
    timestamp: { type: 'string', format: 'date-time' },
    details: { type: 'object' },
    requestId: { type: 'string' },
  },
} as const;

export const successResponseSchema = {
  type: 'object',
  required: ['success', 'data', 'timestamp'],
  properties: {
    success: { type: 'boolean', enum: [true] },
    data: {
      oneOf: [
        { type: 'object', additionalProperties: true },
        { type: 'array', items: { type: 'object', additionalProperties: true } },
      ],
    },
    timestamp: { type: 'string', format: 'date-time' },
  },
} as const;

export const idParamSchema = {
  type: 'object',
  required: ['id'],
  properties: {
    id: { type: 'string', format: 'uuid' },
  },
} as const;

export const sortOrderSchema = {
  type: 'string',
  enum: ['asc', 'desc'],
  default: 'desc',
} as const;
