import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Lightbulb } from 'lucide-react';
import { Button } from '../ui/button';
import { intelligenceService } from '../../services/intelligence-service';
import { SuggestionFeedback } from './suggestion-feedback';

interface SuggestFixButtonProps {
  bugReportId: string;
  projectId: string;
}

// Mounted by bug-report-detail only when intelligence_enabled is
// true, so no self-gating here.
export function SuggestFixButton({ bugReportId, projectId }: SuggestFixButtonProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  // Trigger async generation (POST → 202).
  // Defined before useQuery so refetchInterval can reference isSuccess.
  const triggerMutation = useMutation({
    mutationFn: () => intelligenceService.triggerMitigation(projectId, bugReportId),
    onSuccess: () => {
      // Invalidate to start polling
      queryClient.invalidateQueries({ queryKey: ['mitigation', projectId, bugReportId] });
    },
  });

  // Fetch cached mitigation (GET). Returns null on 404 (not generated yet).
  // Only polls after user explicitly triggers generation.
  const { data: result, isError } = useQuery({
    queryKey: ['mitigation', projectId, bugReportId],
    queryFn: () => intelligenceService.getMitigation(projectId, bugReportId),
    retry: false,
    refetchInterval: (query) => {
      // Only poll while generation has been triggered and result hasn't arrived
      if (triggerMutation.isSuccess && !query.state.data) {
        return 3000;
      }
      return false;
    },
  });

  const isGenerating = triggerMutation.isPending || (triggerMutation.isSuccess && !result);

  // Already have a cached result — show it immediately
  if (result) {
    return (
      <div className="border rounded-lg p-4 bg-purple-50 border-purple-100">
        <div className="flex items-center gap-2 mb-3">
          <Lightbulb className="w-4 h-4 text-purple-600" aria-hidden="true" />
          <h4 className="text-sm font-semibold text-purple-900">
            {t('intelligence.mitigation.suggestion')}
          </h4>
          {result.based_on_similar_bugs && (
            <span className="text-xs text-purple-500">
              {t('intelligence.mitigation.basedOnSimilar')}
            </span>
          )}
        </div>

        <p className="text-sm text-gray-700 whitespace-pre-wrap mb-3">
          {result.mitigation_suggestion}
        </p>

        <SuggestionFeedback
          bugReportId={bugReportId}
          suggestionBugId={bugReportId}
          projectId={projectId}
          suggestionType="mitigation"
        />
      </div>
    );
  }

  // No result yet — show button or generating state
  return (
    <div>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => triggerMutation.mutate()}
        isLoading={isGenerating}
        disabled={isGenerating}
        className="bg-purple-50 border-purple-200 text-purple-700 hover:bg-purple-100"
      >
        <Lightbulb className="w-4 h-4 mr-2" aria-hidden="true" />
        {isGenerating
          ? t('intelligence.mitigation.loading')
          : t('intelligence.mitigation.suggestFix')}
      </Button>

      {(isError || triggerMutation.isError) && (
        <div className="mt-2 border rounded-lg p-3 bg-red-50 border-red-100">
          <p className="text-sm text-red-600">{t('intelligence.mitigation.error')}</p>
        </div>
      )}
    </div>
  );
}
