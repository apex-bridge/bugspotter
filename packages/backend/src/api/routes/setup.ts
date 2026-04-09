/**
 * Setup routes
 * Initial system setup and configuration
 */

import type { FastifyInstance } from 'fastify';
import type { DatabaseClient } from '../../db/client.js';
import type { S3ClientConfig } from '@aws-sdk/client-s3';
import bcrypt from 'bcrypt';
import { AppError } from '../middleware/error.js';
import { sendSuccess } from '../utils/response.js';
import { PASSWORD } from '../utils/constants.js';
import { S3Client, ListBucketsCommand } from '@aws-sdk/client-s3';
import { parseBooleanEnv } from '../../config/validators.js';

// ============================================================================
// CONSTANTS
// ============================================================================

const USER_ROLES = {
  ADMIN: 'admin',
} as const;

const SETUP_MODES = {
  MINIMAL: 'minimal',
  FULL: 'full',
} as const;

type SetupMode = (typeof SETUP_MODES)[keyof typeof SETUP_MODES];

const DEFAULT_REGION = 'us-east-1';
const TOKEN_EXPIRY = {
  ACCESS: '24h',
  REFRESH: '7d',
} as const;

const ERROR_MESSAGES = {
  ALREADY_INITIALIZED: 'System already initialized',
  ADMIN_CREDENTIALS_REQUIRED: 'Admin credentials required',
  STORAGE_CONFIG_REQUIRED: 'Storage configuration required',
} as const;

const SYSTEM_CONFIG_KEY = 'system_settings';

// ============================================================================
// TYPES
// ============================================================================

interface SetupStatus {
  initialized: boolean;
  requiresSetup: boolean;
  setupMode: SetupMode;
  defaults?: {
    instance_name?: string;
    instance_url?: string;
    storage_type?: 'minio' | 's3';
    storage_endpoint?: string;
    storage_bucket?: string;
    storage_region?: string;
  };
}

interface SetupRequest {
  admin_email: string;
  admin_password: string;
  admin_name?: string;
  instance_name?: string;
  instance_url?: string;
  storage_type?: 'minio' | 's3';
  storage_endpoint?: string;
  storage_access_key?: string;
  storage_secret_key?: string;
  storage_bucket?: string;
  storage_region?: string;
}

interface TestStorageRequest {
  storage_type: string;
  storage_endpoint?: string;
  storage_access_key: string;
  storage_secret_key: string;
  storage_bucket: string;
  storage_region?: string;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Check if system has been initialized (has admin users)
 */
async function isSystemInitialized(db: DatabaseClient): Promise<boolean> {
  const result = await db.query(`SELECT COUNT(*) as count FROM users WHERE role = $1`, [
    USER_ROLES.ADMIN,
  ]);
  const adminCount = parseInt(result.rows[0]?.count || '0', 10);
  return adminCount > 0;
}

/**
 * Get setup mode from environment variable
 * Defaults to 'minimal' for production security
 */
function getSetupMode(): SetupMode {
  const mode = process.env.SETUP_MODE?.toLowerCase();
  return mode === SETUP_MODES.FULL ? SETUP_MODES.FULL : SETUP_MODES.MINIMAL;
}

/**
 * Read setup defaults from environment variables
 * Only returns defaults in FULL mode
 */
function getSetupDefaults(mode: SetupMode): SetupStatus['defaults'] {
  // In minimal mode, don't return any defaults (admin-only setup)
  if (mode === SETUP_MODES.MINIMAL) {
    return undefined;
  }
  const hasStorageConfig =
    process.env.S3_ACCESS_KEY && process.env.S3_SECRET_KEY && process.env.S3_BUCKET;

  if (!hasStorageConfig) {
    return undefined;
  }

  const endpoint = process.env.S3_ENDPOINT;
  const forcePathStyle = parseBooleanEnv(process.env.S3_FORCE_PATH_STYLE) ?? false;
  const storageType = detectStorageType(endpoint, forcePathStyle);

  return {
    instance_name: process.env.INSTANCE_NAME,
    instance_url: process.env.INSTANCE_URL,
    storage_type: storageType,
    storage_endpoint: endpoint,
    storage_bucket: process.env.S3_BUCKET,
    storage_region: process.env.S3_REGION || DEFAULT_REGION,
  };
}

/**
 * Detect storage type with fallback chain:
 * 1. Explicit STORAGE_BACKEND env var (validated)
 * 2. Detection: endpoint + forcePathStyle indicates MinIO
 * 3. Default to 's3'
 */
function detectStorageType(endpoint: string | undefined, forcePathStyle: boolean): 'minio' | 's3' {
  const explicitBackend = process.env.STORAGE_BACKEND?.toLowerCase();

  // Validate explicit backend setting
  if (explicitBackend) {
    if (explicitBackend === 'minio' || explicitBackend === 's3') {
      return explicitBackend;
    }
    // Invalid value - log warning and fall through to auto-detection
    console.warn(
      `Invalid STORAGE_BACKEND value: ${explicitBackend}. Expected 'minio' or 's3'. Falling back to auto-detection.`
    );
  }

  // Auto-detection: endpoint with forcePathStyle suggests MinIO
  if (endpoint && forcePathStyle) {
    return 'minio';
  }

  // Default to S3
  return 's3';
}

/**
 * Validate admin credentials
 */
function validateAdminCredentials(email: string | undefined, password: string | undefined): void {
  if (!email || !password) {
    throw new AppError(ERROR_MESSAGES.ADMIN_CREDENTIALS_REQUIRED, 400, 'ValidationError');
  }
}

/**
 * Validate storage configuration
 */
function validateStorageConfig(
  accessKey: string | undefined,
  secretKey: string | undefined,
  bucket: string | undefined
): void {
  if (!accessKey || !secretKey || !bucket) {
    throw new AppError(ERROR_MESSAGES.STORAGE_CONFIG_REQUIRED, 400, 'ValidationError');
  }
}

/**
 * Build S3 client configuration
 */
function buildS3Config(
  storageType: string,
  storageEndpoint: string | undefined,
  accessKey: string,
  secretKey: string,
  region: string | undefined
): S3ClientConfig {
  const config: S3ClientConfig = {
    region: region || DEFAULT_REGION,
    credentials: {
      accessKeyId: accessKey,
      secretAccessKey: secretKey,
    },
  };

  if (storageType === 'minio' && storageEndpoint) {
    config.endpoint = storageEndpoint;
    config.forcePathStyle = true;
  }

  return config;
}

// ============================================================================
// ROUTES
// ============================================================================

export async function setupRoutes(fastify: FastifyInstance, db: DatabaseClient): Promise<void> {
  /**
   * GET /api/v1/setup/status
   * Check if the system has been initialized
   */
  fastify.get('/api/v1/setup/status', { config: { public: true } }, async (_request, reply) => {
    const initialized = await isSystemInitialized(db);
    const setupMode = getSetupMode();
    const defaults = getSetupDefaults(setupMode);

    const status: SetupStatus = {
      initialized,
      requiresSetup: !initialized,
      setupMode,
      defaults,
    };

    return sendSuccess(reply, status);
  });

  /**
   * POST /api/v1/setup/initialize
   * Initialize the system with admin account and instance settings
   *
   * Modes:
   * - minimal: Only creates admin user (requires env vars for storage)
   * - full: Creates admin + stores instance/storage config
   */
  fastify.post<{ Body: SetupRequest }>(
    '/api/v1/setup/initialize',
    { config: { public: true } },
    async (request, reply) => {
      // Check if already initialized
      if (await isSystemInitialized(db)) {
        throw new AppError(ERROR_MESSAGES.ALREADY_INITIALIZED, 400, 'AlreadyInitialized');
      }

      const setupMode = getSetupMode();

      // Admin credentials (required in all modes)
      const admin_email = request.body.admin_email || process.env.ADMIN_EMAIL;
      const admin_password = request.body.admin_password || process.env.ADMIN_PASSWORD;
      const admin_name = request.body.admin_name || process.env.ADMIN_NAME || 'Admin';

      validateAdminCredentials(admin_email, admin_password);

      // Storage configuration (mode-dependent)
      let storage_access_key: string | undefined;
      let storage_secret_key: string | undefined;
      let storage_bucket: string | undefined;

      if (setupMode === SETUP_MODES.MINIMAL) {
        // In minimal mode, storage MUST come from environment variables only
        storage_access_key = process.env.S3_ACCESS_KEY;
        storage_secret_key = process.env.S3_SECRET_KEY;
        storage_bucket = process.env.S3_BUCKET;
      } else {
        // In full mode, accept from request body or fall back to env vars
        storage_access_key = request.body.storage_access_key || process.env.S3_ACCESS_KEY;
        storage_secret_key = request.body.storage_secret_key || process.env.S3_SECRET_KEY;
        storage_bucket = request.body.storage_bucket || process.env.S3_BUCKET;
      }

      // Validate storage configuration (required in both modes)
      validateStorageConfig(storage_access_key, storage_secret_key, storage_bucket);

      // Instance settings (optional in minimal mode, from env or defaults)
      const instance_name = request.body.instance_name || process.env.INSTANCE_NAME || 'BugSpotter';
      const instance_url =
        request.body.instance_url || process.env.INSTANCE_URL || 'http://localhost:3001';

      // Determine storage type: request body > detectStorageType() with fallback chain
      const storage_endpoint = request.body.storage_endpoint || process.env.S3_ENDPOINT;
      const forcePathStyle = parseBooleanEnv(process.env.S3_FORCE_PATH_STYLE) ?? false;
      const storage_type =
        request.body.storage_type || detectStorageType(storage_endpoint, forcePathStyle);
      const storage_region = request.body.storage_region || process.env.S3_REGION || DEFAULT_REGION;

      // Hash admin password (validated to be defined)
      const passwordHash = await bcrypt.hash(admin_password!, PASSWORD.SALT_ROUNDS);

      // Create admin user using repository (admin_email is validated to be defined)
      const user = await db.users.create({
        email: admin_email!,
        name: admin_name,
        password_hash: passwordHash,
        role: USER_ROLES.ADMIN,
      });

      // Set platform admin flag in security JSONB
      await db.query(
        `UPDATE users SET security = security || '{"is_platform_admin": true}'::jsonb WHERE id = $1`,
        [user.id]
      );

      // Store system settings in database
      const systemSettings = {
        instance_name,
        instance_url,
        storage_type,
        storage_endpoint,
        storage_access_key,
        storage_secret_key,
        storage_bucket,
        storage_region,
      };

      await db.systemConfig.set(
        SYSTEM_CONFIG_KEY,
        systemSettings,
        'System configuration from initial setup',
        user.id
      );

      request.log.info({ settings: Object.keys(systemSettings) }, 'System settings stored');

      // Generate JWT tokens
      const payload = { userId: user.id, isPlatformAdmin: true };
      const access_token = fastify.jwt.sign(payload, { expiresIn: TOKEN_EXPIRY.ACCESS });
      const refresh_token = fastify.jwt.sign(payload, { expiresIn: TOKEN_EXPIRY.REFRESH });

      // Set refresh token in httpOnly cookie (secure practice)
      reply.setCookie('refresh_token', refresh_token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in milliseconds
        path: '/',
      });

      request.log.info({ email: admin_email }, 'System initialized with admin user');

      return sendSuccess(reply, {
        access_token,
        expires_in: 24 * 60 * 60, // 24 hours in seconds
        token_type: 'Bearer',
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
        },
      });
    }
  );

  /**
   * POST /api/v1/setup/test-storage
   * Test storage connection with provided credentials
   */
  fastify.post<{ Body: TestStorageRequest }>(
    '/api/v1/setup/test-storage',
    { config: { public: true } },
    async (request, reply) => {
      const {
        storage_type,
        storage_endpoint,
        storage_access_key,
        storage_secret_key,
        storage_bucket,
        storage_region,
      } = request.body;

      try {
        const s3Config = buildS3Config(
          storage_type,
          storage_endpoint,
          storage_access_key,
          storage_secret_key,
          storage_region
        );

        const s3Client = new S3Client(s3Config);

        // Try to list buckets
        await s3Client.send(new ListBucketsCommand({}));

        return sendSuccess(reply, {
          success: true,
          message: 'Storage connection successful',
        });
      } catch (error) {
        request.log.error({ error, storage_type, storage_bucket }, 'Storage connection failed');

        return sendSuccess(reply, {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  );
}
