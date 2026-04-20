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
 *   parent domain (e.g. `.kz.bugspotter.io`) and uses `sameSite=lax`.
 *
 *   Why `lax` and not `strict` here, given the wizard-to-tenant handoff
 *   (`kz.bugspotter.io` → `[org].kz.bugspotter.io`) is same-site and
 *   would work with either:
 *
 *   The real concern is *inbound* cross-site navigations — a user
 *   clicking an email link, following a bookmark, or typing the tenant
 *   URL directly. `Strict` drops the cookie on every such top-level
 *   navigation, which means users would be logged out whenever they
 *   arrive at their tenant from anywhere outside our own origins.
 *   `Lax` preserves the cookie on top-level GETs from external origins
 *   while still blocking cross-site sub-resource and POST leakage.
 *
 *   The CSRF surface from `Lax` here is minimal: refresh_token is
 *   `HttpOnly` so JS can't read it, the refresh endpoint is POST-only,
 *   and the access token still travels via `Authorization` header.
 *
 * - When `COOKIE_DOMAIN` is empty (self-hosted), the cookie stays
 *   host-scoped with `sameSite=strict` to match legacy behavior — no
 *   cross-subdomain flow exists in self-hosted so the stricter mode
 *   costs nothing.
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
