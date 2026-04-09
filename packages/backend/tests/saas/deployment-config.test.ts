/**
 * Deployment Config Tests
 * Tests for DEPLOYMENT_MODE env var and feature flag derivation
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getDeploymentConfig, resetDeploymentConfig } from '../../src/saas/config.js';

describe('getDeploymentConfig', () => {
  const originalEnv = process.env.DEPLOYMENT_MODE;

  beforeEach(() => {
    resetDeploymentConfig();
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.DEPLOYMENT_MODE;
    } else {
      process.env.DEPLOYMENT_MODE = originalEnv;
    }
    resetDeploymentConfig();
  });

  it('should default to selfhosted when env var is not set', () => {
    delete process.env.DEPLOYMENT_MODE;
    const config = getDeploymentConfig();
    expect(config.mode).toBe('selfhosted');
  });

  it('should return selfhosted mode with all features disabled', () => {
    process.env.DEPLOYMENT_MODE = 'selfhosted';
    const config = getDeploymentConfig();
    expect(config.mode).toBe('selfhosted');
    expect(config.features.multiTenancy).toBe(false);
    expect(config.features.billing).toBe(false);
    expect(config.features.usageTracking).toBe(false);
    expect(config.features.quotaEnforcement).toBe(false);
  });

  it('should return saas mode with all features enabled', () => {
    process.env.DEPLOYMENT_MODE = 'saas';
    const config = getDeploymentConfig();
    expect(config.mode).toBe('saas');
    expect(config.features.multiTenancy).toBe(true);
    expect(config.features.billing).toBe(true);
    expect(config.features.usageTracking).toBe(true);
    expect(config.features.quotaEnforcement).toBe(true);
  });

  it('should fall back to selfhosted for invalid values', () => {
    process.env.DEPLOYMENT_MODE = 'invalid';
    const config = getDeploymentConfig();
    expect(config.mode).toBe('selfhosted');
  });

  it('should cache the config', () => {
    process.env.DEPLOYMENT_MODE = 'saas';
    const first = getDeploymentConfig();
    process.env.DEPLOYMENT_MODE = 'selfhosted';
    const second = getDeploymentConfig();
    expect(first).toBe(second); // same reference
    expect(second.mode).toBe('saas'); // still saas from cache
  });

  it('should return fresh config after reset', () => {
    process.env.DEPLOYMENT_MODE = 'saas';
    getDeploymentConfig();
    resetDeploymentConfig();
    process.env.DEPLOYMENT_MODE = 'selfhosted';
    const config = getDeploymentConfig();
    expect(config.mode).toBe('selfhosted');
  });
});
