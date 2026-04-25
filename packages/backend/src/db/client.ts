/**
 * Database Client
 * Manages PostgreSQL connection pool and provides repository access with automatic retry logic
 */

import pg from 'pg';
import { config } from '../config.js';
import { getLogger } from '../logger.js';
import { executeWithRetry, type RetryConfig, DEFAULT_RETRY_CONFIG } from './retry.js';
import { buildSslConfig } from './ssl.js';
import { createRepositories, type RepositoryRegistry } from './repositories/factory.js';
import { type TransactionCallback } from './transaction.js';
import type {
  ProjectRepository,
  ProjectMemberRepository,
  BugReportRepository,
  UserRepository,
  TicketRepository,
  ShareTokenRepository,
  SystemConfigRepository,
} from './repositories.js';
import type { EmailVerificationTokenRepository } from './repositories/email-verification-token.repository.js';
import type { AuditLogRepository } from './repositories/audit-log.repository.js';
import type { ProjectIntegrationRepository } from './project-integration.repository.js';
import type { IntegrationRuleRepository } from './integration-rule.repository.js';
import type { IntegrationRepository } from './repositories/integration.repository.js';
import type { IntegrationSyncLogRepository } from './repositories/integration-sync-log.repository.js';
import type { FieldMappingRepository } from './repositories/field-mapping.repository.js';
import type { WebhookRepository } from './repositories/webhook.repository.js';
import type { OAuthTokenRepository } from './repositories/oauth-token.repository.js';
import type { ApiKeyRepository } from './repositories/api-key.repository.js';
import type { TicketCreationOutboxRepository } from './repositories/ticket-creation-outbox.repository.js';
import type { DataResidencyRepository } from './repositories/data-residency.repository.js';
import type { NotificationChannelRepository } from './repositories/notification-channel.repository.js';
import type { NotificationRuleRepository } from './repositories/notification-rule.repository.js';
import type { NotificationTemplateRepository } from './repositories/notification-template.repository.js';
import type { NotificationHistoryRepository } from './repositories/notification-history.repository.js';
import type { NotificationThrottleRepository } from './repositories/notification-throttle.repository.js';
import { AnalyticsService } from '../analytics/analytics-service.js';
import { DataResidencyService } from '../data-residency/data-residency-service.js';
import type { OrganizationRepository } from '../saas/repositories/organization.repository.js';
import type { OrganizationMemberRepository } from '../saas/repositories/organization-member.repository.js';
import type { SubscriptionRepository } from '../saas/repositories/subscription.repository.js';
import type { UsageRecordRepository } from '../saas/repositories/usage-record.repository.js';
import type { InvitationRepository } from '../saas/repositories/invitation.repository.js';
import type { OrganizationRequestRepository } from '../saas/repositories/organization-request.repository.js';
import type { InvoiceRepository } from '../saas/repositories/invoice.repository.js';
import type { InvoiceLineRepository } from '../saas/repositories/invoice-line.repository.js';
import type { LegalEntityRepository } from '../saas/repositories/legal-entity.repository.js';
import type { ActRepository } from '../saas/repositories/act.repository.js';

const { Pool } = pg;

/**
 * Default connection pool configuration
 */
const DEFAULT_POOL_CONFIG = {
  MAX_CONNECTIONS: 10,
  MIN_CONNECTIONS: 2,
  CONNECTION_TIMEOUT_MS: 30000,
  IDLE_TIMEOUT_MS: 30000,
} as const;

/**
 * SQL commands for transaction control
 */
const TRANSACTION_COMMANDS = {
  BEGIN: 'BEGIN',
  COMMIT: 'COMMIT',
  ROLLBACK: 'ROLLBACK',
  TEST_CONNECTION: 'SELECT NOW()',
} as const;

/**
 * Type definitions for domain-grouped repository access
 * Use these to type services that only need specific domains
 */
export interface CoreRepositories {
  projects: ProjectRepository;
  projectMembers: ProjectMemberRepository;
  bugReports: BugReportRepository;
  users: UserRepository;
  tickets: TicketRepository;
  shareTokens: ShareTokenRepository;
  emailVerificationTokens: EmailVerificationTokenRepository;
  systemConfig: SystemConfigRepository;
  auditLogs: AuditLogRepository;
  retention: BugReportRepository;
  apiKeys: ApiKeyRepository;
}

export interface IntegrationRepositories {
  integrations: IntegrationRepository;
  syncLogs: IntegrationSyncLogRepository;
  fieldMappings: FieldMappingRepository;
  webhooks: WebhookRepository;
  oauthTokens: OAuthTokenRepository;
  projectIntegrations: ProjectIntegrationRepository;
  integrationRules: IntegrationRuleRepository;
}

export interface NotificationRepositories {
  channels: NotificationChannelRepository;
  rules: NotificationRuleRepository;
  templates: NotificationTemplateRepository;
  history: NotificationHistoryRepository;
  throttle: NotificationThrottleRepository;
}

export interface DatabaseConfig {
  connectionString: string;
  max?: number;
  min?: number;
  connectionTimeoutMillis?: number;
  idleTimeoutMillis?: number;
  retryAttempts?: number;
  retryDelayMs?: number;
}

/**
 * Database client for PostgreSQL operations with automatic retry logic
 */
export class DatabaseClient implements RepositoryRegistry {
  /**
   * Methods that are safe to retry (idempotent read operations)
   * Shared across all instances to avoid unnecessary memory allocation
   */
  private static readonly RETRYABLE_METHODS = new Set([
    'findById',
    'findBy',
    'findManyBy',
    'findByMultiple',
    'findByApiKey',
    'findByEmail',
    'findByOAuth',
    'findByBugReport',
    'list',
    // Data residency read operations (compliance-critical)
    'getProjectPolicy',
    'getProjectAuditEntries',
    'countProjectAuditEntries',
    'getProjectViolations',
    'countProjectViolations',
    'getComplianceSummary',
  ]);

  private pool: pg.Pool;
  private retryConfig: RetryConfig;

  // Repository instances - types from concrete classes, satisfies RepositoryRegistry
  public readonly projects!: ProjectRepository;
  public readonly projectMembers!: ProjectMemberRepository;
  public readonly bugReports!: BugReportRepository;
  public readonly users!: UserRepository;
  public readonly tickets!: TicketRepository;
  public readonly shareTokens!: ShareTokenRepository;
  public readonly emailVerificationTokens!: EmailVerificationTokenRepository;
  public readonly projectIntegrations!: ProjectIntegrationRepository;
  public readonly systemConfig!: SystemConfigRepository;
  public readonly auditLogs!: AuditLogRepository;
  public readonly retention!: BugReportRepository;
  public readonly analytics!: AnalyticsService;
  public readonly dataResidencyService!: DataResidencyService;
  public readonly notificationChannels!: NotificationChannelRepository;
  public readonly notificationRules!: NotificationRuleRepository;
  public readonly notificationTemplates!: NotificationTemplateRepository;
  public readonly notificationHistory!: NotificationHistoryRepository;
  public readonly notificationThrottle!: NotificationThrottleRepository;
  public readonly integrations!: IntegrationRepository;
  public readonly integrationSyncLogs!: IntegrationSyncLogRepository;
  public readonly fieldMappings!: FieldMappingRepository;
  public readonly webhooks!: WebhookRepository;
  public readonly oauthTokens!: OAuthTokenRepository;
  public readonly apiKeys!: ApiKeyRepository;
  public readonly integrationRules!: IntegrationRuleRepository;
  public readonly ticketOutbox!: TicketCreationOutboxRepository;
  public readonly dataResidency!: DataResidencyRepository;
  // SaaS multi-tenant repositories
  public readonly organizations!: OrganizationRepository;
  public readonly organizationMembers!: OrganizationMemberRepository;
  public readonly subscriptions!: SubscriptionRepository;
  public readonly usageRecords!: UsageRecordRepository;
  public readonly invitations!: InvitationRepository;
  public readonly organizationRequests!: OrganizationRequestRepository;
  // Invoice billing repositories
  public readonly invoices!: InvoiceRepository;
  public readonly invoiceLines!: InvoiceLineRepository;
  public readonly legalEntities!: LegalEntityRepository;
  public readonly acts!: ActRepository;

  /**
   * Private constructor - use static create() method instead
   * This ensures proper initialization order and testability
   */
  private constructor(pool: pg.Pool, retryConfig: RetryConfig, repositories: RepositoryRegistry) {
    this.pool = pool;
    this.retryConfig = retryConfig;

    // Initialize repositories with retry wrapping
    this.projects = this.wrapWithRetry(repositories.projects);
    this.projectMembers = this.wrapWithRetry(repositories.projectMembers);
    this.bugReports = this.wrapWithRetry(repositories.bugReports);
    this.systemConfig = this.wrapWithRetry(repositories.systemConfig);
    this.auditLogs = this.wrapWithRetry(repositories.auditLogs);
    // Retention operations consolidated into BugReportRepository
    this.retention = this.bugReports;
    this.users = this.wrapWithRetry(repositories.users);
    this.tickets = this.wrapWithRetry(repositories.tickets);
    this.shareTokens = this.wrapWithRetry(repositories.shareTokens);
    this.emailVerificationTokens = this.wrapWithRetry(repositories.emailVerificationTokens);
    this.projectIntegrations = this.wrapWithRetry(repositories.projectIntegrations);
    this.analytics = new AnalyticsService(pool);
    // Data residency repository
    this.dataResidency = this.wrapWithRetry(repositories.dataResidency);
    // Data residency service (business logic layer)
    this.dataResidencyService = new DataResidencyService(this.dataResidency);
    // Notification system repositories
    this.notificationChannels = this.wrapWithRetry(repositories.notificationChannels);
    this.notificationRules = this.wrapWithRetry(repositories.notificationRules);
    this.notificationTemplates = this.wrapWithRetry(repositories.notificationTemplates);
    this.notificationHistory = this.wrapWithRetry(repositories.notificationHistory);
    this.notificationThrottle = this.wrapWithRetry(repositories.notificationThrottle);
    // Integration system repositories
    this.integrations = this.wrapWithRetry(repositories.integrations);
    this.integrationSyncLogs = this.wrapWithRetry(repositories.integrationSyncLogs);
    this.fieldMappings = this.wrapWithRetry(repositories.fieldMappings);
    this.webhooks = this.wrapWithRetry(repositories.webhooks);
    this.oauthTokens = this.wrapWithRetry(repositories.oauthTokens);
    this.apiKeys = this.wrapWithRetry(repositories.apiKeys);
    this.integrationRules = this.wrapWithRetry(repositories.integrationRules);
    this.ticketOutbox = this.wrapWithRetry(repositories.ticketOutbox);
    // SaaS multi-tenant repositories
    this.organizations = this.wrapWithRetry(repositories.organizations);
    this.organizationMembers = this.wrapWithRetry(repositories.organizationMembers);
    this.subscriptions = this.wrapWithRetry(repositories.subscriptions);
    this.usageRecords = this.wrapWithRetry(repositories.usageRecords);
    this.invitations = this.wrapWithRetry(repositories.invitations);
    this.organizationRequests = this.wrapWithRetry(repositories.organizationRequests);
    // Invoice billing repositories
    this.invoices = this.wrapWithRetry(repositories.invoices);
    this.invoiceLines = this.wrapWithRetry(repositories.invoiceLines);
    this.legalEntities = this.wrapWithRetry(repositories.legalEntities);
    this.acts = this.wrapWithRetry(repositories.acts);
  }

  /**
   * Get the underlying connection pool
   * Use sparingly - prefer using repositories for data access
   */
  public getPool(): pg.Pool {
    return this.pool;
  }

  /**
   * Create a new DatabaseClient instance with proper initialization
   * Factory method pattern for better testability and separation of concerns
   */
  static create(config: DatabaseConfig): DatabaseClient {
    const pool = DatabaseClient.createConnectionPool(config);
    const retryConfig = DatabaseClient.createRetryConfig(config);
    const repositories = createRepositories(pool);

    const client = new DatabaseClient(pool, retryConfig, repositories);

    // Set up monitoring after construction (optional side effect)
    client.setupConnectionMonitoring();

    // Log successful initialization
    client.logConnectionInitialized(config);

    return client;
  }

  /**
   * Create PostgreSQL connection pool with configuration
   */
  private static createConnectionPool(config: DatabaseConfig): pg.Pool {
    // Build SSL config from sslmode in connection string.
    // pg-connection-string doesn't translate sslmode=require into
    // rejectUnauthorized=false, so we handle it explicitly.
    // The override also strips sslmode from the connection string because
    // pg's ConnectionParameters overwrites explicit config with parsed values.
    const sslOverride = buildSslConfig(config.connectionString);

    return new Pool({
      connectionString: sslOverride?.connectionString ?? config.connectionString,
      ...(sslOverride !== undefined && { ssl: sslOverride.ssl }),
      max: config.max ?? DEFAULT_POOL_CONFIG.MAX_CONNECTIONS,
      min: config.min ?? DEFAULT_POOL_CONFIG.MIN_CONNECTIONS,
      connectionTimeoutMillis:
        config.connectionTimeoutMillis ?? DEFAULT_POOL_CONFIG.CONNECTION_TIMEOUT_MS,
      idleTimeoutMillis: config.idleTimeoutMillis ?? DEFAULT_POOL_CONFIG.IDLE_TIMEOUT_MS,
      // Allow stale connections to fail and be recreated
      allowExitOnIdle: false,
      // Keep connections alive with periodic queries
      keepAlive: true,
      keepAliveInitialDelayMillis: 10000,
    });
  }

  /**
   * Create retry configuration from database config
   */
  private static createRetryConfig(config: DatabaseConfig): RetryConfig {
    return {
      maxAttempts: config.retryAttempts ?? DEFAULT_RETRY_CONFIG.maxAttempts,
      baseDelay: config.retryDelayMs ?? DEFAULT_RETRY_CONFIG.baseDelay,
      strategy: DEFAULT_RETRY_CONFIG.strategy,
    };
  }

  /**
   * Set up connection pool event monitoring
   */
  private setupConnectionMonitoring(): void {
    const logger = getLogger();

    this.pool.on('error', (err) => {
      const errorMessage = err.message;

      // Detect critical PostgreSQL errors and log with severity
      if (errorMessage.includes('Connection terminated') || errorMessage.includes('ECONNREFUSED')) {
        console.error('[CRITICAL] PostgreSQL connection lost:', {
          error: errorMessage,
          timestamp: new Date().toISOString(),
          action: 'Check if PostgreSQL service is running and DATABASE_URL is correct',
          note: 'Connection pool will automatically attempt reconnection',
        });
      } else if (errorMessage.includes('password authentication failed')) {
        console.error('[CRITICAL] PostgreSQL authentication failed:', {
          error: errorMessage,
          timestamp: new Date().toISOString(),
          action: 'Verify DATABASE_URL credentials are correct',
        });
      } else if (errorMessage.includes('database') && errorMessage.includes('does not exist')) {
        console.error('[CRITICAL] PostgreSQL database does not exist:', {
          error: errorMessage,
          timestamp: new Date().toISOString(),
          action: 'Run migrations or verify DATABASE_URL database name',
        });
      }

      logger.error('Unexpected database error', {
        error: errorMessage,
        stack: err.stack,
        type: 'pool_error',
      });
    });

    this.pool.on('connect', async (client) => {
      // Register error handler immediately (before any awaits) so errors
      // during search_path setup are captured instead of crashing the process.
      client.on('error', (err) => {
        logger.error('Database client connection error', {
          error: err.message,
          type: 'client_error',
        });
      });

      // Set search_path on every new connection via an explicit SET query.
      // The `-c search_path=...` options startup parameter does NOT work
      // through PgBouncer/Odyssey connection poolers — they forward the value
      // as a single quoted identifier instead of a comma-separated list,
      // causing PostgreSQL to look for one schema named "application,saas,public".
      // A SET query on the connect event works reliably in all environments.
      try {
        await client.query('SET search_path TO application, saas, public');
        const result = await client.query('SELECT current_schemas(true) AS schemas');
        logger.info('New database connection established', {
          type: 'pool_connect',
          search_path: result.rows[0]?.schemas,
        });
      } catch (err) {
        logger.error('Failed to set search_path on new connection', {
          error: err instanceof Error ? err.message : String(err),
          type: 'pool_connect_search_path',
        });
      }
    });

    this.pool.on('remove', () => {
      logger.debug('Database connection removed from pool', {
        type: 'pool_remove',
      });
    });

    this.pool.on('acquire', () => {
      logger.debug('Database connection acquired from pool', {
        type: 'pool_acquire',
      });
    });
  }

  /**
   * Log successful connection initialization
   */
  private logConnectionInitialized(config: DatabaseConfig): void {
    getLogger().info('Database client initialized', {
      maxConnections: config.max ?? DEFAULT_POOL_CONFIG.MAX_CONNECTIONS,
      minConnections: config.min ?? DEFAULT_POOL_CONFIG.MIN_CONNECTIONS,
      retryAttempts: config.retryAttempts ?? DEFAULT_RETRY_CONFIG.maxAttempts,
      retryDelay: config.retryDelayMs ?? DEFAULT_RETRY_CONFIG.baseDelay,
    });
  }

  /**
   * Wrap repository methods with automatic retry logic using Proxy pattern
   * Only wraps read operations - write operations should not be auto-retried
   * as they may not be idempotent and could cause data corruption
   */
  private wrapWithRetry<T extends object>(target: T): T {
    return new Proxy(target, {
      get: (obj, prop) => {
        const method = obj[prop as keyof T];

        // Only wrap functions
        if (!this.isFunction(method)) {
          return method;
        }

        const methodName = String(prop);

        // Return wrapped or unwrapped method based on retry safety
        return this.isRetryableMethod(methodName)
          ? this.wrapMethodWithRetry(method, obj)
          : this.wrapMethodWithoutRetry(method, obj);
      },
    });
  }

  /**
   * Check if a value is a function
   */
  private isFunction(value: unknown): value is (...args: unknown[]) => unknown {
    return typeof value === 'function';
  }

  /**
   * Check if a method should be retried automatically
   */
  private isRetryableMethod(methodName: string): boolean {
    return DatabaseClient.RETRYABLE_METHODS.has(methodName);
  }

  /**
   * Wrap a method with retry logic
   */
  private wrapMethodWithRetry<T extends object>(
    method: (...args: unknown[]) => unknown,
    context: T
  ): (...args: unknown[]) => Promise<unknown> {
    return (...args: unknown[]): Promise<unknown> => {
      return executeWithRetry(() => {
        return method.apply(context, args) as Promise<unknown>;
      }, this.retryConfig);
    };
  }

  /**
   * Wrap a method without retry logic (for write operations)
   */
  private wrapMethodWithoutRetry<T extends object>(
    method: (...args: unknown[]) => unknown,
    context: T
  ): (...args: unknown[]) => unknown {
    return (...args: unknown[]): unknown => {
      return method.apply(context, args) as unknown;
    };
  }

  /**
   * Test database connection health
   * Returns true if connection is healthy, false otherwise
   */
  async testConnection(): Promise<boolean> {
    const logger = getLogger();

    try {
      logger.debug('Testing database connection');

      const result = await executeWithRetry(() => {
        return this.pool.query(TRANSACTION_COMMANDS.TEST_CONNECTION);
      }, this.retryConfig);

      const isHealthy = result.rows.length > 0;
      logger.debug('Database connection test completed', { healthy: isHealthy });

      return isHealthy;
    } catch (error) {
      logger.error('Database connection test failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Execute a raw SQL query
   * Use this for complex queries not covered by repositories
   */
  async query<T extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    params?: unknown[]
  ): Promise<pg.QueryResult<T>> {
    return await this.pool.query<T>(text, params);
  }

  /**
   * Get connection pool statistics for monitoring
   */
  getPoolStats(): {
    totalCount: number;
    idleCount: number;
    waitingCount: number;
  } {
    return {
      totalCount: this.pool.totalCount,
      idleCount: this.pool.idleCount,
      waitingCount: this.pool.waitingCount,
    };
  }

  /**
   * Close all database connections gracefully
   */
  async close(): Promise<void> {
    const logger = getLogger();

    try {
      logger.info('Closing database connection pool', this.getPoolStats());
      await this.pool.end();
      logger.info('Database connection pool closed successfully');
    } catch (error) {
      logger.error('Error closing database connection pool', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Domain-grouped access to core bug tracking repositories
   * Provides clearer boundaries and easier testing while maintaining flat access
   */
  get core() {
    return {
      projects: this.projects,
      projectMembers: this.projectMembers,
      bugReports: this.bugReports,
      users: this.users,
      tickets: this.tickets,
      systemConfig: this.systemConfig,
      auditLogs: this.auditLogs,
      retention: this.retention,
      apiKeys: this.apiKeys,
    };
  }

  /**
   * Domain-grouped access to integration system repositories
   * Use this in integration-related services to show clear domain dependencies
   */
  get integration() {
    return {
      integrations: this.integrations,
      syncLogs: this.integrationSyncLogs,
      fieldMappings: this.fieldMappings,
      webhooks: this.webhooks,
      oauthTokens: this.oauthTokens,
      projectIntegrations: this.projectIntegrations,
    };
  }

  /**
   * Domain-grouped access to notification system repositories
   * Use this in notification-related services to show clear domain dependencies
   */
  get notification() {
    return {
      channels: this.notificationChannels,
      rules: this.notificationRules,
      templates: this.notificationTemplates,
      history: this.notificationHistory,
      throttle: this.notificationThrottle,
    };
  }

  /**
   * Execute multiple operations in a transaction
   * @example
   * await db.transaction(async (tx) => {
   *   const bug = await tx.bugReports.create({...});
   *   await tx.sessions.createSession(bug.id, events);
   *   return bug;
   * });
   */
  async transaction<T>(callback: TransactionCallback<T>): Promise<T> {
    const logger = getLogger();
    const client = await this.pool.connect();
    const transactionId = this.generateTransactionId();

    try {
      logger.debug('Transaction starting', { transactionId });
      await client.query(TRANSACTION_COMMANDS.BEGIN);

      // Create repositories using the transaction client
      const transactionContext = createRepositories(client);
      const result = await callback(transactionContext);

      await client.query(TRANSACTION_COMMANDS.COMMIT);
      logger.debug('Transaction committed', { transactionId });

      return result;
    } catch (error) {
      logger.warn('Transaction rolling back', {
        transactionId,
        error: error instanceof Error ? error.message : String(error),
      });

      await this.safeRollback(client, transactionId);
      throw error;
    } finally {
      client.release();
      logger.debug('Transaction client released', { transactionId });
    }
  }

  /**
   * Execute a raw SQL callback within an explicit transaction on a dedicated connection.
   * Useful when you need advisory locks or multiple raw queries that must share
   * the same connection and transaction.
   */
  async queryWithTransaction<T>(callback: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const logger = getLogger();
    const client = await this.pool.connect();
    try {
      await client.query(TRANSACTION_COMMANDS.BEGIN);
      const result = await callback(client);
      await client.query(TRANSACTION_COMMANDS.COMMIT);
      return result;
    } catch (error) {
      logger.warn('queryWithTransaction rolling back', {
        error: error instanceof Error ? error.message : String(error),
      });
      try {
        await client.query(TRANSACTION_COMMANDS.ROLLBACK);
        logger.debug('queryWithTransaction rolled back successfully');
      } catch (rollbackError) {
        logger.error('Failed to rollback queryWithTransaction', {
          error: rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
        });
        // Don't throw - we're already in an error state
      }
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Generate a unique transaction ID for logging
   */
  private generateTransactionId(): string {
    return `tx_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Safely rollback a transaction with error handling
   */
  private async safeRollback(client: pg.PoolClient, transactionId: string): Promise<void> {
    try {
      await client.query(TRANSACTION_COMMANDS.ROLLBACK);
      getLogger().debug('Transaction rolled back successfully', { transactionId });
    } catch (rollbackError) {
      getLogger().error('Failed to rollback transaction', {
        transactionId,
        error: rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
      });
      // Don't throw - we're already in an error state
    }
  }
}

/**
 * Create a database client instance
 */
export function createDatabaseClient(databaseUrl?: string): DatabaseClient {
  const connectionString = databaseUrl ?? config.database.url;

  if (!connectionString) {
    throw new Error('DATABASE_URL is required. Set it in environment variables or .env file');
  }

  return DatabaseClient.create({
    connectionString,
    max: config.database.poolMax,
    min: config.database.poolMin,
    connectionTimeoutMillis: config.database.connectionTimeout,
    idleTimeoutMillis: config.database.idleTimeout,
    retryAttempts: config.database.retryAttempts,
    retryDelayMs: config.database.retryDelayMs,
  });
}
