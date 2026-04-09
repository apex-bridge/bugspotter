/**
 * Test script to verify migrations insert jira integration
 * Run this to debug E2E test failures
 */

import pg from 'pg';
const { Pool } = pg;

async function testMigrations() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    console.error('ERROR: DATABASE_URL environment variable not set');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: databaseUrl });

  try {
    // Check if migrations table exists
    const migrationsCheck = await pool.query(`
      SELECT COUNT(*) as count 
      FROM information_schema.tables 
      WHERE table_name = 'migrations_history'
    `);

    console.log('Migrations table exists:', migrationsCheck.rows[0].count === '1');

    // Check applied migrations
    const migrations = await pool.query(`
      SELECT migration_name 
      FROM migrations_history 
      ORDER BY migration_name
    `);

    console.log('\nApplied migrations:');
    migrations.rows.forEach((row) => {
      console.log(`  - ${row.migration_name}`);
    });

    // Check if integrations table exists
    const integrationsTableCheck = await pool.query(`
      SELECT COUNT(*) as count 
      FROM information_schema.tables 
      WHERE table_name = 'integrations'
    `);

    console.log('\nIntegrations table exists:', integrationsTableCheck.rows[0].count === '1');

    // Check integrations
    const integrations = await pool.query(`
      SELECT id, type, name, status 
      FROM integrations 
      ORDER BY type
    `);

    console.log('\nIntegrations in database:');
    if (integrations.rows.length === 0) {
      console.log('  ❌ NO INTEGRATIONS FOUND - THIS IS THE BUG!');
    } else {
      integrations.rows.forEach((row) => {
        console.log(`  - ${row.type}: ${row.name} (${row.status})`);
      });
    }

    // Specifically check for jira
    const jiraCheck = await pool.query(`
      SELECT * FROM integrations WHERE type = 'jira'
    `);

    if (jiraCheck.rows.length === 0) {
      console.log('\n❌ Jira integration NOT found - this is why E2E tests fail!');
      console.log('Migration 014 should have inserted it.');
    } else {
      console.log('\n✅ Jira integration found:', jiraCheck.rows[0]);
    }
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await pool.end();
  }
}

testMigrations();
