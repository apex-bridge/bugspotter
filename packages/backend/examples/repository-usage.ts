/**
 * Repository Usage Examples
 *
 * RECOMMENDED APPROACH: Use DatabaseClient for application code
 * DIRECT REPOSITORIES: Only for testing or special cases where you need more control
 */

import { fileURLToPath } from 'url';
import pg from 'pg';
import {
  ProjectRepository,
  BugReportRepository,
  UserRepository,
  SessionRepository,
  TicketRepository,
} from '../src/index.js';
import { createDatabaseClient } from '../src/db/client.js';
import { NotificationService } from '../src/services/notifications/notification-service.js';

const { Pool } = pg;

/**
 * RECOMMENDED: Using DatabaseClient (Production Pattern)
 * This is how services like NotificationService should be structured
 */
async function databaseClientExample() {
  const db = createDatabaseClient();

  try {
    // Create a project
    const project = await db.projects.create({
      name: 'Example Project',
      api_key: 'example-key-' + Date.now(),
      settings: {},
    });
    console.log('✅ Created project:', project.id);

    // Create a bug report
    const bug = await db.bugReports.create({
      project_id: project.id,
      title: 'Example bug',
      description: 'Test bug',
      status: 'open',
      priority: 'high',
    });
    console.log('✅ Created bug:', bug.id);

    // Initialize NotificationService with DatabaseClient injection
    // This demonstrates the RECOMMENDED pattern for all services
    new NotificationService(db);
    console.log('✅ NotificationService initialized with DatabaseClient');
    console.log('   This is the RECOMMENDED pattern for all services');

    // Cleanup
    await db.projects.delete(project.id);
    console.log('✅ Cleanup completed');
  } finally {
    await db.close();
  }
}

/**
 * ALTERNATIVE: Direct repository instantiation (Testing/Special Cases)
 * Only use this pattern when you need fine-grained control (e.g., in tests)
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function directRepositoryExample() {
  // Create a connection pool
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
  });

  try {
    console.log('\n=== Direct Repository Pattern (for testing) ===');

    // Initialize repositories
    const projectRepo = new ProjectRepository(pool);
    const bugReportRepo = new BugReportRepository(pool);
    const userRepo = new UserRepository(pool);
    const sessionRepo = new SessionRepository(pool);
    const ticketRepo = new TicketRepository(pool);

    // ========== PROJECT REPOSITORY ==========
    console.log('\n=== Project Repository ===');

    // Create a project
    const project = await projectRepo.create({
      name: 'Repository Example Project',
      api_key: 'example-api-key-' + Date.now(),
      settings: { theme: 'dark', notifications: true },
    });
    console.log('Created project:', project.id);

    // Find by ID
    const foundProject = await projectRepo.findById(project.id);
    console.log('Found project:', foundProject?.name);

    // Update
    const updated = await projectRepo.update(project.id, {
      settings: { theme: 'light', notifications: false },
    });
    console.log('Updated settings:', updated?.settings);

    // ========== USER REPOSITORY ==========
    console.log('\n=== User Repository ===');

    // Create a password user
    const user1 = await userRepo.create({
      email: 'user@example.com',
      password_hash: 'hashed_password_here',
      role: 'admin',
    });
    console.log('Created user:', user1.id);

    // Create an OAuth user
    const user2 = await userRepo.create({
      email: 'oauth@example.com',
      oauth_provider: 'github',
      oauth_id: 'github_123',
      role: 'user',
    });
    console.log('Created OAuth user:', user2.id);

    // Find by email
    const foundUser = await userRepo.findByEmail('user@example.com');
    console.log('Found user:', foundUser?.email);

    // Find by OAuth
    const foundOAuthUser = await userRepo.findByOAuth('github', 'github_123');
    console.log('Found OAuth user:', foundOAuthUser?.email);

    // ========== BUG REPORT REPOSITORY ==========
    console.log('\n=== Bug Report Repository ===');

    // Create bug reports
    const bug1 = await bugReportRepo.create({
      project_id: project.id,
      title: 'Critical bug in login',
      description: 'Users cannot log in',
      status: 'open',
      priority: 'high',
    });

    const bug2 = await bugReportRepo.create({
      project_id: project.id,
      title: 'Minor UI glitch',
      description: 'Button alignment is off',
      status: 'open',
      priority: 'low',
    });

    console.log('Created bugs:', bug1.id, bug2.id);

    // List with filters and pagination
    const results = await bugReportRepo.list(
      { project_id: project.id, priority: 'high' },
      { sort_by: 'created_at', order: 'desc' },
      { page: 1, limit: 10 }
    );
    console.log('High priority bugs:', results.data.length);
    console.log('Total bugs:', results.pagination.total);

    // Update bug status
    const updatedBug = await bugReportRepo.update(bug1.id, {
      status: 'in-progress',
    });
    console.log('Updated bug status:', updatedBug?.status);

    // ========== SESSION REPOSITORY ==========
    console.log('\n=== Session Repository ===');

    const session = await sessionRepo.createSession(
      bug1.id,
      {
        type: 'replay',
        events: [{ timestamp: Date.now(), action: 'click' }],
      },
      5000
    );
    console.log('Created session:', session.id);

    const sessions = await sessionRepo.findByBugReport(bug1.id);
    console.log('Sessions for bug:', sessions.length);

    // ========== TICKET REPOSITORY ==========
    console.log('\n=== Ticket Repository ===');

    const ticket = await ticketRepo.createTicket(bug1.id, 'JIRA-123', 'jira', 'open');
    console.log('Created ticket:', ticket.id);

    const tickets = await ticketRepo.findByBugReport(bug1.id);
    console.log('Tickets for bug:', tickets.length);

    // ========== CLEANUP ==========
    await projectRepo.delete(project.id); // Cascade deletes bug reports, sessions, tickets
    await userRepo.delete(user1.id);
    await userRepo.delete(user2.id);

    console.log('\n✅ Cleanup completed');
  } finally {
    await pool.end();
  }
}

// Run examples if executed directly
const modulePath = fileURLToPath(import.meta.url);
if (process.argv[1] === modulePath) {
  databaseClientExample().catch(console.error);
}
