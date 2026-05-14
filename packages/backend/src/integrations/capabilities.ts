/**
 * Platform-neutral capability interface for ticket integrations.
 *
 * The first wave of integration plugins (Jira, Linear) only needed to *create*
 * tickets from bug reports — that's the `createFromBugReport` method on
 * `IntegrationService`. The dedup rule engine (and the upcoming Phase 0.5
 * automations: notify-on-dedup, counter-on-canonical, auto-reopen) needs
 * three more things from each plugin:
 *
 *   - comment on an existing ticket
 *   - transition an existing ticket to a different status
 *   - read the current status of an existing ticket
 *
 * Two design choices worth flagging:
 *
 * 1) **Canonical statuses at the capability boundary.** `transition(...)`
 *    accepts a `CanonicalStatus` (`'open' | 'in_progress' | 'closed' |
 *    'wont_fix'`) rather than a Jira transition-id or a Linear state UUID.
 *    Each plugin is responsible for mapping that to its own world — Jira
 *    does discovery via `/transitions`, Linear queries `team.states`. This
 *    keeps the rule engine (and the future NL parser) platform-neutral; the
 *    cost is one extra API call per transition, which is fine for the
 *    cadence of dedup automations.
 *
 * 2) **All three are optional.** A plugin can implement zero, one, or all
 *    three. The rule engine checks via `pluginRegistry.supports(...)` before
 *    dispatching an action. A plugin that only implements `addComment` will
 *    have its `transition` actions silently skipped (with a warning log) —
 *    rules don't break when a plugin is partial.
 */

import type { IntegrationService } from './base-integration.service.js';

// ============================================================================
// Canonical status
// ============================================================================

/**
 * Platform-neutral ticket status used by the rule engine.
 *
 * Mapping notes per platform (implementer's responsibility):
 *
 *   Jira:    derived from `statusCategory.key` — new → open, indeterminate →
 *            in_progress, done → closed. `wont_fix` is detected by status
 *            *name* (Won't Fix / Cancelled / Duplicate) since Jira lumps
 *            them into the `done` category.
 *
 *   Linear:  derived from `state.type` — triage/backlog/unstarted → open,
 *            started → in_progress, completed → closed, canceled → wont_fix.
 */
export type CanonicalStatus = 'open' | 'in_progress' | 'closed' | 'wont_fix';

export const CANONICAL_STATUSES: readonly CanonicalStatus[] = [
  'open',
  'in_progress',
  'closed',
  'wont_fix',
] as const;

export function isCanonicalStatus(value: unknown): value is CanonicalStatus {
  return typeof value === 'string' && (CANONICAL_STATUSES as readonly string[]).includes(value);
}

/**
 * Statuses we consider "the ticket is effectively closed" — used by the
 * auto-reopen rule to decide whether a new duplicate is a regression.
 */
export function isTerminalStatus(status: CanonicalStatus): boolean {
  return status === 'closed' || status === 'wont_fix';
}

// ============================================================================
// Capability methods
// ============================================================================

/**
 * Optional capability methods a ticket integration plugin may implement.
 *
 * Each is keyed by `externalId` (the ticket identifier the plugin returned
 * from `createFromBugReport`) and `projectId` (BugSpotter project) so the
 * plugin can resolve credentials and per-project config.
 */
export interface TicketIntegrationCapabilities extends IntegrationService {
  /**
   * Append a comment to an existing ticket.
   *
   * @param externalId Platform identifier (Jira key e.g. "PROJ-100", or
   *                   Linear issue UUID).
   * @param body       Comment body. Plugins may render markdown/templates
   *                   into platform-specific markup.
   * @param projectId  BugSpotter project id — used to resolve credentials.
   */
  addComment?(externalId: string, body: string, projectId: string): Promise<void>;

  /**
   * Move an existing ticket to a canonical status.
   *
   * Plugins resolve `target` to a platform-specific transition / state.
   * If the target status is unreachable from the current state (Jira
   * workflow restriction, missing transition), the plugin throws — the
   * rule engine is responsible for catching and degrading gracefully.
   */
  transition?(externalId: string, target: CanonicalStatus, projectId: string): Promise<void>;

  /**
   * Read the current canonical status of an existing ticket.
   *
   * Used by the auto-reopen rule to detect regressions on closed tickets.
   */
  getStatus?(externalId: string, projectId: string): Promise<CanonicalStatus>;
}

// ============================================================================
// Capability discovery
// ============================================================================

export type CapabilityName = 'addComment' | 'transition' | 'getStatus';

/**
 * Runtime check: does this service instance implement a given capability?
 *
 * The rule engine uses this to decide whether to dispatch an action or
 * skip it with a warning. We check via duck-typing rather than via
 * `instanceof` because plugins are loaded from many sources (built-in,
 * filesystem, database-loaded sandboxed plugins).
 */
export function pluginSupports(
  service: IntegrationService | undefined | null,
  capability: CapabilityName
): boolean {
  if (!service) {
    return false;
  }
  const candidate = service as unknown as Record<string, unknown>;
  return typeof candidate[capability] === 'function';
}
