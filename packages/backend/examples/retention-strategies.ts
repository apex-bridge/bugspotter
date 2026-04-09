/**
 * Example: Creating RetentionService with different archive strategies
 *
 * NOTE: These are demonstration examples showing API usage patterns.
 * The factory functions require BaseStorageService (concrete implementation)
 * not IStorageService interface. In production, use actual storage instances
 * like StorageService or LocalStorageService.
 */

import type { DatabaseClient } from '../src/db/client.js';
import type { BaseStorageService } from '../src/storage/base-storage-service.js';
import type { IStorageArchiver } from '../src/storage/archive-storage.interface.js';
import {
  createRetentionService,
  createRetentionServiceFromEnv,
  RetentionScheduler,
} from '../src/retention/index.js';

/**
 * Example 1: Default deletion strategy (simplest approach)
 *
 * The factory automatically uses DeletionArchiveStrategy when no strategy specified.
 * This immediately deletes S3 files during retention cleanup.
 */
export function example1_DefaultStrategy(db: DatabaseClient, storage: BaseStorageService) {
  const retentionService = createRetentionService({
    db,
    storage,
  });
  // Uses deletion strategy by default

  console.log('Created with default deletion strategy');
  return retentionService;
}

/**
 * Example 2: Explicit deletion strategy
 *
 * Same as Example 1, but explicitly specifies 'deletion' strategy.
 * Useful for clarity in production code.
 */
export function example2_ExplicitDeletion(db: DatabaseClient, storage: BaseStorageService) {
  const retentionService = createRetentionService({
    db,
    storage,
    archiveStrategy: 'deletion',
  });

  console.log('Created with explicit deletion strategy');
  return retentionService;
}

/**
 * Example 3: Custom strategy implementation
 *
 * Bring your own IStorageArchiver implementation for custom archival logic.
 * Useful for: Glacier integration, archive prefixes, multi-region, etc.
 */
export function example3_CustomStrategy(
  db: DatabaseClient,
  storage: BaseStorageService,
  customArchiver: IStorageArchiver
) {
  const retentionService = createRetentionService({
    db,
    storage,
    archiveStrategy: 'custom',
    customArchiver,
  });

  console.log('Created with custom archive strategy');
  return retentionService;
}

/**
 * Example 4: Create from environment variables
 *
 * Reads ARCHIVE_STRATEGY from environment:
 * - export ARCHIVE_STRATEGY=deletion (default if not set)
 * - export ARCHIVE_STRATEGY=custom (requires custom implementation)
 */
export function example4_FromEnvironment(db: DatabaseClient, storage: BaseStorageService) {
  const retentionService = createRetentionServiceFromEnv(db, storage);

  console.log('Created from environment variables');
  return retentionService;
}

/**
 * Example 5: Production setup with scheduler
 *
 * Complete setup with automated retention runs.
 * Scheduler runs daily at 2 AM by default (configurable).
 */
export function example5_ProductionSetup(db: DatabaseClient, storage: BaseStorageService) {
  // Create retention service with environment-based strategy
  const retentionService = createRetentionServiceFromEnv(db, storage);

  // Create scheduler (optional - for automated runs)
  const scheduler = new RetentionScheduler(retentionService);

  // Start automated retention (runs daily at 2 AM by default)
  scheduler.start();

  console.log('Production retention service running with scheduler');

  return { retentionService, scheduler };
}
