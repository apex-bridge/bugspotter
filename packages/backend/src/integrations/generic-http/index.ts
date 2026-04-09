/**
 * Generic HTTP Integration
 * Configurable integration for any REST API
 */

export { GenericHttpService } from './service.js';
export { GenericHttpClient } from './client.js';
export { GenericHttpMapper } from './mapper.js';
export type {
  GenericHttpConfig,
  GenericHttpResult,
  AuthConfig,
  AuthType,
  EndpointConfig,
  FieldMapping,
  HttpMethod,
} from './types.js';
