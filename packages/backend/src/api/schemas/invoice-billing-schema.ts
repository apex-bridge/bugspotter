/**
 * Invoice billing request/response schemas for Fastify validation.
 */

import { successResponseSchema, idParamSchema } from './common-schema.js';

export const listInvoicesSchema = {
  querystring: {
    type: 'object',
    properties: {
      page: { type: 'integer', minimum: 1, default: 1 },
      limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
    },
  },
  response: { 200: successResponseSchema },
} as const;

export const getInvoiceSchema = {
  params: idParamSchema,
  response: { 200: successResponseSchema },
} as const;

export const getInvoicePdfSchema = {
  params: idParamSchema,
} as const;

export const markInvoicePaidSchema = {
  params: idParamSchema,
  response: { 200: successResponseSchema },
} as const;

export const getLegalDetailsSchema = {
  response: { 200: successResponseSchema },
} as const;

export const saveLegalDetailsSchema = {
  body: {
    type: 'object',
    required: ['company_name', 'details'],
    properties: {
      company_name: { type: 'string', minLength: 1, maxLength: 500 },
      details: { type: 'object', additionalProperties: true },
    },
    additionalProperties: false,
  },
  response: { 200: successResponseSchema },
} as const;

export const getActPdfSchema = {
  params: idParamSchema,
} as const;
