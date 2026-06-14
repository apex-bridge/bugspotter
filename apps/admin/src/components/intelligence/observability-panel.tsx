/**
 * AI Observability Panel
 *
 * Per-org dashboard that proxies the three upstream `/admin/observability/*`
 * endpoints (summary, events, accuracy). Read-only KPI cards + a recent-events
 * table; no charts (no charting library in the repo) — KPIs are CSS grid only.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Brain, ChevronDown, ChevronRight, Gauge } from 'lucide-react';
import { Badge } from '../ui/badge';
import { intelligenceService } from '../../services/intelligence-service';
import type { ObservabilityDayStat, ObservabilityEvent } from '../../types/intelligence';
import {
  buildByDayCsv,
  formatCostUsd,
  formatLatencyMs,
  formatPercent,
} from './observability-formatters';

/** Trigger a client-side CSV download of the per-day cost/usage rollup. */
function downloadByDayCsv(rows: ObservabilityDayStat[]): void {
  const blob = new Blob([buildByDayCsv(rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'ai-cost-by-day.csv';
  // Attach to the DOM before click() — a detached anchor's click() is ignored
  // in some browsers (older Firefox/Safari, sandboxed iframes).
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Defer the revoke — revoking synchronously after click() can cancel the
  // download in Firefox/Safari before it starts (matches the health-export pattern).
  setTimeout(() => URL.revokeObjectURL(url), 100);
}

interface ObservabilityPanelProps {
  orgId: string;
}

export function ObservabilityPanel({ orgId }: ObservabilityPanelProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;

  const summaryQuery = useQuery({
    queryKey: ['intelligence-observability-summary', orgId],
    queryFn: () => intelligenceService.getObservabilitySummary(orgId),
  });

  const accuracyQuery = useQuery({
    queryKey: ['intelligence-observability-accuracy', orgId],
    queryFn: () => intelligenceService.getObservabilityAccuracy(orgId),
  });

  const eventsQuery = useQuery({
    queryKey: ['intelligence-observability-events', orgId, 50, 0],
    queryFn: () => intelligenceService.getObservabilityEvents(orgId, { limit: 50, offset: 0 }),
  });

  const summaryError =
    summaryQuery.isError &&
    (summaryQuery.error as { response?: { status?: number } })?.response?.status === 503;

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-lg font-semibold text-gray-900">
          {t('intelligence.observability.title')}
        </h2>
        <p className="text-sm text-gray-600 mt-1">{t('intelligence.observability.description')}</p>
      </header>

      {summaryError ? (
        <div
          role="alert"
          className="border border-amber-200 bg-amber-50 rounded-lg p-4 flex items-start gap-3"
        >
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" aria-hidden="true" />
          <div>
            <p className="text-sm font-medium text-amber-900">
              {t('intelligence.observability.notConfigured.title')}
            </p>
            <p className="text-sm text-amber-800 mt-1">
              {t('intelligence.observability.notConfigured.body')}
            </p>
          </div>
        </div>
      ) : (
        <>
          {/* ─── KPI cards ─────────────────────────────────────────────── */}
          <section aria-labelledby="obs-summary-heading">
            <h3
              id="obs-summary-heading"
              className="text-sm font-medium text-gray-700 mb-3 flex items-center gap-2"
            >
              <Gauge className="w-4 h-4 text-purple-600" aria-hidden="true" />
              {t('intelligence.observability.summary.heading')}
            </h3>

            {summaryQuery.isLoading ? (
              <KpiSkeleton />
            ) : summaryQuery.data ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <KpiTile
                  label={t('intelligence.observability.summary.calls')}
                  value={summaryQuery.data.calls.toLocaleString(locale)}
                />
                <KpiTile
                  label={t('intelligence.observability.summary.cost')}
                  value={formatCostUsd(summaryQuery.data.cost_micros_usd, locale)}
                />
                <KpiTile
                  label={t('intelligence.observability.summary.p95')}
                  value={formatLatencyMs(summaryQuery.data.p95_ms)}
                  hint={t('intelligence.observability.summary.p50Hint', {
                    value: formatLatencyMs(summaryQuery.data.p50_ms),
                  })}
                />
                <KpiTile
                  label={t('intelligence.observability.summary.errorRate')}
                  value={formatPercent(summaryQuery.data.error_rate, 1, locale)}
                  emphasis={summaryQuery.data.error_rate > 0.05}
                />
              </div>
            ) : (
              <ErrorRow message={t('intelligence.observability.summary.loadFailed')} />
            )}

            {summaryQuery.data && summaryQuery.data.by_operation.length > 0 && (
              <div className="mt-4 border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-gray-600 text-xs uppercase">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium">
                        {t('intelligence.observability.summary.colOperation')}
                      </th>
                      <th className="text-right px-3 py-2 font-medium">
                        {t('intelligence.observability.summary.calls')}
                      </th>
                      <th className="text-right px-3 py-2 font-medium">
                        {t('intelligence.observability.summary.p50')}
                      </th>
                      <th className="text-right px-3 py-2 font-medium">
                        {t('intelligence.observability.summary.p95')}
                      </th>
                      <th className="text-right px-3 py-2 font-medium">
                        {t('intelligence.observability.summary.cost')}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {summaryQuery.data.by_operation.map((row) => (
                      <tr key={row.operation}>
                        <td className="px-3 py-2 font-mono text-xs">{row.operation}</td>
                        <td className="px-3 py-2 text-right">{row.calls.toLocaleString(locale)}</td>
                        <td className="px-3 py-2 text-right">{formatLatencyMs(row.p50_ms)}</td>
                        <td className="px-3 py-2 text-right">{formatLatencyMs(row.p95_ms)}</td>
                        <td className="px-3 py-2 text-right">
                          {formatCostUsd(row.cost_micros_usd, locale)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {summaryQuery.data && (summaryQuery.data.by_day?.length ?? 0) > 0 && (
              <div className="mt-4">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-sm font-medium text-gray-700">
                    {t('intelligence.observability.summary.byDayHeading')}
                  </h4>
                  <button
                    type="button"
                    onClick={() => downloadByDayCsv(summaryQuery.data?.by_day ?? [])}
                    className="text-xs text-primary hover:underline focus:outline-none focus:ring-2 focus:ring-primary rounded"
                  >
                    {t('intelligence.observability.summary.exportCsv')}
                  </button>
                </div>
                <div className="border rounded-lg overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-gray-600 text-xs uppercase">
                      <tr>
                        <th className="text-left px-3 py-2 font-medium">
                          {t('intelligence.observability.summary.colDay')}
                        </th>
                        <th className="text-right px-3 py-2 font-medium">
                          {t('intelligence.observability.summary.calls')}
                        </th>
                        <th className="text-right px-3 py-2 font-medium">
                          {t('intelligence.observability.summary.colTokensIn')}
                        </th>
                        <th className="text-right px-3 py-2 font-medium">
                          {t('intelligence.observability.summary.colTokensOut')}
                        </th>
                        <th className="text-right px-3 py-2 font-medium">
                          {t('intelligence.observability.summary.cost')}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {(summaryQuery.data.by_day ?? []).map((row) => (
                        <tr key={row.day}>
                          <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">
                            {row.day}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {row.calls.toLocaleString(locale)}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {row.tokens_in.toLocaleString(locale)}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {row.tokens_out.toLocaleString(locale)}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {formatCostUsd(row.cost_micros_usd, locale)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>

          {/* ─── Accuracy ─────────────────────────────────────────────── */}
          <section aria-labelledby="obs-accuracy-heading">
            <h3
              id="obs-accuracy-heading"
              className="text-sm font-medium text-gray-700 mb-3 flex items-center gap-2"
            >
              <Brain className="w-4 h-4 text-purple-600" aria-hidden="true" />
              {t('intelligence.observability.accuracy.heading')}
            </h3>

            {accuracyQuery.isLoading ? (
              <KpiSkeleton />
            ) : accuracyQuery.data ? (
              accuracyQuery.data.feedback_count === 0 ? (
                <p className="text-sm text-gray-500 italic">
                  {t('intelligence.observability.accuracy.empty')}
                </p>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <KpiTile
                    label={t('intelligence.observability.accuracy.precision')}
                    value={formatPercent(accuracyQuery.data.precision, 1, locale)}
                  />
                  <KpiTile
                    label={t('intelligence.observability.accuracy.feedbackCount')}
                    value={accuracyQuery.data.feedback_count.toLocaleString(locale)}
                  />
                  <KpiTile
                    label={t('intelligence.observability.accuracy.correct')}
                    value={accuracyQuery.data.correct.toLocaleString(locale)}
                  />
                  <KpiTile
                    label={t('intelligence.observability.accuracy.incorrect')}
                    value={accuracyQuery.data.incorrect.toLocaleString(locale)}
                  />
                </div>
              )
            ) : (
              <ErrorRow message={t('intelligence.observability.accuracy.loadFailed')} />
            )}
          </section>

          {/* ─── Recent events ────────────────────────────────────────── */}
          <section aria-labelledby="obs-events-heading">
            <h3 id="obs-events-heading" className="text-sm font-medium text-gray-700 mb-3">
              {t('intelligence.observability.events.heading')}
            </h3>

            {eventsQuery.isLoading ? (
              <KpiSkeleton />
            ) : eventsQuery.data ? (
              eventsQuery.data.events.length === 0 ? (
                <p className="text-sm text-gray-500 italic">
                  {t('intelligence.observability.events.empty')}
                </p>
              ) : (
                <div className="border rounded-lg overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-gray-600 text-xs uppercase">
                      <tr>
                        <th className="w-8 px-2 py-2">
                          <span className="sr-only">
                            {t('intelligence.observability.events.rationale')}
                          </span>
                        </th>
                        <th className="text-left px-3 py-2 font-medium">
                          {t('intelligence.observability.events.colTime')}
                        </th>
                        <th className="text-left px-3 py-2 font-medium">
                          {t('intelligence.observability.events.colOperation')}
                        </th>
                        <th className="text-left px-3 py-2 font-medium">
                          {t('intelligence.observability.events.colModel')}
                        </th>
                        <th className="text-right px-3 py-2 font-medium">
                          {t('intelligence.observability.events.colLatency')}
                        </th>
                        <th className="text-right px-3 py-2 font-medium">
                          {t('intelligence.observability.events.colCost')}
                        </th>
                        <th className="text-left px-3 py-2 font-medium">
                          {t('intelligence.observability.events.colStatus')}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {eventsQuery.data.events.map((e) => (
                        <ObservabilityEventRow
                          key={e.id}
                          event={e}
                          locale={locale}
                          rationaleLabel={t('intelligence.observability.events.rationale')}
                          toggleLabel={t('intelligence.observability.events.rationaleToggle', {
                            operation: e.operation,
                          })}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            ) : (
              <ErrorRow message={t('intelligence.observability.events.loadFailed')} />
            )}
          </section>
        </>
      )}
    </div>
  );
}

interface ObservabilityEventRowProps {
  event: ObservabilityEvent;
  locale: string;
  /** Visible "AI rationale" heading on the expanded sub-row. */
  rationaleLabel: string;
  /** Per-row unique button label (e.g. "AI rationale for enrich") for screen readers. */
  toggleLabel: string;
}

/**
 * One events-table row that can expand to reveal the LLM's rationale. Owns its
 * own expand state, so it resets naturally when the row unmounts (org switch,
 * refetch) — no shared expanded-id set to go stale.
 */
function ObservabilityEventRow({
  event,
  locale,
  rationaleLabel,
  toggleLabel,
}: ObservabilityEventRowProps) {
  const [expanded, setExpanded] = useState(false);
  const hasRationale = event.rationale != null && event.rationale.trim() !== '';

  return (
    <>
      <tr>
        <td className="px-2 py-2 align-top">
          {hasRationale ? (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
              aria-label={toggleLabel}
              className="text-gray-500 hover:text-gray-800 focus:outline-none focus:ring-2 focus:ring-primary rounded"
            >
              {expanded ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </button>
          ) : null}
        </td>
        <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">
          {new Date(event.created_at).toLocaleString(locale)}
        </td>
        <td className="px-3 py-2 font-mono text-xs">{event.operation}</td>
        <td className="px-3 py-2 font-mono text-xs">{event.model}</td>
        <td className="px-3 py-2 text-right">{formatLatencyMs(event.latency_ms)}</td>
        <td className="px-3 py-2 text-right">{formatCostUsd(event.cost_micros_usd, locale)}</td>
        <td className="px-3 py-2">
          <Badge variant={event.status === 'ok' ? 'secondary' : 'destructive'} className="text-xs">
            {event.status}
            {event.error_kind ? ` · ${event.error_kind}` : ''}
          </Badge>
        </td>
      </tr>
      {hasRationale && expanded ? (
        <tr className="bg-gray-50">
          <td />
          <td colSpan={6} className="px-3 py-2 text-xs text-gray-700 break-words">
            <span className="font-medium text-gray-500 uppercase tracking-wide mr-2">
              {rationaleLabel}
            </span>
            {event.rationale}
          </td>
        </tr>
      ) : null}
    </>
  );
}

interface KpiTileProps {
  label: string;
  value: string;
  hint?: string;
  emphasis?: boolean;
}

function KpiTile({ label, value, hint, emphasis }: KpiTileProps) {
  return (
    <div className="border rounded-lg p-3 bg-white">
      <p className="text-xs text-gray-500 uppercase tracking-wide">{label}</p>
      <p className={`mt-1 text-xl font-semibold ${emphasis ? 'text-amber-700' : 'text-gray-900'}`}>
        {value}
      </p>
      {hint ? <p className="text-xs text-gray-500 mt-0.5">{hint}</p> : null}
    </div>
  );
}

function KpiSkeleton() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="border rounded-lg p-3 bg-white animate-pulse">
          <div className="h-3 bg-gray-200 rounded w-1/2 mb-2" />
          <div className="h-6 bg-gray-200 rounded w-3/4" />
        </div>
      ))}
    </div>
  );
}

function ErrorRow({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="text-sm text-red-700 border border-red-200 bg-red-50 rounded-lg p-3"
    >
      {message}
    </div>
  );
}
