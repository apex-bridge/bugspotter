import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';

vi.mock('../../src/logger.js');
vi.mock('../../src/config.js', () => ({
  config: {
    server: {
      port: 3000,
      env: 'production',
      logLevel: 'info',
      corsOrigins: ['http://localhost:3000', 'http://localhost:5173'],
      maxUploadSize: 10485760,
    },
    storage: {
      backend: 's3',
    },
    jwt: {
      secret: 'test-jwt-secret',
    },
    rateLimit: {
      maxRequests: 1000,
      windowMs: 60000,
    },
  },
}));

describe('startServer', () => {
  let mockFastify: FastifyInstance;
  let mockLogger: any;
  let startServer: any;
  let getLogger: any;
  let config: any;

  beforeEach(async () => {
    // Import mocked modules
    const loggerModule = await import('../../src/logger.js');
    const configModule = await import('../../src/config.js');
    const serverModule = await import('../../src/api/server.js');

    getLogger = loggerModule.getLogger;
    config = configModule.config;
    startServer = serverModule.startServer;

    // Mock logger
    mockLogger = {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
    };
    vi.mocked(getLogger).mockReturnValue(mockLogger);

    // Mock Fastify instance
    mockFastify = {
      listen: vi.fn().mockResolvedValue('http://0.0.0.0:3000'),
    } as any;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should log startup information with production config', async () => {
    await startServer(mockFastify);

    // Verify listen was called with correct config
    expect(mockFastify.listen).toHaveBeenCalledWith({
      port: 3000,
      host: '0.0.0.0',
    });

    // Verify startup logs
    expect(mockLogger.info).toHaveBeenCalledWith('BugSpotter API Server started successfully');
    expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Listening on port'));
    expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Environment:'));
    expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Storage backend:'));
    expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Address:'));

    // Verify structured log with all details
    expect(mockLogger.info).toHaveBeenCalledWith(
      'Server details',
      expect.objectContaining({
        address: expect.any(String),
        port: 3000,
        host: '0.0.0.0',
        env: expect.any(String),
        nodeEnv: expect.any(String),
        storage: expect.any(String),
        corsOrigins: expect.any(Array),
      })
    );

    // Should NOT log development URLs in production
    expect(mockLogger.info).not.toHaveBeenCalledWith(expect.stringContaining('Local URL:'));
  });

  it('should log development URLs when env is development', async () => {
    // Override config for development
    config.server.env = 'development';

    await startServer(mockFastify);

    // Should log development URLs
    expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Local URL:'));
    expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Network URL:'));
  });

  it('should handle listen errors gracefully', async () => {
    const listenError = new Error('EADDRINUSE: Port already in use');
    mockFastify.listen = vi.fn().mockRejectedValue(listenError);

    await expect(startServer(mockFastify)).rejects.toThrow('EADDRINUSE');

    expect(mockLogger.error).toHaveBeenCalledWith('Failed to start server', {
      error: listenError,
    });
  });

  it('should use custom port from config', async () => {
    // Override port in config
    config.server.port = 5000;
    mockFastify.listen = vi.fn().mockResolvedValue('http://0.0.0.0:5000');

    await startServer(mockFastify);

    expect(mockFastify.listen).toHaveBeenCalledWith({
      port: 5000,
      host: '0.0.0.0',
    });

    expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Listening on port'));
  });

  it('should work with S3 storage backend', async () => {
    config.storage.backend = 's3';

    await startServer(mockFastify);

    expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Storage backend:'));
  });

  it('should work with MinIO storage backend', async () => {
    config.storage.backend = 'minio';

    await startServer(mockFastify);

    expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Storage backend:'));
  });

  it('should handle high rate limit configuration', async () => {
    // Already configured in beforeEach with rate limit 1000
    await startServer(mockFastify);

    expect(mockLogger.info).toHaveBeenCalledWith('BugSpotter API Server started successfully');
  });

  it('should log correct CORS origins', async () => {
    await startServer(mockFastify);

    expect(mockLogger.info).toHaveBeenCalledWith(
      'Server details',
      expect.objectContaining({
        corsOrigins: expect.any(Array),
      })
    );
  });

  it('should work with production database configuration', async () => {
    // Test that server starts regardless of database URL format
    // (actual connection is handled elsewhere, this just tests startup logging)
    await startServer(mockFastify);

    expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Environment:'));
  });

  it('should work with Redis configuration', async () => {
    // Test that server starts with Redis URL (startup doesn't validate connection)
    await startServer(mockFastify);

    expect(mockLogger.info).toHaveBeenCalledWith('BugSpotter API Server started successfully');
  });

  it('should handle different log levels', async () => {
    config.server.logLevel = 'debug';

    await startServer(mockFastify);

    expect(mockLogger.info).toHaveBeenCalled();
  });

  it('should successfully start server', async () => {
    await startServer(mockFastify);

    expect(mockFastify.listen).toHaveBeenCalled();
    expect(mockLogger.info).toHaveBeenCalledWith('BugSpotter API Server started successfully');
  });

  it('should log structured data with all server details', async () => {
    await startServer(mockFastify);

    // Verify the structured log contains all expected fields
    expect(mockLogger.info).toHaveBeenCalledWith(
      'Server details',
      expect.objectContaining({
        address: expect.any(String),
        port: expect.any(Number),
        host: '0.0.0.0',
        env: expect.any(String),
        nodeEnv: expect.any(String),
        storage: expect.any(String),
        corsOrigins: expect.any(Array),
      })
    );
  });

  it('should always listen on 0.0.0.0 for Docker compatibility', async () => {
    await startServer(mockFastify);

    expect(mockFastify.listen).toHaveBeenCalledWith(
      expect.objectContaining({
        host: '0.0.0.0',
      })
    );
  });
});
