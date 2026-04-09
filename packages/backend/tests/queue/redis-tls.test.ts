import { createRequire } from 'node:module';
import { describe, it, expect, afterEach } from 'vitest';

// Access ioredis via CJS require — same pattern as ssl.test.ts for pg.
// ESM named import { Redis } loses the .options property due to CJS interop.
const require = createRequire(import.meta.url);
const Redis = require('ioredis');

/**
 * Tests that prove ioredis TLS configuration works correctly for managed services.
 *
 * Key insight: ioredis uses lodash.defaults (not Object.assign) to merge options,
 * so explicit options provided by the caller are NOT overwritten by URL-parsed values.
 * This means passing tls: { rejectUnauthorized: false } alongside a rediss:// URL works
 * — unlike pg where Object.assign overwrites explicit options.
 */

const REDISS_URL = 'rediss://:password@managed-redis.cloud:6380';
const REDIS_URL = 'redis://localhost:6379';

describe('ioredis TLS configuration (proves managed service fix)', () => {
  it('BUG: rediss:// with no tls option defaults to rejectUnauthorized: true', () => {
    const redis = new Redis(REDISS_URL, { lazyConnect: true });

    // ioredis detects rediss:// and sets tls: true via lodash.defaults
    // tls: true means TLS enabled, but Node.js defaults rejectUnauthorized to true
    // This is the bug — managed services use private CAs that aren't trusted
    expect(redis.options.tls).toBe(true);

    redis.disconnect();
  });

  it('FIX: explicit tls option survives because lodash.defaults won`t overwrite', () => {
    const redis = new Redis(REDISS_URL, {
      lazyConnect: true,
      tls: { rejectUnauthorized: false },
    });

    // Our explicit tls object is preserved — lodash.defaults sees tls is already
    // defined and does NOT overwrite it with tls: true from rediss:// detection
    expect(redis.options.tls).toEqual({ rejectUnauthorized: false });
    expect(redis.options.tls.rejectUnauthorized).toBe(false);

    redis.disconnect();
  });

  it('redis:// (non-TLS) does not get tls option', () => {
    const redis = new Redis(REDIS_URL, { lazyConnect: true });

    expect(redis.options.tls).toBeUndefined();

    redis.disconnect();
  });

  it('explicit tls: { rejectUnauthorized: true } is also preserved', () => {
    const redis = new Redis(REDISS_URL, {
      lazyConnect: true,
      tls: { rejectUnauthorized: true },
    });

    expect(redis.options.tls).toEqual({ rejectUnauthorized: true });
    expect(redis.options.tls.rejectUnauthorized).toBe(true);

    redis.disconnect();
  });
});

describe('REDIS_TLS_REJECT_UNAUTHORIZED env var behavior', () => {
  const originalEnv = process.env.REDIS_TLS_REJECT_UNAUTHORIZED;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.REDIS_TLS_REJECT_UNAUTHORIZED;
    } else {
      process.env.REDIS_TLS_REJECT_UNAUTHORIZED = originalEnv;
    }
  });

  it('env not set → rejectUnauthorized defaults to true (secure)', () => {
    delete process.env.REDIS_TLS_REJECT_UNAUTHORIZED;
    const rejectUnauthorized = process.env.REDIS_TLS_REJECT_UNAUTHORIZED !== 'false';

    expect(rejectUnauthorized).toBe(true);

    const redis = new Redis(REDISS_URL, {
      lazyConnect: true,
      tls: { rejectUnauthorized },
    });
    expect(redis.options.tls.rejectUnauthorized).toBe(true);
    redis.disconnect();
  });

  it('env set to "false" → rejectUnauthorized is false (managed service mode)', () => {
    process.env.REDIS_TLS_REJECT_UNAUTHORIZED = 'false';
    const rejectUnauthorized = process.env.REDIS_TLS_REJECT_UNAUTHORIZED !== 'false';

    expect(rejectUnauthorized).toBe(false);

    const redis = new Redis(REDISS_URL, {
      lazyConnect: true,
      tls: { rejectUnauthorized },
    });
    expect(redis.options.tls.rejectUnauthorized).toBe(false);
    redis.disconnect();
  });

  it('env set to "true" → rejectUnauthorized stays true', () => {
    process.env.REDIS_TLS_REJECT_UNAUTHORIZED = 'true';
    const rejectUnauthorized = process.env.REDIS_TLS_REJECT_UNAUTHORIZED !== 'false';

    expect(rejectUnauthorized).toBe(true);

    const redis = new Redis(REDISS_URL, {
      lazyConnect: true,
      tls: { rejectUnauthorized },
    });
    expect(redis.options.tls.rejectUnauthorized).toBe(true);
    redis.disconnect();
  });
});
