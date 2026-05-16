/**
 * Action dispatcher for the dedup-rule engine (PR-C slice).
 *
 * Routes `ticket.add_comment` and `ticket.transition` actions to the
 * platform-neutral capability interface introduced in PR #142.
 * `notify.email` / `notify.slack` / `notify.webhook` log a one-shot
 * info message and skip — those land in PR-C2 (email), PR-D (slack /
 * webhook), so they're recognised by the schema but no-op at runtime.
 *
 * The dispatcher takes its dependencies via constructor so the
 * executor stays unit-testable: tests inject a stub
 * `TicketIntegrationCapabilities` instance instead of the real
 * Jira/Linear service.
 */

import type { DatabaseClient } from '../../db/client.js';
import type {
  TicketIntegrationCapabilities,
  CapabilityTarget,
} from '../../integrations/capabilities.js';
import { pluginSupports } from '../../integrations/capabilities.js';
import type { ActionSpec } from '../../integrations/dedup-rule.schema.js';
import { getLogger } from '../../logger.js';
import type { ActionDispatcher, RuleEvalContext } from './types.js';

const logger = getLogger();

/**
 * Resolves the canonical bug's external ticket coordinates so a
 * ticket.* action knows what to address. The minimal lookup the
 * dispatcher needs: (externalId, projectId, integrationId) — see
 * `CapabilityTarget`.
 *
 * Takes `expectedProjectId` and is responsible for verifying that the
 * resolved ticket belongs to it. `bug_reports.id` is a globally-unique
 * UUID, so a cross-project collision shouldn't happen in normal
 * operation; the scope check is defense-in-depth against a stale rule
 * pointing at a bug that was moved/recreated under another project.
 * Returning `null` on mismatch is the safe behaviour — the dispatcher
 * skips the action rather than acting on the wrong tenant's ticket.
 */
export interface CanonicalTicketResolver {
  resolve(canonicalBugId: string, expectedProjectId: string): Promise<CapabilityTarget | null>;
}

/**
 * Factory that returns a ticket-capability service for the given
 * (project, integration) pair, or null if the integration is not
 * usable (disabled / missing / wrong project — all reasons live in
 * the underlying `IntegrationPluginRegistry`). The dispatcher uses
 * this rather than reaching into the plugin registry directly so the
 * tests can stub a single function.
 */
export type CapabilityServiceLookup = (
  integrationId: string,
  projectId: string
) => Promise<TicketIntegrationCapabilities | null>;

export class DefaultActionDispatcher implements ActionDispatcher {
  constructor(
    private readonly resolver: CanonicalTicketResolver,
    private readonly lookupService: CapabilityServiceLookup
  ) {}

  /**
   * Synchronous capability probe — used by the executor to skip
   * rules whose actions can't run yet, so the rate-limit slot
   * isn't consumed for zero work. Keep in sync with `dispatch` below.
   */
  canDispatch(action: ActionSpec): boolean {
    switch (action.type) {
      case 'ticket.add_comment':
      case 'ticket.transition':
        return true;
      case 'notify.email':
      case 'notify.slack':
      case 'notify.webhook':
        // PR-C2 (email) + PR-D (slack / webhook) flip these to true
        // as the wiring lands.
        return false;
      default: {
        const _exhaustive: never = action;
        void _exhaustive;
        return false;
      }
    }
  }

  async dispatch(context: RuleEvalContext, action: ActionSpec): Promise<boolean> {
    switch (action.type) {
      case 'ticket.add_comment':
        return this.dispatchTicketAddComment(context, action.body);
      case 'ticket.transition':
        return this.dispatchTicketTransition(context, action.to);
      case 'notify.email':
      case 'notify.slack':
      case 'notify.webhook':
        // Recognised but not yet wired — log once at info so deploys
        // running with a seeded rule of this shape don't look broken,
        // but we don't spam the error stream.
        logger.info('Rule action type not yet implemented, skipping', {
          actionType: action.type,
          bugReportId: context.bugReport.id,
        });
        return false;
      default: {
        // Exhaustiveness check — if a new ActionSpec variant is added
        // to the schema and not handled here, the assignment fails to
        // typecheck.
        const _exhaustive: never = action;
        void _exhaustive;
        return false;
      }
    }
  }

  private async dispatchTicketAddComment(context: RuleEvalContext, body: string): Promise<boolean> {
    const target = await this.resolveTarget(context);
    if (!target) {
      return false;
    }
    const service = await this.lookupService(target.integrationId, target.projectId);
    if (!pluginSupports(service, 'addComment')) {
      logger.info('Skipping ticket.add_comment: integration does not support addComment', {
        integrationId: target.integrationId,
        bugReportId: context.bugReport.id,
      });
      return false;
    }
    try {
      // `pluginSupports` proved the method exists; the cast is the
      // narrowest way to satisfy the optional-method signature.
      await service!.addComment!(target, body);
      return true;
    } catch (error) {
      logger.error('ticket.add_comment dispatch failed', {
        integrationId: target.integrationId,
        bugReportId: context.bugReport.id,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  private async dispatchTicketTransition(
    context: RuleEvalContext,
    to: 'open' | 'in_progress' | 'closed' | 'wont_fix'
  ): Promise<boolean> {
    const target = await this.resolveTarget(context);
    if (!target) {
      return false;
    }
    const service = await this.lookupService(target.integrationId, target.projectId);
    if (!pluginSupports(service, 'transition')) {
      logger.info('Skipping ticket.transition: integration does not support transition', {
        integrationId: target.integrationId,
        bugReportId: context.bugReport.id,
      });
      return false;
    }
    try {
      await service!.transition!(target, to);
      return true;
    } catch (error) {
      logger.error('ticket.transition dispatch failed', {
        integrationId: target.integrationId,
        bugReportId: context.bugReport.id,
        targetStatus: to,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  private async resolveTarget(context: RuleEvalContext): Promise<CapabilityTarget | null> {
    const canonicalId = context.canonical?.id ?? context.bugReport.duplicate_of;
    if (!canonicalId) {
      // No canonical -> no external ticket to act on. Common for
      // duplicate_detected events where the canonical was hard-deleted
      // between the dedup decision and our handler firing.
      logger.debug('Skipping ticket action: no canonical to resolve', {
        bugReportId: context.bugReport.id,
      });
      return null;
    }
    // Scope the resolution to the firing rule's project. The resolver
    // returns null if the canonical's project doesn't match — a stale
    // rule must never act on another tenant's ticket.
    const target = await this.resolver.resolve(canonicalId, context.projectId);
    if (!target) {
      // Canonical exists but has no external ticket on file — likely
      // dedup-suppressed its own outbox row before any ticket was
      // filed. Log at debug; not an error.
      logger.debug('Skipping ticket action: canonical has no external ticket', {
        canonicalId,
        bugReportId: context.bugReport.id,
      });
      return null;
    }
    return target;
  }
}

/**
 * Production `CanonicalTicketResolver` backed by the `tickets` table.
 * Picks the most-recent ticket if the canonical has more than one
 * (rare but possible: two integrations file in parallel before the
 * pre-file dedup grace lands). The `expectedProjectId` is enforced in
 * the SQL `WHERE` so a cross-project hit returns zero rows rather
 * than leaking a ticket into the wrong tenant's action.
 */
export class TicketsTableResolver implements CanonicalTicketResolver {
  constructor(private readonly db: DatabaseClient) {}

  async resolve(
    canonicalBugId: string,
    expectedProjectId: string
  ): Promise<CapabilityTarget | null> {
    const result = await this.db.getPool().query<{
      external_id: string;
      project_id: string;
      integration_id: string | null;
    }>(
      // Filter `br.deleted_at IS NULL` — without it, the resolver
      // bypasses the soft-delete guard that `loadCanonical` applies in
      // the context provider. When `context.canonical` is null because
      // the canonical was soft-deleted, the dispatcher's fallback to
      // `bugReport.duplicate_of` would otherwise reach this SQL and
      // happily resolve the soft-deleted canonical's external ticket,
      // letting the engine post comments / transitions to a ticket an
      // admin has just retired.
      `SELECT t.external_id, br.project_id, t.integration_id
       FROM application.tickets t
       JOIN application.bug_reports br ON br.id = t.bug_report_id
       WHERE t.bug_report_id = $1
         AND br.project_id = $2
         AND br.deleted_at IS NULL
         AND t.integration_id IS NOT NULL
       ORDER BY t.created_at DESC
       LIMIT 1`,
      [canonicalBugId, expectedProjectId]
    );
    const row = result.rows[0];
    if (!row || !row.integration_id) {
      return null;
    }
    return {
      externalId: row.external_id,
      projectId: row.project_id,
      integrationId: row.integration_id,
    };
  }
}
