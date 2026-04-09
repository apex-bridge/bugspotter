/**
 * Authorization Module — Public API
 *
 * Usage:
 *   import { authorize, extractSubject } from '../authorization/index.js';
 *   import type { Subject, Resource, Action } from '../authorization/index.js';
 */

export { authorize } from './policies/index.js';
export { extractSubject } from './subject.js';
export { guard } from './middleware.js';
export type { GuardOptions, ResourceSpec } from './middleware.js';
export type {
  Subject,
  UserSubject,
  ApiKeySubject,
  ShareTokenSubject,
  AnonymousSubject,
  Resource,
  Action,
  Policy,
  PolicyResult,
  Decision,
  AuthorizationContext,
} from './types.js';
