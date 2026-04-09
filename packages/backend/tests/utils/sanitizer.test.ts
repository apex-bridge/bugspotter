/**
 * Tests for Security Sanitization Utilities
 */

import { describe, it, expect } from 'vitest';
import {
  sanitizeErrorMessage,
  sanitizeError,
  sanitizeUnknownError,
  sanitizeLogContext,
} from '../../src/utils/sanitizer.js';

describe('sanitizeErrorMessage', () => {
  describe('Database Connection Strings', () => {
    it('should redact PostgreSQL connection strings', () => {
      const input = 'Connection failed to postgres://user:pass@localhost:5432/db';
      const result = sanitizeErrorMessage(input);
      expect(result).toBe('Connection failed to [REDACTED]/db');
    });

    it('should redact MySQL connection strings', () => {
      const input = 'Error: mysql://admin:secret@db.example.com:3306/mydb';
      const result = sanitizeErrorMessage(input);
      expect(result).toBe('Error: [REDACTED]/mydb');
    });

    it('should redact MongoDB connection strings', () => {
      const input = 'Failed to connect: mongodb://user:password@cluster.mongodb.net/test';
      const result = sanitizeErrorMessage(input);
      expect(result).toBe('Failed to connect: [REDACTED]/test');
    });

    it('should redact Redis connection strings', () => {
      const input = 'Redis error: redis://default:secret@redis.example.com:6379';
      const result = sanitizeErrorMessage(input);
      expect(result).toBe('Redis error: [REDACTED]');
    });
  });

  describe('Credentials and Secrets', () => {
    it('should redact password parameters', () => {
      const input = 'Login failed with password=mysecret123';
      const result = sanitizeErrorMessage(input);
      expect(result).toBe('Login failed with [REDACTED]');
    });

    it('should redact API key parameters', () => {
      const input = 'Request failed: api_key=abc123def456&foo=bar';
      const result = sanitizeErrorMessage(input);
      expect(result).toBe('Request failed: [REDACTED]&foo=bar');
    });

    it('should redact token parameters', () => {
      const input = 'Auth failed with token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9';
      const result = sanitizeErrorMessage(input);
      expect(result).toBe('Auth failed with [REDACTED]');
    });

    it('should redact secret parameters', () => {
      const input = 'Config error: secret=my-secret-value';
      const result = sanitizeErrorMessage(input);
      expect(result).toBe('Config error: [REDACTED]');
    });

    it('should redact client_secret parameters', () => {
      const input = 'OAuth failed: client_secret=oauth_secret_123';
      const result = sanitizeErrorMessage(input);
      // Redacts the value part, leaving 'client_' prefix
      expect(result).toBe('OAuth failed: client_[REDACTED]');
    });
  });

  describe('Authorization Headers', () => {
    it('should redact Bearer tokens', () => {
      const input = 'Request failed with Authorization: Bearer eyJhbGciOiJIUzI1NiJ9';
      const result = sanitizeErrorMessage(input);
      expect(result).toBe('Request failed with [REDACTED]');
    });

    it('should redact Basic auth tokens', () => {
      const input = 'Auth header: Authorization: Basic dXNlcjpwYXNz';
      const result = sanitizeErrorMessage(input);
      expect(result).toBe('Auth header: [REDACTED]');
    });

    it('should redact generic Authorization headers', () => {
      const input = 'Failed with Authorization: Custom abc123token';
      const result = sanitizeErrorMessage(input);
      expect(result).toBe('Failed with [REDACTED]');
    });
  });

  describe('API Keys with Prefixes', () => {
    it('should redact API keys with sk_ prefix', () => {
      const input = 'Invalid key: sk_live_TESTKEY_000000000000000';
      const result = sanitizeErrorMessage(input);
      expect(result).toBe('Invalid key: [REDACTED]');
    });

    it('should redact API keys with pk_ prefix', () => {
      const input = 'Public key error: pk_test_TESTKEY_000000000000000';
      const result = sanitizeErrorMessage(input);
      expect(result).toBe('Public key error: [REDACTED]');
    });

    it('should redact API keys with api_ prefix', () => {
      const input = 'Key validation failed: api_secret_key_123456789';
      const result = sanitizeErrorMessage(input);
      expect(result).toBe('Key validation failed: [REDACTED]');
    });
  });

  describe('File Paths', () => {
    it('should redact Windows paths', () => {
      const input = 'File not found: C:\\Users\\Admin\\Documents\\secret.txt';
      const result = sanitizeErrorMessage(input);
      expect(result).toBe('File not found: [REDACTED]');
    });

    it('should redact sensitive Unix paths', () => {
      const input = 'Access denied to /home/user/.ssh/id_rsa';
      const result = sanitizeErrorMessage(input);
      expect(result).toBe('Access denied to [REDACTED]');
    });

    it('should redact /root paths', () => {
      const input = 'Cannot read /root/.aws/credentials';
      const result = sanitizeErrorMessage(input);
      expect(result).toBe('Cannot read [REDACTED]');
    });

    it('should redact /var paths', () => {
      const input = 'Log error in /var/log/app/error.log';
      const result = sanitizeErrorMessage(input);
      expect(result).toBe('Log error in [REDACTED]');
    });
  });

  describe('IP Addresses', () => {
    it('should redact private IP addresses (10.x.x.x)', () => {
      const input = 'Connection timeout to 10.0.1.100:8080';
      const result = sanitizeErrorMessage(input);
      // Redacts first 3 octets of 10.x.x.x address
      expect(result).toBe('Connection timeout to [REDACTED].100:8080');
    });

    it('should redact private IP addresses (192.168.x.x)', () => {
      const input = 'Server at 192.168.1.1 is unreachable';
      const result = sanitizeErrorMessage(input);
      expect(result).toBe('Server at [REDACTED] is unreachable');
    });

    it('should redact private IP addresses (172.16-31.x.x)', () => {
      const input = 'Internal server 172.20.5.10 returned error';
      const result = sanitizeErrorMessage(input);
      expect(result).toBe('Internal server [REDACTED] returned error');
    });

    it('should not redact public IP addresses', () => {
      const input = 'Connected to 8.8.8.8';
      const result = sanitizeErrorMessage(input);
      expect(result).toBe('Connected to 8.8.8.8');
    });
  });

  describe('Email Addresses', () => {
    it('should redact email addresses', () => {
      const input = 'User john.doe@example.com not found';
      const result = sanitizeErrorMessage(input);
      expect(result).toBe('User [REDACTED] not found');
    });

    it('should redact multiple email addresses', () => {
      const input = 'Email from admin@company.com to user@domain.org failed';
      const result = sanitizeErrorMessage(input);
      expect(result).toBe('Email from [REDACTED] to [REDACTED] failed');
    });
  });

  describe('Complex Cases', () => {
    it('should redact multiple sensitive patterns in one message', () => {
      const input =
        'Connection to postgres://user:pass@10.0.1.5/db failed for admin@company.com with token=abc123';
      const result = sanitizeErrorMessage(input);
      expect(result).toBe('Connection to [REDACTED]/db failed for [REDACTED] with [REDACTED]');
    });

    it('should handle empty strings', () => {
      const result = sanitizeErrorMessage('');
      expect(result).toBe('');
    });

    it('should handle messages with no sensitive data', () => {
      const input = 'Simple error message without sensitive data';
      const result = sanitizeErrorMessage(input);
      expect(result).toBe('Simple error message without sensitive data');
    });

    it('should be case-insensitive for most patterns', () => {
      const input = 'Failed with PASSWORD=Secret123 and API_KEY=abc456';
      const result = sanitizeErrorMessage(input);
      expect(result).toBe('Failed with [REDACTED] and [REDACTED]');
    });
  });
});

describe('sanitizeError', () => {
  it('should sanitize Error message', () => {
    const error = new Error('Connection failed to postgres://user:pass@localhost/db');
    const result = sanitizeError(error);

    expect(result).toBeInstanceOf(Error);
    expect(result.message).toBe('Connection failed to [REDACTED]/db');
  });

  it('should preserve error name', () => {
    const error = new TypeError('Invalid token=abc123');
    const result = sanitizeError(error);

    expect(result.name).toBe('TypeError');
    expect(result.message).toBe('Invalid [REDACTED]');
  });

  it('should preserve stack trace', () => {
    const error = new Error('Sensitive data: api_key=secret123');
    const originalStack = error.stack;
    const result = sanitizeError(error);

    expect(result.stack).toBe(originalStack);
  });

  it('should handle errors with no sensitive data', () => {
    const error = new Error('Simple error message');
    const result = sanitizeError(error);

    expect(result.message).toBe('Simple error message');
  });
});

describe('sanitizeUnknownError', () => {
  it('should sanitize Error objects', () => {
    const error = new Error('Token expired: token=abc123');
    const result = sanitizeUnknownError(error);

    expect(result).toBe('Token expired: [REDACTED]');
  });

  it('should sanitize string errors', () => {
    const error = 'Connection string: mysql://user:pass@localhost/db';
    const result = sanitizeUnknownError(error);

    expect(result).toBe('Connection string: [REDACTED]/db');
  });

  it('should sanitize number errors', () => {
    const error = 42;
    const result = sanitizeUnknownError(error);

    expect(result).toBe('42');
  });

  it('should sanitize object errors', () => {
    const error = { code: 'ERR_AUTH', apiKey: 'sk_live_TEST00' };
    const result = sanitizeUnknownError(error);

    expect(result).toContain('[object Object]');
  });

  it('should handle null and undefined', () => {
    expect(sanitizeUnknownError(null)).toBe('null');
    expect(sanitizeUnknownError(undefined)).toBe('undefined');
  });
});

describe('sanitizeLogContext', () => {
  it('should sanitize string values in context', () => {
    const context = {
      message: 'Connection to postgres://user:pass@localhost/db failed',
      status: 'error',
    };

    const result = sanitizeLogContext(context);

    expect(result.message).toBe('Connection to [REDACTED]/db failed');
    expect(result.status).toBe('error');
  });

  it('should sanitize nested objects', () => {
    const context = {
      error: {
        message: 'Invalid api_key=secret123',
        code: 'AUTH_FAILED',
      },
      userId: '12345',
    };

    const result = sanitizeLogContext(context);

    expect(result.error).toEqual({
      message: 'Invalid [REDACTED]',
      code: 'AUTH_FAILED',
    });
    expect(result.userId).toBe('12345');
  });

  it('should sanitize arrays of strings', () => {
    const context = {
      errors: ['Token invalid: token=abc123', 'API key expired: api_key=xyz789'],
    };

    const result = sanitizeLogContext(context);

    expect(result.errors).toEqual(['Token invalid: [REDACTED]', 'API key expired: [REDACTED]']);
  });

  it('should sanitize arrays of objects', () => {
    const context = {
      users: [
        { id: '1', email: 'user1@example.com' },
        { id: '2', email: 'user2@example.com' },
      ],
    };

    const result = sanitizeLogContext(context);

    expect(result.users).toEqual([
      { id: '1', email: '[REDACTED]' },
      { id: '2', email: '[REDACTED]' },
    ]);
  });

  it('should preserve non-string primitive values', () => {
    const context = {
      count: 42,
      success: true,
      timestamp: null,
      data: undefined,
    };

    const result = sanitizeLogContext(context);

    expect(result).toEqual({
      count: 42,
      success: true,
      timestamp: null,
      data: undefined,
    });
  });

  it('should handle deeply nested structures', () => {
    const context = {
      level1: {
        level2: {
          level3: {
            secret: 'password=mysecret',
          },
        },
      },
    };

    const result = sanitizeLogContext(context);

    expect(result.level1).toBeDefined();
    expect((result.level1 as Record<string, unknown>).level2).toBeDefined();
    expect(
      ((result.level1 as Record<string, unknown>).level2 as Record<string, unknown>).level3
    ).toEqual({
      secret: '[REDACTED]',
    });
  });

  it('should handle empty objects', () => {
    const context = {};
    const result = sanitizeLogContext(context);

    expect(result).toEqual({});
  });

  it('should handle complex mixed structures', () => {
    const context = {
      message: 'Error connecting to postgres://user:pass@10.0.1.5/db',
      metadata: {
        userId: '123e4567-e89b-12d3-a456-426614174000',
        apiKey: 'sk_live_TESTKEY_0000',
        tags: ['production', 'critical'],
      },
      errors: ['Token expired: Bearer abc123', 'Auth failed for admin@company.com'],
      count: 5,
    };

    const result = sanitizeLogContext(context);

    expect(result.message).toBe('Error connecting to [REDACTED]/db');
    expect(result.metadata).toEqual({
      userId: '123e4567-e89b-12d3-a456-426614174000', // UUIDs are legitimate identifiers, not redacted
      // apiKey field name doesn't trigger pattern, only values like 'api_key=value'
      apiKey: 'sk_live_TESTKEY_0000',
      tags: ['production', 'critical'],
    });
    expect(result.errors).toEqual(['Token expired: [REDACTED]', 'Auth failed for [REDACTED]']);
    expect(result.count).toBe(5);
  });
});
