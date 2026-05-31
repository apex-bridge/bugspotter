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
});
