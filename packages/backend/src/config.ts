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
import { DATA_RESIDENCY_REGION } from './db/types.js';
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
  parseTrustProxy,
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
    // Controls whether Fastify reads `X-Forwarded-For` / `X-Forwarded-Proto`
    // for `request.ip` / `request.protocol`. Required so rate-limit
    // keys on real client IPs rather than the NLB / CDN / nginx hop
    // — without it every public request looks the same to
    // `@fastify/rate-limit`, which defeats the `/auth/signup` spam
    // throttle (plan lists this as a pre-prod blocker).
    //
    // `request.ip` also flows into several other paths beyond
    // rate-limit — all of which become spoofable under the same
    // assumption:
    //   - signup spam filter (`SpamFilterService`) keys velocity
    //     checks on IP and persists `ip_address` on signup rows
    //     (`src/api/routes/signup.ts`,
    //     `src/api/routes/organization-requests.ts`)
    //   - API-key usage tracking
    //     (`api/middleware/auth/handlers.ts:112`)
    //   - data-residency compliance audit log
    //     (`data-residency/middleware.ts:151`)
    // TRUST REQUIREMENT: every upstream proxy in the request path
    // MUST sanitize `X-Forwarded-*` headers coming from the public
    // (either overwrite or validate — appending alone is NOT enough
    // because the client-supplied prefix remains in the chain and
    // `trustProxy: true` returns the leftmost entry). If that
    // assumption can't hold for your deployment, set
    // `TRUST_PROXY=false` or use a hop-count (e.g. `TRUST_PROXY=1`
    // for a single trusted reverse-proxy in front); Fastify then
    // skips the last N entries in the XFF chain as "ours."
    //
    // Default `true`: harmless in dev (no XFF header present means
    // `request.ip` still comes from the socket); correct for
    // deployments behind a trusted, header-sanitizing proxy.
    // Accepts `true` / `false` / `<integer>` (hop count).
    trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
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
    // Trim + lowercase at ingestion so `validateConfig` and
    // `parseDataResidencyRegion` always agree on what's a valid value.
    // Without `.trim()` an env like `" kz "` would pass parse() but fail
    // validate(), causing a confusing boot error.
    region: (process.env.DATA_RESIDENCY_REGION ?? 'kz').trim().toLowerCase(),
  },
  orgRetention: {
    // Use `Number` (strict) instead of `parseInt` (permissive). `parseInt('30d', 10)`
    // returns 30 — silently shortening the retention window; `Number('30d')` is
    // `NaN`, which `collectOrgRetentionErrors` catches via the `Number.isInteger`
    // guard. The `?? '30'` keeps the default when the env is unset, and an empty
    // string trimmed to zero falls through to validation (0 is rejected).
    retentionDays: Number((process.env.ORG_RETENTION_DAYS ?? '30').trim()),
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

  // `parseTrustProxy` returns `NaN` for garbage like `TRUST_PROXY=yes`
  // or `TRUST_PROXY=-3`; surface that here rather than at parse time
  // so it collects into the single "configuration validation failed"
  // message alongside every other config error.
  const tp = config.server.trustProxy;
  if (typeof tp === 'number' && !Number.isFinite(tp)) {
    errors.push(
      `TRUST_PROXY must be 'true', 'false', or a non-negative integer (got "${process.env.TRUST_PROXY}")`
    );
  }

  return errors;
}

function collectSecurityErrors(): string[] {
  const errors: string[] = [];
  errors.push(...validateJwtSecret(config.jwt.secret, config.server.env));
  errors.push(...validateFrontendUrl(config.frontend.url, config.server.env));
  return errors;
}

function collectCookieDomainErrors(): string[] {
  // Skip the check when not configured — a null/empty value means
  // "host-scoped cookie only" which is the self-hosted default.
  const raw = config.auth.cookieDomain;
  if (!raw) {
    return [];
  }

  // Reject obvious misconfigurations that would silently break cookie
  // issuance or expose the refresh cookie to the wrong origin. We don't
  // try to be a full RFC 1034 hostname validator — just catch the
  // common env-var mistakes (pasted URL, included port, trailing path,
  // whitespace, or uppercase).
  const lower = raw.toLowerCase();
  const errors: string[] = [];
  if (raw !== lower) {
    errors.push(`COOKIE_DOMAIN must be lowercase (got "${raw}")`);
  }
  if (/[\s/]/.test(raw) || raw.includes('://') || /:\d+$/.test(raw)) {
    errors.push(
      `COOKIE_DOMAIN must be a bare hostname (no scheme, path, port, or whitespace). Got "${raw}"`
    );
  }
  return errors;
}

function collectOrgRetentionErrors(): string[] {
  // Guard against typos like `ORG_RETENTION_DAYS=30d` that parse to NaN
  // (which `<` comparisons treat as "never past the window" — nothing would
  // ever be eligible, and the ops team wouldn't know why). Also block
  // nonsense values like 0 or negative; the point of the window is a grace
  // period, so the minimum meaningful value is 1 day.
  const days = config.orgRetention.retentionDays;
  if (!Number.isFinite(days) || !Number.isInteger(days) || days < 1) {
    return [
      `ORG_RETENTION_DAYS must be a positive integer (got "${process.env.ORG_RETENTION_DAYS}")`,
    ];
  }
  return [];
}

function collectDataResidencyErrors(): string[] {
  // Validate at boot rather than on the first signup. A misconfigured region
  // otherwise surfaces as a 500 from /api/v1/auth/signup instead of a clear
  // operator-facing startup failure.
  //
  // Source of truth: `DATA_RESIDENCY_REGION` in `db/types.ts` (which is also
  // mirrored by the DB CHECK constraint in the organizations table). Using
  // the enum here means adding a region only requires editing one place.
  const validRegions = Object.values(DATA_RESIDENCY_REGION);
  const region = config.dataResidency.region;
  if (!(validRegions as string[]).includes(region)) {
    return [
      `Invalid DATA_RESIDENCY_REGION: ${region}. Expected one of: ${validRegions.join(', ')}`,
    ];
  }
  return [];
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
    errors.push(...collectDataResidencyErrors());
    errors.push(...collectCookieDomainErrors());
    errors.push(...collectOrgRetentionErrors());
  }

  throwIfErrors(errors);
}
