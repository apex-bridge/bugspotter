/**
 * Prometheus Metrics Registry
 * Shared registry and metric definitions used by API server and worker process.
 * Each Node.js process (container) gets its own registry instance.
 */

import client from 'prom-client';

export const register = new client.Registry();

// Default Node.js metrics (CPU, memory, event loop lag, GC, active handles)
client.collectDefaultMetrics({ register });

// === HTTP Metrics (API only) ===

export const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'] as const,
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5, 10],
  registers: [register],
});

export const httpRequestTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'] as const,
  registers: [register],
});

// === Queue Metrics (Worker) ===

export const queueJobsProcessed = new client.Counter({
  name: 'queue_jobs_processed_total',
  help: 'Total number of queue jobs processed',
  labelNames: ['queue_name', 'status'] as const,
  registers: [register],
});

export const queueJobDuration = new client.Histogram({
  name: 'queue_job_duration_seconds',
  help: 'Duration of queue job processing in seconds',
  labelNames: ['queue_name'] as const,
  buckets: [0.5, 1, 5, 10, 30, 60, 120, 300],
  registers: [register],
});

// === Platform-admin org retention ===
// Admin-initiated hard-deletion of soft-deleted orgs that have aged past
// ORG_RETENTION_DAYS. No scheduler — each increment is a human click.
// Labels: `result` = 'success' (cascade executed) | 'guard_failed' (org
// not eligible) | 'error'.
export const orgHardDeleteTotal = new client.Counter({
  name: 'bugspotter_org_hard_delete_total',
  help: 'Platform-admin hard-deletions of soft-deleted organizations past the retention window',
  labelNames: ['result'] as const,
  registers: [register],
});

// Note: queueDepth and dbPoolSize gauges are created in collectors.ts
// with async collect callbacks (populated on each /metrics scrape).
