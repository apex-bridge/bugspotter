/**
 * Shared URL helpers for the E2E test harness.
 *
 * Used from three places that all need a single, consistent
 * interpretation of the frontend/backend base URLs:
 *   - `playwright.config.ts` (webServer + baseURL wiring)
 *   - `src/tests/e2e/config.ts` (E2E_BASE_URL / E2E_API_URL)
 *   - `src/tests/e2e/global-setup.ts` (backend spawn env)
 *
 * Without shared normalization a user-provided `BASE_URL` / `API_URL`
 * with a trailing slash or path (e.g. `https://host.com/admin`) would
 * leak into CORS matching, Vite's proxy target, and the auth helper's
 * hostname check — each failure mode subtly different.
 */

/**
 * Default ports for the E2E harness. Shared across
 * `playwright.config.ts`, `config.ts`, and `global-setup.ts` so the
 * three consumers can never disagree on the fallback. Strings rather
 * than numbers because `process.env.*` is always a string and the
 * places that use these concatenate them into URLs.
 */
export const DEFAULT_ADMIN_PORT = '4001';
export const DEFAULT_API_PORT = '4000';
export const DEFAULT_WORKER_PORT = '3001';

/**
 * Reduce a URL-like string to its bare origin (`scheme://host[:port]`).
 * Throws a descriptive error if the input can't be parsed.
 */
export function normalizeOrigin(raw: string, label: string): string {
  try {
    return new URL(raw).origin;
  } catch {
    throw new Error(`Invalid ${label}: ${raw}`);
  }
}
