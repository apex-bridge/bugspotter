/**
 * Hardcoded email-template registry for the dedup-rule engine.
 *
 * The Pydantic schema declares `notify.email.template` as a free
 * string, but the executor needs to translate it into a concrete
 * (subject, body) pair to hand to `EmailChannelHandler.send`. PR-D
 * will likely replace this with the `notification_templates` table
 * once the admin UI lets users edit dedup-rule templates; for now
 * the three presets that the seed rules will use live here.
 *
 * Interpolation is intentionally tiny: `{{path.to.value}}` is looked
 * up against the `vars` map, missing values render as empty string.
 * No conditionals, no escaping logic — these templates are short and
 * deterministic, and the body is delivered as plain text by the
 * channel handler anyway. (The handler's email-sending path uses
 * nodemailer with `html: body`, but we render plain prose; the
 * client treats it as text.)
 *
 * If a rule references an unknown template id, the executor logs a
 * warn and skips — same fail-closed pattern as missing channels.
 */

import { getLogger } from '../../logger.js';

const logger = getLogger();

export interface EmailTemplate {
  subject: string;
  body: string;
}

/**
 * Registry. Keep keys in sync with the seed rules in PR-D — adding
 * a new preset that references a template id not in this map will
 * silently no-op at runtime, so the integration test in PR-D should
 * assert every preset's template id resolves.
 */
const TEMPLATES: Record<string, EmailTemplate> = {
  // B1: "Notify reporter on dedup". Sent to the reporter of the bug
  // that was just identified as a duplicate.
  dedup_ack: {
    subject: 'Your bug report was matched to an existing issue',
    body: [
      'Thanks for filing — we grouped your report with an existing bug we are tracking.',
      '',
      'Canonical: {{canonical.title}}',
      'Status: {{canonical.status}}',
      '',
      'You will hear back when there is movement.',
    ].join('\n'),
  },

  // B3-adjacent: notify operations when a closed canonical is hit
  // again. Used by an opt-in regression-alert rule once that lands.
  regression_alert: {
    subject: 'Regression detected: {{canonical.title}}',
    body: [
      'A bug previously marked {{canonical.status}} has received a new occurrence.',
      '',
      'Canonical: {{canonical.title}}',
      'Hits in window: {{hits.count}}',
      '',
      'The canonical ticket has been reopened by the rule engine.',
    ].join('\n'),
  },

  // Placeholder for the weekly-digest preset that lands with the
  // schedule trigger in a later PR. Kept here so the registry is
  // the single source of truth.
  weekly_digest: {
    subject: 'BugSpotter weekly digest',
    body: 'Top clusters this week:\n\n{{digest.body}}',
  },
};

/**
 * Render `subject` + `body` for a known template. Returns null when
 * the id is unknown — callers should fail closed and log.
 */
export function renderEmailTemplate(
  templateId: string,
  vars: Record<string, unknown>
): EmailTemplate | null {
  const tmpl = TEMPLATES[templateId];
  if (!tmpl) {
    logger.warn('Unknown email template id, skipping render', { templateId });
    return null;
  }
  return {
    subject: interpolate(tmpl.subject, vars),
    body: interpolate(tmpl.body, vars),
  };
}

/** Exposed for tests. */
export function listKnownTemplateIds(): string[] {
  return Object.keys(TEMPLATES);
}

/**
 * Replace `{{path.to.value}}` tokens. Missing or non-stringifiable
 * values render as empty string — a missing canonical title is
 * better than an undefined-literal in the email body.
 *
 * **Interpolated values are HTML-escaped.** `EmailChannelHandler.send`
 * passes the rendered body to nodemailer as `html: payload.body`, so
 * any unescaped `<` or `&` from a variable would be interpreted as
 * markup. A malicious bug filer could otherwise put a `<script>` /
 * `<a href="javascript:...">` payload into a bug title and have it
 * land in the recipient's inbox (the `reporter` token resolves to a
 * different user than the bug-title author when one cluster spans
 * multiple submitters). The template strings themselves are trusted
 * — they live in code — so we ONLY escape the value, not the
 * surrounding template.
 */
function interpolate(template: string, vars: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, path: string) => {
    const segments = path.split('.');
    let cur: unknown = vars;
    for (const seg of segments) {
      if (cur === null || cur === undefined || typeof cur !== 'object') {
        return '';
      }
      cur = (cur as Record<string, unknown>)[seg];
    }
    if (cur === null || cur === undefined) {
      return '';
    }
    if (typeof cur === 'string') {
      return escapeHtml(cur);
    }
    if (typeof cur === 'number' || typeof cur === 'boolean') {
      // Numbers and booleans can't contain HTML, no escape needed.
      return String(cur);
    }
    return '';
  });
}

/**
 * Minimal HTML entity escape covering the five characters whose raw
 * appearance changes how a renderer parses the document. We don't
 * use a library here because the templates are short and the surface
 * is small; the equivalent of `lodash.escape`.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
