/**
 * Retention Service Factory
 * Centralized creation of RetentionService with proper dependency injection
 */

import { RetentionService } from './retention-service.js';
import type { DatabaseClient } from '../db/client.js';
import type { BaseStorageService } from '../storage/base-storage-service.js';
import type { IStorageArchiver } from '../storage/archive-storage.interface.js';
import { DeletionArchiveStrategy } from '../storage/archive-storage-service.js';
import { getLogger } from '../logger.js';

const logger = getLogger();

export type ArchiveStrategyType = 'deletion' | 'custom';

export interface RetentionServiceOptions {
  /**
   * Database client instance
   */
  db: DatabaseClient;

  /**
   * Base storage service (S3, local, etc.)
   */
  storage: BaseStorageService;

  /**
   * Archive strategy to use
   * - 'deletion': Immediate deletion (default, free space now)
   * - 'custom': Provide your own IStorageArchiver implementation
   */
  archiveStrategy?: ArchiveStrategyType;

  /**
   * Custom archive strategy implementation
   * Required when archiveStrategy is 'custom'
   */
  customArchiver?: IStorageArchiver;
}

/**
 * Create RetentionService with appropriate archive strategy
 *
 * @example
 * // Use default deletion strategy
 * const service = createRetentionService({ db, storage });
 *
 * @example
 * // Use custom strategy
 * const service = createRetentionService({
 *   db,
 *   storage,
 *   archiveStrategy: 'custom',
 *   customArchiver: new MyCustomArchiver(storage)
 * });
 */
export function createRetentionService(options: RetentionServiceOptions): RetentionService {
  const { db, storage, archiveStrategy = 'deletion', customArchiver } = options;

  let archiver: IStorageArchiver;

  switch (archiveStrategy) {
    case 'deletion':
      archiver = new DeletionArchiveStrategy(storage);
      logger.info('RetentionService created with deletion archive strategy');
      break;

    case 'custom':
      if (!customArchiver) {
        throw new Error('customArchiver is required when archiveStrategy is "custom"');
      }
      archiver = customArchiver;
      logger.info('RetentionService created with custom archive strategy', {
        strategyName: archiver.getStrategyName(),
      });
      break;

    default:
      throw new Error(`Unknown archive strategy: ${archiveStrategy}`);
  }

  return new RetentionService(db, storage, archiver);
}

/**
 * Create RetentionService from environment variables
 *
 * Environment variables:
 * - ARCHIVE_STRATEGY: 'deletion' (default: 'deletion')
 *
 * Note: For custom strategies, use createRetentionService directly
 */
export function createRetentionServiceFromEnv(
  db: DatabaseClient,
  storage: BaseStorageService
): RetentionService {
  const strategyEnv = process.env.ARCHIVE_STRATEGY?.toLowerCase() as
    | ArchiveStrategyType
    | undefined;
  const archiveStrategy = strategyEnv && strategyEnv === 'deletion' ? strategyEnv : 'deletion';

  logger.info('Creating RetentionService from environment', {
    archiveStrategy,
  });

  return createRetentionService({
    db,
    storage,
    archiveStrategy,
  });
}
