/**
 * User Management Schemas
 * Fastify JSON schemas for user endpoints validation
 */

import { paginationResponseSchema } from './common-schema.js';

export const listUsersSchema = {
  querystring: {
    type: 'object',
    properties: {
      page: { type: 'number', minimum: 1 },
      limit: { type: 'number', minimum: 1, maximum: 100 },
      role: { type: 'string', enum: ['admin', 'user', 'viewer'] },
      email: { type: 'string', maxLength: 255 },
    },
    additionalProperties: false,
  },
  response: {
    200: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        data: {
          type: 'object',
          properties: {
            users: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string', format: 'uuid' },
                  email: { type: 'string', format: 'email' },
                  name: { type: 'string' },
                  role: { type: 'string', enum: ['admin', 'user', 'viewer'] },
                  oauth_provider: { type: ['string', 'null'] },
                  oauth_id: { type: ['string', 'null'] },
                  created_at: { type: 'string', format: 'date-time' },
                  updated_at: { type: 'string', format: 'date-time' },
                },
              },
            },
            pagination: paginationResponseSchema,
          },
        },
      },
    },
  },
};

export const createUserSchema = {
  body: {
    type: 'object',
    required: ['email', 'name', 'role'],
    properties: {
      email: { type: 'string', format: 'email', maxLength: 255 },
      name: { type: 'string', minLength: 1, maxLength: 255 },
      password: { type: 'string', minLength: 8, maxLength: 128 },
      role: { type: 'string', enum: ['admin', 'user', 'viewer'] },
      oauth_provider: { type: 'string', maxLength: 50 },
      oauth_id: { type: 'string', maxLength: 255 },
    },
    // Note: Either 'password' OR ('oauth_provider' AND 'oauth_id') must be provided
    // This matches the database constraint: check_auth_method
    anyOf: [{ required: ['password'] }, { required: ['oauth_provider', 'oauth_id'] }],
    additionalProperties: false,
  },
  response: {
    201: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        data: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            email: { type: 'string', format: 'email' },
            name: { type: 'string' },
            role: { type: 'string', enum: ['admin', 'user', 'viewer'] },
            oauth_provider: { type: ['string', 'null'] },
            oauth_id: { type: ['string', 'null'] },
            created_at: { type: 'string', format: 'date-time' },
            updated_at: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
  },
};

export const updateUserSchema = {
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
      email: { type: 'string', format: 'email', maxLength: 255 },
      role: { type: 'string', enum: ['admin', 'user', 'viewer'] },
    },
    additionalProperties: false,
  },
  response: {
    200: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        data: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            email: { type: 'string', format: 'email' },
            name: { type: 'string' },
            role: { type: 'string', enum: ['admin', 'user', 'viewer'] },
            oauth_provider: { type: ['string', 'null'] },
            oauth_id: { type: ['string', 'null'] },
            created_at: { type: 'string', format: 'date-time' },
            updated_at: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
  },
};

export const deleteUserSchema = {
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
      properties: {
        success: { type: 'boolean' },
        message: { type: 'string' },
      },
    },
  },
};

/**
 * User preferences schema
 * Validates only allowed preference keys and their values
 * Allowed preferences:
 * - language: 'en' | 'ru' | 'kk' (supported UI languages)
 * - theme: 'light' | 'dark' | 'system' (future theme preference)
 */
export const updateUserPreferencesSchema = {
  body: {
    type: 'object',
    additionalProperties: false, // Reject unknown keys
    properties: {
      language: {
        type: 'string',
        enum: ['en', 'ru', 'kk'],
        description: 'UI language preference',
      },
      theme: {
        type: 'string',
        enum: ['light', 'dark', 'system'],
        description: 'Theme preference',
      },
    },
    // At least one preference must be provided
    minProperties: 1,
  },
  response: {
    200: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        data: {
          type: 'object',
          properties: {
            language: { type: 'string' },
            theme: { type: 'string' },
          },
          additionalProperties: false,
        },
      },
    },
  },
};

export const getUserPreferencesSchema = {
  response: {
    200: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        data: {
          type: 'object',
          properties: {
            language: { type: 'string' },
            theme: { type: 'string' },
          },
          additionalProperties: false,
        },
      },
    },
  },
};
