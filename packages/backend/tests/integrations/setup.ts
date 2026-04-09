/**
 * Test Setup for Integration Tests
 * Sets up environment variables required for Jira integration tests
 */

import { beforeAll } from 'vitest';

beforeAll(() => {
  // Set required environment variables for tests
  if (!process.env.ENCRYPTION_KEY) {
    process.env.ENCRYPTION_KEY = 'test-encryption-key-32-bytes-min'; // Test key only
  }
});
