/**
 * Worker Process Entry Point
 * Standalone process for running BullMQ workers
 */

import { createServer, type Server } from 'node:http';
import dotenv from 'dotenv';
import { validateConfig } from './config.js';
import { createDatabaseClient } from './db/client.js';
import { getLogger } from './logger.js';
import { getQueueManager } from './queue/queue-manager.js';
import { WorkerManager } from './queue/worker-manager.js';
import { createStorageFromEnv } from './storage/index.js';
import { getQueueConfig } from './config/queue.config.js';
import { register } from './metrics/registry.js';
import { registerGaugeCollectors } from './metrics/collectors.js';

// Load environment variables
dotenv.config();

const logger = getLogger();

/** Race a promise against a timeout; resolves to the fallback on timeout. */
function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: NodeJS.Timeout;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise<T>((resolve) => {
      timer = setTimeout(() => resolve(fallback), ms);
    }),
  ]);
}

const HEALTH_CHECK_TIMEOUT_MS = 5_000;

/**
 * Lightweight HTTP server for worker health checks.
 * Exposes /health (liveness) and /ready (readiness) endpoints.
 */
function createWorkerHealthServer(
  workerManager: { healthCheck(): Promise<{ healthy: boolean }> },
  queueManager: { healthCheck(): Promise<boolean> },
  db: { testConnection(): Promise<boolean> }
): Server {
  return createServer(async (req, res) => {
    try {
      if (req.method !== 'GET') {
        res.writeHead(405);
        res.end();
        return;
      }

      if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }));
        return;
      }

      if (req.url === '/ready') {
        const [workerHealth, redisHealthy, dbHealthy] = await Promise.all([
          withTimeout(
            workerManager.healthCheck().catch(() => ({ healthy: false })),
            HEALTH_CHECK_TIMEOUT_MS,
            { healthy: false }
          ),
          withTimeout(
            queueManager.healthCheck().catch(() => false),
            HEALTH_CHECK_TIMEOUT_MS,
            false
          ),
          withTimeout(
            db.testConnection().catch(() => false),
            HEALTH_CHECK_TIMEOUT_MS,
            false
          ),
        ]);

        const isReady = workerHealth.healthy && redisHealthy && dbHealthy;

        res.writeHead(isReady ? 200 : 503, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            status: isReady ? 'ready' : 'unavailable',
            timestamp: new Date().toISOString(),
            checks: {
              workers: workerHealth.healthy ? 'healthy' : 'unhealthy',
              redis: redisHealthy ? 'healthy' : 'unhealthy',
              database: dbHealthy ? 'healthy' : 'unhealthy',
            },
          })
        );
        return;
      }

      if (req.url === '/metrics') {
        const metricsToken = process.env.METRICS_AUTH_TOKEN ?? '';
        if (metricsToken && req.headers.authorization !== `Bearer ${metricsToken}`) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Unauthorized' }));
          return;
        }
        const metricsText = await register.metrics();
        res.writeHead(200, { 'Content-Type': register.contentType });
        res.end(metricsText);
        return;
      }

      res.writeHead(404);
      res.end();
    } catch (error) {
      logger.error('Health check request error', {
        error: error instanceof Error ? error.message : String(error),
      });
      if (!res.writableEnded) {
        if (!res.headersSent) {
          res.writeHead(503, { 'Content-Type': 'application/json' });
        }
        res.end(JSON.stringify({ status: 'error', timestamp: new Date().toISOString() }));
      }
    }
  });
}

/**
 * Main worker initialization and startup
 */
async function main() {
  try {
    logger.info('Starting BugSpotter Worker Process...');

    // Validate required configuration for workers (DB, server, security)
    validateConfig('worker');

    // Validate queue configuration
    const queueConfig = getQueueConfig();
    if (!queueConfig.redis.url) {
      throw new Error('Redis configuration missing. Workers require REDIS_URL');
    }

    logger.info('Queue configuration loaded', {
      redis: queueConfig.redis.url,
      screenshotEnabled: queueConfig.workers.screenshot.enabled,
      replayEnabled: queueConfig.workers.replay.enabled,
      integrationEnabled: queueConfig.workers.integration.enabled,
      notificationEnabled: queueConfig.workers.notification.enabled,
      outboxEnabled: queueConfig.workers.outbox.enabled,
    });

    // Initialize database client
    logger.info('Connecting to database...');
    const db = createDatabaseClient();
    const isConnected = await db.testConnection();
    if (!isConnected) {
      throw new Error('Failed to connect to database');
    }
    logger.info('Database connection established');

    // Initialize storage service
    logger.info('Initializing storage service...');
    const storage = await createStorageFromEnv();
    logger.info('Storage service initialized');

    // Initialize integration plugin registry
    logger.info('Initializing integration plugins...');
    const { PluginRegistry } = await import('./integrations/plugin-registry.js');
    const { loadIntegrationPlugins } = await import('./integrations/plugin-loader.js');
    const pluginRegistry = new PluginRegistry(db, storage);
    await loadIntegrationPlugins(pluginRegistry);
    logger.info('Integration plugins loaded', {
      platforms: pluginRegistry.getSupportedPlatforms(),
    });

    // Create and start worker manager
    logger.info('Creating worker manager...');
    const workerManager = new WorkerManager(db, storage, pluginRegistry);

    logger.info('Starting workers...');
    await workerManager.start();

    // Log initial metrics
    const metrics = workerManager.getMetrics();
    logger.info('Workers started successfully', {
      totalWorkers: metrics.totalWorkers,
      runningWorkers: metrics.runningWorkers,
      workers: metrics.workers.map((w) => w.workerName),
    });

    // Start health check HTTP server
    const healthPort = parseInt(process.env.WORKER_HEALTH_PORT ?? '3001', 10);
    if (!Number.isFinite(healthPort) || healthPort < 1 || healthPort > 65535) {
      throw new Error(
        `Invalid WORKER_HEALTH_PORT: ${process.env.WORKER_HEALTH_PORT ?? '(unset)'}. Must be 1-65535.`
      );
    }
    const queueManager = getQueueManager();

    // Register Prometheus gauge collectors for DB pool + queue depth
    registerGaugeCollectors(db, queueManager);

    const healthServer = createWorkerHealthServer(workerManager, queueManager, db);
    healthServer.on('error', (err) => {
      logger.error('Worker health server failed to start — exiting', {
        error: err.message,
        port: healthPort,
      });
      process.exit(1);
    });
    healthServer.listen(healthPort, '0.0.0.0', () => {
      logger.info('Worker health server started', { port: healthPort });
    });

    // Declare scheduled job handles before shutdown so they're in scope.
    // They are assigned later after workers start.
    let billingJobsStopped = false;
    let dunningTimer: ReturnType<typeof setTimeout> | undefined;
    let invoiceSchedulerTimer: ReturnType<typeof setTimeout> | undefined;
    // eslint-disable-next-line prefer-const -- assigned after shutdown is defined, must be in scope for cleanup
    let healthCheckInterval: ReturnType<typeof setInterval> | undefined;

    // Setup graceful shutdown
    const shutdown = async (signal: string) => {
      logger.info(`Received ${signal}, starting graceful shutdown...`);

      try {
        // Close health check server (log and continue on error so shutdown proceeds)
        logger.info('Closing health check server...');
        try {
          await new Promise<void>((resolve) =>
            healthServer.close((err) => {
              if (err) {
                logger.error('Error closing health check server', { error: err.message });
              }
              resolve();
            })
          );
        } catch (closeErr) {
          logger.error('Error closing health check server', {
            error: closeErr instanceof Error ? closeErr.message : String(closeErr),
          });
        }

        // Stop scheduled billing jobs and health check interval
        billingJobsStopped = true;
        if (dunningTimer) {
          clearTimeout(dunningTimer);
        }
        if (invoiceSchedulerTimer) {
          clearTimeout(invoiceSchedulerTimer);
        }
        if (healthCheckInterval) {
          clearInterval(healthCheckInterval);
        }
        logger.info('Scheduled jobs stopped');

        // Stop heartbeat system
        logger.info('Stopping heartbeat system...');
        await workerManager.stopHeartbeat();
        logger.info('Heartbeat system stopped');

        // Shutdown workers (allows current jobs to complete)
        logger.info('Shutting down workers...');
        await workerManager.shutdown();
        logger.info('Workers shut down successfully');

        // Close database connections
        logger.info('Closing database connections...');
        await db.close();
        logger.info('Database connections closed');

        logger.info('Worker process shutdown complete');
        process.exit(0);
      } catch (error) {
        logger.error('Error during shutdown', {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
        process.exit(1);
      }
    };

    // Register signal handlers
    process.on('SIGTERM', () => void shutdown('SIGTERM'));
    process.on('SIGINT', () => void shutdown('SIGINT'));

    // Handle uncaught errors
    process.on('uncaughtException', (error) => {
      logger.error('Uncaught exception in worker process', {
        error: error.message,
        stack: error.stack,
      });
      void shutdown('uncaughtException');
    });

    process.on('unhandledRejection', (reason) => {
      logger.error('Unhandled rejection in worker process', {
        reason: reason instanceof Error ? reason.message : String(reason),
        stack: reason instanceof Error ? reason.stack : undefined,
      });
      void shutdown('unhandledRejection');
    });

    // Start heartbeat system for worker health monitoring
    logger.info('Starting heartbeat system...');
    await workerManager.startHeartbeat();
    logger.info('Heartbeat system started');

    // Scheduled billing jobs — use setTimeout loops (not setInterval) to prevent
    // overlapping executions if a job takes longer than its interval.
    // Advisory locks prevent duplicate runs when multiple worker instances are deployed.
    const HOUR_MS = 60 * 60 * 1000;
    const { runDunningJob } = await import('./saas/jobs/dunning.job.js');
    const { runInvoiceSchedulerJob } = await import('./saas/jobs/invoice-scheduler.job.js');

    // Advisory lock namespace for scheduled billing jobs.
    // Uses two-argument pg_try_advisory_lock(classId, objId) to avoid
    // collisions with other advisory lock usage (e.g. org quota locks use class 1001).
    const SCHEDULER_LOCK_CLASS = 2001;
    const LOCK_DUNNING = 1;
    const LOCK_INVOICE_SCHEDULER = 2;

    /** Run a scheduled job with Postgres advisory lock to prevent concurrent runs. */
    async function runWithLock(
      lockObjId: number,
      name: string,
      fn: () => Promise<unknown>
    ): Promise<void> {
      const pool = db.getPool();
      const client = await pool.connect();
      let clientDestroyed = false;
      try {
        const lockResult = await client.query<{ pg_try_advisory_lock: boolean }>(
          'SELECT pg_try_advisory_lock($1, $2)',
          [SCHEDULER_LOCK_CLASS, lockObjId]
        );
        if (!lockResult.rows[0].pg_try_advisory_lock) {
          logger.debug(`[scheduler] ${name}: skipped (another instance holds the lock)`);
          return;
        }
        try {
          await fn();
        } finally {
          try {
            await client.query('SELECT pg_advisory_unlock($1, $2)', [
              SCHEDULER_LOCK_CLASS,
              lockObjId,
            ]);
          } catch (unlockError) {
            // If unlock fails, destroy the connection so it doesn't return
            // to the pool still holding the advisory lock.
            clientDestroyed = true;
            logger.error(
              `[scheduler] ${name}: failed to release advisory lock, destroying connection`,
              {
                error: unlockError instanceof Error ? unlockError.message : String(unlockError),
              }
            );
            client.release(
              unlockError instanceof Error ? unlockError : new Error(String(unlockError))
            );
          }
        }
      } finally {
        if (!clientDestroyed) {
          client.release();
        }
      }
    }

    function scheduleDunning() {
      dunningTimer = setTimeout(async () => {
        if (billingJobsStopped) {
          return;
        }
        try {
          await runWithLock(LOCK_DUNNING, 'dunning', () => runDunningJob(db));
        } catch (error) {
          logger.error('[scheduler] Dunning job failed', {
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
          });
        }
        if (!billingJobsStopped) {
          scheduleDunning();
        }
      }, HOUR_MS);
    }

    function scheduleInvoiceScheduler() {
      invoiceSchedulerTimer = setTimeout(async () => {
        if (billingJobsStopped) {
          return;
        }
        try {
          await runWithLock(LOCK_INVOICE_SCHEDULER, 'invoice-scheduler', () =>
            runInvoiceSchedulerJob(db)
          );
        } catch (error) {
          logger.error('[scheduler] Invoice scheduler job failed', {
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
          });
        }
        if (!billingJobsStopped) {
          scheduleInvoiceScheduler();
        }
      }, 6 * HOUR_MS);
    }

    scheduleDunning();
    scheduleInvoiceScheduler();

    logger.info('Billing scheduled jobs started', {
      dunningIntervalHours: 1,
      invoiceSchedulerIntervalHours: 6,
    });

    // Log health metrics periodically (every 60 seconds)
    healthCheckInterval = setInterval(async () => {
      try {
        const health = await workerManager.healthCheck();
        const currentMetrics = workerManager.getMetrics();

        logger.info('Worker health check', {
          healthy: health.healthy,
          totalJobs: currentMetrics.totalJobsProcessed,
          failedJobs: currentMetrics.totalJobsFailed,
          uptimeSeconds: Math.floor(currentMetrics.uptime / 1000),
          workers: health.workers,
        });
      } catch (error) {
        logger.error('Health check failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }, 60 * 1000); // 60 seconds

    // Note: billing job timers and healthCheckInterval are cleaned up in shutdown().

    logger.info('Worker process running. Press Ctrl+C to stop');
  } catch (error) {
    logger.error('Failed to start worker process', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    process.exit(1);
  }
}

// Start the worker process if this file is run directly
// Note: When using tsx, import.meta.url format may vary, so we check multiple conditions
const isMainModule =
  import.meta.url === `file://${process.argv[1]}` ||
  import.meta.url === `file:///${process.argv[1]}` ||
  process.argv[1]?.endsWith('worker.ts') ||
  process.argv[1]?.endsWith('worker.js');

if (isMainModule) {
  main().catch((error) => {
    console.error('Fatal error during worker startup:', error);
    process.exit(1);
  });
}

// Export for programmatic use
export { createWorkerHealthServer };
export { WorkerManager } from './queue/worker-manager.js';
export { getQueueManager } from './queue/queue-manager.js';
