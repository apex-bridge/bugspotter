/**
 * Prometheus Gauge Collectors
 * Creates gauges with async collect callbacks for database pool and queue stats.
 * Call registerGaugeCollectors() once from server.ts or worker.ts to activate.
 *
 * Gauges are created once (prom-client forbids duplicate names). Subsequent calls
 * update the dependency references that the collect() closures read from, so tests
 * (or any code that creates multiple servers in one process) always get metrics
 * from the latest db/queueManager instance.
 */

import client from 'prom-client';
import type { DatabaseClient } from '../db/client.js';
import type { QueueManager } from '../queue/queue-manager.js';
import { getLogger } from '../logger.js';
import { register } from './registry.js';

// Mutable refs — updated on every registerGaugeCollectors() call so the
// collect() closures always use the most recent dependencies.
let currentDb: DatabaseClient | undefined;
let currentQueueManager: QueueManager | undefined;
let registered = false;

export function registerGaugeCollectors(db: DatabaseClient, queueManager?: QueueManager): void {
  currentDb = db;
  currentQueueManager = queueManager;

  if (registered) {
    return;
  }
  registered = true;

  new client.Gauge({
    name: 'db_connection_pool_size',
    help: 'Database connection pool size',
    labelNames: ['state'] as const,
    registers: [register],
    collect() {
      this.reset();
      if (!currentDb) {
        return;
      }
      const poolStats = currentDb.getPoolStats();
      this.set({ state: 'total' }, poolStats.totalCount);
      this.set({ state: 'idle' }, poolStats.idleCount);
      this.set({ state: 'waiting' }, poolStats.waitingCount);
    },
  });

  new client.Gauge({
    name: 'queue_depth',
    help: 'Current number of jobs waiting in queue',
    labelNames: ['queue_name'] as const,
    registers: [register],
    async collect() {
      // Reset all label values so removed queues and failed scrapes don't
      // leave stale data behind (prom-client persists previous values).
      this.reset();

      if (!currentQueueManager) {
        return;
      }
      try {
        const stats = await currentQueueManager.getQueueStats();
        for (const [queueName, counts] of Object.entries(stats)) {
          this.set({ queue_name: queueName }, counts.waiting + counts.delayed);
        }
      } catch (err) {
        // Scrape should not fail if Redis is temporarily unreachable.
        // Gauge stays at 0 (from reset above) rather than showing stale data.
        getLogger().debug('Failed to collect queue depth metrics', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  });
}
