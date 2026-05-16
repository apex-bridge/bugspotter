/**
 * Public surface of the dedup-rule engine. Trigger handlers (the dedup
 * service, the outbox worker) only need `DedupRuleExecutor` and the
 * `TriggerType` enum; the rest is exported for the small wiring helper
 * that constructs the executor from `DatabaseClient` + the plugin
 * registry.
 */

export { DedupRuleExecutor } from './executor.js';
export type { RuleContextProvider } from './executor.js';
export { DatabaseRuleContextProvider } from './context-provider.js';
export { DefaultActionDispatcher, TicketsTableResolver } from './dispatcher.js';
export type { CanonicalTicketResolver, CapabilityServiceLookup } from './dispatcher.js';
export { ThrottleBackedRateLimiter, windowStringToMinutes } from './rate-limiter.js';
export { evaluateConditions } from './evaluator.js';
export type {
  ActionDispatcher,
  RuleEvalContext,
  RuleFireResult,
  RuleRateLimiter,
  TriggerType,
} from './types.js';
