/**
 * Data Residency Module
 *
 * Provides data residency compliance for BugSpotter:
 * - KZ (Kazakhstan) - Data must stay in Kazakhstan
 * - RF (Russia) - Data must stay in Russia (242-FZ)
 * - EU - Data must stay in EU/EEA (GDPR)
 * - US - US-based storage
 * - Global - No restrictions
 *
 * @example
 * ```typescript
 * import { Pool } from 'pg';
 * import {
 *   DataResidencyService,
 *   initializeDataResidency,
 *   type DataResidencyRegion,
 * } from './data-residency/index.js';
 * import { DataResidencyRepository } from './db/repositories/data-residency.repository.js';
 *
 * // Initialize on server startup
 * initializeDataResidency();
 *
 * // Create service with repository
 * const pool = new Pool({ connectionString: process.env.DATABASE_URL });
 * const repository = new DataResidencyRepository(pool);
 * const service = new DataResidencyService(repository);
 *
 * // Set policy for a project
 * await service.setProjectPolicy(projectId, {
 *   region: 'kz',
 *   storageRegion: 'kz-almaty',
 *   allowCrossRegionBackup: false,
 *   allowCrossRegionProcessing: false,
 *   encryptionRequired: true,
 *   auditDataAccess: true,
 * });
 *
 * // Validate storage operation
 * const result = await service.validateStorageOperation(projectId, 'create');
 * if (!result.allowed) {
 *   throw new Error(result.reason);
 * }
 * ```
 */

// Types
export type {
  DataResidencyRegion,
  StorageRegion,
  DataResidencyPolicy,
  RegionalStorageConfig,
  DataResidencyViolation,
  DataResidencyAuditEntry,
  DataResidencyValidationResult,
} from './types.js';

export {
  ALLOWED_STORAGE_REGIONS,
  DEFAULT_STORAGE_REGION,
  DATA_RESIDENCY_PRESETS,
  DEFAULT_DATA_RESIDENCY_POLICY,
  DataResidencyPolicySchema,
} from './types.js';

// Configuration
export {
  initializeDataResidency,
  getRegionalStorageConfig,
  getAllRegionalStorageConfigs,
  isRegionAvailable,
  getAvailableStorageRegions,
  getDefaultStorageRegionFor,
  validateStorageRegion,
  getDataResidencyPolicy,
  getDataResidencyRegionFromCountry,
  getRegionalStorageStats,
} from './config.js';

// Service
export { DataResidencyService } from './data-residency-service.js';

// Regional Storage Router
export {
  RegionalStorageRouter,
  createRegionalStorageRouter,
  initializeDefaultStorage,
  destroyRegionalClients,
} from './regional-storage-router.js';

// Middleware
export {
  createDataResidencyMiddleware,
  createStrictDataResidencyMiddleware,
  createCrossRegionTransferMiddleware,
  getDataResidencyHeaders,
} from './middleware.js';

// Context type (exported from central types file)
export type { DataResidencyContext } from '../api/types.js';
