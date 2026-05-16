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
 * Interpolation is `{{path.to.value}}`, looked up against the `vars`
 * map; missing values render as empty string.
 *
 * Two rendering modes:
 *   - **Subject**: plain text (per RFC 5322). Interpolated values
 *     are NOT HTML-escaped — entities would render literally in the
 *     inbox.
 *   - **Body**: HTML (the channel handler sends with nodemailer's
 *     `html:` field). Interpolated values ARE HTML-escaped to block
 *     `<script>` payloads from user-controlled fields, and `\n` in
 *     the rendered output is replaced with `<br>` because HTML
 *     collapses runs of whitespace.
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
 *
 * The subject and body have different rendering rules:
 *  - **Subject** is the email's `Subject:` header, which is plain
 *    text per RFC 5322. HTML-escaping it would produce visible
 *    entities (`&amp;`, `&lt;`) in the recipient's inbox. We render
 *    it without escaping.
 *  - **Body** is delivered via `EmailChannelHandler` as
 *    nodemailer's `html:`, so it MUST be HTML-escaped (XSS via
 *    user-controlled values) AND newlines must be converted to
 *    `<br>` because HTML collapses whitespace runs.
 *
 * If `EmailChannelHandler` ever switches to dual `text:` + `html:`,
 * this layer can render both. Today it doesn't, so we render HTML
 * and hand it to the handler as-is.
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
    subject: interpolate(tmpl.subject, vars, { escape: false }),
    body: interpolate(tmpl.body, vars, { escape: true }).replace(/\r?\n/g, '<br>'),
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
 * **`escape: true`** (the body case) HTML-escapes every interpolated
 * string. Without this, a malicious bug filer could put a
 * `<script>` / `<a href="javascript:...">` payload into a bug title
 * and have it land in the recipient's inbox as live markup (the
 * channel handler sends with nodemailer's `html:` field).
 *
 * **`escape: false`** (the subject case) skips the escape because
 * the Subject header is plain text per RFC 5322 — entities would
 * render literally (`&amp;` etc).
 *
 * In either case, only the value side is touched. Template strings
 * are trusted code.
 */
function interpolate(
  template: string,
  vars: Record<string, unknown>,
  opts: { escape: boolean }
): string {
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
      return opts.escape ? escapeHtml(cur) : cur;
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
