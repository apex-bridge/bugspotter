/**
 * E2E Test Configuration
 * Centralized configuration for all E2E tests
 */

// Base URL for the admin panel (Vite dev server)
export const E2E_BASE_URL = process.env.BASE_URL || 'http://localhost:4001';

// API URL for the backend server
export const E2E_API_URL = process.env.API_URL || 'http://localhost:4000';

// Extract hostname for URL checks (without protocol)
export const E2E_BASE_HOSTNAME = E2E_BASE_URL.replace(/^https?:\/\//, '');
