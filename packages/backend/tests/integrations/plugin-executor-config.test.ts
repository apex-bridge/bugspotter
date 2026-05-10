/**
 * Constructor-level config tests for SecurePluginExecutor.
 *
 * Specifically guards against regressions where a misconfigured
 * `PLUGIN_EXECUTION_TIMEOUT_MS` env var could silently disable the
 * wall-clock kill that bounds plugin execution.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SecurePluginExecutor } from '../../src/integrations/security/plugin-executor.js';

const ENV_KEY = 'PLUGIN_EXECUTION_TIMEOUT_MS';
const DEFAULT_TIMEOUT = 15000;

describe('SecurePluginExecutor — constructor timeout config', () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env[ENV_KEY];
    delete process.env[ENV_KEY];
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env[ENV_KEY];
    } else {
      process.env[ENV_KEY] = originalEnv;
    }
  });

  it('uses default 15s when env var is unset', () => {
    const executor = new SecurePluginExecutor();
    expect((executor as any).defaultTimeout).toBe(DEFAULT_TIMEOUT);
  });

  it('honours a valid numeric env var', () => {
    process.env[ENV_KEY] = '8000';
    const executor = new SecurePluginExecutor();
    expect((executor as any).defaultTimeout).toBe(8000);
  });

  it('falls back to 15s when env var is non-numeric (NaN guard)', () => {
    // The bug this guards against: parseInt("15s", 10) === NaN, which would
    // make script.run({ timeout: NaN }) undefined-behaviour and silently
    // disable the wall-clock kill.
    process.env[ENV_KEY] = '15s';
    const executor = new SecurePluginExecutor();
    expect((executor as any).defaultTimeout).toBe(DEFAULT_TIMEOUT);
  });

  it('falls back to 15s when env var is whitespace', () => {
    process.env[ENV_KEY] = '   ';
    const executor = new SecurePluginExecutor();
    expect((executor as any).defaultTimeout).toBe(DEFAULT_TIMEOUT);
  });

  it('falls back to 15s when env var is the empty string', () => {
    process.env[ENV_KEY] = '';
    const executor = new SecurePluginExecutor();
    expect((executor as any).defaultTimeout).toBe(DEFAULT_TIMEOUT);
  });

  it('falls back to 15s when env var is zero', () => {
    process.env[ENV_KEY] = '0';
    const executor = new SecurePluginExecutor();
    expect((executor as any).defaultTimeout).toBe(DEFAULT_TIMEOUT);
  });

  it('falls back to 15s when env var is negative', () => {
    process.env[ENV_KEY] = '-100';
    const executor = new SecurePluginExecutor();
    expect((executor as any).defaultTimeout).toBe(DEFAULT_TIMEOUT);
  });

  it('falls back to 15s when env var is Infinity', () => {
    process.env[ENV_KEY] = 'Infinity';
    const executor = new SecurePluginExecutor();
    expect((executor as any).defaultTimeout).toBe(DEFAULT_TIMEOUT);
  });

  it('options.timeout takes precedence over env var', () => {
    process.env[ENV_KEY] = '8000';
    const executor = new SecurePluginExecutor({ timeout: 3000 });
    expect((executor as any).defaultTimeout).toBe(3000);
  });

  it('options.timeout takes precedence even when env var is malformed', () => {
    process.env[ENV_KEY] = 'not-a-number';
    const executor = new SecurePluginExecutor({ timeout: 3000 });
    expect((executor as any).defaultTimeout).toBe(3000);
  });
});
