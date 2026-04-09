/**
 * Integration Plugin System Usage Example
 * Demonstrates how to use the new plugin architecture
 */

import { PluginRegistry, loadIntegrationPlugins } from '../src/integrations/index.js';
import { DatabaseClient } from '../src/db/client.js';
import { createStorage } from '../src/storage/index.js';

// ============================================================================
// Setup: Database and Storage Configuration
// ============================================================================

const CONNECTION_STRING = process.env.DATABASE_URL || 'postgresql://localhost:5432/bugspotter';
const STORAGE_CONFIG = {
  backend: 'local' as const,
  local: {
    baseDirectory: './storage',
    baseUrl: 'http://localhost:3000/storage',
  },
};

// ============================================================================
// EXAMPLE 1: Auto-load all plugins
// ============================================================================

async function example1_autoLoad() {
  const db = DatabaseClient.create({ connectionString: CONNECTION_STRING });
  const storage = createStorage(STORAGE_CONFIG);
  const registry = new PluginRegistry(db, storage);

  // Load all available plugins
  await loadIntegrationPlugins(registry);

  console.log('Loaded plugins:', registry.getSupportedPlatforms());
  // Output: ['jira'] (more as they are added)

  // Get plugin metadata
  const metadata = registry.getAllPluginMetadata();
  console.log('Plugin info:', metadata);
  // Output: [{ name: 'Jira Integration', platform: 'jira', version: '1.0.0', ... }]
}

// ============================================================================
// EXAMPLE 2: Manual plugin registration
// ============================================================================

async function example2_manualRegistration() {
  const db = DatabaseClient.create({ connectionString: CONNECTION_STRING });
  const storage = createStorage(STORAGE_CONFIG);
  const registry = new PluginRegistry(db, storage);

  // Import specific plugin
  const { jiraPlugin } = await import('../src/integrations/jira/plugin.js');

  // Register manually
  await registry.register(jiraPlugin);

  const jira = registry.get('jira');
  console.log('Jira service loaded:', jira !== null);
}

// ============================================================================
// EXAMPLE 3: Using a plugin to create issues
// ============================================================================

async function example3_createIssue() {
  const db = DatabaseClient.create({ connectionString: CONNECTION_STRING });
  const storage = createStorage(STORAGE_CONFIG);
  const registry = new PluginRegistry(db, storage);

  await loadIntegrationPlugins(registry);

  // Get bug report from database
  const bugReport = await db.bugReports.findById('bug-id-123');
  if (!bugReport) {
    throw new Error('Bug report not found');
  }

  // Get Jira service
  const jiraService = registry.get('jira');
  if (!jiraService) {
    throw new Error('Jira plugin not loaded');
  }

  // Create Jira issue
  const result = await jiraService.createFromBugReport(bugReport, 'project-id-456');
  console.log('Created Jira issue:', result.externalId, result.externalUrl);
}

// ============================================================================
// EXAMPLE 4: Test all plugins
// ============================================================================

async function example4_testAllPlugins() {
  const db = DatabaseClient.create({ connectionString: CONNECTION_STRING });
  const storage = createStorage(STORAGE_CONFIG);
  const registry = new PluginRegistry(db, storage);

  await loadIntegrationPlugins(registry);

  const projectId = 'project-id-789';
  const platforms = registry.getSupportedPlatforms();

  for (const platform of platforms) {
    const service = registry.get(platform);
    if (service) {
      const connected = await service.testConnection(projectId);
      console.log(`${platform}: ${connected ? 'Connected' : 'Failed'}`);
    }
  }
}

// ============================================================================
// EXAMPLE 5: Check if platform is supported
// ============================================================================

async function example5_checkSupport() {
  const db = DatabaseClient.create({ connectionString: CONNECTION_STRING });
  const storage = createStorage(STORAGE_CONFIG);
  const registry = new PluginRegistry(db, storage);

  await loadIntegrationPlugins(registry);

  console.log('Jira supported?', registry.isSupported('jira')); // true
  console.log('GitHub supported?', registry.isSupported('github')); // false (not added yet)
  console.log('Slack supported?', registry.isSupported('slack')); // false (not added yet)
}

// ============================================================================
// EXAMPLE 6: Error handling
// ============================================================================

async function example6_errorHandling() {
  const db = DatabaseClient.create({ connectionString: CONNECTION_STRING });
  const storage = createStorage(STORAGE_CONFIG);
  const registry = new PluginRegistry(db, storage);

  try {
    await loadIntegrationPlugins(registry);

    const service = registry.get('nonexistent');
    if (!service) {
      console.log('Plugin not found');
      return;
    }
  } catch (error) {
    console.error('Failed to load plugins:', error);
  }
}

// ============================================================================
// EXAMPLE 7: Unregister a plugin
// ============================================================================

async function example7_unregister() {
  const db = DatabaseClient.create({ connectionString: CONNECTION_STRING });
  const storage = createStorage(STORAGE_CONFIG);
  const registry = new PluginRegistry(db, storage);

  await loadIntegrationPlugins(registry);

  console.log('Before:', registry.getSupportedPlatforms()); // ['jira']

  await registry.unregister('jira');

  console.log('After:', registry.getSupportedPlatforms()); // []
}

// ============================================================================
// Run examples
// ============================================================================

async function main() {
  console.log('=== Example 1: Auto-load ===');
  await example1_autoLoad();

  console.log('\n=== Example 2: Manual Registration ===');
  await example2_manualRegistration();

  console.log('\n=== Example 5: Check Support ===');
  await example5_checkSupport();

  // Uncomment to run other examples:
  // await example3_createIssue();
  // await example4_testAllPlugins();
  // await example6_errorHandling();
  // await example7_unregister();
}

// Run if executed directly
// Uncomment the line below to run the examples:
// main().catch(console.error);

export {
  main,
  example1_autoLoad,
  example2_manualRegistration,
  example3_createIssue,
  example4_testAllPlugins,
  example5_checkSupport,
  example6_errorHandling,
  example7_unregister,
};
