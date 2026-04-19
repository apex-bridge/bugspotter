/**
 * Application configuration
 * Reads environment variables and provides typed config
 *
 * Note: Call dotenv.config() before importing this module if you need to load .env files
 */

import { getLogger } from './logger.js';
import {
  VALID_STORAGE_BACKENDS,
  type StorageBackend,
  type LogLevel,
  type AppConfig,
} from './config/types.js';
import {
  MIN_PORT,
  MAX_PORT,
  MIN_TIMEOUT_MS,
  MIN_RATE_LIMIT_WINDOW_MS,
  validateNumber,
  validateDatabaseUrl,
  validateDatabasePoolConfig,
  validateJwtSecret,
  validateFrontendUrl,
  validateS3Credentials,
  validateS3BucketName,
  validateS3Region,
  validateS3Endpoint,
  validateS3ForcePathStyle,
  validateLocalStorageConfig,
  parseBooleanEnv,
} from './config/validators.js';

const logger = getLogger();

// Re-export types for convenience
export type { StorageBackend, LogLevel } from './config/types.js';

export const config: AppConfig = {
  database: {
    url: process.env.DATABASE_URL ?? '',
    poolMax: parseInt(process.env.DB_POOL_MAX ?? '10', 10),
    poolMin: parseInt(process.env.DB_POOL_MIN ?? '2', 10),
    connectionTimeout: parseInt(process.env.DB_CONNECTION_TIMEOUT_MS ?? '30000', 10),
    idleTimeout: parseInt(process.env.DB_IDLE_TIMEOUT_MS ?? '30000', 10),
    retryAttempts: parseInt(process.env.DB_RETRY_ATTEMPTS ?? '3', 10),
    retryDelayMs: parseInt(process.env.DB_RETRY_DELAY_MS ?? '1000', 10),
  },
  server: {
    port: parseInt(process.env.PORT ?? '3000', 10),
    env: process.env.NODE_ENV ?? 'development',
    maxUploadSize: parseInt(process.env.MAX_UPLOAD_SIZE ?? '10485760', 10), // 10MB default
    corsOrigins: process.env.CORS_ORIGINS?.split(',') ?? ['http://localhost:3000'],
    cspImgSrc: process.env.CSP_IMG_SRC?.split(',') ?? [
      "'self'",
      'data:',
      'https://secure.gravatar.com',
      'https://avatar-management--avatars.us-west-2.prod.public.atl-paas.net',
    ],
    logLevel: (process.env.LOG_LEVEL ?? 'info') as LogLevel,
  },
  jwt: {
    secret: process.env.JWT_SECRET ?? '',
    expiresIn: process.env.JWT_EXPIRES_IN ?? '24h',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '7d',
  },
  auth: {
    allowRegistration:
      parseBooleanEnv(process.env.ALLOW_REGISTRATION) ?? process.env.DEPLOYMENT_MODE === 'saas',
    requireInvitationToRegister:
      parseBooleanEnv(process.env.REQUIRE_INVITATION_TO_REGISTER) ?? true,
    selfServiceSignupEnabled:
      parseBooleanEnv(process.env.SELF_SERVICE_SIGNUP_ENABLED) ??
      process.env.DEPLOYMENT_MODE === 'saas',
    cookieDomain: process.env.COOKIE_DOMAIN?.trim() || null,
  },
  frontend: {
    url: process.env.FRONTEND_URL ?? '',
  },
  shareToken: {
    defaultExpirationHours: parseInt(process.env.SHARE_TOKEN_DEFAULT_EXPIRATION_HOURS ?? '24', 10),
    presignedUrlExpirationSeconds: parseInt(
      process.env.PRESIGNED_URL_EXPIRATION_SECONDS ?? '3600',
      10
    ),
  },
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS ?? '60000', 10), // 1 minute
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS ?? '100', 10),
  },
  storage: {
    backend: (process.env.STORAGE_BACKEND ?? 'local') as StorageBackend,
    // Local storage config
    local: {
      baseDirectory: process.env.STORAGE_BASE_DIR ?? './data/uploads',
      baseUrl: process.env.STORAGE_BASE_URL ?? 'http://localhost:3000/uploads',
    },
    // S3-compatible storage config
    s3: {
      endpoint: process.env.S3_ENDPOINT, // Required for MinIO/R2, optional for AWS S3
      region: process.env.S3_REGION ?? 'us-east-1',
      accessKeyId: process.env.S3_ACCESS_KEY,
      secretAccessKey: process.env.S3_SECRET_KEY,
      bucket: process.env.S3_BUCKET,
      forcePathStyle: parseBooleanEnv(process.env.S3_FORCE_PATH_STYLE) ?? false,
      maxRetries: parseInt(process.env.S3_MAX_RETRIES ?? '3', 10),
      timeout: parseInt(process.env.S3_TIMEOUT_MS ?? '30000', 10),
    },
  },
  dataResidency: {
    region: (process.env.DATA_RESIDENCY_REGION ?? 'kz').toLowerCase(),
  },
} as const;

/**
 * Validation context determines which config fields are checked.
 * - 'migration': Only database config (migrations don't need JWT, FRONTEND_URL, etc.)
 * - 'worker': Database + server + security (storage validated by worker startup)
 * - 'api': Full validation (all fields required for serving requests)
 */
export type ValidationContext = 'migration' | 'worker' | 'api';

function throwIfErrors(errors: string[]): void {
  if (errors.length > 0) {
    throw new Error(
      `Configuration validation failed:\n${errors.map((e) => `  - ${e}`).join('\n')}`
    );
  }
}

function collectDatabaseErrors(): string[] {
  const errors: string[] = [];
  errors.push(...validateDatabaseUrl(config.database.url));

  // Retry config is used by the migration runner, so validate here
  const retryChecks = [
    validateNumber(config.database.retryAttempts, 'DB_RETRY_ATTEMPTS', 0),
    validateNumber(config.database.retryDelayMs, 'DB_RETRY_DELAY_MS', 0),
  ];
  errors.push(...retryChecks.filter((error): error is string => error !== null));

  return errors;
}

function collectServerErrors(): string[] {
  const errors: string[] = [];

  const numericChecks = [
    validateNumber(config.database.poolMin, 'DB_POOL_MIN', 0),
    validateNumber(config.database.poolMax, 'DB_POOL_MAX', 1),
    validateNumber(config.database.connectionTimeout, 'DB_CONNECTION_TIMEOUT_MS', MIN_TIMEOUT_MS),
    validateNumber(config.database.idleTimeout, 'DB_IDLE_TIMEOUT_MS', MIN_TIMEOUT_MS),
    validateNumber(config.server.port, 'PORT', MIN_PORT, MAX_PORT),
    validateNumber(config.server.maxUploadSize, 'MAX_UPLOAD_SIZE', 1024),
    validateNumber(config.rateLimit.windowMs, 'RATE_LIMIT_WINDOW_MS', MIN_RATE_LIMIT_WINDOW_MS),
    validateNumber(config.rateLimit.maxRequests, 'RATE_LIMIT_MAX_REQUESTS', 1),
  ];

  errors.push(...numericChecks.filter((error): error is string => error !== null));
  errors.push(...validateDatabasePoolConfig(config.database.poolMin, config.database.poolMax));

  return errors;
}

function collectSecurityErrors(): string[] {
  const errors: string[] = [];
  errors.push(...validateJwtSecret(config.jwt.secret, config.server.env));
  errors.push(...validateFrontendUrl(config.frontend.url, config.server.env));
  return errors;
}

function collectStorageErrors(): string[] {
  const errors: string[] = [];

  if (!VALID_STORAGE_BACKENDS.includes(config.storage.backend)) {
    errors.push(
      `Invalid STORAGE_BACKEND: ${config.storage.backend}. Must be one of: ${VALID_STORAGE_BACKENDS.join(', ')}`
    );
  }

  if (['s3', 'minio', 'r2'].includes(config.storage.backend)) {
    const { accessKeyId, secretAccessKey, bucket, region, endpoint, forcePathStyle } =
      config.storage.s3;

    if (!accessKeyId && config.server.env !== 'production') {
      logger.warn(
        'No S3 credentials provided - will attempt to use IAM role or default credential chain'
      );
    }

    errors.push(
      ...validateS3Credentials(accessKeyId, secretAccessKey, config.storage.backend, endpoint)
    );
    errors.push(...validateS3BucketName(bucket));
    errors.push(...validateS3Region(region, config.storage.backend, endpoint));
    errors.push(...validateS3Endpoint(endpoint, config.storage.backend, config.server.env));
    errors.push(...validateS3ForcePathStyle(forcePathStyle, config.storage.backend, endpoint));

    const s3NumericChecks = [
      validateNumber(config.storage.s3.maxRetries, 'S3_MAX_RETRIES', 0),
      validateNumber(config.storage.s3.timeout, 'S3_TIMEOUT_MS', MIN_TIMEOUT_MS),
    ];

    errors.push(...s3NumericChecks.filter((error): error is string => error !== null));
  }

  if (config.storage.backend === 'local') {
    errors.push(
      ...validateLocalStorageConfig(
        config.storage.local.baseDirectory,
        config.storage.local.baseUrl
      )
    );
  }

  return errors;
}

/**
 * Validate application configuration.
 * Each context validates only what it needs:
 *   migration → database only
 *   worker    → database + server + security
 *   api       → database + server + security + storage
 */
export function validateConfig(context: ValidationContext = 'api'): void {
  const errors: string[] = [];

  errors.push(...collectDatabaseErrors());
  if (context === 'migration') {
    return throwIfErrors(errors);
  }

  errors.push(...collectServerErrors());
  errors.push(...collectSecurityErrors());
  if (context === 'api') {
    errors.push(...collectStorageErrors());
  }

  throwIfErrors(errors);
}
