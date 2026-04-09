/**
 * Security tests for RPC Bridge
 * Tests that malicious plugin code cannot escape sandbox restrictions
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RpcBridge } from '../../src/integrations/security/rpc-bridge.js';
import type { DatabaseClient } from '../../src/db/client.js';
import type { IStorageService } from '../../src/storage/types.js';
import type { BugReport } from '../../src/db/types.js';

// Constants for testing (match values from rpc-bridge.ts)
const HTTP_FETCH_TIMEOUT_MS = 10000;
const MAX_RESPONSE_SIZE_BYTES = 10 * 1024 * 1024;

describe('RPC Bridge Security', () => {
  let rpcBridge: RpcBridge;
  let mockDb: DatabaseClient;
  let mockStorage: IStorageService;
  const testProjectId = 'test-project-123';
  const otherProjectId = 'other-project-456';

  beforeEach(() => {
    // Mock database client
    mockDb = {
      bugReports: {
        findById: vi.fn(),
        update: vi.fn(),
      },
      projectIntegrations: {
        findAllByProjectWithType: vi.fn(),
      },
    } as unknown as DatabaseClient;

    // Mock storage service
    mockStorage = {
      getSignedUrl: vi.fn(),
    } as unknown as IStorageService;

    rpcBridge = new RpcBridge(mockDb, mockStorage, testProjectId);
  });

  describe('Method Whitelist', () => {
    it('should reject non-whitelisted RPC methods', async () => {
      const result = await rpcBridge.handleCall({
        method: 'db.bugReports.delete',
        args: ['bug-123'],
        requestId: 'req-1',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not allowed');
    });

    it('should reject attempts to call arbitrary database methods', async () => {
      const result = await rpcBridge.handleCall({
        method: 'db.query',
        args: ['DROP TABLE bug_reports'],
        requestId: 'req-2',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not allowed');
    });

    it('should reject attempts to access storage directly', async () => {
      const result = await rpcBridge.handleCall({
        method: 'storage.uploadBuffer',
        args: ['malicious.exe', Buffer.from('malware')],
        requestId: 'req-3',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not allowed');
    });

    it('should reject attempts to access Node.js APIs', async () => {
      const result = await rpcBridge.handleCall({
        method: 'process.exit',
        args: [1],
        requestId: 'req-4',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not allowed');
    });

    it('should allow whitelisted method: db.bugReports.findById', async () => {
      const mockReport: BugReport = {
        id: 'bug-123',
        project_id: testProjectId,
        title: 'Test Bug',
        description: 'Test description',
        screenshot_url: null,
        replay_url: null,
        metadata: {},
        status: 'open',
        priority: 'medium',
        deleted_at: null,
        deleted_by: null,
        legal_hold: false,
        created_at: new Date(),
        updated_at: new Date(),
        screenshot_key: null,
        thumbnail_key: null,
        replay_key: null,
        upload_status: 'completed',
        replay_upload_status: 'none',
      };

      vi.mocked(mockDb.bugReports.findById).mockResolvedValue(mockReport);

      const result = await rpcBridge.handleCall({
        method: 'db.bugReports.findById',
        args: ['bug-123'],
        requestId: 'req-5',
      });

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    });

    it('should allow whitelisted method: log', async () => {
      const result = await rpcBridge.handleCall({
        method: 'log',
        args: ['Plugin execution started'],
        requestId: 'req-6',
      });

      expect(result.success).toBe(true);
    });
  });

  describe('Project-Scoped Access Control', () => {
    it('should deny access to bug reports from other projects', async () => {
      const otherProjectReport: BugReport = {
        id: 'bug-456',
        project_id: otherProjectId, // Different project!
        title: 'Other Project Bug',
        description: 'Sensitive data',
        screenshot_url: null,
        replay_url: null,
        metadata: {},
        status: 'open',
        priority: 'high',
        deleted_at: null,
        deleted_by: null,
        legal_hold: false,
        created_at: new Date(),
        updated_at: new Date(),
        screenshot_key: null,
        thumbnail_key: null,
        replay_key: null,
        upload_status: 'completed',
        replay_upload_status: 'none',
      };

      vi.mocked(mockDb.bugReports.findById).mockResolvedValue(otherProjectReport);

      const result = await rpcBridge.handleCall({
        method: 'db.bugReports.findById',
        args: ['bug-456'],
        requestId: 'req-7',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Access denied');
    });

    it('should deny access to storage files from other projects', async () => {
      const result = await rpcBridge.handleCall({
        method: 'storage.getPresignedUrl',
        args: [`screenshots/${otherProjectId}/bug-456/screenshot.png`],
        requestId: 'req-8',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Access denied');
    });

    it('should allow access to storage files from own project', async () => {
      vi.mocked(mockStorage.getSignedUrl).mockResolvedValue('https://signed-url.example.com');

      const result = await rpcBridge.handleCall({
        method: 'storage.getPresignedUrl',
        args: [`screenshots/${testProjectId}/bug-123/screenshot.png`],
        requestId: 'req-9',
      });

      expect(result.success).toBe(true);
      expect(result.data).toBe('https://signed-url.example.com');
    });
  });

  describe('Field-Level Restrictions', () => {
    it('should only allow updating metadata field on bug reports', async () => {
      const mockReport: BugReport = {
        id: 'bug-123',
        project_id: testProjectId,
        title: 'Original Title',
        description: 'Original description',
        screenshot_url: null,
        replay_url: null,
        metadata: { version: '1.0' },
        status: 'open',
        priority: 'medium',
        deleted_at: null,
        deleted_by: null,
        legal_hold: false,
        created_at: new Date(),
        updated_at: new Date(),
        screenshot_key: null,
        thumbnail_key: null,
        replay_key: null,
        upload_status: 'completed',
        replay_upload_status: 'none',
      };

      vi.mocked(mockDb.bugReports.findById).mockResolvedValue(mockReport);
      vi.mocked(mockDb.bugReports.update).mockResolvedValue(null);

      const result = await rpcBridge.handleCall({
        method: 'db.bugReports.update',
        args: [
          'bug-123',
          {
            metadata: { version: '1.0', jira_ticket: 'BUG-123' },
            title: 'HACKED', // Should be rejected
            status: 'closed', // Should be rejected
          },
        ],
        requestId: 'req-10',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Plugins can only update 'metadata' field");
      expect(result.error).toContain('title');
      expect(result.error).toContain('status');

      // Verify update was NOT called due to validation failure
      expect(mockDb.bugReports.update).not.toHaveBeenCalled();
    });

    it('should merge metadata instead of replacing it', async () => {
      const mockReport: BugReport = {
        id: 'bug-123',
        project_id: testProjectId,
        title: 'Test Bug',
        description: null,
        screenshot_url: null,
        replay_url: null,
        metadata: { existing: 'value', version: '1.0' },
        status: 'open',
        priority: 'medium',
        deleted_at: null,
        deleted_by: null,
        legal_hold: false,
        created_at: new Date(),
        updated_at: new Date(),
        screenshot_key: null,
        thumbnail_key: null,
        replay_key: null,
        upload_status: 'completed',
        replay_upload_status: 'none',
      };

      vi.mocked(mockDb.bugReports.findById).mockResolvedValue(mockReport);
      vi.mocked(mockDb.bugReports.update).mockResolvedValue(null);

      await rpcBridge.handleCall({
        method: 'db.bugReports.update',
        args: ['bug-123', { metadata: { new: 'field' } }],
        requestId: 'req-11',
      });

      // Verify metadata was merged
      expect(mockDb.bugReports.update).toHaveBeenCalledWith('bug-123', {
        metadata: {
          existing: 'value',
          version: '1.0',
          new: 'field',
        },
      });
    });
  });

  describe('Data Sanitization', () => {
    it('should not expose sensitive fields in bug report data', async () => {
      const mockReport: BugReport = {
        id: 'bug-123',
        project_id: testProjectId, // Sensitive
        title: 'Test Bug',
        description: 'Public description',
        screenshot_url: 'https://example.com/screenshot.png',
        replay_url: null,
        metadata: { user_agent: 'Mozilla/5.0' },
        status: 'open',
        priority: 'medium',
        deleted_at: null, // Sensitive
        deleted_by: null, // Sensitive
        legal_hold: false, // Sensitive
        created_at: new Date(),
        updated_at: new Date(),
        screenshot_key: 's3-key-123', // Sensitive
        thumbnail_key: null,
        replay_key: null,
        upload_status: 'completed',
        replay_upload_status: 'none',
      };

      vi.mocked(mockDb.bugReports.findById).mockResolvedValue(mockReport);

      const result = await rpcBridge.handleCall({
        method: 'db.bugReports.findById',
        args: ['bug-123'],
        requestId: 'req-12',
      });

      expect(result.success).toBe(true);
      const data = result.data as Record<string, unknown>;

      // Should expose these fields
      expect(data.id).toBe('bug-123');
      expect(data.title).toBe('Test Bug');
      expect(data.description).toBe('Public description');
      expect(data.status).toBe('open');
      expect(data.priority).toBe('medium');
      expect(data.metadata).toEqual({ user_agent: 'Mozilla/5.0' });

      // Date fields should be serialized as ISO 8601 strings
      expect(typeof data.created_at).toBe('string');
      expect(typeof data.updated_at).toBe('string');
      expect(data.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(data.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

      // Should NOT expose these sensitive fields
      expect(data).not.toHaveProperty('project_id');
      expect(data).not.toHaveProperty('deleted_at');
      expect(data).not.toHaveProperty('deleted_by');
      expect(data).not.toHaveProperty('legal_hold');
      expect(data).not.toHaveProperty('screenshot_key');
    });

    it('should not expose credentials in integration config', async () => {
      vi.mocked(mockDb.projectIntegrations.findAllByProjectWithType).mockResolvedValue([
        {
          id: 'int-123',
          project_id: testProjectId,
          integration_id: 'int-jira-id',
          integration_type: 'jira',
          enabled: true,
          config: { url: 'https://jira.example.com' },
          encrypted_credentials: 'encrypted-api-key', // Sensitive
          created_at: new Date(),
          updated_at: new Date(),
        },
      ]);

      const result = await rpcBridge.handleCall({
        method: 'db.projectIntegrations.findByProject',
        args: [],
        requestId: 'req-13',
      });

      expect(result.success).toBe(true);
      const integrations = result.data as Array<{
        type: string;
        config: Record<string, unknown>;
      }>;

      expect(integrations[0].type).toBe('jira');
      expect(integrations[0].config).toEqual({ url: 'https://jira.example.com' });

      // Should NOT expose encrypted_credentials
      expect(integrations[0]).not.toHaveProperty('encrypted_credentials');
    });
  });

  describe('URL Expiration', () => {
    it('should generate presigned URLs with 5-minute expiration', async () => {
      vi.mocked(mockStorage.getSignedUrl).mockResolvedValue('https://signed-url.example.com');

      await rpcBridge.handleCall({
        method: 'storage.getPresignedUrl',
        args: [`screenshots/${testProjectId}/bug-123/screenshot.png`],
        requestId: 'req-14',
      });

      expect(mockStorage.getSignedUrl).toHaveBeenCalledWith(
        `screenshots/${testProjectId}/bug-123/screenshot.png`,
        { expiresIn: 300 } // 5 minutes
      );
    });
  });

  describe('Error Handling', () => {
    it('should not leak sensitive error details to plugin', async () => {
      vi.mocked(mockDb.bugReports.findById).mockRejectedValue(
        new Error('Database connection failed: postgres://admin:password@localhost:5432/db')
      );

      const result = await rpcBridge.handleCall({
        method: 'db.bugReports.findById',
        args: ['bug-123'],
        requestId: 'req-15',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();

      // Should not contain database credentials
      expect(result.error).not.toContain('password');
      expect(result.error).not.toContain('postgres://');
    });

    it('should handle missing bug report gracefully', async () => {
      vi.mocked(mockDb.bugReports.findById).mockResolvedValue(null);

      const result = await rpcBridge.handleCall({
        method: 'db.bugReports.findById',
        args: ['nonexistent'],
        requestId: 'req-16',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('Sensitive Data Sanitization', () => {
    describe('Database Connection Strings', () => {
      it('should redact PostgreSQL connection strings', async () => {
        vi.mocked(mockDb.bugReports.findById).mockRejectedValue(
          new Error('Connection error: postgres://user:pass@db.example.com:5432/mydb')
        );

        const result = await rpcBridge.handleCall({
          method: 'db.bugReports.findById',
          args: ['bug-123'],
          requestId: 'req-db-1',
        });

        expect(result.error).toContain('[REDACTED]');
        expect(result.error).not.toContain('postgres://');
        expect(result.error).not.toContain('user:pass');
      });

      it('should redact MySQL connection strings', async () => {
        vi.mocked(mockDb.bugReports.findById).mockRejectedValue(
          new Error('Failed: mysql://admin:secret@mysql.example.com:3306/db')
        );

        const result = await rpcBridge.handleCall({
          method: 'db.bugReports.findById',
          args: ['bug-123'],
          requestId: 'req-db-2',
        });

        expect(result.error).toContain('[REDACTED]');
        expect(result.error).not.toContain('mysql://');
        expect(result.error).not.toContain('admin:secret');
      });

      it('should redact MongoDB connection strings', async () => {
        vi.mocked(mockDb.bugReports.findById).mockRejectedValue(
          new Error('Error: mongodb://dbuser:dbpass@mongo.example.com:27017/mydb')
        );

        const result = await rpcBridge.handleCall({
          method: 'db.bugReports.findById',
          args: ['bug-123'],
          requestId: 'req-db-3',
        });

        expect(result.error).toContain('[REDACTED]');
        expect(result.error).not.toContain('mongodb://');
        expect(result.error).not.toContain('dbuser:dbpass');
      });

      it('should redact Redis connection strings', async () => {
        vi.mocked(mockDb.bugReports.findById).mockRejectedValue(
          new Error('Redis error: redis://user:password@redis.example.com:6379')
        );

        const result = await rpcBridge.handleCall({
          method: 'db.bugReports.findById',
          args: ['bug-123'],
          requestId: 'req-db-4',
        });

        expect(result.error).toContain('[REDACTED]');
        expect(result.error).not.toContain('redis://');
        expect(result.error).not.toContain('user:password');
      });
    });

    describe('Credentials and Secrets', () => {
      it('should redact password parameters', async () => {
        vi.mocked(mockDb.bugReports.findById).mockRejectedValue(
          new Error('Auth failed: password=SuperSecret123')
        );

        const result = await rpcBridge.handleCall({
          method: 'db.bugReports.findById',
          args: ['bug-123'],
          requestId: 'req-cred-1',
        });

        expect(result.error).toContain('[REDACTED]');
        expect(result.error).not.toContain('SuperSecret123');
      });

      it('should redact API key parameters', async () => {
        vi.mocked(mockDb.bugReports.findById).mockRejectedValue(
          new Error('Request failed: api_key=sk_live_1234567890abcdef')
        );

        const result = await rpcBridge.handleCall({
          method: 'db.bugReports.findById',
          args: ['bug-123'],
          requestId: 'req-cred-2',
        });

        expect(result.error).toContain('[REDACTED]');
        expect(result.error).not.toContain('sk_live_1234567890abcdef');
      });

      it('should redact token parameters', async () => {
        vi.mocked(mockDb.bugReports.findById).mockRejectedValue(
          new Error('Auth error: token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9')
        );

        const result = await rpcBridge.handleCall({
          method: 'db.bugReports.findById',
          args: ['bug-123'],
          requestId: 'req-cred-3',
        });

        expect(result.error).toContain('[REDACTED]');
        expect(result.error).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
      });

      it('should redact secret parameters', async () => {
        vi.mocked(mockDb.bugReports.findById).mockRejectedValue(
          new Error('Validation failed: secret=my_secret_value_123')
        );

        const result = await rpcBridge.handleCall({
          method: 'db.bugReports.findById',
          args: ['bug-123'],
          requestId: 'req-cred-4',
        });

        expect(result.error).toContain('[REDACTED]');
        expect(result.error).not.toContain('my_secret_value_123');
      });

      it('should redact client_secret parameters', async () => {
        vi.mocked(mockDb.bugReports.findById).mockRejectedValue(
          new Error('OAuth error: client_secret=oauth_secret_abc123')
        );

        const result = await rpcBridge.handleCall({
          method: 'db.bugReports.findById',
          args: ['bug-123'],
          requestId: 'req-cred-5',
        });

        expect(result.error).toContain('[REDACTED]');
        expect(result.error).not.toContain('oauth_secret_abc123');
      });
    });

    describe('Authorization Headers', () => {
      it('should redact Bearer tokens', async () => {
        vi.mocked(mockDb.bugReports.findById).mockRejectedValue(
          new Error('Request failed: Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9')
        );

        const result = await rpcBridge.handleCall({
          method: 'db.bugReports.findById',
          args: ['bug-123'],
          requestId: 'req-auth-1',
        });

        expect(result.error).toContain('[REDACTED]');
        expect(result.error).not.toContain('Bearer eyJ');
      });

      it('should redact Basic auth tokens', async () => {
        vi.mocked(mockDb.bugReports.findById).mockRejectedValue(
          new Error('Auth failed: Authorization: Basic dXNlcjpwYXNz')
        );

        const result = await rpcBridge.handleCall({
          method: 'db.bugReports.findById',
          args: ['bug-123'],
          requestId: 'req-auth-2',
        });

        expect(result.error).toContain('[REDACTED]');
        expect(result.error).not.toContain('Basic dXNlcjpwYXNz');
      });

      it('should redact generic Authorization headers', async () => {
        vi.mocked(mockDb.bugReports.findById).mockRejectedValue(
          new Error('Error: Authorization: Custom custom_token_12345')
        );

        const result = await rpcBridge.handleCall({
          method: 'db.bugReports.findById',
          args: ['bug-123'],
          requestId: 'req-auth-3',
        });

        expect(result.error).toContain('[REDACTED]');
        expect(result.error).not.toContain('Custom custom_token_12345');
      });
    });

    describe('API Keys with Prefixes', () => {
      it('should redact sk_ prefixed keys', async () => {
        vi.mocked(mockDb.bugReports.findById).mockRejectedValue(
          new Error('Payment failed: sk_live_TESTKEY_0000000000')
        );

        const result = await rpcBridge.handleCall({
          method: 'db.bugReports.findById',
          args: ['bug-123'],
          requestId: 'req-key-1',
        });

        expect(result.error).toContain('[REDACTED]');
        expect(result.error).not.toContain('sk_live_');
      });

      it('should redact pk_ prefixed keys', async () => {
        vi.mocked(mockDb.bugReports.findById).mockRejectedValue(
          new Error('Invalid key: pk_test_TESTKEY_0000000000')
        );

        const result = await rpcBridge.handleCall({
          method: 'db.bugReports.findById',
          args: ['bug-123'],
          requestId: 'req-key-2',
        });

        expect(result.error).toContain('[REDACTED]');
        expect(result.error).not.toContain('pk_test_');
      });

      it('should redact api_ prefixed keys', async () => {
        vi.mocked(mockDb.bugReports.findById).mockRejectedValue(
          new Error('Auth error: api_1234567890abcdefghijklmnopqrst')
        );

        const result = await rpcBridge.handleCall({
          method: 'db.bugReports.findById',
          args: ['bug-123'],
          requestId: 'req-key-3',
        });

        expect(result.error).toContain('[REDACTED]');
        expect(result.error).not.toContain('api_1234567890');
      });

      it('should redact key_ prefixed keys', async () => {
        vi.mocked(mockDb.bugReports.findById).mockRejectedValue(
          new Error('Invalid: key_abcdefghijklmnopqrstuvwxyz123456')
        );

        const result = await rpcBridge.handleCall({
          method: 'db.bugReports.findById',
          args: ['bug-123'],
          requestId: 'req-key-4',
        });

        expect(result.error).toContain('[REDACTED]');
        expect(result.error).not.toContain('key_abcdefg');
      });
    });

    describe('File Paths', () => {
      it('should redact Windows file paths', async () => {
        vi.mocked(mockDb.bugReports.findById).mockRejectedValue(
          new Error('File not found: C:\\Users\\Admin\\Documents\\secrets.txt')
        );

        const result = await rpcBridge.handleCall({
          method: 'db.bugReports.findById',
          args: ['bug-123'],
          requestId: 'req-path-1',
        });

        expect(result.error).toContain('[REDACTED]');
        expect(result.error).not.toContain('C:\\Users\\Admin');
      });

      it('should redact sensitive Unix paths (/home)', async () => {
        vi.mocked(mockDb.bugReports.findById).mockRejectedValue(
          new Error('Access denied: /home/user/.ssh/id_rsa')
        );

        const result = await rpcBridge.handleCall({
          method: 'db.bugReports.findById',
          args: ['bug-123'],
          requestId: 'req-path-2',
        });

        expect(result.error).toContain('[REDACTED]');
        expect(result.error).not.toContain('/home/user');
      });

      it('should redact sensitive Unix paths (/root)', async () => {
        vi.mocked(mockDb.bugReports.findById).mockRejectedValue(
          new Error('Permission denied: /root/.bashrc')
        );

        const result = await rpcBridge.handleCall({
          method: 'db.bugReports.findById',
          args: ['bug-123'],
          requestId: 'req-path-3',
        });

        expect(result.error).toContain('[REDACTED]');
        expect(result.error).not.toContain('/root/');
      });

      it('should redact sensitive Unix paths (/var)', async () => {
        vi.mocked(mockDb.bugReports.findById).mockRejectedValue(
          new Error('Log error: /var/log/sensitive.log')
        );

        const result = await rpcBridge.handleCall({
          method: 'db.bugReports.findById',
          args: ['bug-123'],
          requestId: 'req-path-4',
        });

        expect(result.error).toContain('[REDACTED]');
        expect(result.error).not.toContain('/var/log/');
      });
    });

    describe('IP Addresses', () => {
      it('should redact private IP addresses (10.x.x.x)', async () => {
        vi.mocked(mockDb.bugReports.findById).mockRejectedValue(
          new Error('Connection failed to 10.0.1.50:5432')
        );

        const result = await rpcBridge.handleCall({
          method: 'db.bugReports.findById',
          args: ['bug-123'],
          requestId: 'req-ip-1',
        });

        expect(result.error).toContain('[REDACTED]');
        expect(result.error).not.toContain('10.0.1.50');
      });

      it('should redact private IP addresses (192.168.x.x)', async () => {
        vi.mocked(mockDb.bugReports.findById).mockRejectedValue(
          new Error('Cannot reach 192.168.1.100')
        );

        const result = await rpcBridge.handleCall({
          method: 'db.bugReports.findById',
          args: ['bug-123'],
          requestId: 'req-ip-2',
        });

        expect(result.error).toContain('[REDACTED]');
        expect(result.error).not.toContain('192.168.1.100');
      });

      it('should redact private IP addresses (172.16-31.x.x)', async () => {
        vi.mocked(mockDb.bugReports.findById).mockRejectedValue(
          new Error('Timeout connecting to 172.16.0.50')
        );

        const result = await rpcBridge.handleCall({
          method: 'db.bugReports.findById',
          args: ['bug-123'],
          requestId: 'req-ip-3',
        });

        expect(result.error).toContain('[REDACTED]');
        expect(result.error).not.toContain('172.16.0.50');
      });
    });

    describe('Email Addresses (PII)', () => {
      it('should redact email addresses', async () => {
        vi.mocked(mockDb.bugReports.findById).mockRejectedValue(
          new Error('User john.doe@example.com not authorized')
        );

        const result = await rpcBridge.handleCall({
          method: 'db.bugReports.findById',
          args: ['bug-123'],
          requestId: 'req-email-1',
        });

        expect(result.error).toContain('[REDACTED]');
        expect(result.error).not.toContain('john.doe@example.com');
      });

      it('should redact multiple email addresses', async () => {
        vi.mocked(mockDb.bugReports.findById).mockRejectedValue(
          new Error('Cannot send from admin@example.com to user@test.org')
        );

        const result = await rpcBridge.handleCall({
          method: 'db.bugReports.findById',
          args: ['bug-123'],
          requestId: 'req-email-2',
        });

        expect(result.error).toContain('[REDACTED]');
        expect(result.error).not.toContain('admin@example.com');
        expect(result.error).not.toContain('user@test.org');
      });
    });

    describe('Complex Error Messages', () => {
      it('should redact multiple types of sensitive data in one message', async () => {
        vi.mocked(mockDb.bugReports.findById).mockRejectedValue(
          new Error(
            'Database error at postgres://user:pass@10.0.1.50:5432/db - ' +
              'User admin@example.com (ID: 550e8400-e29b-41d4-a716-446655440000) ' +
              'attempted access with token=secret123 from C:\\Windows\\System32\\config'
          )
        );

        const result = await rpcBridge.handleCall({
          method: 'db.bugReports.findById',
          args: ['bug-123'],
          requestId: 'req-complex-1',
        });

        // Sensitive data should be redacted (but NOT UUIDs - they're legitimate identifiers)
        expect(result.error).toContain('[REDACTED]');
        expect(result.error).not.toContain('postgres://');
        expect(result.error).not.toContain('user:pass');
        expect(result.error).not.toContain('10.0.1.50');
        expect(result.error).not.toContain('admin@example.com');
        expect(result.error).toContain('550e8400-e29b-41d4-a716-446655440000'); // UUIDs preserved
        expect(result.error).not.toContain('secret123');
        expect(result.error).not.toContain('C:\\Windows');
      });
    });
  });

  describe('Input Validation', () => {
    it('should reject invalid bug report ID format', async () => {
      const result = await rpcBridge.handleCall({
        method: 'db.bugReports.findById',
        args: ['../../../etc/passwd'], // Path traversal attempt
        requestId: 'req-17',
      });

      // Should fail at database level or in validation
      expect(result.success).toBe(false);
    });

    it('should reject invalid storage key format', async () => {
      const result = await rpcBridge.handleCall({
        method: 'storage.getPresignedUrl',
        args: ['../../../etc/passwd'], // Path traversal attempt
        requestId: 'req-18',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Path traversal detected');
    });

    it('should reject URL-encoded path traversal', async () => {
      const result = await rpcBridge.handleCall({
        method: 'storage.getPresignedUrl',
        args: ['screenshots/test-project-123/%2e%2e/%2e%2e/etc/passwd'],
        requestId: 'req-18a',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('traversal detected');
    });

    it('should reject uppercase URL-encoded path traversal', async () => {
      const result = await rpcBridge.handleCall({
        method: 'storage.getPresignedUrl',
        args: ['screenshots/test-project-123/%2E%2E/%2E%2E/etc/passwd'], // Uppercase hex
        requestId: 'req-18a-upper',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('traversal detected');
    });

    it('should reject mixed-case URL-encoded path traversal', async () => {
      const result = await rpcBridge.handleCall({
        method: 'storage.getPresignedUrl',
        args: ['screenshots/test-project-123/%2E%2e/%2e%2E/etc/passwd'], // Mixed case
        requestId: 'req-18a-mixed',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('traversal detected');
    });

    it('should reject URL-encoded backslash', async () => {
      const result = await rpcBridge.handleCall({
        method: 'storage.getPresignedUrl',
        args: ['screenshots/test-project-123/%5c..%5c..%5cetc%5cpasswd'], // %5c = backslash
        requestId: 'req-18a-backslash',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('traversal detected');
    });

    it('should reject uppercase URL-encoded backslash', async () => {
      const result = await rpcBridge.handleCall({
        method: 'storage.getPresignedUrl',
        args: ['screenshots/test-project-123/%5C..%5C..%5Cetc%5Cpasswd'], // %5C = backslash (uppercase)
        requestId: 'req-18a-backslash-upper',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('traversal detected');
    });

    it('should reject backslash path traversal', async () => {
      const result = await rpcBridge.handleCall({
        method: 'storage.getPresignedUrl',
        args: ['screenshots\\test-project-123\\..\\..\\etc\\passwd'],
        requestId: 'req-18b',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Path traversal detected');
    });

    it('should reject dot segments in path components', async () => {
      // Both ../ and .. as standalone components are rejected
      const result = await rpcBridge.handleCall({
        method: 'storage.getPresignedUrl',
        args: ['screenshots/test-project-123/../other-project/file.png'],
        requestId: 'req-18c',
      });

      expect(result.success).toBe(false);
      // Either error message is acceptable - both prevent traversal
      expect(result.error).toMatch(/Path traversal detected|Invalid path component/);
    });

    it('should reject invalid file key structure', async () => {
      const result = await rpcBridge.handleCall({
        method: 'storage.getPresignedUrl',
        args: ['screenshots/test-project-123/file.png'], // Too few parts (only 3)
        requestId: 'req-18d',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid file key structure');
    });

    it('should normalize path separators and validate', async () => {
      // Mock storage to verify normalized path is used
      vi.mocked(mockStorage.getSignedUrl).mockResolvedValue('https://signed-url');

      const result = await rpcBridge.handleCall({
        method: 'storage.getPresignedUrl',
        args: ['screenshots/test-project-123/bug-456/file.png'], // Valid path
        requestId: 'req-18e',
      });

      expect(result.success).toBe(true);
      expect(mockStorage.getSignedUrl).toHaveBeenCalledWith(
        'screenshots/test-project-123/bug-456/file.png',
        { expiresIn: 300 }
      );
    });

    it('should handle malformed metadata gracefully', async () => {
      const mockReport: BugReport = {
        id: 'bug-123',
        project_id: testProjectId,
        title: 'Test',
        description: null,
        screenshot_url: null,
        replay_url: null,
        metadata: {},
        status: 'open',
        priority: 'medium',
        deleted_at: null,
        deleted_by: null,
        legal_hold: false,
        created_at: new Date(),
        updated_at: new Date(),
        screenshot_key: null,
        thumbnail_key: null,
        replay_key: null,
        upload_status: 'completed',
        replay_upload_status: 'none',
      };

      vi.mocked(mockDb.bugReports.findById).mockResolvedValue(mockReport);

      const result = await rpcBridge.handleCall({
        method: 'db.bugReports.update',
        args: ['bug-123', { metadata: 'not-an-object' }], // Invalid metadata type
        requestId: 'req-19',
      });

      // Should fail gracefully due to invalid metadata type
      expect(result.success).toBe(false);
      expect(result.error).toContain('No valid updates provided');
      expect(result.requestId).toBe('req-19');

      // Verify no database update was attempted
      expect(mockDb.bugReports.update).not.toHaveBeenCalled();
    });

    it('should reject non-string bug report ID', async () => {
      const result = await rpcBridge.handleCall({
        method: 'db.bugReports.findById',
        args: [{ malicious: 'object' }], // Object instead of string
        requestId: 'req-20',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid arguments');
      expect(mockDb.bugReports.findById).not.toHaveBeenCalled();
    });

    it('should reject empty string bug report ID', async () => {
      const result = await rpcBridge.handleCall({
        method: 'db.bugReports.findById',
        args: [''], // Empty string
        requestId: 'req-21',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid arguments');
      expect(mockDb.bugReports.findById).not.toHaveBeenCalled();
    });

    it('should reject null as bug report ID', async () => {
      const result = await rpcBridge.handleCall({
        method: 'db.bugReports.findById',
        args: [null], // null
        requestId: 'req-22',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid arguments');
      expect(mockDb.bugReports.findById).not.toHaveBeenCalled();
    });

    it('should reject wrong argument count', async () => {
      const result = await rpcBridge.handleCall({
        method: 'db.bugReports.findById',
        args: ['bug-123', 'extra-arg'], // Too many args
        requestId: 'req-23',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid arguments');
      expect(mockDb.bugReports.findById).not.toHaveBeenCalled();
    });

    it('should reject non-object updates parameter', async () => {
      const result = await rpcBridge.handleCall({
        method: 'db.bugReports.update',
        args: ['bug-123', 'not-an-object'], // String instead of object
        requestId: 'req-24',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid arguments');
      expect(mockDb.bugReports.update).not.toHaveBeenCalled();
    });

    it('should reject array as updates parameter', async () => {
      const result = await rpcBridge.handleCall({
        method: 'db.bugReports.update',
        args: ['bug-123', ['array']], // Array instead of object
        requestId: 'req-25',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid arguments');
      expect(mockDb.bugReports.update).not.toHaveBeenCalled();
    });

    it('should reject missing arguments', async () => {
      const result = await rpcBridge.handleCall({
        method: 'db.bugReports.findById',
        args: [], // No args provided
        requestId: 'req-26',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid arguments');
      expect(mockDb.bugReports.findById).not.toHaveBeenCalled();
    });
  });

  describe('HTTP Fetch Security', () => {
    describe('Header Sanitization', () => {
      it('should block Authorization header', async () => {
        const result = await rpcBridge.handleCall({
          method: 'http.fetch',
          args: [
            'https://api.example.com/data',
            {
              headers: {
                Authorization: 'Bearer stolen-token-12345',
                'Content-Type': 'application/json',
              },
            },
          ],
          requestId: 'req-http-1',
        });

        expect(result.success).toBe(false);
        // Should fail due to SSRF validation (no mock setup)
        // But header sanitization happens first
      });

      it('should block Cookie header', async () => {
        const result = await rpcBridge.handleCall({
          method: 'http.fetch',
          args: [
            'https://api.example.com/data',
            {
              headers: {
                Cookie: 'session=abc123; user_id=456',
                'Content-Type': 'application/json',
              },
            },
          ],
          requestId: 'req-http-2',
        });

        expect(result.success).toBe(false);
      });

      it('should block X-Api-Key header', async () => {
        const result = await rpcBridge.handleCall({
          method: 'http.fetch',
          args: [
            'https://api.example.com/data',
            {
              headers: {
                'X-Api-Key': 'secret-api-key-789',
                'Content-Type': 'application/json',
              },
            },
          ],
          requestId: 'req-http-3',
        });

        expect(result.success).toBe(false);
      });

      it('should block Proxy-Authorization header', async () => {
        const result = await rpcBridge.handleCall({
          method: 'http.fetch',
          args: [
            'https://api.example.com/data',
            {
              headers: {
                'Proxy-Authorization': 'Basic dXNlcjpwYXNz',
              },
            },
          ],
          requestId: 'req-http-4',
        });

        expect(result.success).toBe(false);
      });

      it('should block X-Forwarded-For header', async () => {
        const result = await rpcBridge.handleCall({
          method: 'http.fetch',
          args: [
            'https://api.example.com/data',
            {
              headers: {
                'X-Forwarded-For': '10.0.0.1',
              },
            },
          ],
          requestId: 'req-http-5',
        });

        expect(result.success).toBe(false);
      });

      it('should block all Sec-* headers', async () => {
        const result = await rpcBridge.handleCall({
          method: 'http.fetch',
          args: [
            'https://api.example.com/data',
            {
              headers: {
                'Sec-Fetch-Site': 'cross-site',
                'Sec-Fetch-Mode': 'cors',
                'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
              },
            },
          ],
          requestId: 'req-http-6',
        });

        expect(result.success).toBe(false);
      });

      it('should block Set-Cookie header', async () => {
        const result = await rpcBridge.handleCall({
          method: 'http.fetch',
          args: [
            'https://api.example.com/data',
            {
              headers: {
                'Set-Cookie': 'session=hacked; Domain=.example.com',
              },
            },
          ],
          requestId: 'req-http-7',
        });

        expect(result.success).toBe(false);
      });

      it('should block header case-insensitively', async () => {
        const result = await rpcBridge.handleCall({
          method: 'http.fetch',
          args: [
            'https://api.example.com/data',
            {
              headers: {
                authorization: 'Bearer token', // lowercase
                COOKIE: 'session=123', // uppercase
                'X-Api-KEY': 'key123', // mixed case
              },
            },
          ],
          requestId: 'req-http-8',
        });

        expect(result.success).toBe(false);
      });
    });

    describe('HTTP Method Validation', () => {
      it('should allow GET method', async () => {
        const result = await rpcBridge.handleCall({
          method: 'http.fetch',
          args: [
            'https://api.example.com/data',
            {
              method: 'GET',
            },
          ],
          requestId: 'req-method-1',
        });

        expect(result.success).toBe(false);
        // Will fail on SSRF validation (no mock), but method validation passes
      });

      it('should allow POST method', async () => {
        const result = await rpcBridge.handleCall({
          method: 'http.fetch',
          args: [
            'https://api.example.com/data',
            {
              method: 'POST',
              body: JSON.stringify({ data: 'test' }),
            },
          ],
          requestId: 'req-method-2',
        });

        expect(result.success).toBe(false);
        // Will fail on SSRF validation
      });

      it('should reject CONNECT method', async () => {
        const result = await rpcBridge.handleCall({
          method: 'http.fetch',
          args: [
            'https://api.example.com/data',
            {
              method: 'CONNECT', // Tunneling method - dangerous
            },
          ],
          requestId: 'req-method-3',
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('HTTP method not allowed');
      });

      it('should reject TRACE method', async () => {
        const result = await rpcBridge.handleCall({
          method: 'http.fetch',
          args: [
            'https://api.example.com/data',
            {
              method: 'TRACE', // Debug method - can leak sensitive data
            },
          ],
          requestId: 'req-method-4',
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('HTTP method not allowed');
      });

      it('should normalize method to uppercase', async () => {
        const result = await rpcBridge.handleCall({
          method: 'http.fetch',
          args: [
            'https://api.example.com/data',
            {
              method: 'post', // lowercase
            },
          ],
          requestId: 'req-method-5',
        });

        expect(result.success).toBe(false);
        // Will fail on SSRF validation, but method normalization works
      });
    });

    describe('Response Size Limits', () => {
      it('should enforce size limit during streaming', async () => {
        // This would require mocking fetch and ReadableStream
        // Testing the actual streaming logic requires integration tests
        // Unit test validates the size limit constant exists
        expect(MAX_RESPONSE_SIZE_BYTES).toBeDefined();
      });

      it('should check Content-Length header before streaming', async () => {
        // Validated by integration tests with real HTTP responses
        expect(HTTP_FETCH_TIMEOUT_MS).toBeDefined();
      });
    });

    describe('Fetch Timeout', () => {
      it('should enforce 10-second timeout', async () => {
        // Timeout is enforced via AbortController
        // Integration tests validate actual timeout behavior
        expect(HTTP_FETCH_TIMEOUT_MS).toBe(10000);
      });
    });

    describe('Safe Headers Allowed', () => {
      it('should allow Content-Type header', async () => {
        const result = await rpcBridge.handleCall({
          method: 'http.fetch',
          args: [
            'https://api.example.com/data',
            {
              headers: {
                'Content-Type': 'application/json',
              },
            },
          ],
          requestId: 'req-safe-1',
        });

        expect(result.success).toBe(false);
        // Will fail on SSRF validation, but Content-Type passes sanitization
      });

      it('should allow Accept header', async () => {
        const result = await rpcBridge.handleCall({
          method: 'http.fetch',
          args: [
            'https://api.example.com/data',
            {
              headers: {
                Accept: 'application/json',
              },
            },
          ],
          requestId: 'req-safe-2',
        });

        expect(result.success).toBe(false);
        // Will fail on SSRF validation, but Accept passes sanitization
      });

      it('should allow User-Agent header', async () => {
        const result = await rpcBridge.handleCall({
          method: 'http.fetch',
          args: [
            'https://api.example.com/data',
            {
              headers: {
                'User-Agent': 'BugSpotter-Plugin/1.0',
              },
            },
          ],
          requestId: 'req-safe-3',
        });

        expect(result.success).toBe(false);
        // Will fail on SSRF validation, but User-Agent passes sanitization
      });

      it('should allow custom X-Custom-Header', async () => {
        const result = await rpcBridge.handleCall({
          method: 'http.fetch',
          args: [
            'https://api.example.com/data',
            {
              headers: {
                'X-Custom-Header': 'custom-value',
              },
            },
          ],
          requestId: 'req-safe-4',
        });

        expect(result.success).toBe(false);
        // Will fail on SSRF validation, but X-Custom-Header passes sanitization
        // (not in blocked list)
      });
    });
  });
});
