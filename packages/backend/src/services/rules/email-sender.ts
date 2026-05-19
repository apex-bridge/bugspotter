/**
 * Email sender for `notify.email` actions.
 *
 * Sits between the rule dispatcher and the existing
 * `EmailChannelHandler`. The handler is the same nodemailer-based
 * sender the notification pipeline uses; we just resolve a project's
 * email channel + render a template + call `send`. No new SMTP
 * machinery.
 *
 * The recipient resolution rules mirror the schema's `EMAIL_TARGET_PATTERN`:
 *   - `reporter` -> `bugReport.metadata.metadata.user.email`. The
 *     value is SDK-controlled, so the dispatcher gates the send on a
 *     `ReporterVerifier` callback (see `dispatcher.ts`) that confirms
 *     the email maps to a member of the bug's organisation. In SaaS
 *     mode without a verifier wired, the send is skipped fail-closed.
 *     In selfhosted mode (`organization_id === null`) the verifier
 *     never runs — there's no org-membership concept, so the historical
 *     "trust the SDK" behaviour stays.
 *   - `closer` and `all_reporters` are recognised by the schema but
 *     not yet resolvable — they need the closer-identity / cluster-
 *     reporters wiring that the persona analysis flagged but didn't
 *     scope into Phase 0.5. Log and skip.
 *   - A literal email passes through. The per-org allowlist /
 *     confirmation flow that protects against `notify.email.to =
 *     'attacker@evil.com'` rules lands in a follow-up; until then,
 *     admin-gated rule creation remains the only gate on this branch.
 */

import type { NotificationChannelRepository } from '../../db/repositories/notification-channel.repository.js';
import type { EmailChannelHandler } from '../../services/notifications/email-handler.js';
import type { EmailChannelConfig } from '../../types/notifications.js';
import { getLogger } from '../../logger.js';
import { renderEmailTemplate } from './email-templates.js';
import type { RuleEvalContext } from './types.js';

const logger = getLogger();

export interface EmailSendRequest {
  /** Project whose email channel should send this. */
  projectId: string;
  /** Resolved literal email address. */
  to: string;
  /** Template id from the rule's `notify.email.template` field. */
  templateId: string;
  /** Vars for `{{path.to.value}}` substitution in the template. */
  vars: Record<string, unknown>;
}

/**
 * Boundary the dispatcher talks to. Implementations decide HOW the
 * email reaches the recipient — production uses `ChannelBackedEmailSender`
 * (real SMTP via the project's notification channel); tests inject a
 * stub returning `true` / `false`.
 */
export interface EmailSender {
  send(req: EmailSendRequest): Promise<boolean>;
}

/**
 * Auth gate for the `reporter` recipient token. The dispatcher calls
 * this before sending a `notify.email` whose `to` resolved from the
 * SDK-supplied reporter field. Returns `true` iff `email` matches an
 * org-member identity in `organizationId`. Throws and rejects are
 * surfaced; the dispatcher treats both as "not verified" and skips.
 *
 * Production wires this to
 * `db.organizationMembers.existsByOrganizationAndEmail`. Tests inject
 * a stub. Selfhosted deployments leave it unset — `bugReport.organization_id`
 * is null there, so the dispatcher never calls the verifier and the
 * historical pre-Phase-0.5 trust-the-SDK behaviour is preserved.
 */
export type ReporterVerifier = (organizationId: string, email: string) => Promise<boolean>;

/**
 * Production sender — looks up the project's first active email
 * channel and dispatches via `EmailChannelHandler`. Returns `false`
 * on any expected failure (no channel, unknown template, SMTP
 * error). Errors are logged but never thrown — the executor relies
 * on the dispatcher contract that nothing propagates back.
 */
export class ChannelBackedEmailSender implements EmailSender {
  constructor(
    private readonly channels: NotificationChannelRepository,
    private readonly handler: EmailChannelHandler
  ) {}

  async send(req: EmailSendRequest): Promise<boolean> {
    // Resolve the project's email channel. `findAll` is fine here —
    // a project rarely has more than one email channel; if it has
    // many, we take the first active row. PR-D's admin UI can
    // surface a per-rule channel override if that becomes a real
    // user need.
    let channels;
    try {
      channels = await this.channels.findAll({
        project_id: req.projectId,
        type: 'email',
        active: true,
      });
    } catch (error) {
      logger.warn('EmailSender: channel lookup failed', {
        projectId: req.projectId,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
    const channel = channels[0];
    if (!channel) {
      logger.info('EmailSender: no active email channel for project, skipping', {
        projectId: req.projectId,
        templateId: req.templateId,
      });
      return false;
    }

    const rendered = renderEmailTemplate(req.templateId, req.vars);
    if (!rendered) {
      // renderEmailTemplate logs the unknown-id warn itself.
      return false;
    }

    try {
      const result = await this.handler.send(channel.config as unknown as EmailChannelConfig, {
        to: req.to,
        subject: rendered.subject,
        body: rendered.body,
      });
      if (!result.success) {
        logger.warn('EmailSender: handler reported failure', {
          projectId: req.projectId,
          templateId: req.templateId,
          error: result.error,
        });
        return false;
      }
      return true;
    } catch (error) {
      logger.warn('EmailSender: handler threw', {
        projectId: req.projectId,
        templateId: req.templateId,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }
}

/**
 * Resolve the `to` field of a `notify.email` action against the
 * eval context. Returns null when the recipient can't be resolved
 * — the dispatcher then skips with a log, same fail-closed pattern
 * as missing channels / unknown templates.
 */
export function resolveEmailRecipient(to: string, context: RuleEvalContext): string | null {
  if (to === 'reporter') {
    // SDK-supplied — `reports.ts` wraps the SDK payload under a
    // second-level `metadata` key, so the user object lives at
    // `bug_reports.metadata.metadata.user`.
    return readPath(context.bugReport.metadata, ['metadata', 'user', 'email']);
  }
  if (to === 'closer' || to === 'all_reporters') {
    // Not yet wired. `closer` needs the closer-identity tracking
    // that lives outside Phase 0.5; `all_reporters` needs a cluster-
    // reporters query. Both land in follow-ups once the persona
    // workflow actually demands them.
    logger.info('EmailSender: recipient token not yet wired', { to });
    return null;
  }
  // Literal email — the schema's regex validated the shape, but
  // NOT the recipient. A rule author could write
  // `notify.email.to = 'attacker@evil.com'` and exfiltrate bug data
  // (subject + body include canonical title / status from the bug
  // report). Rule creation is admin-gated (no public rule API), so
  // this matches "admin-writes-rule sees bug data" which is the
  // status quo; PR-D's admin UI surfaces per-org allowlist /
  // confirmation flows before non-admin tenant users get to author
  // rules. Until then, treat literal `notify.email.to` as
  // trust-but-document.
  return to;
}

/**
 * Safe path traversal helper. Returns a string when the path
 * resolves to a string, null otherwise.
 */
function readPath(obj: unknown, path: string[]): string | null {
  let cur: unknown = obj;
  for (const key of path) {
    if (cur === null || cur === undefined || typeof cur !== 'object') {
      return null;
    }
    cur = (cur as Record<string, unknown>)[key];
  }
  return typeof cur === 'string' && cur.length > 0 ? cur : null;
}
