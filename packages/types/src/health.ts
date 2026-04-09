/**
 * System Health Monitoring Types
 * Shared between backend API and admin frontend
 */

export interface WorkerHealth {
  name: string;
  enabled: boolean;
  running: boolean;
  jobs_processed: number;
  jobs_failed: number;
  avg_processing_time_ms: number;
  last_processed_at?: string;
  last_error?: string;
}

export interface QueueHealth {
  name: string;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: boolean;
}

export interface PluginHealth {
  platform: string;
  enabled: boolean;
  type: 'built-in' | 'custom';
}

export interface ServiceHealth {
  status: 'up' | 'down';
  response_time: number;
  last_check: string;
  error?: string;
}

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  services: {
    database: ServiceHealth;
    redis: ServiceHealth;
    storage: ServiceHealth;
  };
  workers: WorkerHealth[];
  queues: QueueHealth[];
  plugins: PluginHealth[];
  system: {
    /** Disk space available in bytes */
    disk_space_available: number;
    /** Total disk space in bytes */
    disk_space_total: number;
    /** Total jobs waiting/active across all queues */
    worker_queue_depth: number;
    /** Process uptime in seconds */
    uptime: number;
    /** Node.js version string */
    node_version: string;
    /** Process memory (RSS - Resident Set Size) in MB */
    process_memory_mb: number;
    /** Total system memory in MB */
    system_memory_mb: number;
  };
}
