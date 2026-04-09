/**
 * Migration Runner Retry Tests
 * Tests that the migration runner retries the initial DB connection
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';

// Mock pg Pool
class MockPool extends EventEmitter {
  query = vi.fn().mockResolvedValue({ rows: [] });
  connect = vi.fn();
  end = vi.fn().mockResolvedValue(undefined);
}

const mockPool = new MockPool();

vi.mock('pg', async (importOriginal) => {
  const actual = await importOriginal<typeof import('pg')>();
  return {
    ...actual,
    default: {
      ...actual,
      Pool: vi.fn(() => mockPool),
    },
    Pool: vi.fn(() => mockPool),
  };
});

// Mock config
vi.mock('../../src/config.js', () => ({
  config: {
    database: {
      url: 'postgresql://test:test@localhost:5432/test',
      poolMax: 10,
      poolMin: 2,
      connectionTimeout: 30000,
      idleTimeout: 30000,
      retryAttempts: 3,
      retryDelayMs: 0, // No delays — assertions only check retry counts
    },
  },
  validateConfig: vi.fn(),
}));

// Mock SSL config
vi.mock('../../src/db/ssl.js', () => ({
  buildSslConfig: vi.fn().mockReturnValue(undefined),
}));

// Mock logger (used by retry utility)
vi.mock('../../src/logger.js', () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
  setLogger: vi.fn(),
}));

// Mock fs to control migration file discovery
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    default: {
      ...actual,
      readdirSync: vi.fn().mockReturnValue([]),
      readFileSync: actual.readFileSync,
    },
    readdirSync: vi.fn().mockReturnValue([]),
    readFileSync: actual.readFileSync,
  };
});

describe('Migration Runner - Connection Retry', () => {
  let runMigrations: () => Promise<void>;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Reset query mock — { rows: [] } works for all queries:
    // SELECT NOW() (return value unused), SET search_path, CREATE TABLE,
    // and SELECT migration_name (empty = no applied migrations)
    mockPool.query.mockResolvedValue({ rows: [] });
    mockPool.end.mockResolvedValue(undefined);

    // Dynamic import after mocks
    const module = await import('../../src/db/migrations/migrate.js');
    runMigrations = module.runMigrations;
  });

  it('should succeed when connection works on first attempt', async () => {
    // query mock already returns success by default
    // readdirSync returns [] so no migrations to apply
    await runMigrations();

    // SELECT NOW() for connection test, then SET search_path, then CREATE TABLE, then SELECT migrations
    expect(mockPool.query).toHaveBeenCalledWith('SELECT NOW()');
  });

  it('should retry and succeed when connection fails then recovers', async () => {
    const econnrefused = new Error('connect ECONNREFUSED 127.0.0.1:5432');
    (econnrefused as any).code = 'ECONNREFUSED';

    // Fail first attempt, succeed on second
    mockPool.query
      .mockRejectedValueOnce(econnrefused)
      .mockResolvedValueOnce({ rows: [] }) // SELECT NOW() retry succeeds
      .mockResolvedValue({ rows: [] }); // subsequent queries

    await runMigrations();

    // Should have been called at least twice for SELECT NOW() (1 fail + 1 success)
    const selectNowCalls = mockPool.query.mock.calls.filter((call) => call[0] === 'SELECT NOW()');
    expect(selectNowCalls.length).toBe(2);
  });

  it('should fail after exhausting all retry attempts', async () => {
    const econnrefused = new Error('connect ECONNREFUSED 127.0.0.1:5432');
    (econnrefused as any).code = 'ECONNREFUSED';

    // Fail all attempts
    mockPool.query.mockRejectedValue(econnrefused);

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });

    await expect(runMigrations()).rejects.toThrow('process.exit called');

    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });

  it('should not retry on non-connection errors', async () => {
    const syntaxError = new Error('syntax error at or near "SELEC"');
    (syntaxError as any).code = '42601'; // PG syntax error — not retryable

    mockPool.query.mockRejectedValue(syntaxError);

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });

    await expect(runMigrations()).rejects.toThrow('process.exit called');

    // Should have only tried once (no retry for syntax errors)
    const selectNowCalls = mockPool.query.mock.calls.filter((call) => call[0] === 'SELECT NOW()');
    expect(selectNowCalls.length).toBe(1);

    exitSpy.mockRestore();
  });
});
