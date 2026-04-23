/**
 * E2E Test Configuration
 * Centralized configuration for all E2E tests
 */

// Resolve the admin + API URLs once, normalizing through `new URL(...).origin`
// so a user-provided `BASE_URL` / `API_URL` with a trailing slash or path
// (e.g. `https://host.com/admin`) doesn't leak into downstream consumers
// — `E2E_BASE_HOSTNAME` would end up as `host.com/admin`, breaking the
// auth helper's `currentURL.includes(E2E_BASE_HOSTNAME)` short-circuit.
function normalizeOrigin(raw: string, label: string): string {
  try {
    return new URL(raw).origin;
  } catch {
    throw new Error(`Invalid ${label}: ${raw}`);
  }
}

// Base URL for the admin panel (Vite dev server). Honors E2E_ADMIN_PORT
// so contributors on Windows — where Hyper-V reserves 4000/4001 via
// `netsh int ipv4 show excludedportrange` — can point at free ports.
export const E2E_BASE_URL = normalizeOrigin(
  process.env.BASE_URL || `http://localhost:${process.env.E2E_ADMIN_PORT ?? '4001'}`,
  'BASE_URL'
);

// API URL for the backend server. Honors API_PORT for the same reason.
export const E2E_API_URL = normalizeOrigin(
  process.env.API_URL || `http://localhost:${process.env.API_PORT ?? '4000'}`,
  'API_URL'
);

// Extract hostname for URL checks (without protocol)
export const E2E_BASE_HOSTNAME = E2E_BASE_URL.replace(/^https?:\/\//, '');
