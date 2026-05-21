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
import type {
  EmailSender,
  LiteralRecipientAllowlistProvider,
  ReporterVerifier,
} from './email-sender.js';
import { isLiteralRecipient, resolveEmailRecipient } from './email-sender.js';
import type { RecipientRateLimiter } from './recipient-rate-limiter.js';
import type { TelegramSender, TelegramTokenResolver } from './telegram-sender.js';
import type { WebhookSender } from './webhook-sender.js';
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

/**
 * Dispatcher dependencies. Passed as a single object so callers
 * don't have to remember a 9-arg positional signature and so adding
 * a new sender (slack next) is an additive field on this interface
 * rather than another positional slot. Required fields are the two
 * `ticket.*` collaborators; everything else is optional and gates
 * the matching `canDispatch` probe.
 */
export interface ActionDispatcherDeps {
  resolver: CanonicalTicketResolver;
  lookupService: CapabilityServiceLookup;
  /**
   * When provided, `notify.email` actions are dispatched via this
   * sender. Left optional so the executor's unit tests (and any
   * selfhosted deployment without notification channels) keep
   * working without forcing a sender to exist.
   */
  emailSender?: EmailSender;
  /**
   * Required in SaaS mode (where `bugReport.organization_id` is
   * non-null) to gate the `reporter` recipient token against
   * org-member identity. Without it, a SaaS rule with
   * `notify.email { to: 'reporter' }` fails closed.
   */
  verifyReporter?: ReporterVerifier;
  /**
   * Per-recipient throttle. Caps fan-out to a single address
   * across canonicals and rules — the per-(rule, canonical)
   * throttle alone doesn't bound this. Tests can omit it;
   * production wiring always passes one.
   */
  recipientRateLimiter?: RecipientRateLimiter;
  /**
   * Per-org allowlist for literal `notify.email.to`. Only consulted
   * for literal recipients (tokens like `'reporter'` bypass — they
   * have their own auth check). Empty / unset list preserves legacy
   * trust-the-admin behaviour.
   */
  literalRecipientAllowlist?: LiteralRecipientAllowlistProvider;
  /**
   * Telegram bot-API sender. Must be paired with
   * `telegramTokenResolver`; one without the other is a wiring bug
   * and `canDispatch('notify.telegram')` reflects that.
   */
  telegramSender?: TelegramSender;
  /**
   * Resolves the org's bot token (decrypted plaintext) for
   * `notify.telegram` dispatch. Returns `null` when no token is
   * configured — dispatcher treats that as "skip cleanly".
   */
  telegramTokenResolver?: TelegramTokenResolver;
  /**
   * Generic-webhook sender. No per-org credential — the URL itself
   * is the auth (per Slack/Discord incoming-webhook convention).
   */
  webhookSender?: WebhookSender;
}

export class DefaultActionDispatcher implements ActionDispatcher {
  constructor(private readonly deps: ActionDispatcherDeps) {}

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
        // Wired in PR-C2 when an EmailSender is provided. Without
        // one (test harness, selfhosted with no channels configured)
        // we still report false so the rule skips cleanly.
        return this.deps.emailSender !== undefined;
      case 'notify.slack':
        // Slack dispatcher still pending — separate PR queued after
        // this one (needs per-org bot-token storage + chat.postMessage
        // wiring; bigger scope than the generic webhook).
        return false;
      case 'notify.webhook':
        return this.deps.webhookSender !== undefined;
      case 'notify.telegram':
        // Requires BOTH a sender and a token resolver. One without
        // the other is a wiring bug; the rule skips cleanly.
        return (
          this.deps.telegramSender !== undefined && this.deps.telegramTokenResolver !== undefined
        );
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
        return this.dispatchEmail(context, action.to, action.template);
      case 'notify.telegram':
        return this.dispatchTelegram(context, action.chat_id, action.message);
      case 'notify.webhook':
        return this.dispatchWebhook(context, action.url, action.payload ?? null);
      case 'notify.slack':
        // Slack dispatcher pending — see canDispatch above. Log once
        // at info on a seeded slack rule so it doesn't look like the
        // engine is broken.
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
    const service = await this.deps.lookupService(target.integrationId, target.projectId);
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
    const service = await this.deps.lookupService(target.integrationId, target.projectId);
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

  private async dispatchEmail(
    context: RuleEvalContext,
    to: string,
    templateId: string
  ): Promise<boolean> {
    if (!this.deps.emailSender) {
      // Defensive — `canDispatch` already excludes this path when no
      // sender is wired, so the executor shouldn't actually call us
      // here. Log at info in case a custom dispatcher subclass
      // overrides only one of the two.
      logger.info('Skipping notify.email: no EmailSender wired', {
        bugReportId: context.bugReport.id,
      });
      return false;
    }
    const recipient = resolveEmailRecipient(to, context);
    if (!recipient) {
      // resolveEmailRecipient logs the reason (unknown token, missing
      // reporter email, etc).
      return false;
    }
    // Auth-bound `reporter` gate. The `reporter` field comes from the
    // SDK payload — a bug filer chooses any string for
    // `metadata.user.email`. SaaS mode requires it to match an
    // org-member identity before we'll relay bug data to it; without
    // a verifier wired we fail closed rather than silently regress to
    // the spammable shape. Selfhosted bugs have `organization_id ===
    // null` and skip the check entirely.
    if (to === 'reporter' && context.bugReport.organization_id !== null) {
      if (!this.deps.verifyReporter) {
        logger.warn('Skipping notify.email: SaaS mode without reporter verifier', {
          bugReportId: context.bugReport.id,
          organizationId: context.bugReport.organization_id,
        });
        return false;
      }
      let verified: boolean;
      try {
        verified = await this.deps.verifyReporter(context.bugReport.organization_id, recipient);
      } catch (error) {
        // Treat a verifier failure the same as "not verified" — the
        // worst-case alternative is leaking bug data on a transient
        // DB blip. The executor relies on this being non-throwing.
        // Log the error type/name, not `error.message`. A verifier
        // implementation could embed user-controlled strings (an email,
        // an org-name fragment from a SQL error) in the message;
        // sticking to the class name keeps logs PII-free.
        logger.warn('Skipping notify.email: reporter verifier threw', {
          bugReportId: context.bugReport.id,
          organizationId: context.bugReport.organization_id,
          errorType: error instanceof Error ? error.name : 'NonErrorThrown',
        });
        return false;
      }
      if (!verified) {
        // Email value itself is intentionally not logged — it's PII
        // and the boolean outcome is enough for ops.
        logger.info('Skipping notify.email: reporter not in org membership', {
          bugReportId: context.bugReport.id,
          organizationId: context.bugReport.organization_id,
        });
        return false;
      }
    }
    // Literal-recipient allowlist — closes the `notify.email.to =
    // 'attacker@evil.com'` exfiltration vector for orgs that opt in.
    // Skipped when `to` is a token (those have their own checks),
    // when there's no organization (selfhosted), when no provider is
    // wired (tests), or when the org's allowlist is empty/unset
    // (legacy trust-the-admin behaviour, soft rollout). Runs before
    // the rate limiter so a denied literal doesn't burn budget.
    if (
      this.deps.literalRecipientAllowlist &&
      context.bugReport.organization_id !== null &&
      isLiteralRecipient(to)
    ) {
      let allowlist: readonly string[] | null | undefined;
      try {
        allowlist = await this.deps.literalRecipientAllowlist(context.bugReport.organization_id);
      } catch (error) {
        // Fail closed on provider errors — same shape as the verifier
        // path. A DB hiccup shouldn't open the exfiltration vector.
        logger.warn('Skipping notify.email: literal allowlist provider threw', {
          bugReportId: context.bugReport.id,
          organizationId: context.bugReport.organization_id,
          errorType: error instanceof Error ? error.name : 'NonErrorThrown',
        });
        return false;
      }
      if (allowlist && allowlist.length > 0) {
        const target = recipient.trim().toLowerCase();
        const allowed = allowlist.some((entry) => entry.trim().toLowerCase() === target);
        if (!allowed) {
          logger.info('Skipping notify.email: literal recipient not on org allowlist', {
            bugReportId: context.bugReport.id,
            organizationId: context.bugReport.organization_id,
          });
          return false;
        }
      }
    }
    // Per-recipient throttle — caps fan-out to one address across
    // canonicals and rules. Runs after `verifyReporter` so unverified
    // recipients don't even count against the budget. Recipient stays
    // out of the log (PII); the limiter logs its own throttle hit.
    if (this.deps.recipientRateLimiter) {
      const allowed = await this.deps.recipientRateLimiter.check(
        recipient,
        context.bugReport.organization_id
      );
      if (!allowed) {
        logger.info('Skipping notify.email: recipient rate limit reached', {
          bugReportId: context.bugReport.id,
          organizationId: context.bugReport.organization_id,
        });
        return false;
      }
    }
    return this.deps.emailSender.send({
      projectId: context.projectId,
      to: recipient,
      templateId,
      vars: this.buildEmailVars(context),
    });
  }

  /**
   * Dispatch a `notify.telegram` action. Resolves the org's bot
   * token (decrypted plaintext) via the injected resolver and hands
   * off to the sender. Skips cleanly when no token is configured —
   * not every org runs Telegram. Fails closed on resolver errors.
   *
   * No PII in the success log (chat_id is identifying); the sender's
   * own logging carries enough for ops on the failure path.
   */
  private async dispatchTelegram(
    context: RuleEvalContext,
    chatId: string,
    message: string
  ): Promise<boolean> {
    if (!this.deps.telegramSender || !this.deps.telegramTokenResolver) {
      // `canDispatch` already excludes this — defensive no-op if a
      // subclass overrides one of the two.
      logger.info('Skipping notify.telegram: sender or token resolver not wired', {
        bugReportId: context.bugReport.id,
      });
      return false;
    }
    let token: string | null;
    try {
      token = await this.deps.telegramTokenResolver(context.bugReport.organization_id);
    } catch (error) {
      logger.warn('Skipping notify.telegram: token resolver threw', {
        bugReportId: context.bugReport.id,
        organizationId: context.bugReport.organization_id,
        errorType: error instanceof Error ? error.name : 'NonErrorThrown',
      });
      return false;
    }
    if (!token) {
      logger.info('Skipping notify.telegram: no bot token configured for org', {
        bugReportId: context.bugReport.id,
        organizationId: context.bugReport.organization_id,
      });
      return false;
    }
    // Per-recipient throttle (shared with notify.email) — keyed on
    // chat_id here. Caps fan-out to one Telegram chat across rules /
    // canonicals, same way it does for email recipients. Runs after
    // token resolution so an unconfigured org doesn't burn budget.
    if (this.deps.recipientRateLimiter) {
      const allowed = await this.deps.recipientRateLimiter.check(
        chatId,
        context.bugReport.organization_id
      );
      if (!allowed) {
        logger.info('Skipping notify.telegram: recipient rate limit reached', {
          bugReportId: context.bugReport.id,
          organizationId: context.bugReport.organization_id,
        });
        return false;
      }
    }
    return this.deps.telegramSender.send({ token, chatId, text: message });
  }

  /**
   * Dispatch a `notify.webhook` action. POSTs the payload as JSON to
   * the rule's URL. No per-org credential — the URL itself is the
   * auth (matches the Slack/Discord incoming-webhook convention).
   * Re-runs SSRF validation inside the sender as defense in depth.
   *
   * `payload` defaults to `{}` when the rule's action doesn't carry
   * one — the receiver gets a known shape even if the admin only
   * configured the URL. Templating (`{{bug.id}}` etc.) is a
   * follow-up if a real consumer asks for it.
   */
  private async dispatchWebhook(
    context: RuleEvalContext,
    url: string,
    payload: Record<string, unknown> | null
  ): Promise<boolean> {
    if (!this.deps.webhookSender) {
      logger.info('Skipping notify.webhook: sender not wired', {
        bugReportId: context.bugReport.id,
      });
      return false;
    }
    // Per-recipient throttle — keyed on URL. Caps fan-out to one
    // webhook endpoint the same way the email and telegram paths
    // cap their respective channels. Shared limiter, distinct hash
    // namespace (the input is the raw URL).
    if (this.deps.recipientRateLimiter) {
      const allowed = await this.deps.recipientRateLimiter.check(
        url,
        context.bugReport.organization_id
      );
      if (!allowed) {
        logger.info('Skipping notify.webhook: recipient rate limit reached', {
          bugReportId: context.bugReport.id,
          organizationId: context.bugReport.organization_id,
        });
        return false;
      }
    }
    return this.deps.webhookSender.send({ url, payload: payload ?? {} });
  }

  /**
   * Build the `{{path.to.value}}` substitution map handed to
   * `renderEmailTemplate`. Mirrors the few-shot examples in the
   * Pydantic prompt — rule authors can reference these in template
   * bodies. Keep additions backward-compatible: removing or
   * renaming a top-level key would silently break existing
   * templates.
   *
   * Currently populates `bug` and `canonical`. The shipped templates
   * also reference `{{hits.count}}` (used by `regression_alert`) and
   * `{{digest.body}}` (used by `weekly_digest`); both render as empty
   * strings today because the triggers that would populate them
   * (`cluster_growing`, `schedule`) aren't wired in this PR. The
   * fixes land alongside those triggers — `hits` from the windowed
   * count already resolved by `RuleContextProvider.countHitsInWindow`,
   * `digest` from the schedule-trigger context. The unused templates
   * are kept in the registry so PR-D's seed rules can reference them
   * without a second round-trip.
   */
  private buildEmailVars(context: RuleEvalContext): Record<string, unknown> {
    return {
      bug: {
        id: context.bugReport.id,
        title: context.bugReport.title,
        priority: context.bugReport.priority,
      },
      canonical: context.canonical
        ? {
            id: context.canonical.id,
            title: context.canonical.title,
            status: context.canonical.status,
          }
        : null,
    };
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
    const target = await this.deps.resolver.resolve(canonicalId, context.projectId);
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
