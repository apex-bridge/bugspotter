#!/usr/bin/env node
/**
 * Metadata Diagnostics Script
 * 
 * Run this script to diagnose metadata issues in bug reports.
 * 
 * Usage:
 *   node scripts/diagnose-metadata.mjs
 *   node scripts/diagnose-metadata.mjs --bug-id=<uuid>
 *   node scripts/diagnose-metadata.mjs --recent=5
 * 
 * This script checks:
 * 1. Whether metadata is being saved correctly
 * 2. Console log counts
 * 3. Network request counts
 * 4. Browser metadata fields
 */

import pg from 'pg';
import { config } from 'dotenv';

config();

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

async function diagnoseBugReport(bugId) {
  const result = await pool.query(
    `SELECT id, title, created_at, metadata FROM bug_reports WHERE id = $1`,
    [bugId]
  );

  if (result.rows.length === 0) {
    console.log(`❌ Bug report ${bugId} not found`);
    return;
  }

  const report = result.rows[0];
  analyzeBugReport(report);
}

async function diagnoseRecent(limit = 10) {
  const result = await pool.query(
    `SELECT id, title, created_at, metadata 
     FROM bug_reports 
     ORDER BY created_at DESC 
     LIMIT $1`,
    [limit]
  );

  console.log(`\n📊 Analyzing ${result.rows.length} most recent bug reports...\n`);

  for (const report of result.rows) {
    analyzeBugReport(report);
    console.log('\n' + '─'.repeat(80) + '\n');
  }

  // Summary statistics
  const withConsole = result.rows.filter(
    (r) => r.metadata?.console && r.metadata.console.length > 0
  ).length;
  const withNetwork = result.rows.filter(
    (r) => r.metadata?.network && r.metadata.network.length > 0
  ).length;
  const withMetadata = result.rows.filter(
    (r) => r.metadata?.metadata && Object.keys(r.metadata.metadata).length > 0
  ).length;

  console.log('📈 Summary Statistics:');
  console.log(`   Total Reports: ${result.rows.length}`);
  console.log(`   With Console Logs: ${withConsole} (${((withConsole / result.rows.length) * 100).toFixed(1)}%)`);
  console.log(`   With Network Requests: ${withNetwork} (${((withNetwork / result.rows.length) * 100).toFixed(1)}%)`);
  console.log(`   With Browser Metadata: ${withMetadata} (${((withMetadata / result.rows.length) * 100).toFixed(1)}%)`);
}

function analyzeBugReport(report) {
  console.log(`🐛 Bug Report: ${report.title}`);
  console.log(`   ID: ${report.id}`);
  console.log(`   Created: ${report.created_at}`);

  if (!report.metadata) {
    console.log('   ❌ ERROR: metadata field is NULL');
    return;
  }

  if (typeof report.metadata !== 'object') {
    console.log(`   ❌ ERROR: metadata is not an object (type: ${typeof report.metadata})`);
    return;
  }

  // Check console logs
  if (!report.metadata.console) {
    console.log('   ⚠️  WARNING: metadata.console is missing');
  } else if (!Array.isArray(report.metadata.console)) {
    console.log(`   ❌ ERROR: metadata.console is not an array (type: ${typeof report.metadata.console})`);
  } else {
    const count = report.metadata.console.length;
    console.log(`   ✅ Console Logs: ${count} entries`);
    if (count > 0) {
      const levels = report.metadata.console.map((log) => log.level);
      const levelCounts = levels.reduce((acc, level) => {
        acc[level] = (acc[level] || 0) + 1;
        return acc;
      }, {});
      console.log(`      Levels: ${JSON.stringify(levelCounts)}`);

      // Show first log as sample
      console.log(`      Sample: ${JSON.stringify(report.metadata.console[0]).substring(0, 100)}...`);
    }
  }

  // Check network requests
  if (!report.metadata.network) {
    console.log('   ⚠️  WARNING: metadata.network is missing');
  } else if (!Array.isArray(report.metadata.network)) {
    console.log(`   ❌ ERROR: metadata.network is not an array (type: ${typeof report.metadata.network})`);
  } else {
    const count = report.metadata.network.length;
    console.log(`   ✅ Network Requests: ${count} entries`);
    if (count > 0) {
      const methods = report.metadata.network.map((req) => req.method);
      const methodCounts = methods.reduce((acc, method) => {
        acc[method] = (acc[method] || 0) + 1;
        return acc;
      }, {});
      console.log(`      Methods: ${JSON.stringify(methodCounts)}`);
    }
  }

  // Check browser metadata
  if (!report.metadata.metadata) {
    console.log('   ⚠️  WARNING: metadata.metadata is missing');
  } else if (typeof report.metadata.metadata !== 'object') {
    console.log(`   ❌ ERROR: metadata.metadata is not an object (type: ${typeof report.metadata.metadata})`);
  } else {
    const keys = Object.keys(report.metadata.metadata);
    console.log(`   ✅ Browser Metadata: ${keys.length} fields`);
    if (keys.length > 0) {
      console.log(`      Fields: ${keys.join(', ')}`);
      if (report.metadata.metadata.userAgent) {
        console.log(`      User Agent: ${report.metadata.metadata.userAgent.substring(0, 60)}...`);
      }
      if (report.metadata.metadata.browser) {
        console.log(`      Browser: ${report.metadata.metadata.browser} ${report.metadata.metadata.browserVersion || ''}`);
      }
    } else {
      console.log('   ⚠️  WARNING: metadata.metadata is empty object {}');
    }
  }

  // Overall health check
  const hasConsole = report.metadata.console?.length > 0;
  const hasNetwork = report.metadata.network?.length > 0;
  const hasMetadata = Object.keys(report.metadata.metadata || {}).length > 0;

  if (!hasConsole && !hasNetwork && !hasMetadata) {
    console.log('\n   🔴 CRITICAL: All metadata fields are empty!');
    console.log('      This indicates the Fastify schema validation bug.');
  } else if (hasConsole || hasNetwork || hasMetadata) {
    console.log('\n   ✅ HEALTHY: Metadata is being saved correctly');
  }
}

async function main() {
  const args = process.argv.slice(2);
  const bugIdArg = args.find((arg) => arg.startsWith('--bug-id='));
  const recentArg = args.find((arg) => arg.startsWith('--recent='));

  try {
    if (bugIdArg) {
      const bugId = bugIdArg.split('=')[1];
      await diagnoseBugReport(bugId);
    } else if (recentArg) {
      const limit = parseInt(recentArg.split('=')[1], 10);
      await diagnoseRecent(limit);
    } else {
      // Default: analyze 10 most recent reports
      await diagnoseRecent(10);
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
