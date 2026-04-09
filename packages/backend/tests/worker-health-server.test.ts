/**
 * Worker Health Server Tests
 * Tests the lightweight HTTP health check server used by the worker process
 */

import { describe, it, expect, vi, afterAll } from 'vitest';
import http from 'node:http';
import { createWorkerHealthServer } from '../src/worker.js';

// Mock logger (imported transitively by worker.ts)
vi.mock('../src/logger.js', () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
  setLogger: vi.fn(),
}));

function fetchRaw(
  url: string,
  method = 'GET',
  extraHeaders?: Record<string, string>
): Promise<{ status: number; headers: http.IncomingHttpHeaders; text: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method, headers: extraHeaders }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        resolve({ status: res.statusCode!, headers: res.headers, text: data });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function fetch(
  url: string,
  method = 'GET'
): Promise<{ status: number; body: Record<string, unknown> }> {
  return fetchRaw(url, method).then(({ status, text }) => ({
    status,
    body: text ? JSON.parse(text) : {},
  }));
}

function createMockDeps(overrides?: {
  workerHealthy?: boolean;
  redisHealthy?: boolean;
  dbHealthy?: boolean;
}) {
  const { workerHealthy = true, redisHealthy = true, dbHealthy = true } = overrides ?? {};

  return {
    workerManager: {
      healthCheck: vi.fn().mockResolvedValue({
        healthy: workerHealthy,
        workers: { screenshot: workerHealthy, replay: workerHealthy },
      }),
    },
    queueManager: {
      healthCheck: vi.fn().mockResolvedValue(redisHealthy),
    },
    db: {
      testConnection: vi.fn().mockResolvedValue(dbHealthy),
    },
  };
}

describe('Worker Health Server', () => {
  const servers: http.Server[] = [];

  function startServer(
    overrides?: Parameters<typeof createMockDeps>[0]
  ): Promise<{ url: string; deps: ReturnType<typeof createMockDeps> }> {
    const deps = createMockDeps(overrides);
    return startServerWithDeps(deps);
  }

  function startServerWithDeps(
    deps: ReturnType<typeof createMockDeps>
  ): Promise<{ url: string; deps: ReturnType<typeof createMockDeps> }> {
    const server = createWorkerHealthServer(deps.workerManager, deps.queueManager, deps.db);
    servers.push(server);

    return new Promise((resolve) => {
      server.listen(0, () => {
        const port = (server.address() as { port: number }).port;
        resolve({ url: `http://127.0.0.1:${port}`, deps });
      });
    });
  }

  afterAll(() =>
    Promise.all(servers.map((s) => new Promise<void>((resolve) => s.close(() => resolve()))))
  );

  it('should respond 200 on /health (liveness)', async () => {
    const { url } = await startServer();
    const res = await fetch(`${url}/health`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.timestamp).toBeDefined();
  });

  it('should respond 200 on /ready when all checks pass', async () => {
    const { url } = await startServer();
    const res = await fetch(`${url}/ready`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ready');
    expect(res.body.checks).toEqual({
      workers: 'healthy',
      redis: 'healthy',
      database: 'healthy',
    });
  });

  it('should respond 503 on /ready when Redis is down', async () => {
    const { url } = await startServer({ redisHealthy: false });
    const res = await fetch(`${url}/ready`);

    expect(res.status).toBe(503);
    expect(res.body.status).toBe('unavailable');
    expect(res.body.checks).toEqual({
      workers: 'healthy',
      redis: 'unhealthy',
      database: 'healthy',
    });
  });

  it('should respond 503 on /ready when database is down', async () => {
    const { url } = await startServer({ dbHealthy: false });
    const res = await fetch(`${url}/ready`);

    expect(res.status).toBe(503);
    expect(res.body.status).toBe('unavailable');
    expect(res.body.checks).toEqual({
      workers: 'healthy',
      redis: 'healthy',
      database: 'unhealthy',
    });
  });

  it('should respond 503 on /ready when workers are unhealthy', async () => {
    const { url } = await startServer({ workerHealthy: false });
    const res = await fetch(`${url}/ready`);

    expect(res.status).toBe(503);
    expect(res.body.status).toBe('unavailable');
    expect(res.body.checks).toEqual({
      workers: 'unhealthy',
      redis: 'healthy',
      database: 'healthy',
    });
  });

  it('should respond 404 on unknown paths', async () => {
    const { url } = await startServer();
    const res = await fetch(`${url}/unknown`);

    expect(res.status).toBe(404);
  });

  it('should respond 405 on non-GET requests', async () => {
    const { url } = await startServer();
    const res = await fetch(`${url}/health`, 'POST');

    expect(res.status).toBe(405);
  });

  it('should respond 503 when Redis health check throws', async () => {
    const deps = createMockDeps();
    deps.queueManager.healthCheck.mockRejectedValue(new Error('ECONNREFUSED'));
    const { url } = await startServerWithDeps(deps);
    const res = await fetch(`${url}/ready`);

    expect(res.status).toBe(503);
    expect(res.body.status).toBe('unavailable');
    expect(res.body.checks).toEqual({
      workers: 'healthy',
      redis: 'unhealthy',
      database: 'healthy',
    });
  });

  it('should respond 503 when database health check throws', async () => {
    const deps = createMockDeps();
    deps.db.testConnection.mockRejectedValue(new Error('connection terminated'));
    const { url } = await startServerWithDeps(deps);
    const res = await fetch(`${url}/ready`);

    expect(res.status).toBe(503);
    expect(res.body.status).toBe('unavailable');
    expect(res.body.checks).toEqual({
      workers: 'healthy',
      redis: 'healthy',
      database: 'unhealthy',
    });
  });

  it('should respond 503 when worker health check throws', async () => {
    const deps = createMockDeps();
    deps.workerManager.healthCheck.mockRejectedValue(new Error('worker crashed'));
    const { url } = await startServerWithDeps(deps);
    const res = await fetch(`${url}/ready`);

    expect(res.status).toBe(503);
    expect(res.body.status).toBe('unavailable');
    expect(res.body.checks).toEqual({
      workers: 'unhealthy',
      redis: 'healthy',
      database: 'healthy',
    });
  });

  it('should respond 503 when all health checks throw', async () => {
    const deps = createMockDeps();
    deps.workerManager.healthCheck.mockRejectedValue(new Error('worker crashed'));
    deps.queueManager.healthCheck.mockRejectedValue(new Error('ECONNREFUSED'));
    deps.db.testConnection.mockRejectedValue(new Error('connection terminated'));
    const { url } = await startServerWithDeps(deps);
    const res = await fetch(`${url}/ready`);

    expect(res.status).toBe(503);
    expect(res.body.status).toBe('unavailable');
    expect(res.body.checks).toEqual({
      workers: 'unhealthy',
      redis: 'unhealthy',
      database: 'unhealthy',
    });
  });

  it('should respond 200 on /metrics with Prometheus text format', async () => {
    const { url } = await startServer();
    const res = await fetchRaw(`${url}/metrics`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    // Should include default Node.js process metrics from prom-client
    expect(res.text).toContain('process_cpu_');
  });

  it('should return valid Prometheus metric lines on /metrics', async () => {
    const { url } = await startServer();
    const res = await fetchRaw(`${url}/metrics`);

    // Prometheus exposition format: lines are either comments (# ...) or metric values (name{labels} value)
    const lines = res.text.split('\n').filter((l) => l.length > 0);
    for (const line of lines) {
      expect(line).toMatch(/^(#|[a-zA-Z_])/);
    }
  });

  it('should return 401 on /metrics when METRICS_AUTH_TOKEN is set and no token provided', async () => {
    process.env.METRICS_AUTH_TOKEN = 'test-secret-token';
    try {
      const { url } = await startServer();
      const res = await fetchRaw(`${url}/metrics`);
      expect(res.status).toBe(401);
    } finally {
      delete process.env.METRICS_AUTH_TOKEN;
    }
  });

  it('should return 200 on /metrics when correct bearer token is provided', async () => {
    process.env.METRICS_AUTH_TOKEN = 'test-secret-token';
    try {
      const { url } = await startServer();
      const res = await fetchRaw(`${url}/metrics`, 'GET', {
        Authorization: 'Bearer test-secret-token',
      });
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/plain');
    } finally {
      delete process.env.METRICS_AUTH_TOKEN;
    }
  });

  it('should return 401 on /metrics when wrong bearer token is provided', async () => {
    process.env.METRICS_AUTH_TOKEN = 'test-secret-token';
    try {
      const { url } = await startServer();
      const res = await fetchRaw(`${url}/metrics`, 'GET', {
        Authorization: 'Bearer wrong-token',
      });
      expect(res.status).toBe(401);
    } finally {
      delete process.env.METRICS_AUTH_TOKEN;
    }
  });
});
