import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { GitCompareArrows } from 'lucide-react';
import { Badge } from '../ui/badge';
import { intelligenceService } from '../../services/intelligence-service';
import { SuggestionFeedback } from './suggestion-feedback';

interface SimilarBugsWidgetProps {
  bugReportId: string;
  projectId: string;
  /** The bug this report was auto-closed as a duplicate of, if any. */
  duplicateOf?: string | null;
}

// Mounted by bug-report-detail only when intelligence_enabled is
// true, so no self-gating here.
export function SimilarBugsWidget({ bugReportId, projectId, duplicateOf }: SimilarBugsWidgetProps) {
  const { t } = useTranslation();

  const { data, isLoading, isError } = useQuery({
    queryKey: ['similar-bugs', projectId, bugReportId],
    queryFn: () => intelligenceService.getSimilarBugs(projectId, bugReportId),
    retry: false,
  });

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

  const matchedBug =
    duplicateOf != null ? data.similar_bugs.find((bug) => bug.bug_id === duplicateOf) : undefined;
  const sortedBySimilarity = [...data.similar_bugs].sort((a, b) => b.similarity - a.similarity);
  // Prefer the similarity of the bug actually marked as duplicate; fall back
  // to the top match if it's no longer in the response (corpus/threshold
  // changed since auto-close — see spec Constraint 1).
  const currentMatchScore = matchedBug?.similarity ?? sortedBySimilarity[0]?.similarity ?? 0;
  const top3 = sortedBySimilarity.slice(0, 3);

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

      {duplicateOf != null && (
        <details open className="duplicate-match-details mt-3 pt-3 border-t border-purple-100">
          <summary className="text-sm font-medium text-purple-900 cursor-pointer">
            {t('intelligence.duplicateDetails.title')}
          </summary>
          <p className="text-sm text-purple-800 mt-2">
            {t('intelligence.duplicateDetails.score', {
              score: currentMatchScore.toFixed(2),
              threshold: data.threshold_used.toFixed(2),
            })}
          </p>
          <ul className="mt-1 space-y-1">
            {top3.map((bug) => (
              <li key={bug.bug_id} className="text-sm text-gray-700">
                {bug.title} - {bug.similarity.toFixed(2)}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
