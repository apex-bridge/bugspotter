/**
 * Unit tests for the email-template registry.
 *
 * Covers:
 *  - known template ids render
 *  - {{path.to.value}} interpolation, nested lookup
 *  - missing variables render as empty string (not the literal token)
 *  - unknown template id returns null (caller fails closed)
 *  - the three preset ids referenced by the Phase 0.5 plan exist
 */

import { describe, it, expect } from 'vitest';
import {
  listKnownTemplateIds,
  renderEmailTemplate,
} from '../../../src/services/rules/email-templates.js';

describe('renderEmailTemplate', () => {
  it('returns null for an unknown template id (caller fail-closes)', () => {
    expect(renderEmailTemplate('does-not-exist', {})).toBeNull();
  });

  it('renders subject + body for dedup_ack', () => {
    const rendered = renderEmailTemplate('dedup_ack', {
      canonical: { title: 'Login crash on iOS', status: 'in_progress' },
    });
    expect(rendered).not.toBeNull();
    expect(rendered!.subject).toBe('Your bug report was matched to an existing issue');
    expect(rendered!.body).toContain('Login crash on iOS');
    expect(rendered!.body).toContain('in_progress');
  });

  it('substitutes nested {{path.to.value}} tokens', () => {
    const rendered = renderEmailTemplate('regression_alert', {
      canonical: { title: 'Stripe webhook 502', status: 'closed' },
      hits: { count: 14 },
    });
    expect(rendered!.subject).toBe('Regression detected: Stripe webhook 502');
    expect(rendered!.body).toContain('Hits in window: 14');
    expect(rendered!.body).toContain('previously marked closed');
  });

  it('renders missing variables as empty string (not the literal token)', () => {
    // No canonical.* provided — the dedup_ack body references
    // canonical.title and canonical.status. Both should expand to
    // empty string, leaving the surrounding prose intact.
    const rendered = renderEmailTemplate('dedup_ack', {});
    expect(rendered!.body).not.toContain('{{');
    expect(rendered!.body).not.toContain('}}');
  });

  it('handles number / boolean leaves correctly', () => {
    const rendered = renderEmailTemplate('regression_alert', {
      canonical: { title: 't', status: 's' },
      hits: { count: 0 }, // falsy number must still render as "0"
    });
    expect(rendered!.body).toContain('Hits in window: 0');
  });

  it('exposes the preset ids referenced by Phase 0.5 seed rules', () => {
    const ids = listKnownTemplateIds();
    expect(ids).toContain('dedup_ack');
    expect(ids).toContain('regression_alert');
    expect(ids).toContain('weekly_digest');
  });

  describe('subject vs body rendering', () => {
    // Subject is the email's plain-text `Subject:` header — escaping
    // would surface as literal entities in the inbox. Body is HTML
    // (nodemailer `html:` field), so it MUST be escaped (XSS) and
    // `\n` becomes `<br>` (HTML collapses whitespace).

    it('does NOT HTML-escape the subject (plain-text header)', () => {
      const rendered = renderEmailTemplate('regression_alert', {
        canonical: { title: 'A & B <c>', status: 'closed' },
        hits: { count: 0 },
      });
      // Subject contains `Regression detected: {{canonical.title}}` → no escape
      expect(rendered!.subject).toBe('Regression detected: A & B <c>');
      expect(rendered!.subject).not.toContain('&amp;');
    });

    it('HTML-escapes interpolated values in the body (XSS protection)', () => {
      // The rendered body is passed to nodemailer as `html:`, so any
      // un-escaped `<` or `&` from a variable becomes interpreted
      // markup.
      const rendered = renderEmailTemplate('dedup_ack', {
        canonical: { title: '<script>alert(1)</script>', status: 'open' },
      });
      expect(rendered!.body).not.toContain('<script>');
      expect(rendered!.body).toContain('&lt;script&gt;');
    });

    it('escapes & < > " and \' in body values', () => {
      const rendered = renderEmailTemplate('regression_alert', {
        canonical: {
          title: 'A & B <c> "d" \'e\'',
          status: 'closed',
        },
        hits: { count: 0 },
      });
      expect(rendered!.body).toContain('A &amp; B &lt;c&gt; &quot;d&quot; &#39;e&#39;');
    });

    it('does not escape numbers or booleans (no HTML chars possible)', () => {
      const rendered = renderEmailTemplate('regression_alert', {
        canonical: { title: 't', status: 's' },
        hits: { count: 42 },
      });
      expect(rendered!.body).toContain('Hits in window: 42');
    });

    it('escapes any future template var sourced from user input (defense-in-depth)', () => {
      const rendered = renderEmailTemplate('dedup_ack', {
        canonical: {
          title: '"><img src=x onerror=alert(1)>',
          status: 'closed',
        },
      });
      expect(rendered!.body).not.toMatch(/<img\s+src=/);
      expect(rendered!.body).toContain('&quot;&gt;&lt;img src=x onerror=alert(1)&gt;');
    });

    it('converts `\\n` to `<br>` in the body so multi-line templates render', () => {
      // HTML collapses runs of whitespace, so a template body with
      // explicit `\n` separators would otherwise appear as one
      // single line in the recipient's inbox.
      const rendered = renderEmailTemplate('dedup_ack', {
        canonical: { title: 'X', status: 'open' },
      });
      expect(rendered!.body).toContain('<br>');
      expect(rendered!.body).not.toContain('\n');
    });

    it('preserves `\\n` to `<br>` conversion through escaped values too', () => {
      // A user-supplied value containing a real newline gets the
      // same `<br>` treatment as the template's structural
      // newlines. That's intentional — multi-line bug titles render
      // as visible line breaks, not as collapsed whitespace.
      const rendered = renderEmailTemplate('dedup_ack', {
        canonical: { title: 'line1\nline2', status: 'open' },
      });
      expect(rendered!.body).toContain('line1<br>line2');
    });

    it('converts CRLF (`\\r\\n`) to `<br>` so Windows-supplied values render cleanly', () => {
      // A bug title pasted from a Windows clipboard arrives with CRLF.
      // The `\r` would otherwise survive as `\r<br>` and render as a
      // visible artifact in some clients.
      const rendered = renderEmailTemplate('dedup_ack', {
        canonical: { title: 'line1\r\nline2', status: 'open' },
      });
      expect(rendered!.body).toContain('line1<br>line2');
      expect(rendered!.body).not.toContain('\r');
    });
  });
});
