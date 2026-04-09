/**
 * Backend Index Tests
 * Unit tests for main package exports
 */

import { describe, it, expect } from 'vitest';
import {
  DatabaseClient,
  createDatabaseClient,
  ProjectRepository,
  BugReportRepository,
  UserRepository,
  TicketRepository,
  BaseRepository,
  config,
  validateConfig,
  runMigrations,
  setLogger,
  getLogger,
  executeWithRetry,
  isRetryableError,
  withRetry,
  ExponentialBackoffStrategy,
  LinearBackoffStrategy,
  FixedDelayStrategy,
  DEFAULT_RETRY_CONFIG,
  createRepositories,
} from '../src/index.js';

describe('Backend Package Exports', () => {
  describe('Database Exports', () => {
    it('should export DatabaseClient', () => {
      expect(DatabaseClient).toBeDefined();
      expect(typeof DatabaseClient).toBe('function');
    });

    it('should export createDatabaseClient', () => {
      expect(createDatabaseClient).toBeDefined();
      expect(typeof createDatabaseClient).toBe('function');
    });

    it('should export BaseRepository', () => {
      expect(BaseRepository).toBeDefined();
      expect(typeof BaseRepository).toBe('function');
    });
  });

  describe('Repository Exports', () => {
    it('should export ProjectRepository', () => {
      expect(ProjectRepository).toBeDefined();
      expect(typeof ProjectRepository).toBe('function');
    });

    it('should export BugReportRepository', () => {
      expect(BugReportRepository).toBeDefined();
      expect(typeof BugReportRepository).toBe('function');
    });

    it('should export UserRepository', () => {
      expect(UserRepository).toBeDefined();
      expect(typeof UserRepository).toBe('function');
    });

    it('should export TicketRepository', () => {
      expect(TicketRepository).toBeDefined();
      expect(typeof TicketRepository).toBe('function');
    });
  });

  describe('Configuration Exports', () => {
    it('should export config', () => {
      expect(config).toBeDefined();
      expect(typeof config).toBe('object');
    });

    it('should export validateConfig', () => {
      expect(validateConfig).toBeDefined();
      expect(typeof validateConfig).toBe('function');
    });
  });

  describe('Migration Exports', () => {
    it('should export runMigrations', () => {
      expect(runMigrations).toBeDefined();
      expect(typeof runMigrations).toBe('function');
    });
  });

  describe('Logger Exports', () => {
    it('should export setLogger', () => {
      expect(setLogger).toBeDefined();
      expect(typeof setLogger).toBe('function');
    });

    it('should export getLogger', () => {
      expect(getLogger).toBeDefined();
      expect(typeof getLogger).toBe('function');
    });
  });

  describe('Retry Utilities', () => {
    it('should export executeWithRetry', () => {
      expect(executeWithRetry).toBeDefined();
      expect(typeof executeWithRetry).toBe('function');
    });

    it('should export isRetryableError', () => {
      expect(isRetryableError).toBeDefined();
      expect(typeof isRetryableError).toBe('function');
    });

    it('should export withRetry', () => {
      expect(withRetry).toBeDefined();
      expect(typeof withRetry).toBe('function');
    });

    it('should export ExponentialBackoffStrategy', () => {
      expect(ExponentialBackoffStrategy).toBeDefined();
      expect(typeof ExponentialBackoffStrategy).toBe('function');
    });

    it('should export LinearBackoffStrategy', () => {
      expect(LinearBackoffStrategy).toBeDefined();
      expect(typeof LinearBackoffStrategy).toBe('function');
    });

    it('should export FixedDelayStrategy', () => {
      expect(FixedDelayStrategy).toBeDefined();
      expect(typeof FixedDelayStrategy).toBe('function');
    });

    it('should export DEFAULT_RETRY_CONFIG', () => {
      expect(DEFAULT_RETRY_CONFIG).toBeDefined();
      expect(typeof DEFAULT_RETRY_CONFIG).toBe('object');
    });
  });

  describe('Transaction Utilities', () => {
    it('should export createRepositories', () => {
      expect(createRepositories).toBeDefined();
      expect(typeof createRepositories).toBe('function');
    });
  });

  describe('Package Structure', () => {
    it('should have all main database features', () => {
      const mainExports = [
        DatabaseClient,
        createDatabaseClient,
        BaseRepository,
        ProjectRepository,
        BugReportRepository,
        UserRepository,
        TicketRepository,
      ];

      mainExports.forEach((exp) => {
        expect(exp).toBeDefined();
      });
    });

    it('should have all retry features', () => {
      const retryExports = [
        executeWithRetry,
        isRetryableError,
        withRetry,
        ExponentialBackoffStrategy,
        LinearBackoffStrategy,
        FixedDelayStrategy,
        DEFAULT_RETRY_CONFIG,
      ];

      retryExports.forEach((exp) => {
        expect(exp).toBeDefined();
      });
    });

    it('should have config and logger features', () => {
      expect(config).toBeDefined();
      expect(validateConfig).toBeDefined();
      expect(runMigrations).toBeDefined();
      expect(setLogger).toBeDefined();
      expect(getLogger).toBeDefined();
    });
  });
});
