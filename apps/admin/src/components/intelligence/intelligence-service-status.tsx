/**
 * Intelligence Service Status (platform-admin)
 *
 * Operator readout of the intelligence service, rendered on the system-health
 * page. Self-fetches GET /api/v1/admin/intelligence/status. Degrades quietly:
 * a 503 (master channel not configured) shows a muted note, not an error.
 */

import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Brain, CheckCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { intelligenceService } from '../../services/intelligence-service';

type TFn = (key: string, options?: Record<string, unknown>) => string;

function KeyBadge({ configured, t }: { configured: boolean; t: TFn }) {
  return (
    <Badge variant={configured ? 'secondary' : 'outline'} className="text-xs">
      {configured
        ? t('intelligence.serviceStatus.keyConfigured')
        : t('intelligence.serviceStatus.keyMissing')}
    </Badge>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5 border-b border-gray-100 last:border-0">
      <dt className="text-gray-500">{label}</dt>
      <dd className="font-medium text-gray-900 text-right">{children}</dd>
    </div>
  );
}

export function IntelligenceServiceStatus() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['intelligence-service-status'],
    queryFn: intelligenceService.getServiceStatus,
    retry: false,
    // Refresh on the system-health page like the other cards (30s — config /
    // embedding-health change slowly, vs the page's 10s). Stop polling once it
    // errors (e.g. 503 not-configured) so we don't re-hit it every 30s and
    // spam server logs.
    refetchInterval: (query) => (query.state.error ? false : 30000),
  });

  // 503 = master channel not configured → a quiet note, not an error.
  const notConfigured =
    isError && (error as { response?: { status?: number } })?.response?.status === 503;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Brain className="w-5 h-5 text-gray-500" aria-hidden="true" />
            {t('intelligence.serviceStatus.title')}
          </CardTitle>
          {data ? (
            data.embeddings.healthy ? (
              <span className="flex items-center gap-1 text-green-600 text-sm" role="status">
                <CheckCircle className="w-4 h-4" aria-hidden="true" />
                {t('intelligence.serviceStatus.healthy')}
              </span>
            ) : (
              <span className="flex items-center gap-1 text-amber-600 text-sm" role="status">
                <AlertTriangle className="w-4 h-4" aria-hidden="true" />
                {t('intelligence.serviceStatus.degraded')}
              </span>
            )
          ) : null}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-gray-500">{t('intelligence.serviceStatus.loading')}</p>
        ) : notConfigured ? (
          <p className="text-sm text-gray-500 italic">
            {t('intelligence.serviceStatus.notConfigured')}
          </p>
        ) : isError ? (
          <div role="alert" className="text-sm text-red-700">
            {t('intelligence.serviceStatus.unavailable')}
          </div>
        ) : data ? (
          <dl className="text-sm">
            <Row label={t('intelligence.serviceStatus.provider')}>
              <span className="font-mono">{data.llm_provider}</span>
            </Row>
            <Row label={t('intelligence.serviceStatus.model')}>
              <span className="font-mono">
                {data.llm_model ?? t('intelligence.serviceStatus.none')}
              </span>
            </Row>
            <Row label={t('intelligence.serviceStatus.anthropicKey')}>
              <KeyBadge configured={data.anthropic_key_configured} t={t} />
            </Row>
            <Row label={t('intelligence.serviceStatus.openaiKey')}>
              <KeyBadge configured={data.openai_key_configured} t={t} />
            </Row>
            <Row label={t('intelligence.serviceStatus.similarityThreshold')}>
              {data.similarity_threshold.toLocaleString(locale)}
            </Row>
            <Row label={t('intelligence.serviceStatus.duplicateThreshold')}>
              {data.duplicate_threshold.toLocaleString(locale)}
            </Row>
            <Row label={t('intelligence.serviceStatus.embeddings')}>
              <span className="font-mono">
                {data.embeddings.model ?? data.embeddings.provider}
                {data.embeddings.min_dim != null ? ` (${data.embeddings.min_dim})` : ''}
              </span>
            </Row>
            <Row label={t('intelligence.serviceStatus.embeddingRows')}>
              {data.embeddings.nulls > 0 ? (
                <span className="text-amber-700">
                  {t('intelligence.serviceStatus.embeddingNulls', {
                    nulls: data.embeddings.nulls.toLocaleString(locale),
                    total: data.embeddings.total.toLocaleString(locale),
                  })}
                </span>
              ) : (
                data.embeddings.total.toLocaleString(locale)
              )}
            </Row>
            <Row label={t('intelligence.serviceStatus.version')}>
              <span className="font-mono">{data.version}</span>
            </Row>
          </dl>
        ) : null}
      </CardContent>
    </Card>
  );
}
