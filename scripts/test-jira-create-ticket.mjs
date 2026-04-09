#!/usr/bin/env node
/**
 * Test script to create a Jira ticket from a bug report
 *
 * Usage:
 *   node scripts/test-jira-create-ticket.mjs [integration-type] [bug-report-id]
 *
 * Example:
 *   node scripts/test-jira-create-ticket.mjs jira_http_1761325278253
 */

import postgres from 'postgres';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: 'packages/backend/.env' });

const DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://bugspotter:bugspotter@localhost:5433/bugspotter';

async function testJiraTicketCreation() {
  const sql = postgres(DATABASE_URL);

  try {
    console.log('\n🔍 Finding Jira integration...');

    // Get the most recent integration (or use provided integration type)
    const integrationType = process.argv[2];
    let integration;

    if (integrationType) {
      [integration] = await sql`
        SELECT * FROM integrations
        WHERE type = ${integrationType}
        LIMIT 1
      `;
    } else {
      [integration] = await sql`
        SELECT * FROM integrations
        WHERE plugin_source = 'generic_http'
        ORDER BY created_at DESC
        LIMIT 1
      `;
    }

    if (!integration) {
      console.error('❌ No Jira integration found');
      console.log(
        '\n💡 Create one first in the admin panel at http://localhost:3001/integrations/create'
      );
      process.exit(1);
    }

    console.log(`✅ Found integration: ${integration.name} (${integration.type})`);
    console.log(`   Plugin Source: ${integration.plugin_source}`);
    console.log(`   Custom Config:`, JSON.stringify(integration.custom_config, null, 2));

    // Get or create a bug report
    const bugReportId = process.argv[3];
    let bugReport;

    if (bugReportId) {
      [bugReport] = await sql`
        SELECT * FROM bug_reports
        WHERE id = ${bugReportId}
        LIMIT 1
      `;
    } else {
      // Get the first bug report
      [bugReport] = await sql`
        SELECT * FROM bug_reports
        ORDER BY created_at DESC
        LIMIT 1
      `;
    }

    if (!bugReport) {
      console.error('❌ No bug report found');
      console.log('\n💡 Create one first or provide a bug report ID as second argument');
      process.exit(1);
    }

    console.log(`\n📋 Found bug report: ${bugReport.title}`);
    console.log(`   ID: ${bugReport.id}`);
    console.log(`   Project ID: ${bugReport.project_id}`);

    // Check if integration is linked to the project
    const [projectIntegration] = await sql`
      SELECT * FROM project_integrations
      WHERE project_id = ${bugReport.project_id}
      AND type = ${integration.type}
    `;

    if (!projectIntegration) {
      console.log('\n⚠️  Integration not linked to project');
      console.log('   Creating project integration...');

      await sql`
        INSERT INTO project_integrations (project_id, type, config, enabled)
        VALUES (
          ${bugReport.project_id},
          ${integration.type},
          ${sql.json(integration.custom_config || {})},
          true
        )
      `;

      console.log('✅ Linked integration to project');
    } else {
      console.log(
        `✅ Integration already linked to project (enabled: ${projectIntegration.enabled})`
      );
    }

    console.log('\n🎫 To create a Jira ticket, you need to:');
    console.log('1. Queue an integration job in Redis, OR');
    console.log('2. Call the integration service directly via API');
    console.log('\n📝 Integration configuration:');
    console.log(`   Integration Type: ${integration.type}`);
    console.log(`   Bug Report ID: ${bugReport.id}`);
    console.log(`   Project ID: ${bugReport.project_id}`);

    console.log('\n💡 The E2E tests only verify integration CONFIGURATION, not ticket creation.');
    console.log('   Ticket creation requires:');
    console.log('   - Integration worker running (docker-compose up worker)');
    console.log('   - Job queued in Redis');
    console.log('   - OR manual API call to create ticket');
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

testJiraTicketCreation();
