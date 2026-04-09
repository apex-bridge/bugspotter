/**
 * Intelligence Config Tests
 * Unit tests for config loading, validation, and NaN/edge case handling.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  loadIntelligenceConfig,
  validateIntelligenceConfig,
} from '../../../src/config/intelligence.config.js';

describe('Intelligence Config', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clear intelligence-related env vars
    Object.keys(process.env).forEach((key) => {
      if (key.startsWith('INTELLIGENCE_')) {
        delete process.env[key];
      }
    });
  });

  afterEach(() => {
    // Restore original env
    Object.keys(process.env).forEach((key) => {
      if (key.startsWith('INTELLIGENCE_')) {
        delete process.env[key];
      }
    });
    Object.assign(process.env, originalEnv);
  });

  describe('loadIntelligenceConfig', () => {
    it('should return disabled config by default', () => {
      const config = loadIntelligenceConfig();
      expect(config.enabled).toBe(false);
    });

    it('should enable when INTELLIGENCE_ENABLED=true', () => {
      process.env.INTELLIGENCE_ENABLED = 'true';
      process.env.INTELLIGENCE_API_URL = 'http://test:8000';
      process.env.INTELLIGENCE_API_KEY = 'test-key';

      const config = loadIntelligenceConfig();
      expect(config.enabled).toBe(true);
      expect(config.client.baseUrl).toBe('http://test:8000');
      expect(config.client.apiKey).toBe('test-key');
    });

    it('should use defaults for optional numeric fields', () => {
      const config = loadIntelligenceConfig();
      expect(config.client.timeout).toBe(10000);
      expect(config.client.maxRetries).toBe(3);
      expect(config.client.backoffDelay).toBe(1000);
      expect(config.client.circuitBreaker.failureThreshold).toBe(5);
      expect(config.client.circuitBreaker.resetTimeout).toBe(30000);
    });

    it('should parse custom numeric values when enabled', () => {
      process.env.INTELLIGENCE_ENABLED = 'true';
      process.env.INTELLIGENCE_TIMEOUT_MS = '5000';
      process.env.INTELLIGENCE_MAX_RETRIES = '5';

      const config = loadIntelligenceConfig();
      expect(config.client.timeout).toBe(5000);
      expect(config.client.maxRetries).toBe(5);
    });

    it('should throw on non-numeric env var values when enabled', () => {
      process.env.INTELLIGENCE_ENABLED = 'true';
      process.env.INTELLIGENCE_TIMEOUT_MS = 'not-a-number';
      expect(() => loadIntelligenceConfig()).toThrow('must be a valid integer');
    });

    it('should reject partial numeric values like "1000ms" when enabled', () => {
      process.env.INTELLIGENCE_ENABLED = 'true';
      process.env.INTELLIGENCE_TIMEOUT_MS = '1000ms';
      expect(() => loadIntelligenceConfig()).toThrow('must be a valid integer');
    });

    it('should reject decimal values like "12.5" when enabled', () => {
      process.env.INTELLIGENCE_ENABLED = 'true';
      process.env.INTELLIGENCE_TIMEOUT_MS = '12.5';
      expect(() => loadIntelligenceConfig()).toThrow('must be a valid integer');
    });

    it('should ignore invalid numeric env vars when disabled', () => {
      process.env.INTELLIGENCE_TIMEOUT_MS = 'not-a-number';
      expect(() => loadIntelligenceConfig()).not.toThrow();
      const config = loadIntelligenceConfig();
      expect(config.enabled).toBe(false);
      expect(config.client.timeout).toBe(10000); // default
    });

    it('should default baseUrl to empty string (not localhost)', () => {
      const config = loadIntelligenceConfig();
      expect(config.client.baseUrl).toBe('');
    });
  });

  describe('validateIntelligenceConfig', () => {
    it('should skip validation when disabled', () => {
      const config = loadIntelligenceConfig();
      expect(() => validateIntelligenceConfig(config)).not.toThrow();
    });

    it('should require baseUrl when enabled', () => {
      process.env.INTELLIGENCE_ENABLED = 'true';
      process.env.INTELLIGENCE_API_KEY = 'test-key';

      const config = loadIntelligenceConfig();
      expect(() => validateIntelligenceConfig(config)).toThrow('INTELLIGENCE_API_URL is required');
    });

    it('should require apiKey when enabled', () => {
      process.env.INTELLIGENCE_ENABLED = 'true';
      process.env.INTELLIGENCE_API_URL = 'http://test:8000';

      const config = loadIntelligenceConfig();
      expect(() => validateIntelligenceConfig(config)).toThrow('INTELLIGENCE_API_KEY is required');
    });

    it('should require timeout >= 1000', () => {
      process.env.INTELLIGENCE_ENABLED = 'true';
      process.env.INTELLIGENCE_API_URL = 'http://test:8000';
      process.env.INTELLIGENCE_API_KEY = 'test-key';
      process.env.INTELLIGENCE_TIMEOUT_MS = '500';

      const config = loadIntelligenceConfig();
      expect(() => validateIntelligenceConfig(config)).toThrow('INTELLIGENCE_TIMEOUT_MS');
    });

    it('should pass with valid config', () => {
      process.env.INTELLIGENCE_ENABLED = 'true';
      process.env.INTELLIGENCE_API_URL = 'http://test:8000';
      process.env.INTELLIGENCE_API_KEY = 'test-key';

      const config = loadIntelligenceConfig();
      expect(() => validateIntelligenceConfig(config)).not.toThrow();
    });

    it('should collect multiple errors', () => {
      process.env.INTELLIGENCE_ENABLED = 'true';
      // Missing both URL and key

      const config = loadIntelligenceConfig();
      try {
        validateIntelligenceConfig(config);
        expect.fail('Should have thrown');
      } catch (error) {
        const message = (error as Error).message;
        expect(message).toContain('INTELLIGENCE_API_URL');
        expect(message).toContain('INTELLIGENCE_API_KEY');
      }
    });
  });
});
