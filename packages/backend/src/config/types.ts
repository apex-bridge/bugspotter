/**
 * Configuration type definitions
 */

export const VALID_STORAGE_BACKENDS = ['local', 's3', 'minio', 'r2'] as const;
export type StorageBackend = (typeof VALID_STORAGE_BACKENDS)[number];

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface DatabaseConfig {
  url: string;
  poolMax: number;
  poolMin: number;
  connectionTimeout: number;
  idleTimeout: number;
  retryAttempts: number;
  retryDelayMs: number;
}

export interface ServerConfig {
  port: number;
  env: string;
  maxUploadSize: number;
  corsOrigins: string[];
  cspImgSrc: string[];
  logLevel: LogLevel;
}

export interface JwtConfig {
  secret: string;
  expiresIn: string;
  refreshExpiresIn: string;
}

export interface AuthConfig {
  allowRegistration: boolean;
  requireInvitationToRegister: boolean;
  selfServiceSignupEnabled: boolean;
  /**
   * Domain attribute for refresh_token cookie. When set (e.g. `.kz.bugspotter.io`),
   * enables cross-subdomain SSO between the landing signup wizard and tenant
   * admin UIs. When null/empty, the cookie is scoped to the emitting host.
   */
  cookieDomain: string | null;
}

export interface DataResidencyConfig {
  /** Region code for this deployment (e.g. `kz`, `rf`). Used for signup and billing currency. */
  region: string;
}

export interface FrontendConfig {
  url: string;
}

export interface ShareTokenConfig {
  defaultExpirationHours: number;
  presignedUrlExpirationSeconds: number;
}

export interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
}

export interface LocalStorageConfig {
  baseDirectory: string;
  baseUrl: string;
}

export interface S3Config {
  endpoint?: string;
  region: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  bucket?: string;
  forcePathStyle: boolean;
  maxRetries: number;
  timeout: number;
}

export interface StorageConfig {
  backend: StorageBackend;
  local: LocalStorageConfig;
  s3: S3Config;
}

export interface AppConfig {
  database: DatabaseConfig;
  server: ServerConfig;
  jwt: JwtConfig;
  auth: AuthConfig;
  frontend: FrontendConfig;
  shareToken: ShareTokenConfig;
  rateLimit: RateLimitConfig;
  storage: StorageConfig;
  dataResidency: DataResidencyConfig;
}
