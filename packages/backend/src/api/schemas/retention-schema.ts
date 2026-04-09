/**
 * Retention API Schemas
 * Validation schemas for retention policy endpoints
 */

export const projectIdParamsSchema = {
  params: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'string', format: 'uuid' },
    },
  },
} as const;

export const retentionPreviewSchema = {
  querystring: {
    type: 'object',
    properties: {
      projectId: { type: 'string', format: 'uuid' },
    },
  },
} as const;
