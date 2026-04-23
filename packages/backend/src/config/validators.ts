/**
 * Configuration validation utilities
 * Extracted for better Single Responsibility Principle compliance
 */

import { getLogger } from '../logger.js';
import type { StorageBackend } from './types.js';

// ============================================================================
// CONSTANTS
// ============================================================================

export const MIN_JWT_SECRET_LENGTH = 32;
export const MIN_FRONTEND_URL_LENGTH = 10; // http://x.x minimum
export const MIN_PORT = 1;
export const MAX_PORT = 65535;
export const MIN_TIMEOUT_MS = 1000;
export const MIN_RATE_LIMIT_WINDOW_MS = 1000;

export const MIN_S3_ACCESS_KEY_LENGTH = 16;
export const MIN_S3_SECRET_KEY_LENGTH = 32;
export const MAX_S3_BUCKET_NAME_LENGTH = 63;
export const MIN_S3_BUCKET_NAME_LENGTH = 3;

export const VALID_S3_BUCKET_PATTERN = /^[a-z0-9][a-z0-9.-]*[a-z0-9]$/;
export const INVALID_S3_BUCKET_PATTERNS = [
  /\.\./, // No consecutive periods
  /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/, // No IP address format
];

export const VALID_AWS_REGIONS = [
  'us-east-1',
  'us-east-2',
  'us-west-1',
  'us-west-2',
  'af-south-1',
  'ap-east-1',
  'ap-south-1',
  'ap-northeast-1',
  'ap-northeast-2',
  'ap-northeast-3',
  'ap-southeast-1',
  'ap-southeast-2',
  'ap-southeast-3',
  'ca-central-1',
  'eu-central-1',
  'eu-west-1',
  'eu-west-2',
  'eu-west-3',
  'eu-south-1',
  'eu-north-1',
  'me-south-1',
  'sa-east-1',
];

// ============================================================================
// HELPER VALIDATORS
// ============================================================================

/**
 * Validate a numeric config value
 * @returns Error message if validation fails, null otherwise
 */
export function validateNumber(
  value: number,
  name: string,
  min?: number,
  max?: number
): string | null {
  if (Number.isNaN(value)) {
    return `${name} must be a valid number`;
  }
  if (min !== undefined && value < min) {
    return `${name} must be at least ${min}`;
  }
  if (max !== undefined && value > max) {
    return `${name} must be at most ${max}`;
  }
  return null;
}

/**
 * Validate string length
 * @returns Error message if validation fails, null otherwise
 */
function validateStringLength(
  value: string | undefined,
  name: string,
  minLength: number,
  context?: string
): string | null {
  if (!value) {
    return null;
  }

  if (value.length < minLength) {
    const suffix = context ? ` ${context}` : ' for security';
    return `${name} must be at least ${minLength} characters${suffix}`;
  }

  return null;
}

/**
 * Check if value is required in production environment
 */
function requireInProduction(value: string | undefined, name: string, env: string): string | null {
  if (!value && env === 'production') {
    return `${name} is required in production`;
  }
  return null;
}

/**
 * Check if value meets requirement or return error
 */
function checkRequirement(condition: boolean, errorMessage: string): string | null {
  return condition ? null : errorMessage;
}

// ============================================================================
// ASSERTION VALIDATORS (Throw-Based Runtime Validation)
// ============================================================================

/**
 * Assert value is non-negative (>= 0)
 * @throws Error if value is negative
 */
export function assertNonNegative(value: number, name: string): void {
  if (value < 0) {
    throw new Error(`${name} must be >= 0 (got ${value})`);
  }
}

/**
 * Assert value is positive (> 0)
 * @throws Error if value is zero or negative
 */
export function assertPositive(value: number, name: string): void {
  if (value <= 0) {
    throw new Error(`${name} must be > 0 (got ${value})`);
  }
}

/**
 * Assert value is within range [min, max]
 * @throws Error if value is outside range
 */
export function assertRange(value: number, name: string, min: number, max: number): void {
  if (value < min || value > max) {
    throw new Error(`${name} must be between ${min} and ${max} (got ${value})`);
  }
}

/**
 * Assert value meets minimum threshold
 * @throws Error if value is below minimum
 */
export function assertMinimum(value: number, name: string, min: number): void {
  if (value < min) {
    throw new Error(`${name} must be >= ${min} (got ${value})`);
  }
}

// ============================================================================
// ENVIRONMENT VARIABLE PARSERS
// ============================================================================

/**
 * Parse boolean from environment variable
 * Returns true if 'true', false if 'false', undefined otherwise
 * Use with nullish coalescing for fallback logic: parseBooleanEnv(env) ?? defaultValue
 */
export function parseBooleanEnv(value: string | undefined): boolean | undefined {
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  return undefined;
}

/**
 * Parse Fastify's `trustProxy` config from the `TRUST_PROXY` env.
 *
 * Accepts:
 *   - `true` / `false` — trust all hops / trust none
 *   - `<non-negative integer>` — trust the last N hops in XFF
 *     (e.g. `1` for "single trusted reverse-proxy in front")
 *   - unset / empty — default `true` (safe for dev where no XFF is
 *     present; correct in prod behind a header-sanitizing proxy)
 *
 * `<CIDR list>` and arbitrary strings are not accepted here — add if
 * a deployment needs it. Fastify supports them in principle.
 */
export function parseTrustProxy(value: string | undefined): boolean | number {
  if (value === undefined || value === '') {
    return true;
  }
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  const n = Number(value);
  if (Number.isInteger(n) && n >= 0) {
    return n;
  }
  throw new Error(
    `Invalid TRUST_PROXY: "${value}". Expected "true", "false", or a non-negative integer (hop count).`
  );
}

// ============================================================================
// HOSTNAME VALIDATORS (Network Security)
// ============================================================================

/**
 * Check if hostname is localhost variation
 */
function isLocalhost(hostname: string): boolean {
  return hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local');
}

/**
 * Check if hostname is loopback address (IPv4 or IPv6)
 */
function isLoopback(hostname: string): boolean {
  return (
    hostname === '127.0.0.1' ||
    hostname.startsWith('127.') ||
    hostname === '::1' ||
    hostname === '[::1]'
  );
}

/**
 * Check if IPv4 address is in private range (RFC 1918)
 */
function isPrivateIPv4(hostname: string): boolean {
  const ipParts = hostname.split('.');
  if (ipParts.length !== 4 || !ipParts.every((part) => /^\d+$/.test(part))) {
    return false;
  }

  const octets = ipParts.map(Number);
  return (
    octets[0] === 10 || // 10.0.0.0/8
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) || // 172.16.0.0/12
    (octets[0] === 192 && octets[1] === 168) || // 192.168.0.0/16
    (octets[0] === 169 && octets[1] === 254) // 169.254.0.0/16 (link-local)
  );
}

/**
 * Validate hostname is not internal/local in production
 */
function validateProductionHostname(hostname: string, fieldName: string): string[] {
  const errors: string[] = [];

  if (isLocalhost(hostname)) {
    errors.push(`${fieldName} cannot use localhost domains in production`);
  }

  if (isLoopback(hostname)) {
    errors.push(`${fieldName} cannot use loopback addresses in production`);
  }

  if (isPrivateIPv4(hostname)) {
    errors.push(`${fieldName} cannot use private IP addresses in production (${hostname})`);
  }

  return errors;
}

// ============================================================================
// DATABASE VALIDATORS
// ============================================================================

/**
 * Validate frontend URL configuration
 * @returns Array of error messages (empty if valid)
 */
export function validateFrontendUrl(url: string, env: string): string[] {
  const errors: string[] = [];

  // Required in production
  const prodError = requireInProduction(url, 'FRONTEND_URL', env);
  if (prodError) {
    errors.push(prodError);
    return errors; // Early return if missing in production
  }

  // If provided, validate format
  if (url) {
    // Check minimum length
    const lengthError = validateStringLength(
      url,
      'FRONTEND_URL',
      MIN_FRONTEND_URL_LENGTH,
      '(must be a valid URL)'
    );
    if (lengthError) {
      errors.push(lengthError);
    }

    // Check URL format
    try {
      const parsedUrl = new URL(url);

      // Must be http or https
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        errors.push('FRONTEND_URL must use http or https protocol');
      }

      // Log warning if http in production (don't block startup)
      if (parsedUrl.protocol === 'http:' && env === 'production') {
        const logger = getLogger();
        logger.warn('FRONTEND_URL uses http in production — switch to https after SSL setup');
      }
    } catch {
      errors.push('FRONTEND_URL must be a valid URL');
    }
  }

  return errors;
}

// ============================================================================
// DATABASE VALIDATORS
// ============================================================================

export function validateDatabaseUrl(url: string): string[] {
  const errors: string[] = [];

  if (!url) {
    errors.push('DATABASE_URL is required');
  } else if (!url.startsWith('postgres://') && !url.startsWith('postgresql://')) {
    errors.push(
      'DATABASE_URL must be a valid PostgreSQL connection string (postgres:// or postgresql://)'
    );
  }

  return errors;
}

export function validateDatabasePoolConfig(poolMin: number, poolMax: number): string[] {
  const errors: string[] = [];

  if (poolMin > poolMax) {
    errors.push('DB_POOL_MIN cannot be greater than DB_POOL_MAX');
  }

  return errors;
}

// ============================================================================
// JWT VALIDATORS
// ============================================================================

export function validateJwtSecret(secret: string, env: string): string[] {
  const errors: string[] = [];

  const requiredError = requireInProduction(secret, 'JWT_SECRET', env);
  if (requiredError) {
    errors.push(requiredError);
  }

  const lengthError = validateStringLength(secret, 'JWT_SECRET', MIN_JWT_SECRET_LENGTH);
  if (lengthError) {
    errors.push(lengthError);
  }

  return errors;
}

// ============================================================================
// S3 VALIDATORS
// ============================================================================

export function validateS3Credentials(
  accessKeyId: string | undefined,
  secretAccessKey: string | undefined,
  backend?: StorageBackend,
  endpoint?: string
): string[] {
  const errors: string[] = [];

  // Both credentials must be provided together or both omitted
  const hasAccessKey = accessKeyId !== undefined;
  const hasSecretKey = secretAccessKey !== undefined;

  const bothRequiredError = checkRequirement(
    hasAccessKey === hasSecretKey,
    'S3_ACCESS_KEY and S3_SECRET_KEY must both be provided or both omitted'
  );
  if (bothRequiredError) {
    errors.push(bothRequiredError);
  }

  // Validate access key length
  const accessKeyError = validateStringLength(
    accessKeyId,
    'S3_ACCESS_KEY',
    MIN_S3_ACCESS_KEY_LENGTH
  );
  if (accessKeyError) {
    errors.push(accessKeyError);
  }

  // Validate secret key length
  // AWS S3 (backend='s3' without custom endpoint) requires 32 chars
  // S3-compatible services (with custom endpoint) accept 16+ chars
  if (secretAccessKey) {
    const isAwsS3 = backend === 's3' && !endpoint;
    const minLength = isAwsS3 ? MIN_S3_SECRET_KEY_LENGTH : MIN_S3_ACCESS_KEY_LENGTH;
    const context = isAwsS3 ? 'for AWS S3' : 'for security';

    const secretKeyError = validateStringLength(
      secretAccessKey,
      'S3_SECRET_KEY',
      minLength,
      context
    );
    if (secretKeyError) {
      errors.push(secretKeyError);
    }
  }

  return errors;
}

export function validateS3BucketName(bucket: string | undefined): string[] {
  const errors: string[] = [];

  if (!bucket) {
    errors.push('S3_BUCKET is required');
    return errors;
  }

  if (bucket.length < MIN_S3_BUCKET_NAME_LENGTH || bucket.length > MAX_S3_BUCKET_NAME_LENGTH) {
    errors.push(
      `S3_BUCKET must be between ${MIN_S3_BUCKET_NAME_LENGTH} and ${MAX_S3_BUCKET_NAME_LENGTH} characters`
    );
  }

  if (!VALID_S3_BUCKET_PATTERN.test(bucket)) {
    errors.push(
      'S3_BUCKET must contain only lowercase letters, numbers, periods, and hyphens, and start/end with letter or number'
    );
  }

  if (INVALID_S3_BUCKET_PATTERNS.some((pattern) => pattern.test(bucket))) {
    errors.push('S3_BUCKET cannot contain consecutive periods or be formatted as an IP address');
  }

  return errors;
}

export function validateS3Region(
  region: string,
  backend: StorageBackend,
  endpoint?: string
): string[] {
  const errors: string[] = [];

  // Only validate AWS regions for actual AWS S3 (backend='s3' with no custom endpoint)
  // S3-compatible services (MinIO, R2, Backblaze) use custom region codes
  const isAwsS3 = backend === 's3' && !endpoint;

  if (isAwsS3 && !VALID_AWS_REGIONS.includes(region)) {
    errors.push(
      `S3_REGION must be a valid AWS region. Got: ${region}. Valid regions: ${VALID_AWS_REGIONS.join(', ')}`
    );
  }
  // For S3-compatible services (has custom endpoint), accept any region format

  return errors;
}

export function validateS3Endpoint(
  endpoint: string | undefined,
  backend: StorageBackend,
  env: string
): string[] {
  const errors: string[] = [];

  // Endpoint is required for MinIO/R2
  if ((backend === 'minio' || backend === 'r2') && !endpoint) {
    errors.push(`S3_ENDPOINT is required for ${backend} storage`);
    return errors;
  }

  if (!endpoint) {
    return errors;
  }

  // Validate URL format
  try {
    const url = new URL(endpoint);

    // Must be HTTP or HTTPS
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      errors.push(`S3_ENDPOINT must use http:// or https:// protocol. Got: ${url.protocol}`);
    }

    // In production, require HTTPS for security
    if (env === 'production' && url.protocol !== 'https:') {
      errors.push('S3_ENDPOINT must use https:// in production for security');
    }

    // Prevent localhost/internal IPs in production
    if (env === 'production') {
      errors.push(...validateProductionHostname(url.hostname.toLowerCase(), 'S3_ENDPOINT'));
    }
  } catch {
    errors.push(`S3_ENDPOINT must be a valid URL. Got: ${endpoint}`);
  }

  return errors;
}

export function validateS3ForcePathStyle(
  forcePathStyle: boolean,
  backend: StorageBackend,
  endpoint?: string
): string[] {
  const errors: string[] = [];

  // Only warn for actual AWS S3 (no custom endpoint)
  // S3-compatible services often require forcePathStyle
  if (backend === 's3' && forcePathStyle && !endpoint) {
    errors.push('S3_FORCE_PATH_STYLE is deprecated for AWS S3 and should not be used');
  }

  return errors;
}

// ============================================================================
// STORAGE VALIDATORS
// ============================================================================

export function validateLocalStorageConfig(baseDirectory: string, baseUrl: string): string[] {
  const errors: string[] = [];

  if (!baseDirectory) {
    errors.push('STORAGE_BASE_DIR is required for local storage');
  }

  if (!baseUrl) {
    errors.push('STORAGE_BASE_URL is required for local storage');
  }

  return errors;
}
