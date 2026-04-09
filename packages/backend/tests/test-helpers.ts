/**
 * Test helper functions
 * Shared utilities for creating mocks and test fixtures
 */

import { vi } from 'vitest';
import { Readable } from 'stream';
import { gzipSync } from 'zlib';
import bcrypt from 'bcrypt';
import type { FastifyInstance } from 'fastify';
import type { DatabaseClient } from '../src/db/client.js';

/**
 * Helper to create mock plugin registry for tests
 */
export function createMockPluginRegistry() {
  return {
    get: vi.fn().mockReturnValue({
      createFromBugReport: vi.fn().mockResolvedValue({
        externalId: 'JIRA-123',
        externalUrl: 'https://jira.example.com/browse/JIRA-123',
        platform: 'jira',
      }),
    }),
    listPlugins: vi.fn().mockReturnValue([{ platform: 'jira' }]),
    getSupportedPlatforms: vi.fn().mockReturnValue(['jira']),
    getPluginMetadata: vi.fn().mockReturnValue({
      name: 'Jira Integration',
      version: '1.0.0',
      platform: 'jira',
      isBuiltIn: true,
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

/**
 * Helper to create mock storage service for tests
 */
export function createMockStorage() {
  // Sample rrweb events for mock replay data
  const sampleReplayEvents = [
    {
      type: 4, // Full snapshot
      data: { href: 'https://example.com', width: 1920, height: 1080 },
      timestamp: Date.now() - 10000,
    },
    {
      type: 3, // Incremental snapshot
      data: { source: 2, positions: [{ x: 100, y: 200, timeOffset: 0 }] },
      timestamp: Date.now() - 9000,
    },
  ];

  // Create gzipped replay data
  const replayData = JSON.stringify(sampleReplayEvents);
  const gzipped = gzipSync(replayData);

  return {
    uploadScreenshot: vi.fn().mockResolvedValue({ key: 'test-key', size: 1024 }),
    uploadReplay: vi.fn().mockResolvedValue({ key: 'test-key', size: 2048 }),
    uploadAttachment: vi.fn().mockResolvedValue({ key: 'test-key', size: 512 }),
    getPresignedUploadUrl: vi
      .fn()
      .mockResolvedValue('https://mock-storage.example.com/upload?signature=abc123'),
    getSignedUrl: vi
      .fn()
      .mockResolvedValue(
        'https://mock-storage.example.com/replays/test-replay.json?signature=xyz789'
      ),
    headObject: vi
      .fn()
      .mockResolvedValue({ size: 1024, lastModified: new Date(), key: 'test-key' }),
    // Return fresh stream each time (streams can only be consumed once)
    getObject: vi.fn().mockImplementation(() => Promise.resolve(Readable.from(gzipped))),
    healthCheck: vi.fn().mockResolvedValue(true),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

/**
 * Helper to create mock queue manager for tests
 */
export function createMockQueueManager() {
  return {
    addJob: vi.fn().mockResolvedValue({ id: 'job-123' }),
    getJob: vi.fn(),
    getQueueMetrics: vi.fn(),
    healthCheck: vi.fn().mockResolvedValue(true),
    close: vi.fn(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

/**
 * Create an admin user directly in the database and return a signed JWT.
 * Use this instead of registering via POST /api/v1/auth/register which
 * no longer accepts the role field (security: prevent privilege escalation).
 */
export async function createAdminUser(
  server: FastifyInstance,
  db: DatabaseClient,
  emailPrefix: string = 'admin'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<{ token: string; user: any }> {
  const timestamp = Date.now();
  const randomId = Math.random().toString(36).substring(7);
  const passwordHash = await bcrypt.hash('password123', 10);
  const user = await db.users.create({
    email: `${emailPrefix}-${timestamp}-${randomId}@example.com`,
    password_hash: passwordHash,
    role: 'admin',
  });
  const token = server.jwt.sign({ userId: user.id, role: 'admin' }, { expiresIn: '1h' });
  return { token, user };
}

/**
 * Helper SQL to create project integration with proper FK relationship
 * Use this instead of direct INSERT to handle the integration_id lookup
 *
 * @example
 * const result = await db.query(
 *   createProjectIntegrationSQL(),
 *   [projectId, 'jira', true, JSON.stringify(config), 'encrypted_creds']
 * );
 * const integrationId = result.rows[0].id;
 */
export function createProjectIntegrationSQL(): string {
  return `
    INSERT INTO project_integrations (project_id, integration_id, enabled, config, encrypted_credentials)
    VALUES (
      $1,
      (SELECT id FROM integrations WHERE type = $2),
      $3,
      $4,
      $5
    )
    RETURNING id
  `;
}
