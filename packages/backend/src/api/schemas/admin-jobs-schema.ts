/**
 * Admin Jobs API Schemas
 * Validation schemas for job management endpoints
 */

import { QUEUE_NAMES } from '../../queue/types.js';

export const retryJobsSchema = {
  body: {
    type: 'object',
    required: ['queueName', 'jobIds'],
    properties: {
      queueName: {
        type: 'string',
        enum: Object.values(QUEUE_NAMES),
        description: 'Queue name to retry jobs from',
      },
      jobIds: {
        type: 'array',
        items: { type: 'string' },
        minItems: 1,
        description: 'Array of job IDs to retry',
      },
    },
    additionalProperties: false,
  },
} as const;

export const cleanFailedJobsSchema = {
  querystring: {
    type: 'object',
    properties: {
      queueName: {
        type: 'string',
        enum: Object.values(QUEUE_NAMES),
        description: 'Specific queue to clean (optional, defaults to all queues)',
      },
      olderThan: {
        type: 'string',
        pattern: '^[0-9]+$',
        description:
          'Clean jobs older than this age in milliseconds (optional, e.g., 3600000 for 1 hour)',
      },
    },
    additionalProperties: false,
  },
} as const;
