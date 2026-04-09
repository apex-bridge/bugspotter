/**
 * Service Container & Request Context
 * Exports dependency injection and request context utilities
 */

export {
  ServiceContainer,
  createServiceContainer,
  type IServiceContainer,
  type ServiceContainerConfig,
} from './service-container.js';

export {
  createRequestContextMiddleware,
  getServices,
  setRequestMetadata,
  getRequestMetadata,
  getRequestDuration,
  type RequestContext,
} from './request-context.js';
