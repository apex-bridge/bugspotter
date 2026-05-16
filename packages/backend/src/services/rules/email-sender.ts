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
 *   - `reporter` -> `bugReport.metadata.metadata.user.email` (the SDK-
 *     supplied reporter email on the duplicate that just fired the
 *     rule; legitimate spam-vector concern is bounded because the
 *     rate-limit applies per (rule, canonical) and the "reporter" of
 *     a duplicate is whoever submitted that specific duplicate)
 *   - `closer` and `all_reporters` are recognised by the schema but
 *     not yet resolvable — they need the closer-identity / cluster-
 *     reporters wiring that the persona analysis flagged but didn't
 *     scope into Phase 0.5. Log and skip.
 *   - A literal email passes through.
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
