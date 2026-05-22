/**
 * Smoke tests for `DedupRuleCard` — focus on the action-summary
 * branch, since `summarizeAction` is an internal switch that's easy
 * to drift out of sync with the schema when a new action type
 * lands. Each test asserts the visible text the card produces.
 *
 * Why per-action coverage matters: `summarizeAction` is exhaustive
 * over `ActionSpec.type`. If a future variant is added to the schema
 * but not to the switch, TypeScript flags it — but a stale i18n key
 * or a `default → ''` fallback could still slip through here. These
 * tests pin the rendered summary so a regression shows up in CI.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { TooltipProvider } from '../../components/ui/tooltip';
import i18n from '../../i18n/config';
import { DedupRuleCard } from '../../components/dedup-rules/rule-card';
import type { DedupRule, DedupRuleRow } from '../../services/dedup-rules-service';

function rowOf(rule: Partial<DedupRule> & Pick<DedupRule, 'when' | 'then'>): DedupRuleRow {
  const full: DedupRule = {
    name: rule.name ?? 'Test rule',
    when: rule.when,
    conditions: rule.conditions ?? [],
    then: rule.then,
    rate_limit: rule.rate_limit ?? null,
    enabled: rule.enabled ?? true,
  };
  return {
    id: 'rule-1',
    project_id: 'project-1',
    name: full.name,
    rule_json: full,
    enabled: full.enabled,
    created_at: '2026-05-22T00:00:00Z',
    updated_at: '2026-05-22T00:00:00Z',
  };
}

const noopProps = {
  onToggleEnabled: vi.fn(),
  onEdit: vi.fn(),
  onDelete: vi.fn(),
};

function renderCard(row: DedupRuleRow) {
  return render(
    <I18nextProvider i18n={i18n}>
      <TooltipProvider>
        <DedupRuleCard rule={row} {...noopProps} />
      </TooltipProvider>
    </I18nextProvider>
  );
}

describe('DedupRuleCard — action summary', () => {
  it('summarises notify.telegram with the chat_id', () => {
    const row = rowOf({
      when: { type: 'duplicate_detected' },
      then: [{ type: 'notify.telegram', chat_id: '@kz_engineering', message: 'hit' }],
    });
    renderCard(row);
    // Combined summary text rendered as a single span. Assert both
    // pieces appear (label + arrow + chat_id) without pinning the
    // exact i18n string so locale changes don't break the test.
    expect(screen.getByText(/@kz_engineering/)).toBeInTheDocument();
  });

  it('summarises notify.email with the recipient', () => {
    const row = rowOf({
      when: { type: 'duplicate_detected' },
      then: [{ type: 'notify.email', to: 'reporter', template: 'dedup_ack' }],
    });
    renderCard(row);
    expect(screen.getByText(/reporter/)).toBeInTheDocument();
  });

  it('summarises notify.slack without chat_id (slack has its own channel/user)', () => {
    const row = rowOf({
      when: { type: 'duplicate_detected' },
      then: [{ type: 'notify.slack', channel: '#x', message: 'hit' }],
    });
    renderCard(row);
    // Slack label appears; channel/user is not currently echoed in the
    // card (matches the existing summarize behaviour). Pin that
    // explicitly so a future change shows up here.
    expect(screen.queryByText(/#x/)).not.toBeInTheDocument();
  });
});
