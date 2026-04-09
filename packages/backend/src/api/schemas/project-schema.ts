/**
 * Project schemas for request/response validation
 */

export const projectSchema = {
  type: 'object',
  required: ['id', 'name', 'created_at', 'updated_at'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    name: { type: 'string' },
    settings: { type: 'object', additionalProperties: true },
    created_by: { type: ['string', 'null'], format: 'uuid' },
    organization_id: { type: ['string', 'null'], format: 'uuid' },
    created_at: { type: 'string', format: 'date-time' },
    updated_at: { type: 'string', format: 'date-time' },
  },
} as const;

export const createProjectSchema = {
  body: {
    type: 'object',
    required: ['name'],
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 255 },
      settings: {
        type: 'object',
        additionalProperties: true,
        maxProperties: 100,
      },
      organization_id: { type: 'string', format: 'uuid' },
    },
    additionalProperties: false,
  },
  response: {
    201: {
      type: 'object',
      required: ['success', 'data', 'timestamp'],
      properties: {
        success: { type: 'boolean', enum: [true] },
        data: projectSchema,
        timestamp: { type: 'string', format: 'date-time' },
      },
    },
  },
} as const;

export const getProjectSchema = {
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
        data: projectSchema,
        timestamp: { type: 'string', format: 'date-time' },
      },
    },
  },
} as const;

export const updateProjectSchema = {
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
      name: { type: 'string', minLength: 1, maxLength: 255 },
      settings: {
        type: 'object',
        additionalProperties: true,
        maxProperties: 100,
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
        data: projectSchema,
        timestamp: { type: 'string', format: 'date-time' },
      },
    },
  },
} as const;

export const deleteProjectSchema = {
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
