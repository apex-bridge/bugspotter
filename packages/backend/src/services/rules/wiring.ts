/**
 * Wiring helpers — construct a fully-configured `DedupRuleExecutor`
 * from the dependencies a trigger handler (the outbox worker, the
 * intelligence worker) already has.
 *
 * Kept separate from the executor itself so the executor module stays
 * a clean "logic only" boundary that can be unit-tested without the
 * plugin registry. The wiring here does talk to the DB (for the
 * integration -> platform name lookup) and to the plugin registry,
 * which is why callers want a single helper instead of constructing
 * five collaborators inline.
 */

import type { DatabaseClient } from '../../db/client.js';
import { DedupRuleRepository } from '../../db/dedup-rule.repository.js';
import { NotificationThrottleRepository } from '../../db/repositories/notification-throttle.repository.js';
import type { TicketIntegrationCapabilities } from '../../integrations/capabilities.js';
import type { PluginRegistry } from '../../integrations/plugin-registry.js';
import { getLogger } from '../../logger.js';
import { DatabaseRuleContextProvider } from './context-provider.js';
import { DefaultActionDispatcher, TicketsTableResolver } from './dispatcher.js';
import type { CapabilityServiceLookup } from './dispatcher.js';
import { DedupRuleExecutor } from './executor.js';
import { ThrottleBackedRateLimiter } from './rate-limiter.js';

const logger = getLogger();

/**
 * Build the capability-service lookup that the dispatcher needs. Given
 * an `integrationId` (a `project_integrations.id`), discovers the
 * platform name by joining `project_integrations -> integrations.type`
 * and asks the plugin registry for the matching service.
 *
 * The registry returns services typed as `IntegrationService` — the
 * capability methods (`addComment`, `transition`, `getStatus`) live on
 * the wider `TicketIntegrationCapabilities` interface, so we cast
 * here. The dispatcher uses `pluginSupports` before calling any
 * optional method, which is the actual runtime guard.
 */
export function buildCapabilityServiceLookup(
  db: DatabaseClient,
  pluginRegistry: PluginRegistry
): CapabilityServiceLookup {
  return async (
    integrationId: string,
    projectId: string
  ): Promise<TicketIntegrationCapabilities | null> => {
    try {
      // Scope the lookup by both project_integrations.id AND
      // project_id. The id alone is a UUID and globally unique in
      // practice, but the join lets an integration from project A
      // resolve under a request scoped to project B if upstream code
      // ever swaps the ids by mistake. Adding the project_id check
      // means a cross-project hit returns zero rows -> null -> the
      // dispatcher skips the action. Same defense-in-depth pattern
      // used by TicketsTableResolver.
      const result = await db.getPool().query<{ platform: string; enabled: boolean }>(
        `SELECT i.type AS platform, pi.enabled
         FROM application.project_integrations pi
         JOIN application.integrations i ON i.id = pi.integration_id
         WHERE pi.id = $1
           AND pi.project_id = $2`,
        [integrationId, projectId]
      );
      const row = result.rows[0];
      if (!row || !row.enabled) {
        return null;
      }
      const service = pluginRegistry.get(row.platform);
      if (!service) {
        return null;
      }
      return service as unknown as TicketIntegrationCapabilities;
    } catch (error) {
      logger.warn('CapabilityServiceLookup: integration lookup failed', {
        integrationId,
        projectId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  };
}

/**
 * One-shot constructor. Trigger handlers call this once at startup and
 * reuse the returned executor across firings.
 */
export function buildDedupRuleExecutor(
  db: DatabaseClient,
  pluginRegistry: PluginRegistry
): DedupRuleExecutor {
  const pool = db.getPool();
  const repo = new DedupRuleRepository(pool);
  const throttle = new NotificationThrottleRepository(pool);
  const resolver = new TicketsTableResolver(db);
  const lookup = buildCapabilityServiceLookup(db, pluginRegistry);
  const dispatcher = new DefaultActionDispatcher(resolver, lookup);
  const rateLimiter = new ThrottleBackedRateLimiter(throttle);
  const contextProvider = new DatabaseRuleContextProvider(db);
  return new DedupRuleExecutor(repo, dispatcher, rateLimiter, contextProvider);
}
