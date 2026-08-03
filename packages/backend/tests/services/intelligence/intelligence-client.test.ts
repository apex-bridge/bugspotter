/**
 * Intelligence Client Tests
 * Unit tests for retry logic, error classification, backoff calculation,
 * and circuit breaker integration.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  IntelligenceClient,
  IntelligenceError,
  mapIntelligenceError,
  shouldTripCircuitBreaker,
} from '../../../src/services/intelligence/intelligence-client.js';
import type { IntelligenceClientConfig } from '../../../src/services/intelligence/types.js';

// Mock axios
vi.mock('axios', async () => {
  const mockInstance = {
    request: vi.fn(),
    get: vi.fn(),
  };
  return {
    default: {
      create: vi.fn(() => mockInstance),
      isAxiosError: (err: unknown) =>
        err instanceof Error &&
        'isAxiosError' in err &&
        (err as { isAxiosError: boolean }).isAxiosError === true,
    },
    __mockInstance: mockInstance,
  };
});

// Takes an object rather than positional args so a test can set both a body
// `code` and response headers, which the 503 `llm_unavailable` mapping reads.
function createAxiosError({
  status,
  data = {},
  headers = {},
}: {
  status: number;
  data?: unknown;
  headers?: Record<string, string>;
}): Error & { isAxiosError: boolean; response?: unknown } {
  const error = new Error(`Request failed with status ${status}`) as Error & {
    isAxiosError: boolean;
    response?: { status: number; data: unknown; headers: Record<string, string> };
  };
  error.isAxiosError = true;
  error.response = { status, data, headers };
  return error;
}

function createNetworkError(): Error & { isAxiosError: boolean } {
  const error = new Error('ECONNREFUSED') as Error & {
    isAxiosError: boolean;
    response?: undefined;
  };
  error.isAxiosError = true;
  error.response = undefined;
  return error;
}

const defaultConfig: IntelligenceClientConfig = {
  baseUrl: 'http://test:8000',
  apiKey: 'test-key',
  timeout: 5000,
  maxRetries: 2,
  backoffDelay: 10, // Very short for tests
  circuitBreaker: {
    failureThreshold: 5,
    resetTimeout: 30000,
    halfOpenSuccessThreshold: 2,
  },
};

describe('IntelligenceClient', () => {
  let client: IntelligenceClient;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockAxiosInstance: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const axiosMod = await import('axios');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockAxiosInstance = (axiosMod as any).__mockInstance;
    client = new IntelligenceClient(defaultConfig);
  });

  describe('wrapError classification', () => {
    it('should classify 5xx as server_error', async () => {
      mockAxiosInstance.request.mockRejectedValue(
        createAxiosError({ status: 500, data: { detail: 'Internal error' } })
      );

      await expect(client.analyzeBug({ bug_id: '1', title: 'test' })).rejects.toThrow(
        IntelligenceError
      );

      try {
        await client.analyzeBug({ bug_id: '1', title: 'test' });
      } catch (e) {
        expect(e).toBeInstanceOf(IntelligenceError);
        expect((e as IntelligenceError).code).toBe('server_error');
        expect((e as IntelligenceError).statusCode).toBe(500);
      }
    });

    it('should classify 4xx as client_error', async () => {
      mockAxiosInstance.request.mockRejectedValue(
        createAxiosError({ status: 404, data: { detail: 'Not found' } })
      );

      try {
        await client.analyzeBug({ bug_id: '1', title: 'test' });
      } catch (e) {
        expect(e).toBeInstanceOf(IntelligenceError);
        expect((e as IntelligenceError).code).toBe('client_error');
        expect((e as IntelligenceError).statusCode).toBe(404);
      }
    });

    it('should classify 429 as rate_limit_error', async () => {
      mockAxiosInstance.request.mockRejectedValue(
        createAxiosError({ status: 429, data: { detail: 'Rate limited' } })
      );

      try {
        await client.analyzeBug({ bug_id: '1', title: 'test' });
      } catch (e) {
        expect(e).toBeInstanceOf(IntelligenceError);
        expect((e as IntelligenceError).code).toBe('rate_limit_error');
        expect((e as IntelligenceError).statusCode).toBe(429);
      }
    });

    it('should classify network errors as network_error', async () => {
      mockAxiosInstance.request.mockRejectedValue(createNetworkError());

      try {
        await client.analyzeBug({ bug_id: '1', title: 'test' });
      } catch (e) {
        expect(e).toBeInstanceOf(IntelligenceError);
        expect((e as IntelligenceError).code).toBe('network_error');
        expect((e as IntelligenceError).statusCode).toBe(0);
      }
    });

    it('should handle object detail in error response', async () => {
      const error = createAxiosError({ status: 400 });
      (error.response as { data: unknown }).data = {
        detail: { field: 'title', reason: 'required' },
      };
      mockAxiosInstance.request.mockRejectedValue(error);

      try {
        await client.analyzeBug({ bug_id: '1', title: 'test' });
      } catch (e) {
        expect(e).toBeInstanceOf(IntelligenceError);
        // Object detail should be JSON.stringified, not [object Object]
        expect((e as IntelligenceError).message).toContain('"field"');
        expect((e as IntelligenceError).message).toContain('"title"');
      }
    });
  });

  describe('503 llm_unavailable mapping', () => {
    const map = (e: unknown) => mapIntelligenceError(e, 'POST', '/analyze');

    const llmUnavailable = (retryAfterHeader?: string) =>
      createAxiosError({
        status: 503,
        data: { code: 'llm_unavailable', detail: 'LLM backend unavailable' },
        headers: retryAfterHeader === undefined ? {} : { 'retry-after': retryAfterHeader },
      });

    it('maps 503 + llm_unavailable to a distinct code, not server_error', () => {
      expect(map(llmUnavailable('30')).code).toBe('llm_unavailable');
    });

    it('keeps the same message prefix the generic >=500 branch uses', () => {
      expect(map(llmUnavailable('30')).message).toBe(
        'Intelligence POST /analyze failed: LLM backend unavailable'
      );
    });

    it('reads Retry-After, caps it at 120 s, and defaults to 30 s', () => {
      expect(map(llmUnavailable('45')).retryAfter).toBe(45);
      expect(map(llmUnavailable('999')).retryAfter).toBe(120);
      expect(map(llmUnavailable()).retryAfter).toBe(30);
      expect(map(llmUnavailable('not-a-number')).retryAfter).toBe(30);
    });

    it('leaves a plain 500 mapping exactly as before', () => {
      const err = map(createAxiosError({ status: 500, data: { detail: 'Internal error' } }));
      expect(err.code).toBe('server_error');
      expect(err.statusCode).toBe(500);
      expect(err.retryAfter).toBeUndefined();
      expect(err.tripCircuitBreaker).toBeUndefined();
    });

    it('falls a 503 without the llm_unavailable body code through to server_error', () => {
      const err = map(createAxiosError({ status: 503, data: { detail: 'Service unavailable' } }));
      expect(err.code).toBe('server_error');
      expect(err.retryAfter).toBeUndefined();
    });

    it('does not treat a non-object body as carrying the code', () => {
      // Upstream error pages arrive as an HTML string, not an object. Reading
      // `.code` off it must not throw and must not match.
      const err = map(createAxiosError({ status: 503, data: '<html>502 Bad Gateway</html>' }));
      expect(err.code).toBe('server_error');
    });
  });

  describe('shouldTripCircuitBreaker', () => {
    const map = (e: unknown) => mapIntelligenceError(e, 'POST', '/analyze');

    it('does not trip for llm_unavailable, which carries the opt-out flag', () => {
      const err = map(
        createAxiosError({
          status: 503,
          data: { code: 'llm_unavailable', detail: 'LLM backend unavailable' },
          headers: { 'retry-after': '30' },
        })
      );
      expect(err.tripCircuitBreaker).toBe(false);
      expect(shouldTripCircuitBreaker(err)).toBe(false);
    });

    // The three below pin the behaviour of the predicate that was extracted
    // from the inline lambda, so the extraction cannot silently change it.
    it('does not trip for client errors', () => {
      expect(shouldTripCircuitBreaker(map(createAxiosError({ status: 404 })))).toBe(false);
    });

    it('trips for server errors', () => {
      expect(shouldTripCircuitBreaker(map(createAxiosError({ status: 500 })))).toBe(true);
    });

    it('trips for values that were never wrapped into an IntelligenceError', () => {
      expect(shouldTripCircuitBreaker(new Error('boom'))).toBe(true);
      expect(shouldTripCircuitBreaker(undefined)).toBe(true);
    });
  });

  describe('retry behavior', () => {
    it('should retry on 5xx errors', async () => {
      mockAxiosInstance.request
        .mockRejectedValueOnce(createAxiosError({ status: 502, data: { detail: 'Bad gateway' } }))
        .mockResolvedValueOnce({ status: 200, data: { bug_id: '1' } });

      const result = await client.analyzeBug({ bug_id: '1', title: 'test' });
      expect(result).toEqual({ bug_id: '1' });
      expect(mockAxiosInstance.request).toHaveBeenCalledTimes(2);
    });

    it('should retry on 429 errors', async () => {
      mockAxiosInstance.request
        .mockRejectedValueOnce(createAxiosError({ status: 429, data: { detail: 'Rate limited' } }))
        .mockResolvedValueOnce({ status: 200, data: { bug_id: '1' } });

      const result = await client.analyzeBug({ bug_id: '1', title: 'test' });
      expect(result).toEqual({ bug_id: '1' });
      expect(mockAxiosInstance.request).toHaveBeenCalledTimes(2);
    });

    it('should not retry on 4xx client errors', async () => {
      mockAxiosInstance.request.mockRejectedValue(
        createAxiosError({ status: 400, data: { detail: 'Bad request' } })
      );

      await expect(client.analyzeBug({ bug_id: '1', title: 'test' })).rejects.toThrow(
        IntelligenceError
      );
      // 1 initial attempt, no retries
      expect(mockAxiosInstance.request).toHaveBeenCalledTimes(1);
    });

    it('should retry on network errors', async () => {
      mockAxiosInstance.request
        .mockRejectedValueOnce(createNetworkError())
        .mockResolvedValueOnce({ status: 200, data: { bug_id: '1' } });

      const result = await client.analyzeBug({ bug_id: '1', title: 'test' });
      expect(result).toEqual({ bug_id: '1' });
      expect(mockAxiosInstance.request).toHaveBeenCalledTimes(2);
    });

    it('should respect maxRetries limit', async () => {
      // maxRetries=2 means initial + 2 retries = 3 total attempts
      mockAxiosInstance.request.mockRejectedValue(
        createAxiosError({ status: 500, data: { detail: 'Server error' } })
      );

      await expect(client.analyzeBug({ bug_id: '1', title: 'test' })).rejects.toThrow(
        IntelligenceError
      );
      expect(mockAxiosInstance.request).toHaveBeenCalledTimes(3);
    });
  });

  describe('healthCheck', () => {
    it('should return true when service is healthy', async () => {
      mockAxiosInstance.get.mockResolvedValue({ data: { status: 'healthy' } });
      expect(await client.healthCheck()).toBe(true);
    });

    it('should return false when service is unhealthy', async () => {
      mockAxiosInstance.get.mockResolvedValue({ data: { status: 'degraded' } });
      expect(await client.healthCheck()).toBe(false);
    });

    it('should return false on network error', async () => {
      mockAxiosInstance.get.mockRejectedValue(new Error('ECONNREFUSED'));
      expect(await client.healthCheck()).toBe(false);
    });
  });

  describe('circuit breaker integration', () => {
    it('should not trip circuit on 4xx errors', async () => {
      mockAxiosInstance.request.mockRejectedValue(
        createAxiosError({ status: 400, data: { detail: 'Bad request' } })
      );

      // Make many 4xx calls — circuit should NOT open
      for (let i = 0; i < 10; i++) {
        await client.analyzeBug({ bug_id: '1', title: 'test' }).catch(() => {});
      }

      // Circuit should still be closed
      const state = client.getCircuitState();
      expect(state.state).toBe('closed');
    });
  });

  describe('getServiceStatus', () => {
    const STATUS = {
      version: '0.1.0',
      llm_provider: 'ollama',
      llm_model: 'llama3.2:3b',
      anthropic_key_configured: false,
      openai_key_configured: false,
      similarity_threshold: 0.68,
      duplicate_threshold: 0.85,
      embeddings: {
        provider: 'local',
        model: 'BAAI/bge-m3',
        total: 10,
        nulls: 0,
        min_dim: 1024,
        healthy: true,
      },
    };

    it('GETs /api/v1/admin/status and returns the parsed status', async () => {
      mockAxiosInstance.request.mockResolvedValue({ status: 200, data: STATUS });

      const result = await client.getServiceStatus();

      expect(result).toEqual(STATUS);
      expect(mockAxiosInstance.request).toHaveBeenCalledWith(
        expect.objectContaining({ method: 'GET', url: '/api/v1/admin/status' })
      );
    });

    it('propagates an IntelligenceError on upstream failure', async () => {
      mockAxiosInstance.request.mockRejectedValue(
        createAxiosError({ status: 503, data: { detail: 'unavailable' } })
      );
      await expect(client.getServiceStatus()).rejects.toThrow(IntelligenceError);
    });
  });
});
