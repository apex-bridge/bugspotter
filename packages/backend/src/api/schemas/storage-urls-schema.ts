/**
 * Storage URL API Schemas
 * Validation schemas for storage URL generation endpoints
 */

export const getStorageUrlSchema = {
  params: {
    type: 'object',
    required: ['bugReportId', 'type'],
    properties: {
      bugReportId: { type: 'string', format: 'uuid' },
      type: { type: 'string', enum: ['screenshot', 'replay', 'thumbnail'] },
    },
  },
  querystring: {
    type: 'object',
    properties: {
      shareToken: { type: 'string' },
    },
    additionalProperties: false,
  },
  response: {
    200: {
      type: 'object',
      properties: {
        url: { type: 'string' },
        key: { type: 'string' },
        expiresIn: { type: 'number' },
        generatedAt: { type: 'string', format: 'date-time' },
      },
    },
    404: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        error: { type: 'string' },
        message: { type: 'string' },
        statusCode: { type: 'number' },
        timestamp: { type: 'string' },
        requestId: { type: 'string' },
      },
    },
    500: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        error: { type: 'string' },
        message: { type: 'string' },
        statusCode: { type: 'number' },
        timestamp: { type: 'string' },
        requestId: { type: 'string' },
      },
    },
  },
} as const;

export const postStorageUrlSchema = {
  params: {
    type: 'object',
    required: ['bugReportId', 'type'],
    properties: {
      bugReportId: { type: 'string', format: 'uuid' },
      type: { type: 'string', enum: ['screenshot', 'replay', 'thumbnail'] },
    },
  },
  body: {
    type: 'object',
    required: ['shareToken'],
    properties: {
      shareToken: { type: 'string' },
      shareTokenPassword: { type: 'string' },
    },
    additionalProperties: false,
  },
  response: {
    200: {
      type: 'object',
      properties: {
        url: { type: 'string' },
        key: { type: 'string' },
        expiresIn: { type: 'number' },
        generatedAt: { type: 'string', format: 'date-time' },
      },
    },
    404: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        error: { type: 'string' },
        message: { type: 'string' },
        statusCode: { type: 'number' },
        timestamp: { type: 'string' },
        requestId: { type: 'string' },
      },
    },
    500: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        error: { type: 'string' },
        message: { type: 'string' },
        statusCode: { type: 'number' },
        timestamp: { type: 'string' },
        requestId: { type: 'string' },
      },
    },
  },
} as const;

export const batchGenerateUrlsSchema = {
  body: {
    type: 'object',
    required: ['bugReportIds', 'types'],
    properties: {
      bugReportIds: {
        type: 'array',
        items: { type: 'string', format: 'uuid' },
        minItems: 1,
        maxItems: 100,
      },
      types: {
        type: 'array',
        items: { type: 'string', enum: ['screenshot', 'replay', 'thumbnail'] },
        minItems: 1,
      },
    },
  },
  querystring: {
    type: 'object',
    properties: {
      shareToken: { type: 'string' },
    },
    additionalProperties: false,
  },
  response: {
    200: {
      type: 'object',
      properties: {
        urls: {
          type: 'object',
          additionalProperties: {
            type: 'object',
            properties: {
              screenshot: { type: 'string', nullable: true },
              replay: { type: 'string', nullable: true },
              thumbnail: { type: 'string', nullable: true },
            },
          },
        },
        generatedAt: { type: 'string', format: 'date-time' },
      },
    },
  },
} as const;
