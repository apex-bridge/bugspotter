/**
 * Hardened HTTP helpers
 *
 * Closes two SSRF gaps that the URL-string validator alone can't catch:
 *
 *   1. DNS rebinding. `validateSSRFProtection` checks the hostname as a
 *      string. Node's `https.request` re-resolves DNS at connect time, so
 *      an attacker who controls the resolver can return a public IP for
 *      the validation lookup and a private IP (127.x, 169.254.x, 10.x,
 *      etc.) for the actual connection. `pinHostnameToIp` resolves the
 *      hostname ONCE, runs `assertResolvedIpAllowed` on the answer, and
 *      returns a `lookup` callback that pins every subsequent connection
 *      attempt to that exact IP for the lifetime of the request.
 *
 *   2. Redirect-following past validation. `fetch(url)` follows up to 20
 *      redirects by default and never re-validates the `Location` header.
 *      A whitelisted host can 302 to `http://169.254.169.254/...` and the
 *      built-in fetch will dutifully follow. `hardenedFetch` flips redirect
 *      handling to manual, re-runs the caller's allowlist + SSRF checks
 *      on every hop, and bounds the chain length.
 *
 * The Jira and generic-http clients use `pinHostnameToIp` /
 * `createPinnedAgent` directly: their callers (`https.request` and
 * axios) accept a custom `lookup` / `httpsAgent` that actually
 * overrides DNS resolution. The avatar-proxy uses `hardenedFetch`
 * with per-hop URL re-validation only; Node's undici-backed `fetch`
 * does NOT honour an `agent` option for HTTPS in a way that would
 * make per-hop DNS pinning effective there, so `hardenedFetch` does
 * not attempt to plumb one through.
 */

import { lookup as dnsLookup } from 'dns/promises';
import type { LookupAddress } from 'dns';
import type { LookupFunction } from 'net';
import { Agent as HttpsAgent } from 'https';
import { assertResolvedIpAllowed } from './ssrf-validator.js';
import { getLogger } from '../../logger.js';

const logger = getLogger();

/**
 * Hard cap on redirect hops. Keeps a malicious server from chaining
 * us through arbitrarily many trampolines. `fetch`'s default is 20;
 * 5 is plenty for legitimate use (HTTPS upgrade + canonical-host +
 * trailing-slash is at most 3).
 */
const DEFAULT_MAX_REDIRECTS = 5;

/**
 * `lookup` function compatible with Node's `https.request` / `https.Agent`
 * `lookup` option. Node passes either an `all: true` option (asking for
 * an array of addresses) or omits it (asking for one). Pinned lookup
 * always serves the same single address regardless.
 */
export type PinnedLookup = LookupFunction;

export interface PinnedHostInfo {
  /** The resolved IP literal (IPv4 dotted-quad or IPv6). */
  ip: string;
  /** IP family — 4 or 6. */
  family: 4 | 6;
  /** Drop-in for the `lookup` option of `https.request`/`Agent`. */
  lookup: PinnedLookup;
}

/**
 * Resolve a hostname to a single IP, validate it against the SSRF
 * blocklist, and return a `lookup` callback that pins all subsequent
 * connections to that exact IP. Throws if the resolved IP is private,
 * loopback, link-local, cloud-metadata, etc.
 *
 * Always pin per-request, not per-client: legitimate hosts rotate IPs,
 * and a long-lived client that pinned at construction would silently
 * stop working after a rotation. Per-request also re-validates on every
 * outbound call — there's no window where a stale resolution leaks.
 */
export async function pinHostnameToIp(hostname: string): Promise<PinnedHostInfo> {
  const resolved = await dnsLookup(hostname);
  assertResolvedIpAllowed(resolved.address);

  const family = (resolved.family === 6 ? 6 : 4) as 4 | 6;

  // Cast through `unknown` because Node's `LookupFunction` is a union of
  // overloaded callbacks (one for `all: false`, another for `all: true`)
  // that TypeScript can't auto-unify. The runtime branch on `options.all`
  // below produces the right shape for whichever overload Node is calling.
  const lookup = ((
    _hostname: string,
    options: { all?: boolean } | undefined,
    callback: (
      err: NodeJS.ErrnoException | null,
      address: string | LookupAddress[],
      familyArg?: number
    ) => void
  ) => {
    if (options && options.all === true) {
      callback(null, [{ address: resolved.address, family }]);
    } else {
      callback(null, resolved.address, family);
    }
  }) as unknown as PinnedLookup;

  return { ip: resolved.address, family, lookup };
}

/**
 * Build an `https.Agent` whose `lookup` is pinned to a specific IP.
 * Use as `httpsAgent` in axios or as `agent` in https.request when the
 * caller doesn't want to thread `lookup` through manually. Set
 * `keepAlive: false` so the agent's connection pool can't outlive the
 * request and reuse a connection that was opened to a now-stale IP.
 */
export async function createPinnedAgent(hostname: string): Promise<{
  agent: HttpsAgent;
  ip: string;
}> {
  const { ip, lookup } = await pinHostnameToIp(hostname);
  const agent = new HttpsAgent({
    lookup,
    keepAlive: false,
  });
  return { agent, ip };
}

export interface HardenedFetchOptions {
  /**
   * Maximum redirect hops. Defaults to {@link DEFAULT_MAX_REDIRECTS}.
   * Set to 0 to refuse all redirects.
   */
  maxRedirects?: number;
  /**
   * Caller-supplied check that runs BEFORE every fetch hop, including
   * after each redirect. Throw to abort the chain. Use this to enforce
   * domain allowlists; the URL-string SSRF blocklist (private IP
   * literals, alternative encodings, cloud-metadata) should be invoked
   * here too if redirect targets need to be re-validated.
   */
  validateUrl: (url: URL) => void;
  /** Forwarded to fetch() on every hop. */
  headers?: Record<string, string>;
}

/**
 * Fetch with manual redirect handling and per-hop validation.
 *
 * Each hop:
 *   1. Parses the URL.
 *   2. Calls `options.validateUrl(parsed)` — caller's allowlist check.
 *   3. Issues the request with `redirect: 'manual'`.
 *   4. If the response is 3xx with a `Location`, resolves the next URL
 *      relative to the current one and loops; otherwise returns.
 *
 * Caps total hops at `options.maxRedirects ?? 5`.
 */
export async function hardenedFetch(
  initialUrl: string,
  options: HardenedFetchOptions
): Promise<Response> {
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  let currentUrl = initialUrl;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(currentUrl);
    } catch {
      throw new Error(`Invalid redirect URL at hop ${hop}: ${currentUrl}`);
    }

    // Caller's allowlist + SSRF URL-string check. Throws to abort.
    options.validateUrl(parsedUrl);

    const response = await fetch(currentUrl, {
      headers: options.headers,
      redirect: 'manual',
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) {
        // 3xx without Location — return as-is, caller decides.
        return response;
      }
      // Discard the redirect response body so the connection can be reused/closed.
      try {
        await response.body?.cancel?.();
      } catch {
        // best-effort cleanup
      }
      // Resolve relative redirect against the current URL.
      currentUrl = new URL(location, currentUrl).toString();
      logger.debug('Hardened fetch following redirect', {
        from: parsedUrl.toString(),
        to: currentUrl,
        hop: hop + 1,
      });
      continue;
    }

    return response;
  }

  throw new Error(
    `Too many redirects (>${maxRedirects}). Refusing to follow further to prevent redirect-chain attacks.`
  );
}
