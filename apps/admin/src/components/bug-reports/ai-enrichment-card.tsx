import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Brain, Tag } from 'lucide-react';
import { Badge } from '../ui/badge';
import { intelligenceService } from '../../services/intelligence-service';
import { useIntelligenceStatus } from '../../hooks/use-intelligence-status';
import { formatDate } from '../../utils/format';

interface AIEnrichmentCardProps {
  bugReportId: string;
}

export function AIEnrichmentCard({ bugReportId }: AIEnrichmentCardProps) {
  const { t } = useTranslation();
  const { isEnabled: intelligenceEnabled } = useIntelligenceStatus();

  const {
    data: enrichment,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['enrichment', bugReportId],
    queryFn: () => intelligenceService.getEnrichment(bugReportId),
    retry: false,
    enabled: intelligenceEnabled === true,
  });

  // Hide entirely when intelligence is disabled for the org. The
  // bug-report-detail view shows a single explanatory notice
  // instead of letting each widget fail open with a red error box.
  if (intelligenceEnabled !== true) {
    return null;
  }

  if (isLoading) {
    return (
      <div className="border rounded-lg p-4 bg-purple-50 border-purple-100">
        <div className="flex items-center gap-2 text-purple-600">
          <Brain className="w-4 h-4 animate-pulse" aria-hidden="true" />
          <span className="text-sm font-medium">{t('intelligence.enrichment.enriching')}</span>
        </div>
      </div>
    );
  }

  // null = 404 (not enriched), hide silently
  // error = real failure, show error state
  if (isError) {
    return (
      <div className="border rounded-lg p-4 bg-red-50 border-red-100">
        <div className="flex items-center gap-2 text-red-600">
          <Brain className="w-4 h-4" aria-hidden="true" />
          <span className="text-sm font-medium">{t('intelligence.errors.enrichmentFailed')}</span>
        </div>
      </div>
    );
  }

  if (!enrichment) {
    return null;
  }

  return (
    <div className="border rounded-lg p-4 bg-purple-50 border-purple-100">
      <div className="flex items-center gap-2 mb-3">
        <Brain className="w-4 h-4 text-purple-600" aria-hidden="true" />
        <h4 className="text-sm font-semibold text-purple-900">
          {t('intelligence.enrichment.title')}
        </h4>
        <span className="text-xs text-purple-500">
          {t('intelligence.enrichment.enrichedAt', {
            date: formatDate(enrichment.created_at),
          })}
        </span>
      </div>

      <div className="space-y-2">
        {/* Root Cause Summary */}
        {enrichment.root_cause_summary && (
          <div>
            <span className="text-xs font-medium text-purple-700 uppercase tracking-wider">
              {t('intelligence.enrichment.summary')}
            </span>
            <p className="text-sm text-gray-700 mt-0.5">{enrichment.root_cause_summary}</p>
          </div>
        )}

        {/* Severity & Category */}
        <div className="flex gap-4">
          {enrichment.suggested_severity && (
            <div>
              <span className="text-xs font-medium text-purple-700 uppercase tracking-wider">
                {t('intelligence.enrichment.severity')}
              </span>
              <p className="text-sm mt-0.5">
                <Badge variant="secondary">{enrichment.suggested_severity}</Badge>
              </p>
            </div>
          )}
          {enrichment.category && (
            <div>
              <span className="text-xs font-medium text-purple-700 uppercase tracking-wider">
                {t('intelligence.enrichment.category')}
              </span>
              <p className="text-sm mt-0.5">
                <Badge variant="secondary">{enrichment.category}</Badge>
              </p>
            </div>
          )}
        </div>

        {/* Tags */}
        {enrichment.tags.length > 0 && (
          <div>
            <span className="text-xs font-medium text-purple-700 uppercase tracking-wider flex items-center gap-1">
              <Tag className="w-3 h-3" aria-hidden="true" />
              {t('intelligence.enrichment.tags')}
            </span>
            <div className="flex flex-wrap gap-1 mt-1">
              {enrichment.tags.map((tag) => (
                <Badge key={tag} variant="outline" className="text-xs">
                  {tag}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Affected Components */}
        {enrichment.affected_components.length > 0 && (
          <div>
            <span className="text-xs font-medium text-purple-700 uppercase tracking-wider">
              {t('intelligence.enrichment.components')}
            </span>
            <div className="flex flex-wrap gap-1 mt-1">
              {enrichment.affected_components.map((component) => (
                <Badge key={component} variant="outline" className="text-xs">
                  {component}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
