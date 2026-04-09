/**
 * Test utilities for integration tests
 * Provides helper functions for creating test data and cleaning up
 */

import type { DatabaseClient } from '../../src/db/client.js';
import type { Project, User, BugReport } from '../../src/db/types.js';
import bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { API_KEY_PREFIX, API_KEY_BYTES } from '../../src/api/utils/constants.js';

/**
 * Generate a unique identifier for tests to avoid collisions
 */
let uniqueCounter = 0;
export function generateUniqueId(): string {
  return `${Date.now()}-${process.hrtime.bigint()}-${++uniqueCounter}`;
}

/**
 * Generate a secure random API key
 */
export function generateApiKey(): string {
  return `${API_KEY_PREFIX}${randomBytes(API_KEY_BYTES).toString('hex')}`;
}

/**
 * Create a test project
 */
export async function createTestProject(
  db: DatabaseClient,
  overrides?: Partial<{ name: string; settings: Record<string, unknown>; created_by: string }>
): Promise<Project> {
  const project = await db.projects.create({
    name: overrides?.name || `Test Project ${generateUniqueId()}`,
    settings: overrides?.settings || { test: true },
    created_by: overrides?.created_by,
  });

  return project;
}

/**
 * Create a test user with hashed password
 */
export async function createTestUser(
  db: DatabaseClient,
  overrides?: Partial<{ email: string; password: string; role: 'admin' | 'user' | 'viewer' }>
): Promise<{ user: User; password: string }> {
  const password = overrides?.password || 'Test123!@#';
  const password_hash = await bcrypt.hash(password, 10);

  const user = await db.users.create({
    email: overrides?.email || `test-${generateUniqueId()}@example.com`,
    password_hash,
    role: overrides?.role || 'user',
  });

  return { user, password };
}

/**
 * Create a test bug report
 */
export async function createTestBugReport(
  db: DatabaseClient,
  projectId: string,
  overrides?: Partial<{
    title: string;
    description: string;
    status: string;
    priority: string;
    metadata: Record<string, unknown>;
  }>
): Promise<BugReport> {
  const bugReport = await db.bugReports.create({
    project_id: projectId,
    title: overrides?.title || `Test Bug ${generateUniqueId()}`,
    description: overrides?.description || 'Test bug description',
    status: (overrides?.status as BugReport['status']) || 'open',
    priority: (overrides?.priority as BugReport['priority']) || 'medium',
    metadata: overrides?.metadata || { browser: 'Chrome', version: '120' },
  });

  return bugReport;
}

/**
 * Test cleanup tracker
 * Keeps track of created resources for cleanup
 */
export class TestCleanupTracker {
  private projectIds: string[] = [];
  private userIds: string[] = [];
  private bugReportIds: string[] = [];
  private organizationIds: string[] = [];

  trackProject(id: string): void {
    this.projectIds.push(id);
  }

  trackUser(id: string): void {
    this.userIds.push(id);
  }

  trackBugReport(id: string): void {
    this.bugReportIds.push(id);
  }

  trackOrganization(id: string): void {
    this.organizationIds.push(id);
  }

  async cleanup(db: DatabaseClient): Promise<void> {
    // Delete in reverse order of creation
    // Bug reports first (they may reference projects)
    for (const id of this.bugReportIds) {
      try {
        await db.bugReports.delete(id);
      } catch {
        // Ignore if already deleted
      }
    }

    // Then projects
    for (const id of this.projectIds) {
      try {
        await db.projects.delete(id);
      } catch {
        // Ignore if already deleted
      }
    }

    // Then organizations (CASCADE deletes members)
    for (const id of this.organizationIds) {
      try {
        await db.organizations.hardDelete(id);
      } catch {
        // Ignore if already deleted
      }
    }

    // Finally users
    for (const id of this.userIds) {
      try {
        await db.users.delete(id);
      } catch {
        // Ignore if already deleted
      }
    }

    // Clear tracking arrays
    this.projectIds = [];
    this.userIds = [];
    this.bugReportIds = [];
    this.organizationIds = [];
  }
}

/**
 * Simple cleanup - delete specific resources
 */
export async function cleanupResources(
  db: DatabaseClient,
  resources: { projects?: string[]; users?: string[]; bugReports?: string[] }
): Promise<void> {
  // Delete bug reports first
  if (resources.bugReports) {
    for (const id of resources.bugReports) {
      try {
        await db.bugReports.delete(id);
      } catch {
        // Ignore errors
      }
    }
  }

  // Then projects
  if (resources.projects) {
    for (const id of resources.projects) {
      try {
        await db.projects.delete(id);
      } catch {
        // Ignore errors
      }
    }
  }

  // Finally users
  if (resources.users) {
    for (const id of resources.users) {
      try {
        await db.users.delete(id);
      } catch {
        // Ignore errors
      }
    }
  }
}

/**
 * Wait for database to be ready
 * Polls the database connection until it's available
 */
export async function waitForDatabase(
  db: DatabaseClient,
  maxAttempts = 30,
  delayMs = 1000
): Promise<boolean> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const isConnected = await db.testConnection();
      if (isConnected) {
        return true;
      }
    } catch {
      // Ignore error and retry
    }

    if (attempt < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return false;
}

/**
 * Create multiple test bug reports in batch
 */
export async function createTestBugReports(
  db: DatabaseClient,
  projectId: string,
  count: number
): Promise<BugReport[]> {
  const reports = Array.from({ length: count }, (_, i) => ({
    project_id: projectId,
    title: `Test Bug ${i + 1} - ${generateUniqueId()}`,
    description: `Test bug description ${i + 1}`,
    status: 'open' as const,
    priority: (['low', 'medium', 'high', 'critical'] as const)[i % 4],
    metadata: { browser: 'Chrome', index: i },
  }));

  return await db.bugReports.createBatch(reports);
}

/**
 * Get test JWT secret (for testing only)
 */
export function getTestJwtSecret(): string {
  return process.env.JWT_SECRET || 'test-jwt-secret-for-testing-only-not-production';
}

/**
 * Sleep for a specified number of milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
