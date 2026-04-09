/**
 * Path and filename utilities for storage layer
 * Handles sanitization and key building with comprehensive security
 *
 * Refactored following SOLID, DRY, and KISS principles:
 * - Single Responsibility: Each function has one clear purpose
 * - DRY: Extracted common patterns into reusable helpers
 * - KISS: Complex logic broken into simple, testable functions
 */

import path from 'path';
import { getLogger } from '../logger.js';

const logger = getLogger();

// ============================================================================
// CONSTANTS
// ============================================================================

// S3/MinIO limits
const MAX_S3_KEY_LENGTH = 1024;
const MAX_FILENAME_LENGTH = 255;
const MIN_FILENAME_LENGTH = 10; // Minimum length before truncating extensions
const MAX_EXTENSION_LENGTH = 10; // Maximum length for a single extension
const RANDOM_SUFFIX_LENGTH = 7; // Length of random string in generated names

// Safe characters for filenames (alphanumeric, dash, underscore, dot)
// More permissive than strict S3 spec but safer for cross-platform compatibility
const SAFE_FILENAME_CHARS = /[^a-zA-Z0-9._-]/g;

// Windows reserved names
const WINDOWS_RESERVED_NAMES = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;

// Security patterns
// eslint-disable-next-line no-control-regex -- Intentional: detect null bytes and control chars for security
const CONTROL_CHARS = /[\x00-\x1F\x7F]/g;
// eslint-disable-next-line no-control-regex -- Intentional: detect path traversal with control chars
const PATH_TRAVERSAL_PATTERN = /\.\.|\/\.|\\|[\x00-\x1F]/;
// eslint-disable-next-line no-control-regex -- Intentional: detect path traversal without slashes
const PATH_TRAVERSAL_NO_SLASH = /\.\.|\\|[\x00-\x1F]/;
const WINDOWS_DRIVE_PATTERN = /^[a-zA-Z]:[/\\]/;
const WHITESPACE_DOTS_ONLY = /^[\s.]+$/;
const LEADING_DOTS = /^\.+/;
const TRAILING_SPACES_DOTS = /[\s.]+$/;
const LEADING_TRAILING_DASHES_UNDERSCORES = /^[_-]+|[_-]+$/g;

// Valid storage types (whitelist)
export const DEFAULT_STORAGE_TYPES = ['screenshots', 'replays', 'attachments'] as const;
export type StorageType = (typeof DEFAULT_STORAGE_TYPES)[number];

// ============================================================================
// PRIVATE HELPER FUNCTIONS (Single Responsibility Principle)
// ============================================================================

/**
 * Remove null bytes and control characters from string
 */
function removeControlCharacters(str: string): string {
  return str.replace(CONTROL_CHARS, '');
}

/**
 * Safely decode URL-encoded strings, handling double encoding attacks
 */
function decodeUrlSafely(input: string, originalFilename: string): string {
  try {
    let decoded = decodeURIComponent(input);
    // Double decode to catch double-encoded attacks
    while (decoded !== input) {
      input = decoded;
      decoded = decodeURIComponent(input);
    }
    return input;
  } catch {
    // Invalid encoding, continue with original
    logger.warn('Invalid URL encoding detected in filename', { filename: originalFilename });
    return input;
  }
}

/**
 * Extract basename and normalize path separators
 * Defeats path traversal attacks (../, ./, etc.)
 */
function extractBasename(input: string): string {
  return path.basename(input.replace(/\\/g, '/'));
}

/**
 * Separate filename from extensions
 * Example: "file.tar.gz" → { name: "file", extensions: ["tar", "gz"] }
 */
function separateNameAndExtensions(input: string): { name: string; extensions: string[] } {
  const parts = input.split('.');
  return {
    name: parts[0],
    extensions: parts.slice(1),
  };
}

/**
 * Sanitize and validate extensions array
 */
function sanitizeExtensions(extensions: string[]): string[] {
  return extensions
    .filter((ext) => ext && ext.length > 0 && ext.length <= MAX_EXTENSION_LENGTH)
    .map((ext) => ext.replace(SAFE_FILENAME_CHARS, '_'))
    .filter((ext) => ext.length > 0);
}

/**
 * Handle Windows reserved names by adding underscore prefix
 */
function handleWindowsReservedName(name: string, originalFilename: string): string {
  if (WINDOWS_RESERVED_NAMES.test(name)) {
    logger.warn('Windows reserved name detected', {
      original: originalFilename,
      detected: name,
    });
    return '_' + name;
  }
  return name;
}

/**
 * Truncate filename while preserving extension if possible
 */
function truncateWithExtension(
  name: string,
  extensions: string[],
  maxLength: number,
  preserveExtension: boolean
): string {
  const ext = extensions.length > 0 ? '.' + extensions.join('.') : '';
  const fullName = name + ext;

  if (fullName.length <= maxLength) {
    return fullName;
  }

  if (!preserveExtension || !ext) {
    return fullName.substring(0, maxLength);
  }

  const availableSpace = maxLength - ext.length;
  return availableSpace > MIN_FILENAME_LENGTH
    ? name.substring(0, availableSpace) + ext
    : fullName.substring(0, maxLength);
}

/**
 * Generate a safe default filename with timestamp and random suffix
 */
function generateSafeName(): string {
  const random = Math.random()
    .toString(36)
    .substring(2, 2 + RANDOM_SUFFIX_LENGTH);
  return `unnamed_${Date.now()}_${random}`;
}

/**
 * Generic ID validator - DRY principle for validateProjectId/validateBugId
 */
function validateId(
  id: string,
  idType: 'project' | 'bug',
  options: { strict?: boolean } = {}
): string {
  const { strict = false } = options;
  const typeName = idType.charAt(0).toUpperCase() + idType.slice(1);

  if (!id || typeof id !== 'string') {
    throw new Error(`${typeName} ID is required`);
  }

  const trimmed = id.trim();

  // Remove any path traversal or dangerous characters
  const sanitized = trimmed.replace(/[./\\]/g, '-');

  if (sanitized !== trimmed) {
    logger.warn(`${typeName} ID contained dangerous characters`, {
      [`${idType}Id`]: id,
      sanitized,
    });
  }

  if (!isValidUUID(sanitized)) {
    if (strict) {
      logger.warn(`Invalid ${idType} ID format (strict mode)`, { [`${idType}Id`]: sanitized });
      throw new Error(`Invalid ${idType} ID: must be a valid UUID`);
    }
    logger.debug(`${typeName} ID is not a UUID, using as-is`, { [`${idType}Id`]: sanitized });
  }

  return sanitized.toLowerCase();
}

/**
 * Validate a storage key path component for security issues
 * DRY helper for buildStorageKey validation
 */
function validatePathComponent(value: string, componentName: string, pattern: RegExp): void {
  if (pattern.test(value)) {
    logger.warn(`Path traversal detected in ${componentName}`, { [componentName]: value });
    throw new Error(`Invalid characters in ${componentName}`);
  }
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Sanitize a filename to prevent security issues and ensure compatibility
 *
 * Security features:
 * - Prevents path traversal (../, ./, URL encoded variants)
 * - Blocks null bytes and control characters
 * - Rejects absolute paths
 * - Handles double encoding attacks
 * - Validates against Windows reserved names
 * - Enforces S3/MinIO compatibility
 * - Preserves file extensions correctly
 * - Generates safe defaults for invalid inputs
 *
 * @param filename - Original filename from user input
 * @param options - Optional configuration
 * @returns Sanitized filename safe for storage
 *
 * @example
 * sanitizeFilename('../../../etc/passwd') // => 'passwd'
 * sanitizeFilename('my file.txt') // => 'my_file.txt'
 * sanitizeFilename('') // => 'unnamed_1234567890'
 * sanitizeFilename('CON.txt') // => '_CON.txt'
 */
export function sanitizeFilename(
  filename: string,
  options: { preserveExtension?: boolean; maxLength?: number } = {}
): string {
  const { preserveExtension = true, maxLength = MAX_FILENAME_LENGTH } = options;

  if (!filename || typeof filename !== 'string') {
    return generateSafeName();
  }

  const originalFilename = filename;

  // Step 1: Decode and clean
  let sanitized = decodeUrlSafely(filename, originalFilename);
  sanitized = removeControlCharacters(sanitized);

  // Step 2: Handle absolute paths
  if (path.isAbsolute(sanitized) || WINDOWS_DRIVE_PATTERN.test(sanitized)) {
    logger.warn('Absolute path detected in filename', { original: originalFilename });
    sanitized = path.basename(sanitized);
  }

  // Step 3: Extract basename (defeats path traversal)
  sanitized = extractBasename(sanitized);

  // Step 4: Early exit for invalid names
  if (!sanitized || WHITESPACE_DOTS_ONLY.test(sanitized)) {
    return generateSafeName();
  }

  // Step 5: Remove leading dots and trailing spaces/dots
  sanitized = sanitized.replace(LEADING_DOTS, '').replace(TRAILING_SPACES_DOTS, '');

  if (!sanitized) {
    return generateSafeName();
  }

  // Step 6: Separate and clean name/extensions
  const { name, extensions } = separateNameAndExtensions(sanitized);
  let cleanName = name
    .replace(SAFE_FILENAME_CHARS, '_')
    .replace(LEADING_TRAILING_DASHES_UNDERSCORES, '');

  if (!cleanName) {
    return generateSafeName();
  }

  // Step 7: Handle Windows reserved names
  cleanName = handleWindowsReservedName(cleanName, originalFilename);

  // Step 8: Sanitize extensions
  const safeExtensions = preserveExtension ? sanitizeExtensions(extensions) : [];

  // Step 9: Enforce length limit
  let result = truncateWithExtension(cleanName, safeExtensions, maxLength, preserveExtension);

  // Step 10: Final cleanup
  result = result.replace(TRAILING_SPACES_DOTS, '');

  if (!result) {
    return generateSafeName();
  }

  // Log if significant sanitization occurred
  if (result !== originalFilename) {
    logger.debug('Filename sanitized', { original: originalFilename, sanitized: result });
  }

  return result;
}

/**
 * Sanitize and validate a complete S3 key path
 * Ensures the full path meets S3/MinIO requirements
 *
 * @param key - Complete S3 key (e.g., "attachments/proj-1/bug-123/file.txt")
 * @returns Sanitized S3 key
 */
export function sanitizeS3Key(key: string): string {
  if (!key || typeof key !== 'string') {
    throw new Error('Invalid S3 key: must be a non-empty string');
  }

  // Remove leading/trailing slashes
  let sanitized = key.trim().replace(/^\/+|\/+$/g, '');

  // Remove null bytes and control characters (DRY - use existing helper)
  sanitized = removeControlCharacters(sanitized);

  // Normalize multiple slashes to single slash
  sanitized = sanitized.replace(/\/+/g, '/');

  // Validate no path traversal sequences (consistent with buildStorageKey validation)
  if (PATH_TRAVERSAL_PATTERN.test(sanitized)) {
    logger.warn('Path traversal detected in S3 key', { key, sanitized });
    throw new Error('S3 key contains path traversal sequences');
  }

  // Check length
  if (sanitized.length > MAX_S3_KEY_LENGTH) {
    logger.warn('S3 key exceeds maximum length', {
      original: key,
      length: sanitized.length,
      maxLength: MAX_S3_KEY_LENGTH,
    });
    throw new Error(`S3 key too long: ${sanitized.length} > ${MAX_S3_KEY_LENGTH}`);
  }

  // Validate no empty segments
  const segments = sanitized.split('/');
  if (segments.some((seg) => !seg || seg.trim().length === 0)) {
    throw new Error('S3 key contains empty segments');
  }

  return sanitized;
}

/**
 * Validate if a string is a valid UUID v4
 *
 * @param id - String to validate
 * @returns True if valid UUID v4
 */
export function isValidUUID(id: string): boolean {
  if (!id || typeof id !== 'string') {
    return false;
  }

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(id);
}

/**
 * Validate and sanitize project ID
 * Project IDs should be UUIDs but non-UUID strings are allowed with warning
 *
 * @param projectId - Project identifier
 * @param options - Validation options
 * @returns Validated project ID
 * @throws Error if invalid
 */
export function validateProjectId(projectId: string, options: { strict?: boolean } = {}): string {
  return validateId(projectId, 'project', options);
}

/**
 * Validate and sanitize bug report ID
 * Bug IDs should be UUIDs but non-UUID strings are allowed with warning
 *
 * @param bugId - Bug report identifier
 * @param options - Validation options
 * @returns Validated bug ID
 * @throws Error if invalid
 */
export function validateBugId(bugId: string, options: { strict?: boolean } = {}): string {
  return validateId(bugId, 'bug', options);
}

/**
 * Build a standardized storage key path
 * Format: {type}/{projectId}/{bugId}/{filename}
 *
 * Security: All inputs are validated to prevent path traversal and injection attacks
 *
 * @param type - Resource type (screenshots, replays, attachments)
 * @param projectId - Project identifier (should be pre-validated)
 * @param bugId - Bug report identifier (should be pre-validated)
 * @param filename - File name (should be pre-sanitized)
 * @returns Standardized storage key
 * @throws Error if any input is invalid
 *
 * @example
 * buildStorageKey('screenshots', 'proj-1', 'bug-123', 'original.png')
 * // => 'screenshots/proj-1/bug-123/original.png'
 */
export function buildStorageKey(
  type: string,
  projectId: string,
  bugId: string,
  filename: string
): string {
  // Validate all inputs are provided
  if (!type || !projectId || !bugId || !filename) {
    throw new Error('All parameters are required for buildStorageKey');
  }

  // Validate type - only allow specific resource types (whitelist approach)
  if (!(DEFAULT_STORAGE_TYPES as readonly string[]).includes(type)) {
    logger.warn('Invalid storage type provided', { type });
    throw new Error(`Invalid storage type: ${type}`);
  }

  // Validate no path traversal sequences in each component (DRY)
  validatePathComponent(type, 'storage type', PATH_TRAVERSAL_PATTERN);
  validatePathComponent(projectId, 'project ID', PATH_TRAVERSAL_PATTERN);
  validatePathComponent(bugId, 'bug ID', PATH_TRAVERSAL_PATTERN);

  // Filename can contain slashes for subdirectories (e.g., chunks/0.json.gz)
  // So use pattern without slash checking
  validatePathComponent(filename, 'filename', PATH_TRAVERSAL_NO_SLASH);

  // Build and validate the complete key
  const key = `${type}/${projectId}/${bugId}/${filename}`;

  // Final validation with sanitizeS3Key
  return sanitizeS3Key(key);
}
