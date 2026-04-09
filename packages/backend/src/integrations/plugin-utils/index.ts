/**
 * Plugin utilities - Shared helpers for custom ticket integrations
 *
 * This module provides reusable utilities for building custom ticket integrations
 * with platforms like Jira, GitHub, Linear, Azure DevOps, etc.
 *
 * @module plugin-utils
 */

// Authentication
export { buildAuthHeader } from './auth.js';
export type { AuthConfig } from './auth.js';

// HTTP utilities
export { makeApiRequest, parseResponse, buildUrl } from './http.js';
export type { HttpContext, ApiRequestConfig } from './http.js';

// Storage
export { getResourceUrls } from './storage.js';
export type { StorageContext, BugReportWithResources, ResourceUrls } from './storage.js';

// Metadata extraction
export { extractEnvironment, extractConsoleLogs, extractNetworkErrors } from './metadata.js';
export type { BugReportMetadata, Environment, ConsoleLog, NetworkError } from './metadata.js';

// Validation
export { validators, validateFields, createValidationResult } from './validation.js';
export type { Validator, FieldValidation, ValidationResult } from './validation.js';

// Error handling
export { ERROR_CODES, PluginError, createPluginError } from './errors.js';
export type { ErrorCode, PluginErrorDetails } from './errors.js';

// Retry logic
export { withRetry } from './retry.js';
export type { RetryOptions } from './retry.js';

// Jira ADF (Atlassian Document Format)
export {
  buildJiraAdfDescription,
  adfHeading,
  adfParagraph,
  adfLink,
  adfCodeBlock,
  adfBulletList,
} from './jira-adf.js';
export type { AdfNode, BugReportForAdf } from './jira-adf.js';
