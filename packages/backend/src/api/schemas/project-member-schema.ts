/**
 * Project Member management schemas for request/response validation
 * Handles project access control and member management
 */

import { idParamSchema } from './common-schema.js';

/**
 * Project member base schema (response format)
 */
export const projectMemberSchema = {
  type: 'object',
  required: ['id', 'project_id', 'user_id', 'role', 'created_at'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    project_id: { type: 'string', format: 'uuid' },
    user_id: { type: 'string', format: 'uuid' },
    role: {
      type: 'string',
      enum: ['owner', 'admin', 'member', 'viewer'],
    },
    created_at: { type: 'string', format: 'date-time' },
  },
} as const;

/**
 * Project member with user details (joined response)
 */
export const projectMemberWithUserSchema = {
  type: 'object',
  required: ['id', 'project_id', 'user_id', 'role', 'created_at', 'user_email', 'user_name'],
  properties: {
    ...projectMemberSchema.properties,
    user_email: { type: 'string', format: 'email' },
    user_name: { type: ['string', 'null'] },
  },
} as const;

/**
 * List project members
 * GET /api/v1/projects/:id/members
 */
export const listProjectMembersSchema = {
  params: idParamSchema,
  response: {
    200: {
      type: 'object',
      required: ['success', 'data'],
      properties: {
        success: { type: 'boolean' },
        data: {
          type: 'array',
          items: projectMemberWithUserSchema,
        },
      },
    },
  },
} as const;

/**
 * Add member to project
 * POST /api/v1/projects/:id/members
 */
export const addProjectMemberSchema = {
  params: idParamSchema,
  body: {
    type: 'object',
    required: ['user_id', 'role'],
    properties: {
      user_id: { type: 'string', format: 'uuid' },
      role: {
        type: 'string',
        enum: ['admin', 'member', 'viewer'],
        description: 'Cannot assign owner role via this endpoint',
      },
    },
    additionalProperties: false,
  },
  response: {
    201: {
      type: 'object',
      required: ['success', 'data'],
      properties: {
        success: { type: 'boolean' },
        data: projectMemberSchema,
      },
    },
  },
} as const;

/**
 * Update project member role
 * PATCH /api/v1/projects/:id/members/:userId
 */
export const updateProjectMemberSchema = {
  params: {
    type: 'object',
    required: ['id', 'userId'],
    properties: {
      id: { type: 'string', format: 'uuid' },
      userId: { type: 'string', format: 'uuid' },
    },
  },
  body: {
    type: 'object',
    required: ['role'],
    properties: {
      role: {
        type: 'string',
        enum: ['admin', 'member', 'viewer'],
        description: 'Cannot change to/from owner role via this endpoint',
      },
    },
    additionalProperties: false,
  },
  response: {
    200: {
      type: 'object',
      required: ['success', 'data'],
      properties: {
        success: { type: 'boolean' },
        data: projectMemberSchema,
      },
    },
  },
} as const;

/**
 * Remove member from project
 * DELETE /api/v1/projects/:id/members/:userId
 */
export const removeProjectMemberSchema = {
  params: {
    type: 'object',
    required: ['id', 'userId'],
    properties: {
      id: { type: 'string', format: 'uuid' },
      userId: { type: 'string', format: 'uuid' },
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

/**
 * Get user's projects
 * GET /api/v1/admin/users/:id/projects
 */
export const getUserProjectsSchema = {
  params: idParamSchema,
  response: {
    200: {
      type: 'object',
      required: ['success', 'data'],
      properties: {
        success: { type: 'boolean' },
        data: {
          type: 'array',
          items: {
            type: 'object',
            required: ['id', 'name', 'role', 'created_at'],
            properties: {
              id: { type: 'string', format: 'uuid' },
              name: { type: 'string' },
              role: {
                type: 'string',
                enum: ['owner', 'admin', 'member', 'viewer'],
              },
              created_at: { type: 'string', format: 'date-time' },
            },
          },
        },
      },
    },
  },
} as const;
