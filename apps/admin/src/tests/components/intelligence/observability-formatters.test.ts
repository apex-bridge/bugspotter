import { describe, it, expect } from 'vitest';
import {
  buildByDayCsv,
  formatCostUsd,
  formatLatencyMs,
  formatPercent,
} from '../../../components/intelligence/observability-formatters';

describe('buildByDayCsv', () => {
  it('emits a header and one row per day, with cost in dollars', () => {
    const csv = buildByDayCsv([
      { day: '2026-06-13', calls: 3, cost_micros_usd: 1_200_000, tokens_in: 500, tokens_out: 200 },
      { day: '2026-06-14', calls: 1, cost_micros_usd: 0, tokens_in: 40, tokens_out: 10 },
    ]);
    expect(csv).toBe(
      'day,calls,tokens_in,tokens_out,cost_usd\n' +
        '2026-06-13,3,500,200,1.200000\n' +
        '2026-06-14,1,40,10,0.000000'
    );
  });

  it('returns just the header for no rows', () => {
    expect(buildByDayCsv([])).toBe('day,calls,tokens_in,tokens_out,cost_usd');
  });
});

describe('formatCostUsd', () => {
  it('returns the em-dash sentinel for null / undefined / NaN', () => {
    expect(formatCostUsd(null)).toBe('—');
    expect(formatCostUsd(undefined)).toBe('—');
    expect(formatCostUsd(Number.NaN)).toBe('—');
  });

  it('formats sub-dollar amounts with 4 fraction digits (cheap LLM calls)', () => {
    // 7500 micros = $0.0075
    expect(formatCostUsd(7500, 'en-US')).toBe('$0.0075');
  });

  it('formats >= $1 amounts with 2 fraction digits', () => {
    expect(formatCostUsd(12_340_000, 'en-US')).toBe('$12.34');
  });

  it('formats zero cents as $0.0000 (not the sentinel — zero is a real datum)', () => {
    expect(formatCostUsd(0, 'en-US')).toBe('$0.0000');
  });
});

describe('formatLatencyMs', () => {
  it('returns the em-dash sentinel for null', () => {
    expect(formatLatencyMs(null)).toBe('—');
    expect(formatLatencyMs(undefined)).toBe('—');
  });

  it('rounds to integer milliseconds', () => {
    expect(formatLatencyMs(123.4)).toBe('123 ms');
    expect(formatLatencyMs(0)).toBe('0 ms');
    expect(formatLatencyMs(999.6)).toBe('1000 ms');
  });
});

describe('formatPercent', () => {
  it('returns the em-dash sentinel for null', () => {
    expect(formatPercent(null)).toBe('—');
    expect(formatPercent(undefined)).toBe('—');
    expect(formatPercent(Number.NaN)).toBe('—');
  });

  it('formats a [0,1] fraction with one decimal by default', () => {
    expect(formatPercent(0.123, 1, 'en-US')).toBe('12.3%');
    expect(formatPercent(0, 1, 'en-US')).toBe('0.0%');
    expect(formatPercent(1, 1, 'en-US')).toBe('100.0%');
  });

  it('rejects out-of-range values rather than rendering "150%"', () => {
    expect(formatPercent(-0.1, 1, 'en-US')).toBe('—');
    expect(formatPercent(1.5, 1, 'en-US')).toBe('—');
  });
});
