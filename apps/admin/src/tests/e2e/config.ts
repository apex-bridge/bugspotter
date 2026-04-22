/**
 * E2E Test Configuration
 * Centralized configuration for all E2E tests
 */

// Base URL for the admin panel (Vite dev server). Honors E2E_ADMIN_PORT
// so contributors on Windows — where Hyper-V reserves 4000/4001 via
// `netsh int ipv4 show excludedportrange` — can point at free ports.
export const E2E_BASE_URL =
  process.env.BASE_URL || `http://localhost:${process.env.E2E_ADMIN_PORT ?? '4001'}`;

// API URL for the backend server. Honors API_PORT for the same reason.
export const E2E_API_URL =
  process.env.API_URL || `http://localhost:${process.env.API_PORT ?? '4000'}`;

// Extract hostname for URL checks (without protocol)
export const E2E_BASE_HOSTNAME = E2E_BASE_URL.replace(/^https?:\/\//, '');
