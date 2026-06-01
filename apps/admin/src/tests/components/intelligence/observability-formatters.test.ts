import { describe, it, expect } from 'vitest';
import {
  formatCostUsd,
  formatLatencyMs,
  formatPercent,
} from '../../../components/intelligence/observability-formatters';

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
