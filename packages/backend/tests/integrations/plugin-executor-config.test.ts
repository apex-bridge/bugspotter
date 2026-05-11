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

  // Same NaN-class bug, different input source — caller passes invalid options
  // through the typed API. `options.timeout ?? envTimeout` doesn't catch NaN
  // because NaN isn't nullish.
  it('falls back to env/default when options.timeout is NaN', () => {
    const executor = new SecurePluginExecutor({ timeout: NaN });
    expect((executor as any).defaultTimeout).toBe(DEFAULT_TIMEOUT);
  });

  it('falls back to env/default when options.timeout is zero', () => {
    const executor = new SecurePluginExecutor({ timeout: 0 });
    expect((executor as any).defaultTimeout).toBe(DEFAULT_TIMEOUT);
  });

  it('falls back to env/default when options.timeout is negative', () => {
    const executor = new SecurePluginExecutor({ timeout: -1 });
    expect((executor as any).defaultTimeout).toBe(DEFAULT_TIMEOUT);
  });

  it('falls back to env/default when options.timeout is Infinity', () => {
    const executor = new SecurePluginExecutor({ timeout: Infinity });
    expect((executor as any).defaultTimeout).toBe(DEFAULT_TIMEOUT);
  });
});

describe('SecurePluginExecutor — constructor memoryLimit config', () => {
  const DEFAULT_MEMORY = 128;

  it('uses default 128 MB when no options', () => {
    const executor = new SecurePluginExecutor();
    expect((executor as any).defaultMemoryLimit).toBe(DEFAULT_MEMORY);
  });

  it('honours a valid options.memoryLimit', () => {
    const executor = new SecurePluginExecutor({ memoryLimit: 64 });
    expect((executor as any).defaultMemoryLimit).toBe(64);
  });

  // Same NaN-class bug as timeout — `options.memoryLimit ?? 128` doesn't catch
  // NaN, and isolated-vm's behaviour with `memoryLimit: NaN` is unspecified.
  it('falls back to 128 MB when options.memoryLimit is NaN', () => {
    const executor = new SecurePluginExecutor({ memoryLimit: NaN });
    expect((executor as any).defaultMemoryLimit).toBe(DEFAULT_MEMORY);
  });

  it('falls back to 128 MB when options.memoryLimit is zero', () => {
    const executor = new SecurePluginExecutor({ memoryLimit: 0 });
    expect((executor as any).defaultMemoryLimit).toBe(DEFAULT_MEMORY);
  });

  it('falls back to 128 MB when options.memoryLimit is negative', () => {
    const executor = new SecurePluginExecutor({ memoryLimit: -1 });
    expect((executor as any).defaultMemoryLimit).toBe(DEFAULT_MEMORY);
  });

  it('falls back to 128 MB when options.memoryLimit is Infinity', () => {
    const executor = new SecurePluginExecutor({ memoryLimit: Infinity });
    expect((executor as any).defaultMemoryLimit).toBe(DEFAULT_MEMORY);
  });
});
