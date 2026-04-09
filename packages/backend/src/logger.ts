/**
 * Logger interface and default implementation
 * Users can provide their own logger implementation (pino, winston, etc.)
 */

export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

/**
 * Log level priorities for filtering
 */
const LOG_LEVEL_PRIORITY: Record<string, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Default console-based logger
 * Provides basic logging functionality with optional metadata
 * Respects LOG_LEVEL environment variable for filtering
 */
class ConsoleLogger implements Logger {
  private readonly minLevel: string;

  constructor() {
    // Default to 'info' in production, 'debug' in development
    const defaultLevel = process.env.NODE_ENV === 'production' ? 'info' : 'debug';
    this.minLevel = process.env.LOG_LEVEL || defaultLevel;
  }

  private shouldLog(level: string): boolean {
    const currentPriority = LOG_LEVEL_PRIORITY[level] ?? 0;
    const minPriority = LOG_LEVEL_PRIORITY[this.minLevel] ?? 0;
    return currentPriority >= minPriority;
  }

  private formatMessage(level: string, message: string, meta?: Record<string, unknown>): string {
    const timestamp = new Date().toISOString();
    const metaStr = meta ? ` ${JSON.stringify(meta)}` : '';
    return `[${timestamp}] ${level.toUpperCase()}: ${message}${metaStr}`;
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    if (this.shouldLog('debug')) {
      console.debug(this.formatMessage('debug', message, meta));
    }
  }

  info(message: string, meta?: Record<string, unknown>): void {
    if (this.shouldLog('info')) {
      console.info(this.formatMessage('info', message, meta));
    }
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    if (this.shouldLog('warn')) {
      console.warn(this.formatMessage('warn', message, meta));
    }
  }

  error(message: string, meta?: Record<string, unknown>): void {
    if (this.shouldLog('error')) {
      console.error(this.formatMessage('error', message, meta));
    }
  }
}

/**
 * Global logger instance
 * Can be replaced by users with their own logger
 */
let globalLogger: Logger = new ConsoleLogger();

/**
 * Set a custom logger implementation
 * @example
 * import pino from 'pino';
 * setLogger(pino());
 */
export function setLogger(logger: Logger): void {
  globalLogger = logger;
}

/**
 * Get the current logger instance
 */
export function getLogger(): Logger {
  return globalLogger;
}
