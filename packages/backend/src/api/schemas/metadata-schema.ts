/**
 * Metadata Validation Schemas
 * Zod schemas for validating bug report metadata structure
 */

import { z } from 'zod';

/**
 * Console log entry schema
 */
export const consoleLogEntrySchema = z.object({
  level: z.enum(['log', 'info', 'warn', 'error', 'debug']),
  message: z.string(),
  timestamp: z.number(),
  args: z.array(z.unknown()).optional(),
});

/**
 * Network request entry schema
 */
export const networkRequestEntrySchema = z.object({
  url: z.string(),
  method: z.string(),
  status: z.number(),
  statusText: z.string().optional(),
  duration: z.number().optional(),
  timestamp: z.number(),
  headers: z.record(z.string()).optional(),
  body: z.string().optional(),
});

/**
 * Browser metadata schema
 */
export const browserMetadataSchema = z.object({
  userAgent: z.string(),
  viewport: z.object({
    width: z.number(),
    height: z.number(),
  }),
  url: z.string(),
  timestamp: z.number(),
  platform: z.string().optional(),
  language: z.string().optional(),
  screen: z
    .object({
      width: z.number(),
      height: z.number(),
    })
    .optional(),
  timezone: z.string().optional(),
});

/**
 * Complete bug report metadata schema
 */
export const bugReportMetadataSchema = z.object({
  console: z.array(consoleLogEntrySchema).optional(),
  network: z.array(networkRequestEntrySchema).optional(),
  metadata: browserMetadataSchema.optional(),
});

/**
 * Type exports
 */
export type ConsoleLogEntry = z.infer<typeof consoleLogEntrySchema>;
export type NetworkRequestEntry = z.infer<typeof networkRequestEntrySchema>;
export type BrowserMetadata = z.infer<typeof browserMetadataSchema>;
export type BugReportMetadata = z.infer<typeof bugReportMetadataSchema>;
