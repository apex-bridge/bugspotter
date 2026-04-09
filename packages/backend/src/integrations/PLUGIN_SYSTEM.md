# Integration Plugin System

## Overview

BugSpotter uses a **plugin architecture** for integrations with external platforms (Jira, GitHub, Linear, Slack, etc.). This allows you to add new integrations without modifying core code.

## Quick Start

### Using the Plugin System

```typescript
import { PluginRegistry, loadIntegrationPlugins } from './integrations/index.js';
import { DatabaseClient } from './db/client.js';
import { StorageService } from './storage/storage.service.js';

// Create registry
const db = DatabaseClient.create();
const storage = new StorageService();
const registry = new PluginRegistry(db, storage);

// Auto-load all plugins
await loadIntegrationPlugins(registry);

// Use a plugin
const jiraService = registry.get('jira');
if (jiraService) {
  const result = await jiraService.createFromBugReport(bugReport, projectId);
}
```

## Creating a New Plugin

### Step 1: Implement the Integration Service

Create your service class that implements `IntegrationService`:

```typescript
// src/integrations/github/service.ts
import type { IntegrationService, IntegrationResult } from '../base-integration.service.js';
import type { BugReport } from '../../db/types.js';

export class GitHubIntegrationService implements IntegrationService {
  readonly platform = 'github';

  constructor(
    private bugReportRepo: BugReportRepository,
    private integrationRepo: ProjectIntegrationRepository,
    private db: DatabaseClient,
    private storage: IStorageService
  ) {}

  async createFromBugReport(bugReport: BugReport, projectId: string): Promise<IntegrationResult> {
    // Your implementation
    return {
      externalId: 'issue-123',
      externalUrl: 'https://github.com/owner/repo/issues/123',
      platform: 'github',
    };
  }

  async testConnection(projectId: string): Promise<boolean> {
    // Test GitHub API connection
    return true;
  }
}
```

### Step 2: Create Plugin Definition

Create a plugin file that wraps your service:

```typescript
// src/integrations/github/plugin.ts
import type { IntegrationPlugin } from '../plugin.types.js';
import { GitHubIntegrationService } from './service.js';

export const githubPlugin: IntegrationPlugin = {
  metadata: {
    name: 'GitHub Integration',
    platform: 'github',
    version: '1.0.0',
    description: 'Create and sync issues with GitHub',
    author: 'Your Name',
    requiredEnvVars: ['GITHUB_APP_ID', 'GITHUB_PRIVATE_KEY'],
  },

  factory: (context) => {
    return new GitHubIntegrationService(
      context.db.bugReports,
      context.db.projectIntegrations,
      context.db,
      context.storage
    );
  },
};
```

### Step 3: Register Plugin in Loader

Add your plugin to the plugin loader:

```typescript
// src/integrations/plugin-loader.ts
import { githubPlugin } from './github/plugin.js';

export async function loadIntegrationPlugins(registry: PluginRegistry): Promise<void> {
  const plugins = [
    jiraPlugin,
    githubPlugin, // Add your plugin here
  ];
  // ... rest of loading logic
}
```

### Step 4: Test Your Plugin

```typescript
import { PluginRegistry } from './integrations/plugin-registry.js';
import { githubPlugin } from './integrations/github/plugin.js';

const registry = new PluginRegistry(db, storage);
await registry.register(githubPlugin);

const github = registry.get('github');
await github.testConnection(projectId);
```

## Advanced: Lifecycle Hooks

For plugins that need initialization or cleanup:

```typescript
import type { AdvancedIntegrationPlugin } from '../plugin.types.js';

export const advancedPlugin: AdvancedIntegrationPlugin = {
  metadata: {
    name: 'Advanced Plugin',
    platform: 'advanced',
    version: '1.0.0',
  },

  factory: (context) => new AdvancedService(context),

  lifecycle: {
    // Called when plugin is loaded
    async onLoad() {
      console.log('Plugin loading...');
      // Initialize resources, validate config, etc.
    },

    // Called when plugin is unloaded
    async onUnload() {
      console.log('Plugin unloading...');
      // Cleanup resources, close connections, etc.
    },

    // Validate plugin can run
    async validate() {
      // Check environment, dependencies, etc.
      return process.env.API_KEY !== undefined;
    },
  },
};
```

## Plugin Context

Every plugin receives a `PluginContext` with:

```typescript
interface PluginContext {
  db: DatabaseClient; // Full database client with all repositories
  storage: IStorageService; // Storage service (S3, local, etc.)
}
```

Access specific repositories via:

- `context.db.bugReports` - Bug report operations
- `context.db.projectIntegrations` - Integration config storage
- `context.db.tickets` - Ticket linking
- `context.db` - For transactions

## Plugin Metadata

```typescript
interface PluginMetadata {
  name: string; // Display name
  platform: string; // Unique identifier (lowercase)
  version: string; // Semver version
  description?: string; // Optional description
  author?: string; // Plugin author
  requiredEnvVars?: string[]; // Required environment variables
}
```

## Best Practices

### 1. **Use Dependency Injection**

Don't hardcode dependencies - accept them through the factory:

```typescript
factory: (context) => {
  // ✅ GOOD: Inject dependencies
  return new Service(context.db.bugReports, context.storage);

  // ❌ BAD: Create dependencies inside
  // const db = createDb(); // Don't do this
};
```

### 2. **Handle Errors Gracefully**

Plugin loading failures shouldn't crash the application:

```typescript
async createFromBugReport(bugReport, projectId) {
  try {
    // Your implementation
  } catch (error) {
    logger.error('Failed to create external issue', { error });
    throw error; // Re-throw after logging
  }
}
```

### 3. **Validate Configuration Early**

Use lifecycle hooks to validate at load time:

```typescript
lifecycle: {
  async validate() {
    const hasConfig = await this.configManager.hasConfig(projectId);
    return hasConfig;
  }
}
```

### 4. **Follow Existing Patterns**

Look at the Jira plugin as a reference implementation:

- Configuration encryption
- Transaction-based ticket saving
- Proper error handling
- Comprehensive logging

## Plugin Discovery

Current: **Manual registration** in `plugin-loader.ts`

Future possibilities:

- **Directory scanning**: Auto-discover plugins in `/integrations/*/plugin.ts`
- **NPM packages**: Load plugins from `@bugspotter-plugins/*`
- **Remote loading**: Fetch plugins from registry
- **Hot reload**: Add/remove plugins without restart

## Example: Complete Plugin

See `src/integrations/jira/` for a complete, production-ready plugin implementation:

- `service.ts` - Service implementation
- `client.ts` - API client
- `config.ts` - Configuration management
- `mapper.ts` - Data transformation
- `types.ts` - TypeScript definitions
- `plugin.ts` - Plugin definition
- `README.md` - Plugin-specific docs
