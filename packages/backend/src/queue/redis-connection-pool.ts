import { Redis, RedisOptions } from 'ioredis';
import { getLogger } from '../logger.js';
import { getQueueConfig } from '../config/queue.config.js';

const logger = getLogger();

/**
 * Redis Connection Pool
 * Manages a pool of Redis connections to avoid exceeding Upstash connection limits
 */
export class RedisConnectionPool {
  private mainConnection: Redis | null = null;
  private workerConnections: Map<string, Redis> = new Map();
  private connectionConfig: RedisOptions;
  private maxConnections: number;
  private activeConnectionCount = 0;
  private connectionDelay = 500; // 500ms delay between connections

  constructor(maxConnections: number = 8) {
    const config = getQueueConfig();
    this.maxConnections = maxConnections;

    // For rediss:// URLs, ioredis auto-enables TLS but defaults to
    // rejectUnauthorized: true. Managed services (e.g. Yandex Cloud) use
    // private CAs not in Node's trust store. Set REDIS_TLS_REJECT_UNAUTHORIZED=false
    // to disable verification, or use NODE_EXTRA_CA_CERTS to add the CA cert.
    // ioredis uses lodash.defaults (won't overwrite), so explicit tls takes precedence.
    let usesTls = false;
    try {
      usesTls = new URL(config.redis.url).protocol === 'rediss:';
    } catch {
      // Unparseable URL — let ioredis handle it
    }
    const rejectUnauthorized = process.env.REDIS_TLS_REJECT_UNAUTHORIZED !== 'false';

    this.connectionConfig = {
      ...(usesTls && { tls: { rejectUnauthorized } }),
      maxRetriesPerRequest: null,
      enableOfflineQueue: true,
      lazyConnect: true, // Don't connect immediately
      keepAlive: 60000, // 60 seconds - longer keepalive to prevent premature closes
      connectTimeout: 10000, // 10 seconds
      // DISABLE reconnectOnError to prevent reconnection storms
      // Let retryStrategy handle all reconnection logic
      reconnectOnError: null,
      retryStrategy: (times: number) => {
        // Never give up — linear backoff (1s, 2s, 3s...) capped at 30s
        const delay = Math.min(times * config.redis.retryDelay, 30000);
        const level = times <= 5 ? 'warn' : 'error';
        logger[level]('⚠️ Redis reconnection scheduled', {
          attempt: times,
          delay,
        });
        return delay;
      },
    };
  }

  /**
   * Get or create the main connection
   */
  async getMainConnection(): Promise<Redis> {
    if (this.mainConnection && this.mainConnection.status === 'ready') {
      return this.mainConnection;
    }

    if (this.activeConnectionCount >= this.maxConnections) {
      throw new Error(`Connection pool limit reached: ${this.maxConnections}`);
    }

    const config = getQueueConfig();
    logger.info('Creating main Redis connection', {
      url: config.redis.url.replace(/\/\/[^@]+@/, '//***@'),
      activeConnections: this.activeConnectionCount,
      maxConnections: this.maxConnections,
    });

    this.mainConnection = new Redis(config.redis.url, this.connectionConfig);

    const connectionStartTime = Date.now();

    this.mainConnection.on('connect', () => {
      this.activeConnectionCount++;
      logger.info('✅ Main Redis connection established', {
        activeConnections: this.activeConnectionCount,
        elapsed: Date.now() - connectionStartTime,
      });
    });

    this.mainConnection.on('ready', () => {
      logger.info('✅ Main Redis connection READY', {
        elapsed: Date.now() - connectionStartTime,
      });
    });

    this.mainConnection.on('error', (err) => {
      logger.error('❌ Main Redis connection ERROR', {
        error: err.message,
        code: (err as NodeJS.ErrnoException).code,
        elapsed: Date.now() - connectionStartTime,
        stack: err.stack?.split('\n').slice(0, 3).join('\n'),
      });
    });

    this.mainConnection.on('close', () => {
      this.activeConnectionCount = Math.max(0, this.activeConnectionCount - 1);
      logger.warn('⚠️ Main Redis connection CLOSED', {
        activeConnections: this.activeConnectionCount,
        elapsed: Date.now() - connectionStartTime,
        status: this.mainConnection?.status,
      });
    });

    this.mainConnection.on('end', () => {
      logger.warn('🔚 Main Redis connection ENDED (stream closed)', {
        elapsed: Date.now() - connectionStartTime,
      });
    });

    await this.mainConnection.connect();
    return this.mainConnection;
  }

  /**
   * Get or create a worker-specific connection with delay
   */
  async getWorkerConnection(workerName: string): Promise<Redis> {
    const existing = this.workerConnections.get(workerName);
    if (existing && existing.status === 'ready') {
      logger.info('Reusing existing worker connection', { workerName });
      return existing;
    }

    if (this.activeConnectionCount >= this.maxConnections) {
      logger.warn('Connection pool limit reached, reusing main connection', {
        workerName,
        activeConnections: this.activeConnectionCount,
      });
      return await this.getMainConnection();
    }

    // Add delay between connection attempts
    await this.delay(this.connectionDelay * this.workerConnections.size);

    const config = getQueueConfig();
    logger.info('Creating worker Redis connection', {
      workerName,
      activeConnections: this.activeConnectionCount,
      maxConnections: this.maxConnections,
      delay: this.connectionDelay * this.workerConnections.size,
    });

    const connection = new Redis(config.redis.url, this.connectionConfig);

    const workerStartTime = Date.now();

    connection.on('connect', () => {
      this.activeConnectionCount++;
      logger.info('✅ Worker Redis connection established', {
        workerName,
        activeConnections: this.activeConnectionCount,
        elapsed: Date.now() - workerStartTime,
      });
    });

    connection.on('ready', () => {
      logger.info('✅ Worker Redis connection READY', {
        workerName,
        elapsed: Date.now() - workerStartTime,
      });
    });

    connection.on('error', (err) => {
      logger.error('❌ Worker Redis connection ERROR', {
        workerName,
        error: err.message,
        code: (err as NodeJS.ErrnoException).code,
        elapsed: Date.now() - workerStartTime,
      });
    });

    connection.on('close', () => {
      this.activeConnectionCount = Math.max(0, this.activeConnectionCount - 1);
      logger.warn('⚠️ Worker Redis connection CLOSED', {
        workerName,
        activeConnections: this.activeConnectionCount,
        elapsed: Date.now() - workerStartTime,
        status: connection?.status,
      });
      this.workerConnections.delete(workerName);
    });

    connection.on('end', () => {
      logger.warn('🔚 Worker Redis connection ENDED', {
        workerName,
        elapsed: Date.now() - workerStartTime,
      });
    });

    await connection.connect();
    this.workerConnections.set(workerName, connection);
    return connection;
  }

  /**
   * Get connection count for monitoring
   */
  getConnectionCount(): number {
    return this.activeConnectionCount;
  }

  /**
   * Close all connections
   */
  async closeAll(): Promise<void> {
    logger.info('Closing all Redis connections', {
      activeConnections: this.activeConnectionCount,
    });

    const closePromises: Promise<unknown>[] = [];

    if (this.mainConnection) {
      closePromises.push(this.mainConnection.quit());
    }

    for (const [name, connection] of this.workerConnections.entries()) {
      logger.info('Closing worker connection', { workerName: name });
      closePromises.push(connection.quit());
    }

    await Promise.all(closePromises);

    this.mainConnection = null;
    this.workerConnections.clear();
    this.activeConnectionCount = 0;

    logger.info('All Redis connections closed');
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// Singleton instance
let poolInstance: RedisConnectionPool | null = null;

export function getConnectionPool(): RedisConnectionPool {
  if (!poolInstance) {
    poolInstance = new RedisConnectionPool(6); // Limit to 6 connections for Upstash
  }
  return poolInstance;
}
