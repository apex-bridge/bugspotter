/**
 * Data Residency Types
 *
 * Defines types for data residency compliance including:
 * - Geographic regions (KZ, RF, EU, US, etc.)
 * - Storage location requirements
 * - Data locality policies
 */

import { z } from 'zod';

/**
 * Supported data residency regions
 *
 * @description
 * - 'kz' - Kazakhstan (Law on Personal Data, data must stay in KZ)
 * - 'rf' - Russian Federation (Federal Law 242-FZ, data must stay in RU)
 * - 'eu' - European Union (GDPR, data can be in any EU country)
 * - 'us' - United States (various state laws, no federal requirement)
 * - 'global' - No geographic restrictions
 */
export type DataResidencyRegion = 'kz' | 'rf' | 'eu' | 'us' | 'global';

/**
 * Storage regions mapped to cloud provider regions
 * These define where data can physically be stored
 */
export type StorageRegion =
  // Kazakhstan
  | 'kz-almaty'
  | 'kz-astana'
  // Russia
  | 'rf-moscow'
  | 'rf-spb'
  // EU
  | 'eu-west-1' // Ireland
  | 'eu-central-1' // Frankfurt
  | 'eu-north-1' // Stockholm
  // US
  | 'us-east-1' // Virginia
  | 'us-west-2' // Oregon
  // Global/Any
  | 'auto';

/**
 * Regions that require strict data residency compliance
 * (cannot use 'auto' storage, require regional storage configuration)
 */
export const STRICT_DATA_RESIDENCY_REGIONS: ReadonlySet<DataResidencyRegion> = new Set([
  'kz',
  'rf',
]);

/**
 * Mapping of data residency regions to allowed storage regions
 */
export const ALLOWED_STORAGE_REGIONS: Record<DataResidencyRegion, StorageRegion[]> = {
  kz: ['kz-almaty', 'kz-astana'],
  rf: ['rf-moscow', 'rf-spb'],
  eu: ['eu-west-1', 'eu-central-1', 'eu-north-1'],
  us: ['us-east-1', 'us-west-2'],
  global: [
    'auto',
    'kz-almaty',
    'kz-astana',
    'rf-moscow',
    'rf-spb',
    'eu-west-1',
    'eu-central-1',
    'eu-north-1',
    'us-east-1',
    'us-west-2',
  ],
};

/**
 * Default storage region for each data residency region
 */
export const DEFAULT_STORAGE_REGION: Record<DataResidencyRegion, StorageRegion> = {
  kz: 'kz-almaty',
  rf: 'rf-moscow',
  eu: 'eu-central-1',
  us: 'us-east-1',
  global: 'auto',
};

/**
 * Data residency policy for a project
 */
export interface DataResidencyPolicy {
  /** The compliance region that determines data locality rules */
  region: DataResidencyRegion;

  /** Specific storage region for this project's data */
  storageRegion: StorageRegion;

  /** Whether cross-region data transfer is allowed (for backups, etc.) */
  allowCrossRegionBackup: boolean;

  /** Whether data can be processed outside the region (for analytics, AI, etc.) */
  allowCrossRegionProcessing: boolean;

  /** Encryption requirements */
  encryptionRequired: boolean;

  /** Whether to log all data access for audit */
  auditDataAccess: boolean;
}

/**
 * Zod schema for DataResidencyPolicy validation
 */
export const DataResidencyPolicySchema = z.object({
  region: z.enum(['kz', 'rf', 'eu', 'us', 'global']),
  storageRegion: z.enum([
    'kz-almaty',
    'kz-astana',
    'rf-moscow',
    'rf-spb',
    'eu-west-1',
    'eu-central-1',
    'eu-north-1',
    'us-east-1',
    'us-west-2',
    'auto',
  ]),
  allowCrossRegionBackup: z.boolean(),
  allowCrossRegionProcessing: z.boolean(),
  encryptionRequired: z.boolean(),
  auditDataAccess: z.boolean(),
});

/**
 * Default data residency policy (global, no restrictions)
 */
export const DEFAULT_DATA_RESIDENCY_POLICY: DataResidencyPolicy = {
  region: 'global',
  storageRegion: 'auto',
  allowCrossRegionBackup: true,
  allowCrossRegionProcessing: true,
  encryptionRequired: false,
  auditDataAccess: false,
};

/**
 * Strict data residency policy presets for specific regions
 */
export const DATA_RESIDENCY_PRESETS: Record<DataResidencyRegion, DataResidencyPolicy> = {
  kz: {
    region: 'kz',
    storageRegion: 'kz-almaty',
    allowCrossRegionBackup: false, // KZ law requires data to stay in KZ
    allowCrossRegionProcessing: false,
    encryptionRequired: true,
    auditDataAccess: true,
  },
  rf: {
    region: 'rf',
    storageRegion: 'rf-moscow',
    allowCrossRegionBackup: false, // 242-FZ requires data to stay in Russia
    allowCrossRegionProcessing: false,
    encryptionRequired: true,
    auditDataAccess: true,
  },
  eu: {
    region: 'eu',
    storageRegion: 'eu-central-1',
    allowCrossRegionBackup: true, // GDPR allows within EU/EEA
    allowCrossRegionProcessing: false, // No processing outside EU without adequacy
    encryptionRequired: true,
    auditDataAccess: true,
  },
  us: {
    region: 'us',
    storageRegion: 'us-east-1',
    allowCrossRegionBackup: true,
    allowCrossRegionProcessing: true,
    encryptionRequired: false,
    auditDataAccess: false,
  },
  global: DEFAULT_DATA_RESIDENCY_POLICY,
};

/**
 * Regional storage bucket configuration
 */
export interface RegionalStorageConfig {
  /** Storage region identifier */
  region: StorageRegion;

  /** S3-compatible endpoint URL */
  endpoint: string;

  /** Bucket name for this region */
  bucket: string;

  /** Access key ID (optional if using IAM roles) */
  accessKeyId?: string;

  /** Secret access key (optional if using IAM roles) */
  secretAccessKey?: string;

  /**
   * S3 client region string (optional)
   * For AWS: use actual AWS region (e.g., 'ap-northeast-1', 'sa-east-1')
   * For S3-compatible providers: use provider-specific region string
   * If not set, defaults to the storage region identifier
   */
  s3Region?: string;

  /** Whether this region is currently available */
  available: boolean;

  /** Human-readable name for the region */
  displayName: string;

  /** Country code (ISO 3166-1 alpha-2) */
  countryCode: string;
}

/**
 * Data residency violation event
 */
export interface DataResidencyViolation {
  /** Unique violation ID */
  id: string;

  /** Project that was affected */
  projectId: string;

  /** Type of violation */
  violationType:
    | 'storage_region_mismatch'
    | 'cross_region_transfer'
    | 'unauthorized_processing'
    | 'policy_change_denied';

  /** Detailed description */
  description: string;

  /** Attempted action that caused the violation */
  attemptedAction: string;

  /** User who triggered the violation (if applicable) */
  userId?: string;

  /** Source region (where data was coming from) */
  sourceRegion?: StorageRegion;

  /** Target region (where data was going to) */
  targetRegion?: StorageRegion;

  /** Whether the violation was blocked or just logged */
  blocked: boolean;

  /** When the violation occurred */
  createdAt: Date;
}

/**
 * Data residency audit log entry
 */
export interface DataResidencyAuditEntry {
  /** Unique entry ID */
  id: string;

  /** Project ID */
  projectId: string;

  /** Action performed */
  action:
    | 'data_created'
    | 'data_read'
    | 'data_updated'
    | 'data_deleted'
    | 'data_exported'
    | 'policy_changed'
    | 'region_changed';

  /** Resource type (e.g., 'bug_report', 'screenshot', 'replay') */
  resourceType: string;

  /** Resource ID */
  resourceId?: string;

  /** Storage region where the action occurred */
  storageRegion: StorageRegion;

  /** User who performed the action */
  userId?: string;

  /** IP address of the request */
  ipAddress?: string;

  /** Additional metadata */
  metadata?: Record<string, unknown>;

  /** When the action occurred */
  createdAt: Date;
}

/**
 * Result of validating data residency for an operation
 */
export interface DataResidencyValidationResult {
  /** Whether the operation is allowed */
  allowed: boolean;

  /** Reason for denial (if not allowed) */
  reason?: string;

  /** The policy that was applied */
  policy: DataResidencyPolicy;

  /** Target storage region for the operation */
  targetRegion: StorageRegion;

  /** Warnings (non-blocking issues) */
  warnings?: string[];
}
