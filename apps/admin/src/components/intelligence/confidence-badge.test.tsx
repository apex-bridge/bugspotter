import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConfidenceBadge } from './confidence-badge';

vi.mock('react-i18next', async () => {
  const en = (await import('../../i18n/locales/en.json')).default;

  const getTranslation = (key: string): string | undefined => {
    const result = key
      .split('.')
      .reduce<unknown>(
        (obj, part) =>
          obj != null && typeof obj === 'object'
            ? (obj as Record<string, unknown>)[part]
            : undefined,
        en
      );
    return typeof result === 'string' ? result : undefined;
  };

  return {
    useTranslation: () => ({
      t: (key: string, opts?: Record<string, unknown>) => {
        const raw = getTranslation(key) ?? key;
        if (!opts) {
          return raw;
        }
        return raw.replace(/\{\{(\w+)\}\}/g, (_, k) => String(opts[k] ?? ''));
      },
      i18n: { language: 'en' },
    }),
  };
});

describe('ConfidenceBadge', () => {
  it('renders nothing when confidence is null', () => {
    const { container } = render(<ConfidenceBadge confidence={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when confidence is undefined', () => {
    const { container } = render(<ConfidenceBadge confidence={undefined} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when confidence is NaN', () => {
    const { container } = render(<ConfidenceBadge confidence={Number.NaN} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when confidence is +Infinity', () => {
    const { container } = render(<ConfidenceBadge confidence={Number.POSITIVE_INFINITY} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when confidence is -Infinity (would otherwise produce "-Infinity%" tooltip)', () => {
    const { container } = render(<ConfidenceBadge confidence={Number.NEGATIVE_INFINITY} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when confidence >= 0.85 (high)', () => {
    const { container } = render(<ConfidenceBadge confidence={0.85} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing at 1.0', () => {
    const { container } = render(<ConfidenceBadge confidence={1} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders "Needs review" when confidence < 0.6', () => {
    render(<ConfidenceBadge confidence={0.4} />);
    expect(screen.getByText('Needs review')).toBeInTheDocument();
  });

  it('renders "Needs review" at exact 0', () => {
    render(<ConfidenceBadge confidence={0} />);
    expect(screen.getByText('Needs review')).toBeInTheDocument();
  });

  it('renders "AI-suggested" for the muted band [0.6, 0.85)', () => {
    render(<ConfidenceBadge confidence={0.7} />);
    expect(screen.getByText('AI-suggested')).toBeInTheDocument();
  });

  it('renders "AI-suggested" at exact 0.6 (band lower bound)', () => {
    render(<ConfidenceBadge confidence={0.6} />);
    expect(screen.getByText('AI-suggested')).toBeInTheDocument();
  });

  it('embeds rounded percentage in tooltip', () => {
    render(<ConfidenceBadge confidence={0.423} />);
    const node = screen.getByText('Needs review').closest('[title]');
    expect(node?.getAttribute('title')).toContain('42%');
  });

  // Gating must use the displayed rounded score, not the raw float — otherwise
  // a value like 0.596 would show "Needs review" but the tooltip would read
  // "60%", contradicting the band the badge claims to be in.
  describe('boundary consistency (badge matches displayed percentage)', () => {
    it('0.596 rounds to 60% and shows the muted band, not "Needs review"', () => {
      render(<ConfidenceBadge confidence={0.596} />);
      expect(screen.queryByText('Needs review')).not.toBeInTheDocument();
      const node = screen.getByText('AI-suggested').closest('[title]');
      expect(node?.getAttribute('title')).toContain('60%');
    });

    it('0.846 rounds to 85% and hides the badge, not "AI-suggested"', () => {
      const { container } = render(<ConfidenceBadge confidence={0.846} />);
      expect(container.firstChild).toBeNull();
    });

    it('0.594 rounds to 59% and shows "Needs review"', () => {
      render(<ConfidenceBadge confidence={0.594} />);
      const node = screen.getByText('Needs review').closest('[title]');
      expect(node?.getAttribute('title')).toContain('59%');
    });

    it('0.844 rounds to 84% and shows "AI-suggested"', () => {
      render(<ConfidenceBadge confidence={0.844} />);
      const node = screen.getByText('AI-suggested').closest('[title]');
      expect(node?.getAttribute('title')).toContain('84%');
    });
  });
});
