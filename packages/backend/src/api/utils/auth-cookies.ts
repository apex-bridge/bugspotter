/**
 * Refresh-token cookie options helper
 *
 * Centralizes cookie settings so `/register`, `/login`, `/refresh`,
 * `/magic-login`, `/logout`, and the self-service `/signup` all emit
 * identical cookies. Keeping this in one place avoids drift when the
 * cookie domain or sameSite mode changes per deployment.
 */

import type { CookieSerializeOptions } from '@fastify/cookie';
import { config } from '../../config.js';

export interface RefreshCookieOptions extends CookieSerializeOptions {
  /** Always present — Fastify requires explicit options each call. */
  httpOnly: true;
  path: '/';
}

/**
 * Build cookie options for setting the refresh_token cookie.
 *
 * - When `COOKIE_DOMAIN` is configured (SaaS), the cookie is scoped to the
 *   parent domain (e.g. `.kz.bugspotter.io`) and uses `sameSite=lax` so
 *   the wizard on `kz.bugspotter.io` can hand off the session to
 *   `[org].kz.bugspotter.io` on redirect.
 * - When `COOKIE_DOMAIN` is empty (self-hosted), the cookie stays
 *   host-scoped with `sameSite=strict` to match legacy behavior.
 */
export function buildRefreshCookieOptions(maxAgeSeconds: number): RefreshCookieOptions {
  const hasCookieDomain = !!config.auth.cookieDomain;
  return {
    httpOnly: true,
    secure: config.server.env === 'production',
    sameSite: hasCookieDomain ? 'lax' : 'strict',
    maxAge: maxAgeSeconds,
    path: '/',
    ...(hasCookieDomain ? { domain: config.auth.cookieDomain as string } : {}),
  };
}

/**
 * Build cookie options for clearing the refresh_token cookie.
 * Must match the attributes used when setting it, or browsers ignore the clear.
 */
export function buildClearRefreshCookieOptions(): RefreshCookieOptions {
  const hasCookieDomain = !!config.auth.cookieDomain;
  return {
    httpOnly: true,
    secure: config.server.env === 'production',
    sameSite: hasCookieDomain ? 'lax' : 'strict',
    path: '/',
    ...(hasCookieDomain ? { domain: config.auth.cookieDomain as string } : {}),
  };
}
