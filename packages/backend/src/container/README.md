# Service Container & Dependency Injection

## Overview

The Service Container provides centralized dependency management with lazy initialization for the BugSpotter backend. This improves testability, maintainability, and enables better lifecycle management of services.

## Architecture

```
┌───────────────────────────────────────────────────┐
│                 Fastify Server                    │
│                                                   │
│  ┌────────────────────────────────────────────┐   │
│  │     Request Context Middleware             │   │
│  │  (Attaches container to req.ctx)           │   │
│  └────────────────────────────────────────────┘   │
│                       │                           │
│                       ▼                           │
│  ┌────────────────────────────────────────────┐   │
│  │         Service Container                  │   │
│  │                                            │   │
│  │  • db: DatabaseClient                      │   │
│  │  • storage: IStorageService                │   │
│  │  • pluginRegistry: PluginRegistry          │   │
│  │  • queueManager?: QueueManager             │   │
│  │  • retentionService?: RetentionService     │   │
│  │                                            │   │
│  │  Lazy-loaded services:                     │   │
│  │  • NotificationService (when QM exists)    │   │
│  └────────────────────────────────────────────┘   │
│                       │                           │
│                       ▼                           │
│  ┌────────────────────────────────────────────┐   │
│  │          Route Handlers                    │   │
│  │   Access services via req.ctx.services     │   │
│  └────────────────────────────────────────────┘   │
└───────────────────────────────────────────────────┘
```

## Features

- **Centralized Dependency Management**: All services in one place
- **Lazy Initialization**: Services created only when needed
- **Lifecycle Management**: Proper cleanup via `dispose()` method
- **Type Safety**: Full TypeScript support
- **Testability**: Easy mocking for unit tests
- **Request Context**: Services attached to each request via `req.ctx`

## Usage

### Server Setup

```typescript
import { createServiceContainer, createRequestContextMiddleware } from './container/index.js';

// Create service container
const container = createServiceContainer({
  db: databaseClient,
  storage: storageService,
  pluginRegistry: registry,
  queueManager: queueMgr, // Optional
  retentionService: retentionSvc, // Optional
  retentionScheduler: scheduler, // Optional
});

// Register request context middleware
const requestContextMiddleware = createRequestContextMiddleware(container);
fastify.addHook('onRequest', requestContextMiddleware);

// Now all routes have access to services via req.ctx.services
```

### Route Handler (New Pattern)

```typescript
import { getServices } from '../container/index.js';

fastify.get('/ready', async (request, reply) => {
  // Access services through container
  const services = getServices(request);
  const isHealthy = await services.db.testConnection();

  if (!isHealthy) {
    return reply.code(503).send({ status: 'unavailable' });
  }

  return reply.send({ status: 'ready' });
});
```

### Route Handler (Old Pattern - Being Phased Out)

```typescript
// OLD: Services passed as function parameters
export async function healthRoutes(fastify: FastifyInstance, db: DatabaseClient) {
  fastify.get('/ready', async (request, reply) => {
    const isHealthy = await db.testConnection(); // Direct parameter access
    // ...
  });
}
```

## Request Context API

### getServices(request)

Get the service container from the request:

```typescript
const services = getServices(request);
const db = services.db;
const storage = services.storage;
```

### setRequestMetadata(request, key, value)

Store request-specific metadata:

```typescript
setRequestMetadata(request, 'userId', user.id);
setRequestMetadata(request, 'timing', { start: Date.now() });
```

### getRequestMetadata<T>(request, key)

Retrieve request metadata with type safety:

```typescript
const userId = getRequestMetadata<string>(request, 'userId');
const timing = getRequestMetadata<{ start: number }>(request, 'timing');
```

### getRequestDuration(request)

Get request duration in milliseconds:

```typescript
const durationMs = getRequestDuration(request);
console.log(`Request took ${durationMs}ms`);
```

## Testing

### Mocking the Service Container

```typescript
import { describe, it, expect, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { getServices } from '../container/index.js';

describe('MyRoute', () => {
  it('should handle requests', async () => {
    // Create mock container
    const mockContainer = {
      db: {
        testConnection: vi.fn().mockResolvedValue(true),
      },
      storage: {
        /* mock storage */
      },
      pluginRegistry: {
        /* mock registry */
      },
      isInitialized: () => true,
      dispose: vi.fn(),
      getNotificationService: vi.fn(),
    };

    // Create mock request with context
    const mockRequest = {
      ctx: {
        services: mockContainer,
        requestId: 'test-123',
        startTime: Date.now(),
        metadata: {},
      },
    } as FastifyRequest;

    // Test your route handler
    const services = getServices(mockRequest);
    const result = await services.db.testConnection();
    expect(result).toBe(true);
  });
});
```

## Lazy-Loaded Services

### Notification Service

The NotificationService is lazy-loaded only when a QueueManager is available:

```typescript
const container = createServiceContainer({
  db,
  storage,
  pluginRegistry,
  queueManager, // If present, enables NotificationService
});

// Later in route handler
const notificationService = container.getNotificationService();
if (notificationService) {
  await notificationService.notify(/* ... */);
}
```

### Adding New Lazy Services

To add a new lazy-loaded service:

1. Add property to `ServiceContainer` class:

   ```typescript
   private _myService?: MyService;
   ```

2. Create getter method:

   ```typescript
   getMyService(): MyService | undefined {
     if (!this._myService) {
       this._myService = new MyService(this.db, this.storage);
     }
     return this._myService;
   }
   ```

3. Update interface:
   ```typescript
   export interface IServiceContainer {
     // ...
     getMyService(): MyService | undefined;
   }
   ```

## Lifecycle Management

### Initialization

Services are initialized when the container is created:

```typescript
const container = createServiceContainer(config);
console.log(container.isInitialized()); // true
```

### Disposal

Properly cleanup resources when shutting down:

```typescript
// On server shutdown
await container.dispose();

// Disposal order:
// 1. Close QueueManager (if present)
// 2. Stop RetentionScheduler (if present)
// 3. Close Database connections
```

### Disposal is Idempotent

Safe to call multiple times:

```typescript
await container.dispose();
await container.dispose(); // Safe - no-op
```

## Migration Guide

### Migrating Routes to Use Service Container

**Before:**

```typescript
export function myRoutes(fastify: FastifyInstance, db: DatabaseClient, storage: IStorageService) {
  fastify.get('/endpoint', async (request, reply) => {
    const data = await db.query(/* ... */);
    await storage.upload(/* ... */);
    // ...
  });
}
```

**After:**

```typescript
import { getServices } from '../container/index.js';

export function myRoutes(fastify: FastifyInstance) {
  fastify.get('/endpoint', async (request, reply) => {
    const services = getServices(request);
    const data = await services.db.query(/* ... */);
    await services.storage.upload(/* ... */);
    // ...
  });
}
```

### Migration Steps

1. **Remove service parameters** from route function signature
2. **Import getServices** helper
3. **Get services from request**: `const services = getServices(request)`
4. **Update service calls**: `db.query()` → `services.db.query()`
5. **Update tests** to mock `req.ctx.services`

## Benefits

### Before Service Container

❌ **Problems:**

- Services passed through many layers (parameter drilling)
- Difficult to mock for testing
- No centralized lifecycle management
- Hard to add new services (change many signatures)
- Route handlers tightly coupled to service implementations

### After Service Container

✅ **Benefits:**

- Single source of truth for services
- Easy to mock in tests (one place)
- Centralized lifecycle management
- Easy to extend with new services
- Loose coupling via dependency injection
- Better code organization

## Best Practices

### 1. Always Use getServices()

```typescript
// ✅ GOOD: Type-safe access
const services = getServices(request);
const db = services.db;

// ❌ BAD: Direct access, not type-safe
const db = request.ctx.services.db;
```

### 2. Handle Optional Services

```typescript
// ✅ GOOD: Check before use
const notificationService = container.getNotificationService();
if (notificationService) {
  await notificationService.notify(/* ... */);
}

// ❌ BAD: Assume service exists
await container.getNotificationService().notify(/* ... */); // May be undefined!
```

### 3. Use Request Metadata for Context

```typescript
// ✅ GOOD: Store user context
setRequestMetadata(request, 'userId', user.id);

// Later in middleware or route
const userId = getRequestMetadata<string>(request, 'userId');
```

### 4. Clean Up in Tests

```typescript
afterEach(async () => {
  if (container.isInitialized()) {
    await container.dispose();
  }
  vi.clearAllMocks();
});
```

## Examples

### Complete Route Example

```typescript
import type { FastifyInstance } from 'fastify';
import { getServices, setRequestMetadata, getRequestDuration } from '../container/index.js';

export function dataRoutes(fastify: FastifyInstance) {
  fastify.get('/data/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const services = getServices(request);

    // Store metadata
    setRequestMetadata(request, 'resourceId', id);

    try {
      // Access database
      const data = await services.db.query('SELECT * FROM data WHERE id = $1', [id]);

      // Access storage
      if (data.fileKey) {
        const url = await services.storage.getSignedUrl(data.fileKey);
        data.fileUrl = url;
      }

      // Log duration
      const duration = getRequestDuration(request);
      request.log.info({ id, duration }, 'Data fetched successfully');

      return reply.send({ success: true, data });
    } catch (error) {
      request.log.error({ error, id }, 'Failed to fetch data');
      return reply.code(500).send({ success: false, error: 'Internal server error' });
    }
  });
}
```

### Complete Test Example

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { dataRoutes } from './data-routes.js';
import type { IServiceContainer } from '../container/index.js';

describe('Data Routes', () => {
  let mockContainer: IServiceContainer;
  let mockRequest: Partial<FastifyRequest>;
  let mockReply: Partial<FastifyReply>;

  beforeEach(() => {
    mockContainer = {
      db: {
        query: vi.fn().mockResolvedValue({ id: '123', name: 'Test' }),
      },
      storage: {
        getSignedUrl: vi.fn().mockResolvedValue('https://example.com/file'),
      },
      pluginRegistry: {},
      isInitialized: () => true,
      dispose: vi.fn(),
      getNotificationService: vi.fn(),
    } as any;

    mockRequest = {
      params: { id: '123' },
      ctx: {
        services: mockContainer,
        requestId: 'test-123',
        startTime: Date.now(),
        metadata: {},
      },
      log: {
        info: vi.fn(),
        error: vi.fn(),
      },
    } as any;

    mockReply = {
      send: vi.fn().mockReturnThis(),
      code: vi.fn().mockReturnThis(),
    } as any;
  });

  it('should fetch data successfully', async () => {
    // Test implementation
  });
});
```

## Troubleshooting

### "Request context not initialized" Error

**Cause:** Request context middleware not registered or called before accessing services.

**Solution:**

```typescript
// Ensure middleware is registered BEFORE routes
fastify.addHook('onRequest', createRequestContextMiddleware(container));

// Then register routes
fastify.register(myRoutes);
```

### Service is Undefined

**Cause:** Optional service requested but dependency not provided.

**Solution:**

```typescript
// Check if service exists before using
const notificationService = container.getNotificationService();
if (!notificationService) {
  return reply.code(503).send({ error: 'Notifications unavailable' });
}
```

### Tests Fail with "getPool is not a function"

**Cause:** Mock database doesn't include all required methods.

**Solution:**

```typescript
mockDb = {
  testConnection: vi.fn(),
  close: vi.fn(),
  getPool: vi.fn().mockReturnValue({}), // Add getPool mock
  // ... other required methods
} as unknown as DatabaseClient;
```

## See Also

- [Fastify Hooks Documentation](https://www.fastify.io/docs/latest/Reference/Hooks/)
- [Dependency Injection Pattern](https://en.wikipedia.org/wiki/Dependency_injection)
- [Testing Best Practices](../../tests/README.md)

## Status

✅ **Implemented in:** Phase 1 (Roadmap task 1.2)
📝 **Next Steps:** Migrate existing routes to use container pattern
🔄 **Migration Status:** In progress (example: health routes)
