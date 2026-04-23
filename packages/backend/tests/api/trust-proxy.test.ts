/**
 * trustProxy wiring test.
 *
 * Verifies that when Fastify is constructed with `trustProxy: true`,
 * `request.ip` reflects the `X-Forwarded-For` header rather than the
 * socket's remote address. This is load-bearing for `@fastify/rate-limit`
 * keying on real client IPs behind the Yandex NLB / admin-nginx / CDN —
 * without it every public request looks like the same proxy IP and
 * the `/auth/signup` spam throttle is effectively shared across all
 * traffic.
 */

import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';

async function buildApp(trustProxy: boolean | number) {
  const app = Fastify({ trustProxy });
  app.get('/whoami', async (request) => ({ ip: request.ip, protocol: request.protocol }));
  await app.ready();
  return app;
}

describe('Fastify trustProxy', () => {
  it('reads request.ip from X-Forwarded-For when trustProxy is true', async () => {
    const app = await buildApp(true);
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/whoami',
        headers: {
          // Chain: <real client>, <proxy1>. With `trustProxy: true`,
          // Fastify trusts the entire proxy chain and returns the
          // leftmost address from `X-Forwarded-For` as `request.ip`.
          'x-forwarded-for': '203.0.113.7, 10.0.0.1',
          'x-forwarded-proto': 'https',
        },
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload) as { ip: string; protocol: string };
      expect(body.ip).toBe('203.0.113.7');
      expect(body.protocol).toBe('https');
    } finally {
      await app.close();
    }
  });

  it('ignores X-Forwarded-For when trustProxy is false', async () => {
    const app = await buildApp(false);
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/whoami',
        headers: {
          'x-forwarded-for': '203.0.113.7',
          'x-forwarded-proto': 'https',
        },
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload) as { ip: string; protocol: string };
      // With trustProxy off, ip is whatever Fastify sees on the socket
      // (which for `.inject` is `127.0.0.1`) — never 203.0.113.7.
      expect(body.ip).not.toBe('203.0.113.7');
      expect(body.protocol).toBe('http');
    } finally {
      await app.close();
    }
  });

  it('with trustProxy=1, treats only the rightmost hop as trusted', async () => {
    const app = await buildApp(1);
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/whoami',
        headers: {
          // Chain: <client-claimed-spoof>, <attacker-real>. With hop
          // count = 1, Fastify skips the last entry (what our direct
          // upstream appended, representing the source of the TCP
          // connection) and treats the remaining chain as untrusted,
          // returning the rightmost of THOSE entries. Under
          // `Fastify.inject`, the socket address is '127.0.0.1', so
          // the hop-count-1 resolution returns the spoofed value the
          // test sends in XFF. This is expected for the inject harness
          // — the test's job is to confirm the mode is configurable,
          // not that it's spoof-proof against a single nginx layer.
          'x-forwarded-for': '203.0.113.7',
        },
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload) as { ip: string };
      expect(body.ip).toBe('203.0.113.7');
    } finally {
      await app.close();
    }
  });

  it('request.ip falls back to socket address when no XFF header is present', async () => {
    const app = await buildApp(true);
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/whoami',
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload) as { ip: string };
      // Even with trustProxy enabled, an absent XFF header leaves us
      // reading the socket — so dev environments (no proxy, no XFF)
      // behave as if trustProxy was off. Makes `trustProxy: true` a
      // safe default.
      expect(body.ip).toBeTruthy();
      expect(body.ip).toMatch(/^(127\.0\.0\.1|::1|::ffff:127\.0\.0\.1)$/);
    } finally {
      await app.close();
    }
  });
});
