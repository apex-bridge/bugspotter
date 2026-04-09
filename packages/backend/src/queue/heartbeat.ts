/**
 * Worker Heartbeat System
 * Workers send periodic heartbeats to Redis to report their health status
 * TTL-based expiry automatically marks crashed workers as down
 */

import type { Redis } from 'ioredis';

export interface WorkerHeartbeatData {
  status: 'running' | 'idle' | 'stopped';
  timestamp: string;
  pid: number;
  hostname: string;
  jobs_processed: number;
  jobs_failed: number;
  avg_processing_time_ms: number;
  last_error?: string;
}

export interface WorkerHeartbeatConfig {
  /** Heartbeat interval in milliseconds (default: 10000 = 10 seconds) */
  interval: number;
  /** Time-to-live in seconds (default: 30 seconds) */
  ttl: number;
}

export const DEFAULT_HEARTBEAT_CONFIG: WorkerHeartbeatConfig = {
  interval: 10000, // 10 seconds
  ttl: 30, // 30 seconds (must be > interval to avoid false positives)
};

/**
 * Redis key for worker heartbeat
 */
function getHeartbeatKey(workerName: string): string {
  return `bugspotter:worker:${workerName}:heartbeat`;
}

/**
 * Send worker heartbeat to Redis
 * Sets heartbeat with TTL - if worker crashes, key expires automatically
 */
export async function sendWorkerHeartbeat(
  redis: Redis,
  workerName: string,
  data: WorkerHeartbeatData,
  ttl: number = DEFAULT_HEARTBEAT_CONFIG.ttl
): Promise<void> {
  const key = getHeartbeatKey(workerName);
  await redis.setex(key, ttl, JSON.stringify(data));
}

/**
 * Get worker heartbeat from Redis
 * Returns null if heartbeat has expired (worker is down)
 */
export async function getWorkerHeartbeat(
  redis: Redis,
  workerName: string
): Promise<WorkerHeartbeatData | null> {
  const key = getHeartbeatKey(workerName);
  const data = await redis.get(key);

  if (!data) {
    return null;
  }

  try {
    return JSON.parse(data);
  } catch {
    // Invalid JSON - treat as missing heartbeat
    return null;
  }
}

/**
 * Get all worker heartbeats
 * Uses MGET for efficient batch retrieval (single Redis roundtrip)
 */
export async function getAllWorkerHeartbeats(
  redis: Redis,
  workerNames: string[]
): Promise<Map<string, WorkerHeartbeatData | null>> {
  const heartbeats = new Map<string, WorkerHeartbeatData | null>();

  if (workerNames.length === 0) {
    return heartbeats;
  }

  // Build all keys
  const keys = workerNames.map((name) => getHeartbeatKey(name));

  // Fetch all values in a single Redis call
  const values = await redis.mget(...keys);

  // Map results back to worker names
  workerNames.forEach((name, index) => {
    const value = values[index];

    if (!value) {
      heartbeats.set(name, null);
      return;
    }

    try {
      heartbeats.set(name, JSON.parse(value));
    } catch {
      // Invalid JSON - treat as missing heartbeat
      heartbeats.set(name, null);
    }
  });

  return heartbeats;
}

/**
 * Check if worker heartbeat is alive
 * Returns true if heartbeat exists and is fresh
 */
export async function isWorkerAlive(redis: Redis, workerName: string): Promise<boolean> {
  const heartbeat = await getWorkerHeartbeat(redis, workerName);
  return heartbeat !== null;
}

/**
 * Delete worker heartbeat (called on graceful shutdown)
 */
export async function deleteWorkerHeartbeat(redis: Redis, workerName: string): Promise<void> {
  const key = getHeartbeatKey(workerName);
  await redis.del(key);
}
