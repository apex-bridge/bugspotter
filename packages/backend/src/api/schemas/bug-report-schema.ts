/**
 * Bug Report schemas for request/response validation
 */

import { paginationSchema, paginationResponseSchema, sortOrderSchema } from './common-schema.js';

// Re-export constants from @bugspotter/types for backward compatibility
export { BugStatus, BugPriority } from '@bugspotter/types';

export const bugStatusEnum = ['open', 'in-progress', 'resolved', 'closed'] as const;
export const bugPriorityEnum = ['low', 'medium', 'high', 'critical'] as const;

export const bugReportSchema = {
  type: 'object',
  required: ['id', 'project_id', 'title', 'status', 'priority', 'created_at', 'updated_at'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    project_id: { type: 'string', format: 'uuid' },
    title: { type: 'string' },
    description: { type: 'string', nullable: true },
    screenshot_url: { type: 'string', nullable: true },
    replay_url: { type: 'string', nullable: true },
    screenshot_key: { type: 'string', nullable: true },
    replay_key: { type: 'string', nullable: true },
    upload_status: {
      type: 'string',
      enum: ['none', 'pending', 'complete', 'failed'],
      nullable: true,
    },
    replay_upload_status: {
      type: 'string',
      enum: ['none', 'pending', 'complete', 'failed'],
      nullable: true,
    },
    metadata: { type: 'object', additionalProperties: true },
    status: { type: 'string', enum: bugStatusEnum },
    priority: { type: 'string', enum: bugPriorityEnum },
    duplicate_of: { type: 'string', format: 'uuid', nullable: true },
    created_at: { type: 'string', format: 'date-time' },
    updated_at: { type: 'string', format: 'date-time' },
  },
} as const;

export const createBugReportSchema = {
  body: {
    type: 'object',
    required: ['title', 'report'],
    properties: {
      project_id: { type: 'string', format: 'uuid' },
      title: { type: 'string', minLength: 1, maxLength: 500 },
      description: { type: 'string', maxLength: 5000 },
      priority: { type: 'string', enum: bugPriorityEnum, default: 'medium' },
      report: {
        type: 'object',
        required: ['console', 'network', 'metadata'],
        properties: {
          console: {
            type: 'array',
            maxItems: 1000,
            items: { type: 'object', additionalProperties: true },
          },
          network: {
            type: 'array',
            maxItems: 500,
            items: { type: 'object', additionalProperties: true },
          },
          metadata: {
            type: 'object',
            additionalProperties: true,
            maxProperties: 50,
          },
        },
      },
      // Report source (extension, sdk, or api)
      source: { type: 'string', enum: ['extension', 'sdk', 'api'] },
      // Flags to request presigned URLs for file uploads
      hasScreenshot: { type: 'boolean', default: false },
      hasReplay: { type: 'boolean', default: false },
    },
    additionalProperties: false,
  },
  response: {
    201: {
      type: 'object',
      required: ['success', 'data', 'timestamp'],
      properties: {
        success: { type: 'boolean', enum: [true] },
        data: {
          type: 'object',
          properties: {
            ...bugReportSchema.properties,
            presignedUrls: {
              type: 'object',
              properties: {
                screenshot: {
                  type: 'object',
                  properties: {
                    uploadUrl: { type: 'string' },
                    storageKey: { type: 'string' },
                  },
                },
                replay: {
                  type: 'object',
                  properties: {
                    uploadUrl: { type: 'string' },
                    storageKey: { type: 'string' },
                  },
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

export const listBugReportsSchema = {
  querystring: {
    type: 'object',
    properties: {
      ...paginationSchema.properties,
      status: { type: 'string', enum: bugStatusEnum },
      priority: { type: 'string', enum: bugPriorityEnum },
      project_id: { type: 'string', format: 'uuid' },
      created_after: { type: 'string', format: 'date' },
      created_before: { type: 'string', format: 'date' },
      sort_by: {
        type: 'string',
        enum: ['created_at', 'updated_at', 'priority'],
        default: 'created_at',
      },
      order: sortOrderSchema,
    },
    additionalProperties: false,
  },
  response: {
    200: {
      type: 'object',
      required: ['success', 'data', 'pagination', 'timestamp'],
      properties: {
        success: { type: 'boolean', enum: [true] },
        data: {
          type: 'array',
          items: bugReportSchema,
        },
        pagination: paginationResponseSchema,
        timestamp: { type: 'string', format: 'date-time' },
      },
    },
  },
} as const;

export const getBugReportSchema = {
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
        data: bugReportSchema,
        timestamp: { type: 'string', format: 'date-time' },
      },
    },
  },
} as const;

export const deleteBugReportSchema = {
  params: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'string', format: 'uuid' },
    },
  },
  response: {
    204: { type: 'null', description: 'Report deleted' },
  },
} as const;

export const bulkDeleteBugReportsSchema = {
  body: {
    type: 'object',
    required: ['ids'],
    properties: {
      ids: {
        type: 'array',
        items: { type: 'string', format: 'uuid' },
        minItems: 1,
        maxItems: 100,
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
          required: ['deleted'],
          properties: {
            deleted: { type: 'integer', minimum: 0 },
          },
        },
        timestamp: { type: 'string', format: 'date-time' },
      },
    },
  },
} as const;

export const updateBugReportSchema = {
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
      status: { type: 'string', enum: bugStatusEnum },
      priority: { type: 'string', enum: bugPriorityEnum },
      description: { type: 'string', maxLength: 5000 },
      resolution_notes: { type: 'string', maxLength: 5000 },
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
        data: bugReportSchema,
        timestamp: { type: 'string', format: 'date-time' },
      },
    },
  },
} as const;
