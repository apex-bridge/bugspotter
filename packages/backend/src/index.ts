/**
 * Main entry point for the backend package
 * Exports the database client, repositories, and types
 */

export { DatabaseClient, createDatabaseClient, type DatabaseConfig } from './db/client.js';
export {
  ProjectRepository,
  BugReportRepository,
  UserRepository,
  TicketRepository,
} from './db/repositories.js';
export { BaseRepository } from './db/repositories.js';
export * from './db/types.js';
export { config, validateConfig } from './config.js';
export { runMigrations } from './db/migrations/migrate.js';
export { setLogger, getLogger, type Logger } from './logger.js';

// Export new retry utilities and transaction types
export {
  executeWithRetry,
  isRetryableError,
  withRetry,
  ExponentialBackoffStrategy,
  LinearBackoffStrategy,
  FixedDelayStrategy,
  DEFAULT_RETRY_CONFIG,
  type RetryStrategy,
  type RetryConfig,
} from './db/retry.js';
export { createRepositories, type RepositoryRegistry } from './db/repositories/factory.js';
export { type TransactionContext, type TransactionCallback } from './db/transaction.js';

// Export Service Container and Request Context
export {
  ServiceContainer,
  createServiceContainer,
  createRequestContextMiddleware,
  getServices,
  setRequestMetadata,
  getRequestMetadata,
  getRequestDuration,
  type IServiceContainer,
  type ServiceContainerConfig,
  type RequestContext,
} from './container/index.js';
