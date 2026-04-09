/**
 * BugSpotter API Server Entry Point
 * Main application that initializes and starts the Fastify server
 */

import dotenv from 'dotenv';
import { createDatabaseClient } from '../db/client.js';
import { config, validateConfig } from '../config.js';
import { getLogger } from '../logger.js';
import { createServer, startServer, shutdownServer } from './server.js';
import { getQueueManager } from '../queue/queue-manager.js';
import { getQueueConfig } from '../config/queue.config.js';

// Load environment variables from .env file
dotenv.config();

/**
 * Initialize and start the API server
 */
async function main() {
  const logger = getLogger();
  const appStartTime = Date.now();

  try {
    // Validate configuration
    const configStartTime = Date.now();
    logger.info('⏱️ [STARTUP] Validating configuration...');
    validateConfig();
    logger.info('✅ [STARTUP] Configuration validated', {
      duration: Date.now() - configStartTime,
    });

    // Initialize database client
    const dbStartTime = Date.now();
    logger.info('⏱️ [STARTUP] Connecting to database...', {
      url: config.database.url.replace(/:[^:@]+@/, ':***@'), // Hide password in logs
    });
    const db = createDatabaseClient();

    // Test database connection
    const isConnected = await db.testConnection();
    if (!isConnected) {
      throw new Error('Failed to connect to database');
    }
    logger.info('✅ [STARTUP] Database connected', {
      duration: Date.now() - dbStartTime,
    });

    // Initialize storage service
    const storageStartTime = Date.now();
    logger.info('⏱️ [STARTUP] Initializing storage service...');
    const { createStorageFromEnv } = await import('../storage/index.js');
    const storage = createStorageFromEnv();
    logger.info('✅ [STARTUP] Storage initialized', {
      duration: Date.now() - storageStartTime,
    });

    // Initialize integration plugin registry
    const pluginStartTime = Date.now();
    logger.info('⏱️ [STARTUP] Loading integration plugins...');
    const { PluginRegistry } = await import('../integrations/plugin-registry.js');
    const { loadIntegrationPlugins } = await import('../integrations/plugin-loader.js');
    const pluginRegistry = new PluginRegistry(db, storage);
    await loadIntegrationPlugins(pluginRegistry);
    logger.info('✅ [STARTUP] Plugins loaded', {
      platforms: pluginRegistry.getSupportedPlatforms(),
      duration: Date.now() - pluginStartTime,
    });

    // Initialize queue manager if Redis is configured
    let queueManager: ReturnType<typeof getQueueManager> | undefined;
    const queueConfig = getQueueConfig();
    let queueStartTime = Date.now();
    if (queueConfig.redis.url) {
      try {
        queueStartTime = Date.now();
        logger.info('⏱️ [STARTUP] Initializing queue manager...');
        queueManager = getQueueManager();
        await queueManager.initialize();

        // Test queue health
        const queueHealthy = await queueManager.healthCheck();
        if (queueHealthy) {
          logger.info('✅ [STARTUP] Queue manager ready', {
            duration: Date.now() - queueStartTime,
          });
        } else {
          logger.warn('⚠️  [STARTUP] Queue health check failed', {
            duration: Date.now() - queueStartTime,
          });
        }
      } catch (error) {
        logger.error('❌ [STARTUP] Queue manager failed', {
          error: error instanceof Error ? error.message : String(error),
          duration: Date.now() - queueStartTime,
        });
        queueManager = undefined;
      }
    } else {
      logger.info('[STARTUP] Redis not configured, queues disabled');
    }

    // Create Fastify server
    const serverStartTime = Date.now();
    logger.info('⏱️ [STARTUP] Creating Fastify server...');
    const server = await createServer({ db, storage, pluginRegistry, queueManager });
    logger.info('✅ [STARTUP] Server created', {
      duration: Date.now() - serverStartTime,
    });

    // Start listening for requests
    const listenStartTime = Date.now();
    logger.info('⏱️ [STARTUP] Starting server...');
    await startServer(server);

    // Log total startup time
    logger.info('🚀 [STARTUP] APPLICATION READY', {
      totalDuration: Date.now() - appStartTime,
      listenDuration: Date.now() - listenStartTime,
    });

    // Graceful shutdown handlers
    const shutdown = async (signal: string) => {
      logger.info(`Received ${signal}, starting graceful shutdown...`);
      try {
        await shutdownServer(server);
        process.exit(0);
      } catch (error) {
        logger.error('Error during shutdown', { error });
        process.exit(1);
      }
    };

    process.on('SIGTERM', () => void shutdown('SIGTERM'));
    process.on('SIGINT', () => void shutdown('SIGINT'));

    // Handle uncaught errors
    process.on('uncaughtException', (error) => {
      logger.error('Uncaught exception', { error });
      void shutdown('uncaughtException');
    });

    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled rejection', { reason, promise });
      void shutdown('unhandledRejection');
    });
  } catch (error) {
    logger.error('Failed to start server', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw error;
  }
}

// Start the server if this file is run directly
// Note: When using tsx, import.meta.url format may vary, so we check multiple conditions
const isMainModule =
  import.meta.url === `file://${process.argv[1]}` ||
  import.meta.url === `file:///${process.argv[1]}` ||
  process.argv[1]?.endsWith('index.ts') ||
  process.argv[1]?.endsWith('index.js');

if (isMainModule) {
  main().catch((error) => {
    console.error('Fatal error during startup:', error);
    process.exit(1);
  });
}

// Export for programmatic use
export { createServer, startServer, shutdownServer } from './server.js';
export {
  createAuthMiddleware,
  requirePlatformAdmin,
  requireProject,
  requireUser,
} from './middleware/auth.js';
export { AppError, errorHandler, notFoundHandler } from './middleware/error.js';
