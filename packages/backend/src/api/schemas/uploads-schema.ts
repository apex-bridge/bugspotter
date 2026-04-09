/**
 * Upload API Schemas
 * Validation schemas for file upload endpoints
 */

export const VALID_FILE_TYPES = ['screenshot', 'replay'] as const;

export const confirmUploadSchema = {
  params: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'string', format: 'uuid' },
    },
  },
  body: {
    type: 'object',
    required: ['fileType'],
    properties: {
      fileType: { type: 'string', enum: VALID_FILE_TYPES },
    },
    additionalProperties: false,
  },
} as const;

export const bugReportIdParamsSchema = {
  params: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'string', format: 'uuid' },
    },
  },
} as const;
