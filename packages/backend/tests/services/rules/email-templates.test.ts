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
});
