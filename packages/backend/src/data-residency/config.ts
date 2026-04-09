/**
 * Data Residency Configuration
 *
 * Manages regional storage configuration and bucket mapping
 * for data residency compliance (KZ, RF, EU, US)
 */

import { getLogger } from '../logger.js';
import type {
  DataResidencyRegion,
  StorageRegion,
  RegionalStorageConfig,
  DataResidencyPolicy,
} from './types.js';
import {
  ALLOWED_STORAGE_REGIONS,
  DEFAULT_STORAGE_REGION,
  DATA_RESIDENCY_PRESETS,
  STRICT_DATA_RESIDENCY_REGIONS,
} from './types.js';

const logger = getLogger();

/**
 * Environment variable prefix for regional storage configuration
 * Example: STORAGE_KZ_ALMATY_ENDPOINT, STORAGE_KZ_ALMATY_BUCKET
 */
const ENV_PREFIX = 'STORAGE_';

/**
 * Regional storage configurations loaded from environment variables
 */
const regionalConfigs = new Map<StorageRegion, RegionalStorageConfig>();

/**
 * Region display names and country codes
 */
const REGION_METADATA: Record<StorageRegion, { displayName: string; countryCode: string }> = {
  'kz-almaty': { displayName: 'Kazakhstan (Almaty)', countryCode: 'KZ' },
  'kz-astana': { displayName: 'Kazakhstan (Astana)', countryCode: 'KZ' },
  'rf-moscow': { displayName: 'Russia (Moscow)', countryCode: 'RU' },
  'rf-spb': { displayName: 'Russia (St. Petersburg)', countryCode: 'RU' },
  'eu-west-1': { displayName: 'EU (Ireland)', countryCode: 'IE' },
  'eu-central-1': { displayName: 'EU (Frankfurt)', countryCode: 'DE' },
  'eu-north-1': { displayName: 'EU (Stockholm)', countryCode: 'SE' },
  'us-east-1': { displayName: 'US East (Virginia)', countryCode: 'US' },
  'us-west-2': { displayName: 'US West (Oregon)', countryCode: 'US' },
  auto: { displayName: 'Auto (Global)', countryCode: 'XX' },
};

/**
 * Convert storage region to environment variable suffix
 * e.g., 'kz-almaty' -> 'KZ_ALMATY'
 */
export function regionToEnvSuffix(region: StorageRegion): string {
  return region.toUpperCase().replace(/-/g, '_');
}

/**
 * Load regional storage configuration from environment variables
 *
 * Expected environment variables:
 * - STORAGE_KZ_ALMATY_ENDPOINT
 * - STORAGE_KZ_ALMATY_BUCKET
 * - STORAGE_KZ_ALMATY_ACCESS_KEY (optional)
 * - STORAGE_KZ_ALMATY_SECRET_KEY (optional)
 * - STORAGE_KZ_ALMATY_REGION (optional, for S3 client region)
 */
function loadRegionalConfig(region: StorageRegion): RegionalStorageConfig | null {
  if (region === 'auto') {
    // 'auto' uses the default storage configuration
    return null;
  }

  const suffix = regionToEnvSuffix(region);
  const endpoint = process.env[`${ENV_PREFIX}${suffix}_ENDPOINT`];
  const bucket = process.env[`${ENV_PREFIX}${suffix}_BUCKET`];

  // Region is not configured if endpoint or bucket is missing
  if (!endpoint || !bucket) {
    return null;
  }

  const metadata = REGION_METADATA[region] ?? {
    displayName: region,
    countryCode: 'XX',
  };

  return {
    region,
    endpoint,
    bucket,
    accessKeyId: process.env[`${ENV_PREFIX}${suffix}_ACCESS_KEY`],
    secretAccessKey: process.env[`${ENV_PREFIX}${suffix}_SECRET_KEY`],
    s3Region: process.env[`${ENV_PREFIX}${suffix}_REGION`],
    available: true,
    displayName: metadata.displayName,
    countryCode: metadata.countryCode,
  };
}

/**
 * Initialize data residency configuration
 * Loads all regional storage configurations from environment variables
 */
export function initializeDataResidency(): void {
  // Clear existing configuration to support reinitialization (useful for testing)
  regionalConfigs.clear();

  // Dynamically generate the list of regions from ALLOWED_STORAGE_REGIONS
  // This ensures new regions are automatically included without manual updates
  const allRegions = Object.values(ALLOWED_STORAGE_REGIONS).flat();
  const regions = Array.from(new Set(allRegions)).filter(
    (region): region is Exclude<StorageRegion, 'auto'> => region !== 'auto'
  );

  const configuredRegions: string[] = [];

  for (const region of regions) {
    const config = loadRegionalConfig(region);
    if (config) {
      regionalConfigs.set(region, config);
      configuredRegions.push(region);
    }
  }

  // Log configured regions (without sensitive data)
  if (configuredRegions.length > 0) {
    logger.info('Data residency configuration loaded', {
      configuredRegions,
      count: configuredRegions.length,
    });
  } else {
    logger.debug('No regional storage configured, using default storage');
  }
}

/**
 * Get storage configuration for a specific region
 */
export function getRegionalStorageConfig(region: StorageRegion): RegionalStorageConfig | null {
  return regionalConfigs.get(region) ?? null;
}

/**
 * Get all configured regional storage configurations
 */
export function getAllRegionalStorageConfigs(): RegionalStorageConfig[] {
  return Array.from(regionalConfigs.values());
}

/**
 * Check if a storage region is available
 */
export function isRegionAvailable(region: StorageRegion): boolean {
  if (region === 'auto') {
    return true; // 'auto' is always available (uses default storage)
  }
  return regionalConfigs.has(region);
}

/**
 * Get available storage regions for a data residency region
 */
export function getAvailableStorageRegions(
  dataResidencyRegion: DataResidencyRegion
): StorageRegion[] {
  const allowed = ALLOWED_STORAGE_REGIONS[dataResidencyRegion];
  return allowed.filter((region) => isRegionAvailable(region));
}

/**
 * Get the default storage region for a data residency region
 * Falls back to first available region if default is not configured
 */
export function getDefaultStorageRegionFor(
  dataResidencyRegion: DataResidencyRegion
): StorageRegion {
  const defaultRegion = DEFAULT_STORAGE_REGION[dataResidencyRegion];

  // If default is available, use it
  if (isRegionAvailable(defaultRegion)) {
    return defaultRegion;
  }

  // Otherwise, find first available region
  const available = getAvailableStorageRegions(dataResidencyRegion);
  if (available.length > 0) {
    logger.warn('Default storage region not available, using fallback', {
      dataResidencyRegion,
      defaultRegion,
      fallbackRegion: available[0],
    });
    return available[0];
  }

  // If no regional storage is configured, fall back to 'auto'
  logger.warn('No regional storage available for data residency region', {
    dataResidencyRegion,
    fallbackRegion: 'auto',
  });
  return 'auto';
}

/**
 * Validate that a storage region is allowed for a data residency region
 */
export function validateStorageRegion(
  storageRegion: StorageRegion,
  dataResidencyRegion: DataResidencyRegion
): { valid: boolean; error?: string } {
  const allowed = ALLOWED_STORAGE_REGIONS[dataResidencyRegion];

  if (!allowed.includes(storageRegion)) {
    return {
      valid: false,
      error: `Storage region '${storageRegion}' is not allowed for data residency region '${dataResidencyRegion}'. Allowed regions: ${allowed.join(', ')}`,
    };
  }

  if (!isRegionAvailable(storageRegion)) {
    return {
      valid: false,
      error: `Storage region '${storageRegion}' is not configured. Configure it with environment variables: ${ENV_PREFIX}${regionToEnvSuffix(storageRegion)}_ENDPOINT and ${ENV_PREFIX}${regionToEnvSuffix(storageRegion)}_BUCKET`,
    };
  }

  return { valid: true };
}

/**
 * Get data residency policy for a region
 * Returns the preset policy for the region, or creates a custom one
 */
export function getDataResidencyPolicy(
  region: DataResidencyRegion,
  storageRegion?: StorageRegion
): DataResidencyPolicy {
  const preset = DATA_RESIDENCY_PRESETS[region];

  if (!storageRegion) {
    return preset;
  }

  // Validate storage region is allowed
  const validation = validateStorageRegion(storageRegion, region);
  if (!validation.valid) {
    logger.warn('Invalid storage region for data residency policy', {
      region,
      storageRegion,
      error: validation.error,
    });
    return preset;
  }

  return {
    ...preset,
    storageRegion,
  };
}

/**
 * Get data residency region from a country code
 * Maps ISO 3166-1 alpha-2 country codes to data residency regions
 */
export function getDataResidencyRegionFromCountry(countryCode: string): DataResidencyRegion {
  const code = countryCode.toUpperCase();

  // Kazakhstan
  if (code === 'KZ') {
    return 'kz';
  }

  // Russia
  if (code === 'RU') {
    return 'rf';
  }

  // EU member states
  const euCountries = [
    'AT', // Austria
    'BE', // Belgium
    'BG', // Bulgaria
    'HR', // Croatia
    'CY', // Cyprus
    'CZ', // Czech Republic
    'DK', // Denmark
    'EE', // Estonia
    'FI', // Finland
    'FR', // France
    'DE', // Germany
    'GR', // Greece
    'HU', // Hungary
    'IE', // Ireland
    'IT', // Italy
    'LV', // Latvia
    'LT', // Lithuania
    'LU', // Luxembourg
    'MT', // Malta
    'NL', // Netherlands
    'PL', // Poland
    'PT', // Portugal
    'RO', // Romania
    'SK', // Slovakia
    'SI', // Slovenia
    'ES', // Spain
    'SE', // Sweden
  ];

  if (euCountries.includes(code)) {
    return 'eu';
  }

  // United States
  if (code === 'US') {
    return 'us';
  }

  // Default to global
  return 'global';
}

/**
 * Format regional storage statistics for logging/monitoring
 */
export function getRegionalStorageStats(): {
  totalConfigured: number;
  regions: Array<{
    region: StorageRegion;
    displayName: string;
    countryCode: string;
    available: boolean;
  }>;
} {
  const regions = Array.from(regionalConfigs.values()).map((config) => ({
    region: config.region,
    displayName: config.displayName,
    countryCode: config.countryCode,
    available: config.available,
  }));

  return {
    totalConfigured: regions.length,
    regions,
  };
}

/**
 * Validate that required storage regions are configured for strict residency regions
 *
 * This checks that if strict data residency regions (KZ, RF) are enabled,
 * their required storage regions are actually configured with endpoints and buckets.
 *
 * Can be disabled via DISABLE_STRICT_RESIDENCY_VALIDATION=true for testing/CI.
 *
 * @throws Error if strict residency region storage is not configured
 * @returns Object with validation results and warnings
 */
export function validateStrictResidencyStorage(): {
  valid: boolean;
  errors: string[];
  warnings: string[];
} {
  // Skip validation if explicitly disabled (for testing/CI environments)
  if (process.env.DISABLE_STRICT_RESIDENCY_VALIDATION === 'true') {
    return { valid: true, errors: [], warnings: [] };
  }

  const errors: string[] = [];
  const warnings: string[] = [];

  // Check each strict residency region
  for (const region of Array.from(STRICT_DATA_RESIDENCY_REGIONS)) {
    const allowedStorageRegions = ALLOWED_STORAGE_REGIONS[region];
    const hasConfiguredStorage = allowedStorageRegions.some(
      (storageRegion) => storageRegion === 'auto' || isRegionAvailable(storageRegion)
    );

    if (!hasConfiguredStorage) {
      errors.push(
        `Strict data residency region '${region.toUpperCase()}' requires storage configuration. ` +
          `Configure one of: ${allowedStorageRegions.join(', ')}`
      );
    } else {
      // Check if all allowed regions are configured (warn if some are missing)
      const unconfiguredRegions = allowedStorageRegions.filter(
        (storageRegion) => storageRegion !== 'auto' && !isRegionAvailable(storageRegion)
      );

      if (unconfiguredRegions.length > 0) {
        warnings.push(
          `Some storage regions for ${region.toUpperCase()} are not configured: ${unconfiguredRegions.join(', ')}. ` +
            `Only configured regions will be available.`
        );
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// Re-export types and presets for convenience
export {
  ALLOWED_STORAGE_REGIONS,
  DEFAULT_STORAGE_REGION,
  DATA_RESIDENCY_PRESETS,
} from './types.js';
