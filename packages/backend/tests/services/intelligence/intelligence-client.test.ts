/**
 * Intelligence Client Tests
 * Unit tests for retry logic, error classification, backoff calculation,
 * and circuit breaker integration.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  IntelligenceClient,
  IntelligenceError,
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

function createAxiosError(
  status: number,
  detail?: string
): Error & { isAxiosError: boolean; response?: unknown } {
  const error = new Error(`Request failed with status ${status}`) as Error & {
    isAxiosError: boolean;
    response?: { status: number; data: unknown };
  };
  error.isAxiosError = true;
  error.response = {
    status,
    data: detail ? { detail } : {},
  };
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
      mockAxiosInstance.request.mockRejectedValue(createAxiosError(500, 'Internal error'));

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
      mockAxiosInstance.request.mockRejectedValue(createAxiosError(404, 'Not found'));

      try {
        await client.analyzeBug({ bug_id: '1', title: 'test' });
      } catch (e) {
        expect(e).toBeInstanceOf(IntelligenceError);
        expect((e as IntelligenceError).code).toBe('client_error');
        expect((e as IntelligenceError).statusCode).toBe(404);
      }
    });

    it('should classify 429 as rate_limit_error', async () => {
      mockAxiosInstance.request.mockRejectedValue(createAxiosError(429, 'Rate limited'));

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
      const error = createAxiosError(400);
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

  describe('retry behavior', () => {
    it('should retry on 5xx errors', async () => {
      mockAxiosInstance.request
        .mockRejectedValueOnce(createAxiosError(502, 'Bad gateway'))
        .mockResolvedValueOnce({ status: 200, data: { bug_id: '1' } });

      const result = await client.analyzeBug({ bug_id: '1', title: 'test' });
      expect(result).toEqual({ bug_id: '1' });
      expect(mockAxiosInstance.request).toHaveBeenCalledTimes(2);
    });

    it('should retry on 429 errors', async () => {
      mockAxiosInstance.request
        .mockRejectedValueOnce(createAxiosError(429, 'Rate limited'))
        .mockResolvedValueOnce({ status: 200, data: { bug_id: '1' } });

      const result = await client.analyzeBug({ bug_id: '1', title: 'test' });
      expect(result).toEqual({ bug_id: '1' });
      expect(mockAxiosInstance.request).toHaveBeenCalledTimes(2);
    });

    it('should not retry on 4xx client errors', async () => {
      mockAxiosInstance.request.mockRejectedValue(createAxiosError(400, 'Bad request'));

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
      mockAxiosInstance.request.mockRejectedValue(createAxiosError(500, 'Server error'));

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
      mockAxiosInstance.request.mockRejectedValue(createAxiosError(400, 'Bad request'));

      // Make many 4xx calls — circuit should NOT open
      for (let i = 0; i < 10; i++) {
        await client.analyzeBug({ bug_id: '1', title: 'test' }).catch(() => {});
      }

      // Circuit should still be closed
      const state = client.getCircuitState();
      expect(state.state).toBe('closed');
    });
  });
});
