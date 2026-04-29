import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { GitCompareArrows } from 'lucide-react';
import { Badge } from '../ui/badge';
import { intelligenceService } from '../../services/intelligence-service';
import { useIntelligenceStatus } from '../../hooks/use-intelligence-status';
import { SuggestionFeedback } from './suggestion-feedback';

interface SimilarBugsWidgetProps {
  bugReportId: string;
  projectId: string;
}

export function SimilarBugsWidget({ bugReportId, projectId }: SimilarBugsWidgetProps) {
  const { t } = useTranslation();
  const { isEnabled: intelligenceEnabled } = useIntelligenceStatus();

  const { data, isLoading, isError } = useQuery({
    queryKey: ['similar-bugs', projectId, bugReportId],
    queryFn: () => intelligenceService.getSimilarBugs(projectId, bugReportId),
    retry: false,
    enabled: intelligenceEnabled === true,
  });

  if (intelligenceEnabled !== true) {
    return null;
  }

  if (isLoading) {
    return (
      <div className="border rounded-lg p-4 bg-purple-50 border-purple-100">
        <div className="flex items-center gap-2 text-purple-600">
          <GitCompareArrows className="w-4 h-4 animate-pulse" aria-hidden="true" />
          <span className="text-sm font-medium">{t('intelligence.similarBugs.loading')}</span>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="border rounded-lg p-4 bg-red-50 border-red-100">
        <div className="flex items-center gap-2 text-red-600">
          <GitCompareArrows className="w-4 h-4" aria-hidden="true" />
          <span className="text-sm font-medium">{t('intelligence.similarBugs.error')}</span>
        </div>
      </div>
    );
  }

  if (!data || data.similar_bugs.length === 0) {
    return null;
  }

  return (
    <div className="border rounded-lg p-4 bg-purple-50 border-purple-100">
      <div className="flex items-center gap-2 mb-3">
        <GitCompareArrows className="w-4 h-4 text-purple-600" aria-hidden="true" />
        <h4 className="text-sm font-semibold text-purple-900">
          {t('intelligence.similarBugs.title')}
        </h4>
        <Badge variant="secondary" className="text-xs">
          {data.similar_bugs.length}
        </Badge>
      </div>

      <div className="space-y-2">
        {data.similar_bugs.map((bug) => (
          <div
            key={bug.bug_id}
            className="flex items-center justify-between bg-white rounded-md px-3 py-2 border border-purple-100"
          >
            <div className="flex-1 min-w-0 mr-3">
              <p className="text-sm font-medium text-gray-900 truncate">{bug.title}</p>
              <div className="flex items-center gap-2 mt-0.5">
                <Badge variant="outline" className="text-xs">
                  {bug.status}
                </Badge>
                {bug.resolution && (
                  <span className="text-xs text-gray-500 truncate">{bug.resolution}</span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <div className="text-right">
                <span className="text-sm font-semibold text-purple-700">
                  {Math.round(bug.similarity * 100)}%
                </span>
                <div className="w-16 h-1.5 bg-purple-100 rounded-full mt-0.5">
                  <div
                    className="h-full bg-purple-500 rounded-full"
                    style={{ width: `${bug.similarity * 100}%` }}
                  />
                </div>
              </div>
              <SuggestionFeedback
                bugReportId={bugReportId}
                suggestionBugId={bug.bug_id}
                projectId={projectId}
                suggestionType="similar_bug"
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
