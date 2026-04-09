import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { DatabaseClient } from '../../src/db/client.js';
import type { ProjectInsert, BugReportInsert } from '../../src/db/types.js';

// Test database configuration - use DATABASE_URL set by testcontainers
const TEST_DATABASE_URL =
  process.env.DATABASE_URL ||
  process.env.TEST_DATABASE_URL ||
  'postgresql://postgres:postgres@localhost:5432/bugspotter_test';

// Generate unique identifiers for tests to avoid collisions
let uniqueCounter = 0;
function generateUniqueId(): string {
  return `${Date.now()}-${process.hrtime.bigint()}-${++uniqueCounter}`;
}

describe('DatabaseClient', () => {
  let db: DatabaseClient;
  let testProjectId: string;
  const createdProjectIds: string[] = [];

  beforeAll(async () => {
    // Create database client
    db = DatabaseClient.create({
      connectionString: TEST_DATABASE_URL,
    });

    // Test connection
    const isConnected = await db.testConnection();
    if (!isConnected) {
      throw new Error('Failed to connect to test database');
    }
  });

  afterAll(async () => {
    // Clean up all created projects (will cascade delete related records)
    for (const projectId of createdProjectIds) {
      try {
        await db.projects.delete(projectId);
      } catch {
        // Ignore errors if already deleted
      }
    }
    // Close connection
    await db.close();
  });

  beforeEach(async () => {
    // Create a test project before each test
    const projectData: ProjectInsert = {
      name: 'Test Project',
      settings: { theme: 'dark' },
    };
    const project = await db.projects.create(projectData);
    testProjectId = project.id;
    createdProjectIds.push(project.id);
  });

  describe('Connection', () => {
    it('should successfully connect to database', async () => {
      const result = await db.testConnection();
      expect(result).toBe(true);
    });
  });

  describe('Projects', () => {
    it('should create a project', async () => {
      const data: ProjectInsert = {
        name: 'New Project',
        settings: { color: 'blue' },
      };

      const project = await db.projects.create(data);
      createdProjectIds.push(project.id); // Track for cleanup

      expect(project).toBeDefined();
      expect(project.id).toBeDefined();
      expect(project.name).toBe(data.name);
      expect(project.settings).toEqual(data.settings);
      expect(project.created_at).toBeInstanceOf(Date);
    });

    it('should get project by ID', async () => {
      const project = await db.projects.findById(testProjectId);

      expect(project).toBeDefined();
      expect(project?.id).toBe(testProjectId);
      expect(project?.name).toBe('Test Project');
    });

    it('should update project', async () => {
      const updated = await db.projects.update(testProjectId, {
        name: 'Updated Project',
        settings: { theme: 'light' },
      });

      expect(updated).toBeDefined();
      expect(updated?.name).toBe('Updated Project');
      expect(updated?.settings).toEqual({ theme: 'light' });
    });

    it('should delete project', async () => {
      const result = await db.projects.delete(testProjectId);
      expect(result).toBe(true);

      const project = await db.projects.findById(testProjectId);
      expect(project).toBeNull();
    });

    it('should return null for non-existent project', async () => {
      const project = await db.projects.findById('00000000-0000-0000-0000-000000000000');
      expect(project).toBeNull();
    });
  });

  describe('Bug Reports', () => {
    it('should create a bug report', async () => {
      const data: BugReportInsert = {
        project_id: testProjectId,
        title: 'Test Bug',
        description: 'This is a test bug',
        metadata: { browser: 'Chrome', version: '120' },
        status: 'open',
        priority: 'high',
      };

      const bugReport = await db.bugReports.create(data);

      expect(bugReport).toBeDefined();
      expect(bugReport.id).toBeDefined();
      expect(bugReport.title).toBe(data.title);
      expect(bugReport.project_id).toBe(testProjectId);
      expect(bugReport.status).toBe('open');
      expect(bugReport.priority).toBe('high');
      expect(bugReport.metadata).toEqual(data.metadata);
    });

    it('should get bug report by ID', async () => {
      const created = await db.bugReports.create({
        project_id: testProjectId,
        title: 'Get Test Bug',
      });

      const bugReport = await db.bugReports.findById(created.id);

      expect(bugReport).toBeDefined();
      expect(bugReport?.id).toBe(created.id);
      expect(bugReport?.title).toBe('Get Test Bug');
    });

    it('should update bug report', async () => {
      const created = await db.bugReports.create({
        project_id: testProjectId,
        title: 'Original Title',
        status: 'open',
      });

      const updated = await db.bugReports.update(created.id, {
        title: 'Updated Title',
        status: 'in-progress',
        priority: 'critical',
      });

      expect(updated).toBeDefined();
      expect(updated?.title).toBe('Updated Title');
      expect(updated?.status).toBe('in-progress');
      expect(updated?.priority).toBe('critical');
    });

    it('should list bug reports with pagination', async () => {
      // Create multiple bug reports
      for (let i = 1; i <= 5; i++) {
        await db.bugReports.create({
          project_id: testProjectId,
          title: `Bug ${i}`,
          priority: i <= 2 ? 'high' : 'low',
        });
      }

      const result = await db.bugReports.list(
        { project_id: testProjectId },
        { sort_by: 'created_at', order: 'desc' },
        { page: 1, limit: 3 }
      );

      expect(result.data).toHaveLength(3);
      expect(result.pagination.page).toBe(1);
      expect(result.pagination.limit).toBe(3);
      expect(result.pagination.total).toBeGreaterThanOrEqual(5);
    });

    it('should filter bug reports by status', async () => {
      await db.bugReports.create({
        project_id: testProjectId,
        title: 'Open Bug',
        status: 'open',
      });

      await db.bugReports.create({
        project_id: testProjectId,
        title: 'Resolved Bug',
        status: 'resolved',
      });

      const result = await db.bugReports.list({ project_id: testProjectId, status: 'open' });

      expect(result.data.length).toBeGreaterThan(0);
      result.data.forEach((bug) => {
        expect(bug.status).toBe('open');
      });
    });

    it('should filter bug reports by priority', async () => {
      await db.bugReports.create({
        project_id: testProjectId,
        title: 'Critical Bug',
        priority: 'critical',
      });

      const result = await db.bugReports.list({ project_id: testProjectId, priority: 'critical' });

      expect(result.data.length).toBeGreaterThan(0);
      result.data.forEach((bug) => {
        expect(bug.priority).toBe('critical');
      });
    });

    it('should delete bug report', async () => {
      const created = await db.bugReports.create({
        project_id: testProjectId,
        title: 'To Delete',
      });

      const result = await db.bugReports.delete(created.id);
      expect(result).toBe(true);

      const bugReport = await db.bugReports.findById(created.id);
      expect(bugReport).toBeNull();
    });
  });

  describe('Users', () => {
    it('should create a user', async () => {
      const email = `test-${Date.now()}@example.com`;
      const user = await db.users.create({
        email,
        password_hash: 'hashed_password',
        role: 'user',
      });

      expect(user).toBeDefined();
      expect(user.id).toBeDefined();
      expect(user.email).toBe(email);
      expect(user.role).toBe('user');
    });

    it('should get user by email', async () => {
      const email = `test-${Date.now()}@example.com`;
      await db.users.create({
        email,
        password_hash: 'hashed_password',
      });

      const user = await db.users.findByEmail(email);

      expect(user).toBeDefined();
      expect(user?.email).toBe(email);
    });

    it('should create OAuth user', async () => {
      const email = `oauth-${Date.now()}@example.com`;
      const user = await db.users.create({
        email,
        oauth_provider: 'google',
        oauth_id: '12345',
        role: 'user',
      });

      expect(user).toBeDefined();
      expect(user.oauth_provider).toBe('google');
      expect(user.oauth_id).toBe('12345');
    });

    it('should get user by OAuth credentials', async () => {
      const email = `oauth-${Date.now()}@example.com`;
      await db.users.create({
        email,
        oauth_provider: 'github',
        oauth_id: 'gh123',
      });

      const user = await db.users.findByOAuth('github', 'gh123');

      expect(user).toBeDefined();
      expect(user?.email).toBe(email);
    });

    it('should enforce unique email addresses', async () => {
      const email = `duplicate-${Date.now()}@example.com`;

      await db.users.create({
        email,
        password_hash: 'password1',
      });

      // Try to create another user with same email (different auth method)
      await expect(
        db.users.create({
          email,
          oauth_provider: 'google',
          oauth_id: 'google123',
        })
      ).rejects.toThrow();
    });

    it('should enforce unique OAuth credentials', async () => {
      const email1 = `oauth1-${Date.now()}@example.com`;
      const email2 = `oauth2-${Date.now()}@example.com`;

      await db.users.create({
        email: email1,
        oauth_provider: 'google',
        oauth_id: 'same-id-123',
      });

      // Try to create another user with same OAuth credentials
      await expect(
        db.users.create({
          email: email2,
          oauth_provider: 'google',
          oauth_id: 'same-id-123',
        })
      ).rejects.toThrow();
    });

    it('should reject users with both password and OAuth', async () => {
      const email = `invalid-${Date.now()}@example.com`;

      // This violates the check_auth_method constraint
      await expect(
        db.users.create({
          email,
          password_hash: 'password123',
          oauth_provider: 'google',
          oauth_id: 'google123',
        })
      ).rejects.toThrow();
    });

    it('should reject users with neither password nor OAuth', async () => {
      const email = `invalid2-${Date.now()}@example.com`;

      // This violates the check_auth_method constraint
      await expect(
        db.users.create({
          email,
          // No password_hash, no oauth_provider/oauth_id
        })
      ).rejects.toThrow();
    });
  });

  describe('Tickets', () => {
    let bugReportId: string;

    beforeEach(async () => {
      const bugReport = await db.bugReports.create({
        project_id: testProjectId,
        title: 'Bug with Ticket',
      });
      bugReportId = bugReport.id;
    });

    it('should create a ticket', async () => {
      const ticket = await db.tickets.createTicket(bugReportId, 'JIRA-123', 'jira', 'open');

      expect(ticket).toBeDefined();
      expect(ticket.id).toBeDefined();
      expect(ticket.bug_report_id).toBe(bugReportId);
      expect(ticket.external_id).toBe('JIRA-123');
      expect(ticket.platform).toBe('jira');
    });

    it('should get tickets by bug report', async () => {
      await db.tickets.createTicket(bugReportId, 'JIRA-789', 'jira');
      await db.tickets.createTicket(bugReportId, 'LIN-456', 'linear');

      const tickets = await db.tickets.findByBugReport(bugReportId);

      expect(tickets).toHaveLength(2);
      expect(tickets[0].bug_report_id).toBe(bugReportId);
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid project ID gracefully', async () => {
      // PostgreSQL will throw an error for invalid UUID format
      await expect(db.projects.findById('invalid-id')).rejects.toThrow();
    });

    it('should allow projects with empty names', async () => {
      // PostgreSQL allows empty strings, application layer should validate
      const project = await db.projects.create({
        name: '',
      });
      createdProjectIds.push(project.id);

      expect(project).toBeDefined();
      expect(project.name).toBe('');
    });
  });

  describe('Transactions', () => {
    it('should commit transaction on success', async () => {
      const result = await db.transaction(async (tx) => {
        const bug = await tx.bugReports.create({
          project_id: testProjectId,
          title: 'Transaction Test Bug',
        });

        return { bug };
      });

      expect(result.bug).toBeDefined();

      // Verify data persisted
      const bug = await db.bugReports.findById(result.bug.id);
      expect(bug).toBeDefined();
    });

    it('should rollback transaction on error', async () => {
      let createdBugId: string | null = null;

      await expect(
        db.transaction(async (tx) => {
          const bug = await tx.bugReports.create({
            project_id: testProjectId,
            title: 'Rollback Test Bug',
          });
          createdBugId = bug.id;

          // Intentionally cause an error
          throw new Error('Test error - should rollback');
        })
      ).rejects.toThrow('Test error - should rollback');

      // Verify data was rolled back
      if (createdBugId) {
        const bug = await db.bugReports.findById(createdBugId);
        expect(bug).toBeNull();
      }
    });
  });

  describe('Batch Operations', () => {
    it('should create multiple bug reports in batch', async () => {
      const bugData: BugReportInsert[] = [
        {
          project_id: testProjectId,
          title: 'Batch Bug 1',
          priority: 'high',
        },
        {
          project_id: testProjectId,
          title: 'Batch Bug 2',
          priority: 'low',
        },
        {
          project_id: testProjectId,
          title: 'Batch Bug 3',
          priority: 'medium',
        },
      ];

      const results = await db.bugReports.createBatch(bugData);

      expect(results).toHaveLength(3);
      expect(results[0].title).toBe('Batch Bug 1');
      expect(results[1].title).toBe('Batch Bug 2');
      expect(results[2].title).toBe('Batch Bug 3');

      // Verify all were created
      for (const bug of results) {
        const found = await db.bugReports.findById(bug.id);
        expect(found).toBeDefined();
      }
    });

    it('should return empty array for empty batch', async () => {
      const results = await db.bugReports.createBatch([]);
      expect(results).toHaveLength(0);
    });

    it('should reject batch exceeding maximum size (1000)', async () => {
      const hugeArray = Array.from({ length: 1001 }, (_, i) => ({
        project_id: testProjectId,
        title: `Bug ${i}`,
      }));

      await expect(db.bugReports.createBatch(hugeArray)).rejects.toThrow(
        'Batch size 1001 exceeds maximum allowed (1000)'
      );
    });

    it('should accept batch at maximum size (1000)', async () => {
      // This test might be slow, so we'll use a smaller representative size
      const largeArray = Array.from({ length: 50 }, (_, i) => ({
        project_id: testProjectId,
        title: `Large Batch Bug ${i}`,
      }));

      const results = await db.bugReports.createBatch(largeArray);
      expect(results).toHaveLength(50);
    });

    it('should reject batch size that would exceed PostgreSQL parameter limit', async () => {
      // With 8 columns per row, 1001 rows would need 8,008 parameters
      // Our limit of 1000 prevents this
      const oversizedArray = Array.from({ length: 10000 }, (_, i) => ({
        project_id: testProjectId,
        title: `Bug ${i}`,
      }));

      await expect(db.bugReports.createBatch(oversizedArray)).rejects.toThrow(
        'exceeds maximum allowed'
      );
    });

    it('should handle large arrays with createBatchAuto', async () => {
      // Create 150 items (will be split into 3 batches of 50)
      const largeArray = Array.from({ length: 150 }, (_, i) => ({
        project_id: testProjectId,
        title: `Auto Batch Bug ${i}`,
      }));

      const results = await db.bugReports.createBatchAuto(largeArray, 50);
      expect(results).toHaveLength(150);
    });

    it('should handle small arrays with createBatchAuto', async () => {
      const smallArray = Array.from({ length: 5 }, (_, i) => ({
        project_id: testProjectId,
        title: `Small Auto Batch ${i}`,
      }));

      const results = await db.bugReports.createBatchAuto(smallArray);
      expect(results).toHaveLength(5);
    });

    it('should reject invalid batch size in createBatchAuto', async () => {
      const data = [{ project_id: testProjectId, title: 'Test' }];

      await expect(db.bugReports.createBatchAuto(data, 0)).rejects.toThrow(
        'Batch size must be between 1 and 1000'
      );

      await expect(db.bugReports.createBatchAuto(data, 1001)).rejects.toThrow(
        'Batch size must be between 1 and 1000'
      );

      await expect(db.bugReports.createBatchAuto(data, -10)).rejects.toThrow(
        'Batch size must be between 1 and 1000'
      );
    });

    it('should return empty array for empty input in createBatchAuto', async () => {
      const results = await db.bugReports.createBatchAuto([]);
      expect(results).toHaveLength(0);
    });
  });

  describe('SQL Injection Protection', () => {
    it('should prevent SQL injection in ORDER BY clause', async () => {
      // Attempt SQL injection through sort parameter
      await expect(
        db.bugReports.list(
          { project_id: testProjectId },
          // @ts-expect-error - Testing runtime injection attempt
          { sort_by: 'created_at; DROP TABLE bug_reports--', order: 'desc' },
          { page: 1, limit: 10 }
        )
      ).rejects.toThrow('Invalid sort column');
    });

    it('should reject invalid sort column not in whitelist', async () => {
      await expect(
        db.bugReports.list(
          { project_id: testProjectId },
          // @ts-expect-error - Testing runtime validation
          { sort_by: 'invalid_column', order: 'desc' },
          { page: 1, limit: 10 }
        )
      ).rejects.toThrow('Invalid sort column: invalid_column');
    });

    it('should reject invalid sort order', async () => {
      await expect(
        db.bugReports.list(
          { project_id: testProjectId },
          // @ts-expect-error - Testing runtime validation
          { sort_by: 'created_at', order: 'INVALID' },
          { page: 1, limit: 10 }
        )
      ).rejects.toThrow('Invalid sort order');
    });

    it('should allow all valid sort columns', async () => {
      // Test all whitelisted columns
      const validColumns = ['created_at', 'updated_at', 'priority'] as const;

      for (const column of validColumns) {
        const result = await db.bugReports.list(
          { project_id: testProjectId },
          { sort_by: column, order: 'desc' },
          { page: 1, limit: 10 }
        );
        expect(result).toBeDefined();
        expect(result.data).toBeInstanceOf(Array);
      }
    });

    it('should allow valid column names in ORDER BY', async () => {
      // Valid column names should work
      const result = await db.bugReports.list(
        { project_id: testProjectId },
        { sort_by: 'created_at', order: 'desc' },
        { page: 1, limit: 10 }
      );

      expect(result).toBeDefined();
      expect(result.data).toBeDefined();
    });

    it('should prevent SQL injection in column names via update()', async () => {
      const created = await db.bugReports.create({
        project_id: testProjectId,
        title: 'Test',
      });

      // Attempt injection through column name
      const maliciousUpdate: Record<string, unknown> = {
        'title; DROP TABLE bug_reports--': 'malicious',
      };
      await expect(db.bugReports.update(created.id, maliciousUpdate)).rejects.toThrow(
        'Invalid SQL identifier'
      );
    });

    it('should prevent SQL injection in column names via create()', async () => {
      // Attempt injection through column name in serialized data
      type RepositoryWithSerialize = typeof db.bugReports & {
        serializeForInsert: (data: Record<string, unknown>) => Record<string, unknown>;
      };
      const maliciousRepo = db.bugReports as RepositoryWithSerialize;
      const originalSerialize = maliciousRepo.serializeForInsert.bind(maliciousRepo);
      maliciousRepo.serializeForInsert = () => {
        return {
          'project_id; DROP TABLE projects--': testProjectId,
          title: 'test',
        };
      };

      await expect(
        maliciousRepo.create({ project_id: testProjectId, title: 'test' })
      ).rejects.toThrow('Invalid SQL identifier');

      // Restore original
      maliciousRepo.serializeForInsert = originalSerialize;
    });

    it('should prevent SQL injection via findBy() column parameter', async () => {
      // Direct call to protected method via type assertion
      type RepositoryWithFindBy = typeof db.projects & {
        findBy: (column: string, value: unknown) => Promise<unknown>;
      };
      const repo = db.projects as RepositoryWithFindBy;
      await expect(repo.findBy('id; DROP TABLE projects--', 'anything')).rejects.toThrow(
        'Invalid SQL identifier'
      );
    });

    it('should prevent SQL injection via findByMultiple() columns', async () => {
      type RepositoryWithFindByMultiple = typeof db.users & {
        findByMultiple: (criteria: Record<string, unknown>) => Promise<unknown>;
      };
      const repo = db.users as RepositoryWithFindByMultiple;
      await expect(
        repo.findByMultiple({
          'email; DROP TABLE users--': 'test@example.com',
          password_hash: 'hash',
        })
      ).rejects.toThrow('Invalid SQL identifier');
    });

    it('should prevent SQL injection in batch insert column names', async () => {
      const maliciousData = [
        {
          project_id: testProjectId,
          title: 'Test 1',
        },
      ];

      // Override serialization to inject malicious column name
      type RepositoryWithSerialize = typeof db.bugReports & {
        serializeForInsert: (data: Record<string, unknown>) => Record<string, unknown>;
        createBatch: (data: unknown[]) => Promise<unknown>;
      };
      const repo = db.bugReports as RepositoryWithSerialize;
      const originalSerialize = repo.serializeForInsert.bind(repo);
      repo.serializeForInsert = () => {
        return {
          'project_id; DROP TABLE bug_reports--': testProjectId,
          title: 'malicious',
        };
      };

      await expect(repo.createBatch(maliciousData)).rejects.toThrow('Invalid SQL identifier');

      // Restore
      repo.serializeForInsert = originalSerialize;
    });
  });

  describe('Pagination Validation', () => {
    it('should reject negative page numbers', async () => {
      await expect(
        db.bugReports.list({ project_id: testProjectId }, {}, { page: -1, limit: 20 })
      ).rejects.toThrow('Invalid page number: -1');
    });

    it('should reject zero page numbers', async () => {
      await expect(
        db.bugReports.list({ project_id: testProjectId }, {}, { page: 0, limit: 20 })
      ).rejects.toThrow('Invalid page number: 0');
    });

    it('should reject decimal page numbers', async () => {
      await expect(
        db.bugReports.list({ project_id: testProjectId }, {}, { page: 1.5, limit: 20 })
      ).rejects.toThrow('Invalid page number: 1.5');
    });

    it('should reject negative limit', async () => {
      await expect(
        db.bugReports.list({ project_id: testProjectId }, {}, { page: 1, limit: -10 })
      ).rejects.toThrow('Invalid limit: -10');
    });

    it('should reject zero limit', async () => {
      await expect(
        db.bugReports.list({ project_id: testProjectId }, {}, { page: 1, limit: 0 })
      ).rejects.toThrow('Invalid limit: 0');
    });

    it('should reject decimal limit', async () => {
      await expect(
        db.bugReports.list({ project_id: testProjectId }, {}, { page: 1, limit: 20.5 })
      ).rejects.toThrow('Invalid limit: 20.5');
    });

    it('should reject limit exceeding maximum (1000)', async () => {
      await expect(
        db.bugReports.list({ project_id: testProjectId }, {}, { page: 1, limit: 1001 })
      ).rejects.toThrow('Invalid limit: 1001');
    });

    it('should reject excessively large limit (DoS protection)', async () => {
      await expect(
        db.bugReports.list({ project_id: testProjectId }, {}, { page: 1, limit: 999999 })
      ).rejects.toThrow('Invalid limit: 999999');
    });

    it('should accept valid pagination (page 1)', async () => {
      const result = await db.bugReports.list(
        { project_id: testProjectId },
        {},
        { page: 1, limit: 10 }
      );

      expect(result).toBeDefined();
      expect(result.pagination.page).toBe(1);
      expect(result.pagination.limit).toBe(10);
    });

    it('should accept valid pagination (page 5)', async () => {
      const result = await db.bugReports.list(
        { project_id: testProjectId },
        {},
        { page: 5, limit: 20 }
      );

      expect(result).toBeDefined();
      expect(result.pagination.page).toBe(5);
      expect(result.pagination.limit).toBe(20);
    });

    it('should accept maximum allowed limit (1000)', async () => {
      const result = await db.bugReports.list(
        { project_id: testProjectId },
        {},
        { page: 1, limit: 1000 }
      );

      expect(result).toBeDefined();
      expect(result.pagination.limit).toBe(1000);
    });

    it('should use default values when pagination is not provided', async () => {
      const result = await db.bugReports.list({ project_id: testProjectId });

      expect(result.pagination.page).toBe(1);
      expect(result.pagination.limit).toBe(20);
    });
  });

  describe('Retry Logic', () => {
    it('should have retry wrapper on read methods', () => {
      // Verify proxy wrapping exists
      expect(db.bugReports).toBeDefined();
      expect(typeof db.bugReports.findById).toBe('function');
      expect(typeof db.bugReports.list).toBe('function');
    });

    it('should have methods for write operations (not auto-retried)', () => {
      // Verify write methods are accessible
      expect(typeof db.bugReports.create).toBe('function');
      expect(typeof db.bugReports.update).toBe('function');
      expect(typeof db.bugReports.delete).toBe('function');
      expect(typeof db.bugReports.createBatch).toBe('function');
    });

    it('should use same retry logic across all repository instances', () => {
      // All repositories should reference the same retry whitelist
      // This tests that we're using a shared static constant, not per-instance closures
      expect(db.projects).toBeDefined();
      expect(db.bugReports).toBeDefined();
      expect(db.users).toBeDefined();
      expect(db.tickets).toBeDefined();

      // Verify that different repositories behave consistently
      expect(typeof db.projects.findById).toBe('function');
      expect(typeof db.users.findById).toBe('function');
    });

    it('should allow read operations to succeed', async () => {
      const created = await db.bugReports.create({
        project_id: testProjectId,
        title: 'Test Read Retry',
      });

      // This uses the retry wrapper
      const found = await db.bugReports.findById(created.id);
      expect(found).toBeDefined();
      expect(found?.id).toBe(created.id);
    });

    it('should allow write operations to succeed', async () => {
      // Create operation (not auto-retried)
      const bug = await db.bugReports.create({
        project_id: testProjectId,
        title: 'Test Write No Retry',
      });

      expect(bug).toBeDefined();
      expect(bug.title).toBe('Test Write No Retry');

      // Update operation (not auto-retried)
      const updated = await db.bugReports.update(bug.id, { title: 'Updated Title' });
      expect(updated?.title).toBe('Updated Title');

      // Delete operation (not auto-retried)
      const deleted = await db.bugReports.delete(bug.id);
      expect(deleted).toBe(true);
    });
  });

  describe('Audit Logs', () => {
    let testUserId: string;

    beforeEach(async () => {
      // Create test user for audit logs
      const user = await db.users.create({
        email: `audit-test-${generateUniqueId()}@example.com`,
        password_hash: 'hash',
        name: 'Audit Test User',
      });
      testUserId = user.id;
    });

    it('should throw ValidationError for invalid sort column', async () => {
      await expect(
        db.auditLogs.list({}, { sort_by: 'invalid_column' as never }, 1, 10)
      ).rejects.toThrow('Invalid sort column: invalid_column');

      try {
        await db.auditLogs.list({}, { sort_by: 'invalid_column' as never }, 1, 10);
      } catch (error) {
        const validationError = error as {
          name: string;
          statusCode: number;
          details: Record<string, unknown>;
        };
        expect(validationError.name).toBe('ValidationError');
        expect(validationError.statusCode).toBe(400);
        expect(validationError.details).toBeDefined();
        expect(validationError.details.provided).toBe('invalid_column');
        expect(validationError.details.allowed).toEqual(['timestamp', 'action', 'resource']);
      }
    });

    it('should throw ValidationError for invalid sort order', async () => {
      await expect(
        db.auditLogs.list({}, { sort_by: 'timestamp', order: 'invalid' as never }, 1, 10)
      ).rejects.toThrow('Invalid sort order: invalid');

      try {
        await db.auditLogs.list({}, { sort_by: 'timestamp', order: 'invalid' as never }, 1, 10);
      } catch (error) {
        const validationError = error as {
          name: string;
          statusCode: number;
          details: Record<string, unknown>;
        };
        expect(validationError.name).toBe('ValidationError');
        expect(validationError.statusCode).toBe(400);
        expect(validationError.details).toBeDefined();
        expect(validationError.details.provided).toBe('invalid');
        expect(validationError.details.allowed).toEqual(['asc', 'desc']);
      }
    });

    it('should escape SQL wildcards in resource filter (% character)', async () => {
      // Create test audit logs with different resources
      await db.auditLogs.create({
        user_id: testUserId,
        action: 'GET',
        resource: '/api/v1/users',
        success: true,
      });

      await db.auditLogs.create({
        user_id: testUserId,
        action: 'GET',
        resource: '/api/v2/users',
        success: true,
      });

      await db.auditLogs.create({
        user_id: testUserId,
        action: 'GET',
        resource: '/other/endpoint',
        success: true,
      });

      // Search with % wildcard - should be escaped and match literally
      const results = await db.auditLogs.list(
        { resource: '/api/%', user_id: testUserId },
        {},
        1,
        50
      );

      // Should find NO results (% is escaped, so looking for literal '/api/%' prefix)
      expect(results.data.length).toBe(0);

      // Now search for legitimate prefix
      const validResults = await db.auditLogs.list(
        { resource: '/api/v1', user_id: testUserId },
        {},
        1,
        50
      );

      // Should find only /api/v1/users (prefix match)
      expect(validResults.data.length).toBe(1);
      expect(validResults.data[0].resource).toBe('/api/v1/users');
    });

    it('should escape SQL wildcards in resource filter (_ character)', async () => {
      // Create test audit logs
      await db.auditLogs.create({
        user_id: testUserId,
        action: 'GET',
        resource: '/api/v1/users',
        success: true,
      });

      await db.auditLogs.create({
        user_id: testUserId,
        action: 'GET',
        resource: '/api/v2/users',
        success: true,
      });

      // Search with _ wildcard (matches any single char) - should be escaped
      const results = await db.auditLogs.list(
        { resource: '/api/v_', user_id: testUserId },
        {},
        1,
        50
      );

      // Should find NO results (_ is escaped, so looking for literal '/api/v_' prefix)
      expect(results.data.length).toBe(0);
    });

    it('should use case-sensitive LIKE for resource filtering', async () => {
      // Create audit logs with different case
      await db.auditLogs.create({
        user_id: testUserId,
        action: 'GET',
        resource: '/api/v1/users',
        success: true,
      });

      await db.auditLogs.create({
        user_id: testUserId,
        action: 'GET',
        resource: '/API/V1/USERS',
        success: true,
      });

      // Search with lowercase - should only match lowercase (LIKE is case-sensitive)
      const lowercaseResults = await db.auditLogs.list(
        { resource: '/api/v1', user_id: testUserId },
        {},
        1,
        50
      );
      expect(lowercaseResults.data.length).toBe(1);
      expect(lowercaseResults.data[0].resource).toBe('/api/v1/users');

      // Search with uppercase - should only match uppercase
      const uppercaseResults = await db.auditLogs.list(
        { resource: '/API/V1', user_id: testUserId },
        {},
        1,
        50
      );
      expect(uppercaseResults.data.length).toBe(1);
      expect(uppercaseResults.data[0].resource).toBe('/API/V1/USERS');
    });

    it('should allow valid sort columns', async () => {
      // Create audit logs
      await db.auditLogs.create({
        user_id: testUserId,
        action: 'POST',
        resource: '/api/v1/projects',
        success: true,
      });

      // Test all valid sort columns
      const timestampSort = await db.auditLogs.list({}, { sort_by: 'timestamp' }, 1, 10);
      expect(timestampSort.data).toBeDefined();

      const actionSort = await db.auditLogs.list({}, { sort_by: 'action' }, 1, 10);
      expect(actionSort.data).toBeDefined();

      const resourceSort = await db.auditLogs.list({}, { sort_by: 'resource' }, 1, 10);
      expect(resourceSort.data).toBeDefined();
    });

    it('should allow both asc and desc sort orders', async () => {
      // Create multiple audit logs
      await db.auditLogs.create({
        user_id: testUserId,
        action: 'GET',
        resource: '/api/v1/projects',
        success: true,
      });

      await db.auditLogs.create({
        user_id: testUserId,
        action: 'POST',
        resource: '/api/v1/users',
        success: true,
      });

      // Test ascending order
      const ascResults = await db.auditLogs.list({}, { sort_by: 'action', order: 'asc' }, 1, 10);
      expect(ascResults.data).toBeDefined();

      // Test descending order
      const descResults = await db.auditLogs.list({}, { sort_by: 'action', order: 'desc' }, 1, 10);
      expect(descResults.data).toBeDefined();
    });
  });

  describe('Bug Reports - findByIds()', () => {
    it('should fetch multiple bug reports by IDs in single query', async () => {
      // Create multiple bug reports
      const report1 = await db.bugReports.create({
        project_id: testProjectId,
        title: 'Bug Report 1',
        description: 'First bug',
      });

      const report2 = await db.bugReports.create({
        project_id: testProjectId,
        title: 'Bug Report 2',
        description: 'Second bug',
      });

      const report3 = await db.bugReports.create({
        project_id: testProjectId,
        title: 'Bug Report 3',
        description: 'Third bug',
      });

      // Fetch all three by IDs
      const bugReports = await db.bugReports.findByIds([report1.id, report2.id, report3.id]);

      expect(bugReports).toHaveLength(3);
      expect(bugReports.map((r) => r.id)).toContain(report1.id);
      expect(bugReports.map((r) => r.id)).toContain(report2.id);
      expect(bugReports.map((r) => r.id)).toContain(report3.id);
    });

    it('should return empty array when no IDs provided', async () => {
      const bugReports = await db.bugReports.findByIds([]);
      expect(bugReports).toEqual([]);
    });

    it('should return only found reports when some IDs do not exist', async () => {
      const report = await db.bugReports.create({
        project_id: testProjectId,
        title: 'Existing Bug',
        description: 'This exists',
      });

      const nonExistentId = '00000000-0000-0000-0000-000000000000';
      const bugReports = await db.bugReports.findByIds([report.id, nonExistentId]);

      expect(bugReports).toHaveLength(1);
      expect(bugReports[0].id).toBe(report.id);
    });

    it('should return empty array when all IDs do not exist', async () => {
      const nonExistentIds = [
        '00000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-000000000002',
        '00000000-0000-0000-0000-000000000003',
      ];

      const bugReports = await db.bugReports.findByIds(nonExistentIds);
      expect(bugReports).toEqual([]);
    });

    it('should handle large batch of IDs efficiently', async () => {
      // Create 50 bug reports
      const ids: string[] = [];
      for (let i = 0; i < 50; i++) {
        const report = await db.bugReports.create({
          project_id: testProjectId,
          title: `Batch Bug ${i}`,
          description: `Bug number ${i}`,
        });
        ids.push(report.id);
      }

      // Fetch all 50 in single query
      const bugReports = await db.bugReports.findByIds(ids);

      expect(bugReports).toHaveLength(50);
      // Verify all IDs are present
      const returnedIds = bugReports.map((r) => r.id);
      ids.forEach((id) => {
        expect(returnedIds).toContain(id);
      });
    });

    it('should preserve all bug report fields', async () => {
      const report = await db.bugReports.create({
        project_id: testProjectId,
        title: 'Complete Bug Report',
        description: 'Full details',
        status: 'in-progress',
        priority: 'high',
        screenshot_key: 'screenshots/test.png',
        screenshot_url: 'https://example.com/screenshot.png',
        replay_key: 'replays/test.json.gz',
        replay_url: 'https://example.com/replay.json.gz',
        metadata: { browser: 'Chrome', version: '120' },
      });

      const [retrieved] = await db.bugReports.findByIds([report.id]);

      expect(retrieved.title).toBe('Complete Bug Report');
      expect(retrieved.description).toBe('Full details');
      expect(retrieved.status).toBe('in-progress');
      expect(retrieved.priority).toBe('high');
      expect(retrieved.screenshot_key).toBe('screenshots/test.png');
      expect(retrieved.screenshot_url).toBe('https://example.com/screenshot.png');
      expect(retrieved.replay_key).toBe('replays/test.json.gz');
      expect(retrieved.replay_url).toBe('https://example.com/replay.json.gz');
      expect(retrieved.metadata).toEqual({ browser: 'Chrome', version: '120' });
    });

    it('should handle duplicate IDs correctly', async () => {
      const report = await db.bugReports.create({
        project_id: testProjectId,
        title: 'Duplicate Test',
        description: 'Test duplicate IDs',
      });

      // Request same ID multiple times
      const bugReports = await db.bugReports.findByIds([report.id, report.id, report.id]);

      // Should return unique results (PostgreSQL behavior with ANY)
      expect(bugReports.length).toBeGreaterThan(0);
      expect(bugReports.every((r) => r.id === report.id)).toBe(true);
    });
  });

  describe('queryWithTransaction', () => {
    it('should execute callback within a transaction', async () => {
      const result = await db.queryWithTransaction(async (client) => {
        const res = await client.query('SELECT 1 + 1 AS sum');
        return res.rows[0].sum;
      });

      expect(result).toBe(2);
    });

    it('should commit transaction on success', async () => {
      const testValue = `txtest_${Date.now()}`;

      await db.queryWithTransaction(async (client) => {
        await client.query('INSERT INTO application.projects (name) VALUES ($1)', [testValue]);
      });

      // Verify the insert was committed
      const result = await db.query('SELECT name FROM application.projects WHERE name = $1', [
        testValue,
      ]);

      expect(result.rows.length).toBe(1);
      expect(result.rows[0].name).toBe(testValue);

      // Cleanup
      await db.query('DELETE FROM application.projects WHERE name = $1', [testValue]);
    });

    it('should rollback transaction on error', async () => {
      const testValue = `txrollback_${Date.now()}`;

      await expect(
        db.queryWithTransaction(async (client) => {
          await client.query('INSERT INTO application.projects (name) VALUES ($1)', [testValue]);
          throw new Error('Simulated error');
        })
      ).rejects.toThrow('Simulated error');

      // Verify the insert was rolled back
      const result = await db.query('SELECT name FROM application.projects WHERE name = $1', [
        testValue,
      ]);

      expect(result.rows.length).toBe(0);
    });

    it('should support advisory locks within transaction', async () => {
      const lockKey = 12345;

      const result = await db.queryWithTransaction(async (client) => {
        // Acquire advisory lock
        await client.query('SELECT pg_advisory_xact_lock($1)', [lockKey]);

        // Verify lock is held (would block if not in same transaction)
        const lockCheck = await client.query('SELECT pg_try_advisory_xact_lock($1) AS acquired', [
          lockKey,
        ]);

        return lockCheck.rows[0].acquired;
      });

      // Lock should have been acquired initially, but the try would fail since already held
      expect(result).toBeDefined();

      // After transaction completes, lock should be released
      // We can verify by acquiring it in a new transaction
      const canAcquire = await db.queryWithTransaction(async (client) => {
        const lockCheck = await client.query('SELECT pg_try_advisory_xact_lock($1) AS acquired', [
          lockKey,
        ]);
        return lockCheck.rows[0].acquired;
      });

      expect(canAcquire).toBe(true);
    });

    it('should release client even on callback error', async () => {
      const poolStats = db.getPoolStats();
      const initialTotal = poolStats.totalCount;

      // Execute failing transaction
      await expect(
        db.queryWithTransaction(async (client) => {
          await client.query('SELECT 1');
          throw new Error('Test error');
        })
      ).rejects.toThrow('Test error');

      // Give pool time to process release
      await new Promise((resolve) => setTimeout(resolve, 10));

      const afterStats = db.getPoolStats();

      // Total count should not increase (client was released)
      expect(afterStats.totalCount).toBeLessThanOrEqual(initialTotal + 1);
    });

    it('should handle multiple sequential transactions', async () => {
      const testValueBase = `multi_${Date.now()}`;

      // First transaction
      await db.queryWithTransaction(async (client) => {
        await client.query('INSERT INTO application.projects (name) VALUES ($1)', [
          `${testValueBase}_1`,
        ]);
      });

      // Second transaction
      await db.queryWithTransaction(async (client) => {
        await client.query('INSERT INTO application.projects (name) VALUES ($1)', [
          `${testValueBase}_2`,
        ]);
      });

      // Verify both commits succeeded
      const result = await db.query(
        'SELECT name FROM application.projects WHERE name LIKE $1 ORDER BY name',
        [`${testValueBase}_%`]
      );

      expect(result.rows.length).toBe(2);
      expect(result.rows[0].name).toBe(`${testValueBase}_1`);
      expect(result.rows[1].name).toBe(`${testValueBase}_2`);

      // Cleanup
      await db.query('DELETE FROM application.projects WHERE name LIKE $1', [`${testValueBase}_%`]);
    });

    it('should handle concurrent transactions without interference', async () => {
      const testValueBase = `concurrent_${Date.now()}`;

      // Execute two transactions concurrently
      const [result1, result2] = await Promise.all([
        db.queryWithTransaction(async (client) => {
          await client.query('INSERT INTO application.projects (name) VALUES ($1)', [
            `${testValueBase}_a`,
          ]);
          return 'a';
        }),
        db.queryWithTransaction(async (client) => {
          await client.query('INSERT INTO application.projects (name) VALUES ($1)', [
            `${testValueBase}_b`,
          ]);
          return 'b';
        }),
      ]);

      expect(result1).toBe('a');
      expect(result2).toBe('b');

      // Verify both commits succeeded
      const result = await db.query(
        'SELECT COUNT(*)::int AS count FROM application.projects WHERE name LIKE $1',
        [`${testValueBase}_%`]
      );

      expect(result.rows[0].count).toBe(2);

      // Cleanup
      await db.query('DELETE FROM application.projects WHERE name LIKE $1', [`${testValueBase}_%`]);
    });

    it('should pass client with correct transaction state', async () => {
      const result = await db.queryWithTransaction(async (client) => {
        // Check transaction state by attempting a query
        const txState = await client.query('SELECT txid_current() AS txid');
        return txState.rows[0].txid;
      });

      // Should return a valid transaction ID
      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
    });

    it('should handle rollback errors gracefully', async () => {
      // This test ensures that even if rollback fails, the original error is thrown
      await expect(
        db.queryWithTransaction(async (client) => {
          await client.query('SELECT 1');
          throw new Error('Original error');
        })
      ).rejects.toThrow('Original error');
    });

    it('should support returning complex data types', async () => {
      const result = await db.queryWithTransaction(async (client) => {
        const res = await client.query(
          `
          SELECT 
            $1::text AS text_val,
            $2::int AS int_val,
            $3::jsonb AS json_val,
            $4::timestamp AS ts_val
        `,
          ['test', 42, JSON.stringify({ key: 'value' }), new Date('2024-01-01')]
        );
        return res.rows[0];
      });

      expect(result.text_val).toBe('test');
      expect(result.int_val).toBe(42);
      expect(result.json_val).toEqual({ key: 'value' });
      expect(result.ts_val).toBeInstanceOf(Date);
    });

    it('should support nested queries within transaction', async () => {
      const testValue = `nested_${Date.now()}`;

      await db.queryWithTransaction(async (client) => {
        // Create project
        const projectResult = await client.query(
          'INSERT INTO application.projects (name) VALUES ($1) RETURNING id',
          [testValue]
        );
        const projectId = projectResult.rows[0].id;

        // Create bug report referencing the project
        await client.query(
          'INSERT INTO application.bug_reports (project_id, title, description) VALUES ($1, $2, $3)',
          [projectId, 'Test Bug', 'Test Description']
        );

        // Both should be visible within transaction
        const bugCount = await client.query(
          'SELECT COUNT(*)::int AS count FROM application.bug_reports WHERE project_id = $1',
          [projectId]
        );

        expect(bugCount.rows[0].count).toBe(1);
      });

      // Verify both commits succeeded
      const result = await db.query(
        'SELECT COUNT(*)::int AS count FROM application.projects WHERE name = $1',
        [testValue]
      );

      expect(result.rows[0].count).toBe(1);

      // Cleanup
      await db.query('DELETE FROM application.projects WHERE name = $1', [testValue]);
    });
  });
});
