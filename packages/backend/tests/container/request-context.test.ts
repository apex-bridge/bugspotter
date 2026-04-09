/**
 * Unit tests for Request Context Middleware
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FastifyRequest, FastifyReply } from 'fastify';
import {
  createRequestContextMiddleware,
  getServices,
  setRequestMetadata,
  getRequestMetadata,
  getRequestDuration,
} from '../../src/container/request-context.js';
import type { IServiceContainer } from '../../src/container/service-container.js';

describe('Request Context Middleware', () => {
  let mockContainer: IServiceContainer;
  let mockRequest: Partial<FastifyRequest>;
  let mockReply: Partial<FastifyReply>;
  let doneFn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Create mock container
    mockContainer = {
      db: {} as IServiceContainer['db'],
      storage: {} as IServiceContainer['storage'],
      pluginRegistry: {} as IServiceContainer['pluginRegistry'],
      isInitialized: vi.fn().mockReturnValue(true),
      dispose: vi.fn(),
      getNotificationService: vi.fn(),
    };

    // Create mock request
    mockRequest = {
      id: 'test-request-123',
      method: 'GET',
      url: '/test',
      log: {
        debug: vi.fn(),
        info: vi.fn(),
        error: vi.fn(),
      } as unknown as FastifyRequest['log'],
    };

    // Create mock reply
    mockReply = {};

    // Create done function
    doneFn = vi.fn();
  });

  describe('createRequestContextMiddleware', () => {
    it('should attach context to request', () => {
      const middleware = createRequestContextMiddleware(mockContainer);

      middleware(mockRequest as FastifyRequest, mockReply as FastifyReply, doneFn);

      expect(mockRequest.ctx).toBeDefined();
      expect(mockRequest.ctx?.services).toBe(mockContainer);
      expect(mockRequest.ctx?.requestId).toBe('test-request-123');
      expect(mockRequest.ctx?.startTime).toBeGreaterThan(0);
      expect(mockRequest.ctx?.metadata).toEqual({});
      expect(doneFn).toHaveBeenCalledTimes(1);
    });

    it('should create context without errors', () => {
      const middleware = createRequestContextMiddleware(mockContainer);

      middleware(mockRequest as FastifyRequest, mockReply as FastifyReply, doneFn);

      // Verify context was created successfully
      expect(mockRequest.ctx).toBeDefined();
      expect(doneFn).toHaveBeenCalled();
      // Note: We don't assert on debug logging as logger config varies in tests
    });

    it('should set startTime to current timestamp', () => {
      const beforeTime = Date.now();
      const middleware = createRequestContextMiddleware(mockContainer);

      middleware(mockRequest as FastifyRequest, mockReply as FastifyReply, doneFn);

      const afterTime = Date.now();
      expect(mockRequest.ctx?.startTime).toBeGreaterThanOrEqual(beforeTime);
      expect(mockRequest.ctx?.startTime).toBeLessThanOrEqual(afterTime);
    });
  });

  describe('getServices', () => {
    it('should return services from request context', () => {
      const middleware = createRequestContextMiddleware(mockContainer);
      middleware(mockRequest as FastifyRequest, mockReply as FastifyReply, doneFn);

      const services = getServices(mockRequest as FastifyRequest);
      expect(services).toBe(mockContainer);
    });

    it('should throw error if context not initialized', () => {
      expect(() => getServices(mockRequest as FastifyRequest)).toThrow(
        'Request context not initialized'
      );
    });

    it('should throw error if services not available', () => {
      mockRequest.ctx = {
        services: undefined as unknown as IServiceContainer,
        requestId: 'test',
        startTime: Date.now(),
        metadata: {},
      };

      expect(() => getServices(mockRequest as FastifyRequest)).toThrow(
        'Request context not initialized'
      );
    });
  });

  describe('setRequestMetadata', () => {
    beforeEach(() => {
      const middleware = createRequestContextMiddleware(mockContainer);
      middleware(mockRequest as FastifyRequest, mockReply as FastifyReply, doneFn);
    });

    it('should set metadata key-value pair', () => {
      setRequestMetadata(mockRequest as FastifyRequest, 'userId', '12345');

      expect(mockRequest.ctx?.metadata['userId']).toBe('12345');
    });

    it('should support multiple metadata keys', () => {
      setRequestMetadata(mockRequest as FastifyRequest, 'userId', '12345');
      setRequestMetadata(mockRequest as FastifyRequest, 'projectId', 'abc-def');

      expect(mockRequest.ctx?.metadata['userId']).toBe('12345');
      expect(mockRequest.ctx?.metadata['projectId']).toBe('abc-def');
    });

    it('should support complex metadata values', () => {
      const complexValue = { name: 'Test User', roles: ['admin', 'user'] };
      setRequestMetadata(mockRequest as FastifyRequest, 'user', complexValue);

      expect(mockRequest.ctx?.metadata['user']).toEqual(complexValue);
    });

    it('should throw error if context not initialized', () => {
      delete mockRequest.ctx;

      expect(() => setRequestMetadata(mockRequest as FastifyRequest, 'key', 'value')).toThrow(
        'Request context not initialized'
      );
    });
  });

  describe('getRequestMetadata', () => {
    beforeEach(() => {
      const middleware = createRequestContextMiddleware(mockContainer);
      middleware(mockRequest as FastifyRequest, mockReply as FastifyReply, doneFn);
    });

    it('should get metadata value by key', () => {
      setRequestMetadata(mockRequest as FastifyRequest, 'userId', '12345');

      const value = getRequestMetadata(mockRequest as FastifyRequest, 'userId');
      expect(value).toBe('12345');
    });

    it('should return undefined for non-existent key', () => {
      const value = getRequestMetadata(mockRequest as FastifyRequest, 'nonexistent');
      expect(value).toBeUndefined();
    });

    it('should support typed metadata retrieval', () => {
      interface UserData {
        id: string;
        name: string;
      }

      const userData: UserData = { id: '123', name: 'Test' };
      setRequestMetadata(mockRequest as FastifyRequest, 'user', userData);

      const value = getRequestMetadata<UserData>(mockRequest as FastifyRequest, 'user');
      expect(value?.id).toBe('123');
      expect(value?.name).toBe('Test');
    });

    it('should throw error if context not initialized', () => {
      delete mockRequest.ctx;

      expect(() => getRequestMetadata(mockRequest as FastifyRequest, 'key')).toThrow(
        'Request context not initialized'
      );
    });
  });

  describe('getRequestDuration', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should calculate request duration', () => {
      const middleware = createRequestContextMiddleware(mockContainer);
      middleware(mockRequest as FastifyRequest, mockReply as FastifyReply, doneFn);

      // Advance time by 10ms
      vi.advanceTimersByTime(10);

      const duration = getRequestDuration(mockRequest as FastifyRequest);
      expect(duration).toBe(10);
    });

    it('should throw error if context not initialized', () => {
      expect(() => getRequestDuration(mockRequest as FastifyRequest)).toThrow(
        'Request context not initialized'
      );
    });

    it('should return increasing duration over time', () => {
      const middleware = createRequestContextMiddleware(mockContainer);
      middleware(mockRequest as FastifyRequest, mockReply as FastifyReply, doneFn);

      const duration1 = getRequestDuration(mockRequest as FastifyRequest);

      // Advance time by 20ms
      vi.advanceTimersByTime(20);

      const duration2 = getRequestDuration(mockRequest as FastifyRequest);

      expect(duration2).toBeGreaterThan(duration1);
      expect(duration2 - duration1).toBe(20); // Deterministic with fake timers
    });
  });
});
