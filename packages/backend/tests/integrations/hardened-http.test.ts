/**
 * Hardened HTTP helpers — unit tests
 *
 * Covers the two SSRF gaps the URL-string validator alone can't close:
 *   - DNS rebinding via `pinHostnameToIp` / `assertResolvedIpAllowed`
 *   - Redirect-following past validation via `hardenedFetch`
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as dnsPromises from 'dns/promises';
import { assertResolvedIpAllowed } from '../../src/integrations/security/ssrf-validator.js';
import { pinHostnameToIp, hardenedFetch } from '../../src/integrations/security/hardened-http.js';

vi.mock('dns/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('dns/promises')>();
  return { ...actual, lookup: vi.fn() };
});

const mockedLookup = vi.mocked(dnsPromises.lookup);

beforeEach(() => {
  mockedLookup.mockReset();
});

describe('assertResolvedIpAllowed', () => {
  describe('blocks private IPv4 ranges', () => {
    it.each([
      ['127.0.0.1', 'loopback'],
      ['127.255.255.255', 'loopback upper'],
      ['10.0.0.1', 'RFC 1918 10/8'],
      ['10.255.255.255', 'RFC 1918 10/8 upper'],
      ['172.16.0.1', 'RFC 1918 172.16/12'],
      ['172.31.255.255', 'RFC 1918 172.16/12 upper'],
      ['192.168.0.1', 'RFC 1918 192.168/16'],
      ['192.168.255.255', 'RFC 1918 192.168/16 upper'],
      ['169.254.169.254', 'AWS/Azure/GCP cloud-metadata'],
      ['169.254.0.1', 'link-local'],
      ['100.64.0.1', 'RFC 6598 CGNAT'],
      ['0.0.0.0', 'this-network'],
    ])('rejects %s (%s)', (ip) => {
      expect(() => assertResolvedIpAllowed(ip)).toThrow();
    });
  });

  describe('blocks private IPv6 ranges', () => {
    it.each([
      ['::1', 'loopback'],
      ['fc00::1', 'unique-local'],
      ['fe80::1', 'link-local'],
      ['::ffff:127.0.0.1', 'IPv4-mapped loopback'],
    ])('rejects %s (%s)', (ip) => {
      expect(() => assertResolvedIpAllowed(ip)).toThrow();
    });
  });

  describe('allows public IPs', () => {
    it.each([
      ['1.1.1.1', 'Cloudflare'],
      ['8.8.8.8', 'Google DNS'],
      ['52.84.0.1', 'AWS public'],
      ['2606:4700:4700::1111', 'Cloudflare IPv6'],
    ])('allows %s (%s)', (ip) => {
      expect(() => assertResolvedIpAllowed(ip)).not.toThrow();
    });
  });
});

describe('pinHostnameToIp', () => {
  it('resolves, validates, and returns a lookup that pins to the resolved IP', async () => {
    mockedLookup.mockResolvedValue({ address: '1.2.3.4', family: 4 });

    const pinned = await pinHostnameToIp('example.com');

    expect(pinned.ip).toBe('1.2.3.4');
    expect(pinned.family).toBe(4);
    // The pinned lookup must always return the SAME ip even if Node calls
    // it with a different hostname (e.g. on a redirect or retry); that's
    // the entire point of pinning.
    const cb = vi.fn();
    pinned.lookup('attacker-rebound.example', {}, cb);
    expect(cb).toHaveBeenCalledWith(null, '1.2.3.4', 4);
  });

  it('handles `all: true` lookup option', async () => {
    mockedLookup.mockResolvedValue({ address: '1.2.3.4', family: 4 });
    const pinned = await pinHostnameToIp('example.com');

    const cb = vi.fn();
    pinned.lookup('example.com', { all: true }, cb);
    // With all: true, Node expects an array of LookupAddress.
    expect(cb).toHaveBeenCalledWith(null, [{ address: '1.2.3.4', family: 4 }]);
  });

  it('rejects when DNS resolves to a private IP (DNS rebinding gate)', async () => {
    // Attacker controls `rebind.example.com`; resolver returns 127.0.0.1.
    mockedLookup.mockResolvedValue({ address: '127.0.0.1', family: 4 });

    await expect(pinHostnameToIp('rebind.example.com')).rejects.toThrow(
      /internal\/private networks/
    );
  });

  it('rejects when DNS resolves to a cloud-metadata IP', async () => {
    mockedLookup.mockResolvedValue({ address: '169.254.169.254', family: 4 });

    await expect(pinHostnameToIp('cloud-metadata-rebind.example')).rejects.toThrow(
      /cloud metadata endpoints/
    );
  });

  it('rejects when DNS resolves to an IPv6 loopback', async () => {
    mockedLookup.mockResolvedValue({ address: '::1', family: 6 });

    await expect(pinHostnameToIp('ipv6-rebind.example')).rejects.toThrow(
      /internal\/private networks/
    );
  });
});

describe('hardenedFetch', () => {
  // Restore real fetch for tests that don't need it; mock per-test for the
  // ones that do. This isolates the redirect logic from network behaviour.
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function mockFetchSequence(responses: Array<{ status: number; location?: string }>) {
    let call = 0;
    globalThis.fetch = vi.fn(async () => {
      const r = responses[call++];
      if (!r) {
        throw new Error('Unexpected extra fetch call');
      }
      const headers = new Headers();
      if (r.location) {
        headers.set('location', r.location);
      }
      return new Response(null, { status: r.status, headers });
    }) as unknown as typeof fetch;
    return globalThis.fetch as ReturnType<typeof vi.fn>;
  }

  it('returns a 200 response unchanged (no redirect)', async () => {
    const fetchMock = mockFetchSequence([{ status: 200 }]);

    const response = await hardenedFetch('https://example.com/avatar.png', {
      validateUrl: () => {
        // accept everything
      },
    });

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('follows a single 302 to an allowed URL', async () => {
    const fetchMock = mockFetchSequence([
      { status: 302, location: 'https://example.com/final.png' },
      { status: 200 },
    ]);

    const validateUrl = vi.fn();
    const response = await hardenedFetch('https://example.com/avatar.png', {
      validateUrl,
    });

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // validateUrl runs on EVERY hop, including the redirect target.
    expect(validateUrl).toHaveBeenCalledTimes(2);
    expect(validateUrl.mock.calls[1][0].toString()).toBe('https://example.com/final.png');
  });

  it('aborts when validateUrl throws on a redirect target (closes H1)', async () => {
    // First hop is the originally-allowed URL; redirect target is on a
    // host the allowlist rejects. This is the avatar-proxy scenario:
    // attacker controls *.atlassian.net, 302s to 169.254.169.254. Without
    // per-hop validation, plain fetch would follow and stream cloud
    // metadata back to the unauthenticated caller.
    mockFetchSequence([
      { status: 302, location: 'http://169.254.169.254/latest/meta-data/' },
      { status: 200 }, // would never be reached
    ]);

    const validateUrl = vi.fn((url: URL) => {
      if (url.hostname.endsWith('.atlassian.net') || url.hostname === 'allowed.example') {
        return;
      }
      throw new Error(`hostname not allowed: ${url.hostname}`);
    });

    await expect(
      hardenedFetch('https://attacker.atlassian.net/redirect', {
        validateUrl,
      })
    ).rejects.toThrow(/not allowed/);
  });

  it('caps redirects at the configured maximum', async () => {
    // 6 redirects in a chain — exceeds the default cap of 5.
    mockFetchSequence([
      { status: 302, location: 'https://example.com/h1' },
      { status: 302, location: 'https://example.com/h2' },
      { status: 302, location: 'https://example.com/h3' },
      { status: 302, location: 'https://example.com/h4' },
      { status: 302, location: 'https://example.com/h5' },
      { status: 302, location: 'https://example.com/h6' },
      { status: 200 }, // would never be reached
    ]);

    await expect(
      hardenedFetch('https://example.com/start', {
        maxRedirects: 5,
        validateUrl: () => {},
      })
    ).rejects.toThrow(/Too many redirects/);
  });

  it('refuses to follow ANY redirect when maxRedirects is 0', async () => {
    mockFetchSequence([
      { status: 302, location: 'https://example.com/elsewhere' },
      { status: 200 }, // never reached
    ]);

    await expect(
      hardenedFetch('https://example.com/start', {
        maxRedirects: 0,
        validateUrl: () => {},
      })
    ).rejects.toThrow(/Too many redirects/);
  });

  it('returns a 3xx response unchanged when Location header is missing', async () => {
    // 304 Not Modified, 305 Use Proxy, etc. don't always have Location.
    // Caller decides what to do.
    mockFetchSequence([{ status: 304 }]);

    const response = await hardenedFetch('https://example.com/cached', {
      validateUrl: () => {},
    });

    expect(response.status).toBe(304);
  });

  it('resolves relative redirect URLs against the current URL', async () => {
    const fetchMock = mockFetchSequence([
      { status: 302, location: '/v2/resource' },
      { status: 200 },
    ]);

    const validateUrl = vi.fn();
    await hardenedFetch('https://example.com/v1/resource', {
      validateUrl,
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://example.com/v2/resource',
      expect.anything()
    );
    expect(validateUrl.mock.calls[1][0].toString()).toBe('https://example.com/v2/resource');
  });
});
