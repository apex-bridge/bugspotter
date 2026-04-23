/**
 * E2E Test Configuration
 * Centralized configuration for all E2E tests
 */

import { normalizeOrigin } from './helpers/url-helpers';

// Base URL for the admin panel (Vite dev server). Honors E2E_ADMIN_PORT
// so contributors on Windows — where Hyper-V reserves 4000/4001 via
// `netsh int ipv4 show excludedportrange` — can point at free ports.
// Using `||` (not `??`) so an empty-string env var falls back to the
// default rather than producing `http://localhost:` and throwing in
// `normalizeOrigin`.
export const E2E_BASE_URL = normalizeOrigin(
  process.env.BASE_URL || `http://localhost:${process.env.E2E_ADMIN_PORT || '4001'}`,
  'BASE_URL'
);

// API URL for the backend server. Honors API_PORT for the same reason.
export const E2E_API_URL = normalizeOrigin(
  process.env.API_URL || `http://localhost:${process.env.API_PORT || '4000'}`,
  'API_URL'
);

// Extract hostname for URL checks (without protocol)
export const E2E_BASE_HOSTNAME = E2E_BASE_URL.replace(/^https?:\/\//, '');
