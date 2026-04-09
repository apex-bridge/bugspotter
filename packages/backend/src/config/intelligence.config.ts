/**
 * Intelligence Service Configuration
 * Reads intelligence-related environment variables and provides typed config.
 */

import { getLogger } from '../logger.js';
import { assertMinimum, assertNonNegative } from './validators.js';
import type { IntelligenceClientConfig } from '../services/intelligence/types.js';

const logger = getLogger();

export interface IntelligenceConfig {
  /** Whether intelligence integration is enabled */
  enabled: boolean;
  /** Client config for IntelligenceClient */
  client: IntelligenceClientConfig;
  /** Master API key for cross-tenant operations (e.g. generating per-org keys) */
  masterApiKey: string;
  /**
   * Base URL for admin/provisioning calls to the intelligence service.
   * Always read from INTELLIGENCE_API_URL regardless of `enabled`, so that
   * admins can provision per-org keys before the global feature is turned on.
   */
  adminBaseUrl: string;
}

function getEnvInt(key: string, defaultValue: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return defaultValue;
  // Strict check: only digits with optional leading minus, reject "1000ms", "12.5", etc.
  if (!/^-?\d+$/.test(raw)) {
    throw new Error(`${key} must be a valid integer, got: "${raw}"`);
  }
  const parsed = parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${key} must be a valid integer, got: "${raw}"`);
  }
  return parsed;
}

export function loadIntelligenceConfig(): IntelligenceConfig {
  const enabled = process.env.INTELLIGENCE_ENABLED === 'true';

  // Only parse numeric env vars when enabled — a stray invalid value
  // (e.g. INTELLIGENCE_TIMEOUT_MS=foo) shouldn't crash startup when disabled.
  const client: IntelligenceClientConfig = enabled
    ? {
        baseUrl: process.env.INTELLIGENCE_API_URL || '',
        apiKey: process.env.INTELLIGENCE_API_KEY || '',
        timeout: getEnvInt('INTELLIGENCE_TIMEOUT_MS', 10000),
        maxRetries: getEnvInt('INTELLIGENCE_MAX_RETRIES', 3),
        backoffDelay: getEnvInt('INTELLIGENCE_BACKOFF_DELAY_MS', 1000),
        circuitBreaker: {
          failureThreshold: getEnvInt('INTELLIGENCE_CB_FAILURE_THRESHOLD', 5),
          resetTimeout: getEnvInt('INTELLIGENCE_CB_RESET_TIMEOUT_MS', 30000),
          halfOpenSuccessThreshold: 2,
        },
      }
    : {
        baseUrl: '',
        apiKey: '',
        timeout: 10000,
        maxRetries: 3,
        backoffDelay: 1000,
        circuitBreaker: {
          failureThreshold: 5,
          resetTimeout: 30000,
          halfOpenSuccessThreshold: 2,
        },
      };

  const masterApiKey = process.env.INTELLIGENCE_MASTER_API_KEY || '';
  // Always read the base URL regardless of `enabled` — admin provisioning must work
  // before the global feature flag is turned on (provision key → then enable).
  const adminBaseUrl = process.env.INTELLIGENCE_API_URL || '';

  const config: IntelligenceConfig = { enabled, client, masterApiKey, adminBaseUrl };

  if (enabled) {
    logger.info('Intelligence integration enabled', {
      baseUrl: config.client.baseUrl,
      timeout: config.client.timeout,
      maxRetries: config.client.maxRetries,
    });
  } else {
    logger.info('Intelligence integration disabled');
  }

  return config;
}

export function validateIntelligenceConfig(config: IntelligenceConfig): void {
  if (!config.enabled) return;

  const errors: string[] = [];

  if (!config.client.baseUrl) {
    errors.push('INTELLIGENCE_API_URL is required when intelligence is enabled');
  }

  if (!config.client.apiKey) {
    errors.push('INTELLIGENCE_API_KEY is required when intelligence is enabled');
  }

  const collectError = (validator: () => void) => {
    try {
      validator();
    } catch (e) {
      errors.push((e as Error).message);
    }
  };

  collectError(() => assertMinimum(config.client.timeout, 'INTELLIGENCE_TIMEOUT_MS', 1000));
  collectError(() => assertNonNegative(config.client.maxRetries, 'INTELLIGENCE_MAX_RETRIES'));
  collectError(() =>
    assertNonNegative(config.client.backoffDelay, 'INTELLIGENCE_BACKOFF_DELAY_MS')
  );
  collectError(() =>
    assertMinimum(
      config.client.circuitBreaker.failureThreshold,
      'INTELLIGENCE_CB_FAILURE_THRESHOLD',
      1
    )
  );
  collectError(() =>
    assertMinimum(
      config.client.circuitBreaker.resetTimeout,
      'INTELLIGENCE_CB_RESET_TIMEOUT_MS',
      1000
    )
  );

  if (errors.length > 0) {
    throw new Error(
      `Intelligence configuration validation failed:\n${errors.map((e) => `  - ${e}`).join('\n')}`
    );
  }
}

// Singleton
let intelligenceConfigInstance: IntelligenceConfig | null = null;

export function getIntelligenceConfig(): IntelligenceConfig {
  if (!intelligenceConfigInstance) {
    intelligenceConfigInstance = loadIntelligenceConfig();
    validateIntelligenceConfig(intelligenceConfigInstance);
  }
  return intelligenceConfigInstance;
}
