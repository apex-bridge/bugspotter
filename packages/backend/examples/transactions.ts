/**
 * Example: Using transactions for atomic operations
 *
 * Transactions ensure that multiple database operations either all succeed
 * or all fail together, maintaining data consistency.
 */

import { createDatabaseClient } from '../src/index.js';

async function main() {
  const db = createDatabaseClient();

  try {
    console.log('\n=== Example 1: Bug Report + Session ===');
    const result1 = await db.transaction(async (client) => {
      const bug = await client.bugReports.create({
        project_id: 'some-project-uuid',
        title: 'Payment button not working',
        description: 'Users cannot complete checkout',
        priority: 'critical',
        status: 'open',
      });

      console.log(`Created bug report: ${bug.id}`);

      const session = await client.sessions.create({
        bug_report_id: bug.id,
        events: {
          type: 'rrweb',
          recordedEvents: [{ type: 'FullSnapshot', timestamp: Date.now() }],
        },
        duration: 5000,
      });

      console.log(`Created session: ${session.id}`);

      return { bug, session };
    });

    console.log('Transaction committed successfully!');
    console.log(`Bug: ${result1.bug.id}, Session: ${result1.session.id}`);

    console.log('\n=== Example 2: Transaction Rollback ===');
    try {
      await db.transaction(async (client) => {
        const bug1 = await client.bugReports.create({
          project_id: 'some-project-uuid',
          title: 'First Bug',
          description: 'Description for first bug',
          priority: 'high',
          status: 'open',
        });

        console.log(`Created bug 1: ${bug1.id}`);

        const bug2 = await client.bugReports.create({
          project_id: 'some-project-uuid',
          title: 'Second Bug',
          description: 'Description for second bug',
          priority: 'low',
          status: 'open',
        });

        console.log(`Created bug 2: ${bug2.id}`);

        throw new Error('Test error - should rollback');
      });
    } catch (error) {
      console.log(
        'Transaction rolled back as expected:',
        error instanceof Error ? error.message : String(error)
      );
    }

    console.log('\n=== Example 3: Batch Insert ===');
    const bugs = await db.bugReports.createBatch([
      {
        project_id: 'some-project-uuid',
        title: 'Issue 1',
        description: 'First issue description',
        priority: 'low',
        status: 'open',
      },
      {
        project_id: 'some-project-uuid',
        title: 'Issue 2',
        description: 'Second issue description',
        priority: 'medium',
        status: 'open',
      },
      {
        project_id: 'some-project-uuid',
        title: 'Issue 3',
        description: 'Third issue description',
        priority: 'high',
        status: 'open',
      },
    ]);

    console.log(`Created ${bugs.length} bug reports in batch`);
  } finally {
    await db.close();
  }
}

main().catch(console.error);
