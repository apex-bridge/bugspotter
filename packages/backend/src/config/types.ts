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
  trustProxy: boolean | number;
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

export interface OrgRetentionConfig {
  /**
   * Days a soft-deleted organization must sit before a platform admin can
   * hard-delete it via the retention UI. The window gives tenants a grace
   * period to restore themselves if the soft-delete was a mistake.
   *
   * The value gates both the "pending hard-delete" list endpoint (only
   * orgs past this age appear) and the hard-delete endpoint itself (a
   * server-side guard rejects any attempt on an org that hasn't aged
   * past it yet). Default: 30.
   */
  retentionDays: number;
}

export interface FrontendConfig {
  url: string;
}

export interface OidcConfig {
  /**
   * Canonical externally-reachable base URL for this backend instance (e.g.
   * `https://api.bugspotter.io`), used to build the `redirect_uri` sent to
   * an OIDC IdP during login initiation. MUST be a fixed, operator-set
   * value — never derived from `request.protocol`/`request.hostname`,
   * which are attacker-influenceable via the Host / X-Forwarded-* headers
   * depending on proxy config, and a mismatched/spoofed redirect_uri is
   * security-relevant for an OIDC flow (open-redirect / code interception).
   * `null` when unset — fine for deployments with no tenant SSO configured.
   */
  redirectBaseUrl: string | null;
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
  oidc: OidcConfig;
  shareToken: ShareTokenConfig;
  rateLimit: RateLimitConfig;
  storage: StorageConfig;
  dataResidency: DataResidencyConfig;
  orgRetention: OrgRetentionConfig;
}
