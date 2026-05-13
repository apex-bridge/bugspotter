/**
 * Password Reset Token Service Tests
 *
 * Covers the four invariants we care about:
 *   1. Issue stores the (hashed) token in Redis with the configured TTL.
 *   2. Consume returns the bound userId on first call.
 *   3. Consume returns null on the second call (one-shot).
 *   4. Consume returns null when Redis throws (fail-closed).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  issuePasswordResetToken,
  consumePasswordResetToken,
  PASSWORD_RESET_TTL_SECONDS,
} from '../../src/services/auth/password-reset-token.js';

// Single in-memory store shared by all `redis.*` mock methods so that
// `setex` followed by `getdel` actually round-trips.
const store = new Map<string, string>();

const mockRedis: {
  setex: ReturnType<typeof vi.fn>;
  getdel?: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  del: ReturnType<typeof vi.fn>;
  eval: ReturnType<typeof vi.fn>;
} = {
  setex: vi.fn(async (key: string, _ttl: number, value: string) => {
    store.set(key, value);
    return 'OK';
  }),
  getdel: vi.fn(async (key: string) => {
    const value = store.get(key) ?? null;
    store.delete(key);
    return value;
  }),
  get: vi.fn(async (key: string) => store.get(key) ?? null),
  del: vi.fn(async (key: string) => {
    const had = store.delete(key);
    return had ? 1 : 0;
  }),
  // Fallback path runs `redis.eval(script, 1, key)` — emulate the
  // Lua GETDEL by replaying our in-memory store using the key passed
  // as KEYS[1] (which is arg #3 in ioredis's eval signature).
  eval: vi.fn(async (_script: string, _numKeys: number, key: string) => {
    const value = store.get(key) ?? null;
    if (value !== null) {
      store.delete(key);
    }
    return value;
  }),
};

vi.mock('../../src/queue/redis-connection-pool.js', () => ({
  getConnectionPool: () => ({
    getMainConnection: vi.fn().mockResolvedValue(mockRedis),
  }),
}));

vi.mock('../../src/logger.js', () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe('Password Reset Token Service', () => {
  beforeEach(() => {
    store.clear();
    vi.clearAllMocks();
  });

  describe('issuePasswordResetToken', () => {
    it('stores the token in Redis with the configured TTL', async () => {
      const token = await issuePasswordResetToken('user-1');

      expect(token).toBeTruthy();
      // base64url of 32 bytes is at least 32 chars long
      expect(token.length).toBeGreaterThanOrEqual(32);
      expect(mockRedis.setex).toHaveBeenCalledTimes(1);
      const [, ttl, value] = mockRedis.setex.mock.calls[0]!;
      expect(ttl).toBe(PASSWORD_RESET_TTL_SECONDS);
      expect(value).toBe('user-1');
    });

    it('produces a different token on each call', async () => {
      const a = await issuePasswordResetToken('user-1');
      const b = await issuePasswordResetToken('user-1');
      expect(a).not.toBe(b);
    });
  });

  describe('consumePasswordResetToken', () => {
    it('returns the bound userId on first consume', async () => {
      const token = await issuePasswordResetToken('user-42');
      const userId = await consumePasswordResetToken(token);
      expect(userId).toBe('user-42');
    });

    it('returns null on a replayed consume (one-shot)', async () => {
      const token = await issuePasswordResetToken('user-42');
      const first = await consumePasswordResetToken(token);
      const second = await consumePasswordResetToken(token);
      expect(first).toBe('user-42');
      expect(second).toBeNull();
    });

    it('returns null for an unknown / expired token', async () => {
      // Token wasn't issued at all — Redis has no key.
      const userId = await consumePasswordResetToken('definitely-not-a-real-token');
      expect(userId).toBeNull();
    });

    it('returns null when Redis throws (fail-closed)', async () => {
      mockRedis.getdel!.mockRejectedValueOnce(new Error('redis unavailable'));
      const userId = await consumePasswordResetToken('any-token');
      expect(userId).toBeNull();
    });
  });

  describe('atomic Lua fallback (Redis < 6.2)', () => {
    // Simulate an older Redis that doesn't expose `getdel`. The
    // service then drops into the Lua-eval branch which must remain
    // atomic and one-shot.
    let originalGetdel: ReturnType<typeof vi.fn> | undefined;

    beforeEach(() => {
      originalGetdel = mockRedis.getdel;
      delete mockRedis.getdel;
    });

    afterEach(() => {
      mockRedis.getdel = originalGetdel;
    });

    it('returns the bound userId via Lua eval', async () => {
      const token = await issuePasswordResetToken('user-99');
      const userId = await consumePasswordResetToken(token);
      expect(userId).toBe('user-99');
      expect(mockRedis.eval).toHaveBeenCalledTimes(1);
    });

    it('one-shot: second consume via Lua sees null', async () => {
      const token = await issuePasswordResetToken('user-99');
      const first = await consumePasswordResetToken(token);
      const second = await consumePasswordResetToken(token);
      expect(first).toBe('user-99');
      expect(second).toBeNull();
    });
  });
});
