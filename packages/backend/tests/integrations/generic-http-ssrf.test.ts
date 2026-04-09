/**
 * Tests for SSRF protection in GenericHttpClient and GenericHttpService
 * Ensures SSRF validation is properly integrated at the integration layer
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GenericHttpClient } from '../../src/integrations/generic-http/client.js';
import { GenericHttpService } from '../../src/integrations/generic-http/service.js';
import type { GenericHttpConfig } from '../../src/integrations/generic-http/types.js';
import type { DatabaseClient } from '../../src/db/client.js';

// Mock the database client
const createMockDb = (): DatabaseClient => {
  return {
    transaction: vi.fn(),
    bugReports: {},
    projects: {},
    integrations: {},
    tickets: {},
  } as unknown as DatabaseClient;
};

// Valid config for testing
const createValidConfig = (baseUrl: string): GenericHttpConfig => ({
  baseUrl,
  auth: { type: 'bearer', token: 'test-token' },
  endpoints: {
    create: {
      path: '/issues',
      method: 'POST',
      responseMapping: {
        idField: 'id',
        urlField: 'url',
      },
    },
  },
  fieldMappings: [{ source: 'title', target: 'summary' }],
});

describe('GenericHttpClient SSRF Protection', () => {
  describe('constructor validation', () => {
    it('should allow valid public URLs', () => {
      expect(
        () => new GenericHttpClient(createValidConfig('https://api.example.com'))
      ).not.toThrow();
      expect(
        () => new GenericHttpClient(createValidConfig('https://jira.company.com'))
      ).not.toThrow();
      expect(() => new GenericHttpClient(createValidConfig('https://8.8.8.8'))).not.toThrow();
    });

    it('should block localhost URLs', () => {
      expect(() => new GenericHttpClient(createValidConfig('http://localhost'))).toThrow(
        'internal/private networks'
      );
      expect(() => new GenericHttpClient(createValidConfig('http://localhost:3000'))).toThrow(
        'internal/private networks'
      );
      expect(() => new GenericHttpClient(createValidConfig('http://127.0.0.1'))).toThrow(
        'internal/private networks'
      );
    });

    it.each([
      { url: 'http://10.0.0.1', description: '10.x.x.x range' },
      { url: 'http://192.168.1.1', description: '192.168.x.x range' },
      { url: 'http://172.16.0.1', description: '172.16.x.x - 172.31.x.x range' },
    ])('should block private network IP: $description', ({ url }) => {
      expect(() => new GenericHttpClient(createValidConfig(url))).toThrow(
        'internal/private networks'
      );
    });

    it('should block cloud metadata endpoints', () => {
      expect(() => new GenericHttpClient(createValidConfig('http://169.254.169.254'))).toThrow(
        'cloud metadata'
      );
      expect(() => new GenericHttpClient(createValidConfig('http://169.254.170.2'))).toThrow(
        'cloud metadata'
      );
    });

    it.each([
      { url: 'http://0177.0.0.1', description: 'octal encoding' },
      { url: 'http://0x7f.0.0.1', description: 'hexadecimal encoding' },
      { url: 'http://2130706433', description: 'decimal encoding' },
    ])('should block alternative IP encoding: $description', ({ url }) => {
      expect(() => new GenericHttpClient(createValidConfig(url))).toThrow(
        'Alternative IP address formats'
      );
    });

    it('should block dangerous protocols', () => {
      expect(() => new GenericHttpClient(createValidConfig('file:///etc/passwd'))).toThrow(
        'Protocol not allowed'
      );
      expect(() => new GenericHttpClient(createValidConfig('ftp://example.com'))).toThrow(
        'Protocol not allowed'
      );
    });
  });
});

describe('GenericHttpService.validateConfig SSRF Protection', () => {
  let mockDb: DatabaseClient;
  let service: GenericHttpService;

  beforeEach(() => {
    mockDb = createMockDb();
    service = new GenericHttpService('test', createValidConfig('https://api.example.com'), mockDb);
  });

  it('should validate valid public URLs', async () => {
    const result = await service.validateConfig(createValidConfig('https://api.example.com'));
    expect(result.valid).toBe(true);
  });

  it('should reject localhost URLs in config', async () => {
    const result = await service.validateConfig(createValidConfig('http://localhost:3000'));
    expect(result.valid).toBe(false);
    expect(result.error).toContain('baseUrl is not allowed');
    expect(result.error).toContain('internal/private networks');
  });

  it.each([
    { url: 'http://10.0.0.1', description: '10.x.x.x range' },
    { url: 'http://192.168.1.1', description: '192.168.x.x range' },
  ])('should reject private network IP in config: $description', async ({ url }) => {
    const result = await service.validateConfig(createValidConfig(url));
    expect(result.valid).toBe(false);
    expect(result.error).toContain('internal/private networks');
  });

  it('should reject cloud metadata endpoints in config', async () => {
    const result = await service.validateConfig(createValidConfig('http://169.254.169.254'));
    expect(result.valid).toBe(false);
    expect(result.error).toContain('cloud metadata');
  });

  it.each([
    { url: 'http://0177.0.0.1', description: 'octal encoding' },
    { url: 'http://0x7f.0.0.1', description: 'hexadecimal encoding' },
    { url: 'http://2130706433', description: 'decimal encoding' },
  ])('should reject alternative IP encoding in config: $description', async ({ url }) => {
    const result = await service.validateConfig(createValidConfig(url));
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Alternative IP address formats');
  });

  it('should reject missing baseUrl', async () => {
    const config = createValidConfig('https://api.example.com');
    delete (config as any).baseUrl;

    const result = await service.validateConfig(config as any);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('baseUrl is required');
  });
});
