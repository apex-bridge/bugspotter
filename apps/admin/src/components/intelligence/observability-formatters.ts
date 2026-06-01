/**
 * Small formatters used by the observability page.
 *
 * Kept in a sibling module so the page component stays declarative and the
 * functions can be unit-tested without rendering anything.
 */

/** Upstream stores cost in micro-dollars. NULL means "unknown / not priced
 *  by the local pricing map" (Ollama etc.), distinct from $0. */
export function formatCostUsd(micros: number | null | undefined, locale?: string): string {
  if (micros == null || !Number.isFinite(micros)) {
    return '—';
  }
  const dollars = micros / 1_000_000;
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: dollars < 1 ? 4 : 2,
    maximumFractionDigits: dollars < 1 ? 4 : 2,
  }).format(dollars);
}

/** Latency percentile from upstream is in milliseconds; show as integer-ms. */
export function formatLatencyMs(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) {
    return '—';
  }
  return `${Math.round(ms)} ms`;
}

/** 0..1 fraction → percentage with one decimal place. Out-of-range or null
 *  collapses to the dash sentinel — the upstream API contract is `[0, 1]`
 *  but rendering "150%" would be visibly broken. */
export function formatPercent(
  fraction: number | null | undefined,
  digits = 1,
  locale?: string
): string {
  if (fraction == null || !Number.isFinite(fraction) || fraction < 0 || fraction > 1) {
    return '—';
  }
  return new Intl.NumberFormat(locale, {
    style: 'percent',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(fraction);
}
