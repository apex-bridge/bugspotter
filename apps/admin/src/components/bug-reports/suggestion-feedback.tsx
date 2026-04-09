import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ThumbsUp, ThumbsDown } from 'lucide-react';
import { toast } from 'sonner';
import { intelligenceService } from '../../services/intelligence-service';
import { handleApiError } from '../../lib/api-client';
import { useAuth } from '../../contexts/auth-context';
import type { SuggestionType } from '../../types/intelligence';

interface SuggestionFeedbackProps {
  bugReportId: string;
  suggestionBugId: string;
  projectId: string;
  suggestionType: SuggestionType;
}

export function SuggestionFeedback({
  bugReportId,
  suggestionBugId,
  projectId,
  suggestionType,
}: SuggestionFeedbackProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data: existingFeedback = [] } = useQuery({
    queryKey: ['bug-feedback', bugReportId],
    queryFn: () => intelligenceService.getBugFeedback(bugReportId),
  });

  // Find if the current user already gave feedback for this suggestion.
  // Backend uniqueness is (bug_report_id, suggestion_bug_id, user_id) —
  // suggestion_type is not part of the unique key.
  const currentFeedback = existingFeedback.find(
    (f) => f.suggestion_bug_id === suggestionBugId && f.user_id === user?.id
  );

  const feedbackMutation = useMutation({
    mutationFn: (rating: -1 | 1) =>
      intelligenceService.submitFeedback({
        bug_report_id: bugReportId,
        suggestion_bug_id: suggestionBugId,
        project_id: projectId,
        suggestion_type: suggestionType,
        rating,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bug-feedback', bugReportId] });
      toast.success(t('intelligence.feedback.submitted'));
    },
    onError: (error) => {
      toast.error(handleApiError(error));
    },
  });

  const isSubmitting = feedbackMutation.isPending;

  return (
    <div className="flex items-center gap-1">
      <span className="text-xs text-gray-500 mr-1">{t('intelligence.feedback.helpful')}</span>
      <button
        type="button"
        onClick={() => feedbackMutation.mutate(1)}
        disabled={isSubmitting || currentFeedback?.rating === 1}
        className={`p-1 rounded transition-colors ${
          currentFeedback?.rating === 1
            ? 'text-green-600 bg-green-50'
            : 'text-gray-400 hover:text-green-600 hover:bg-green-50'
        } disabled:opacity-50 disabled:cursor-not-allowed`}
        aria-label={t('intelligence.feedback.thumbsUp')}
      >
        <ThumbsUp className="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        onClick={() => feedbackMutation.mutate(-1)}
        disabled={isSubmitting || currentFeedback?.rating === -1}
        className={`p-1 rounded transition-colors ${
          currentFeedback?.rating === -1
            ? 'text-red-600 bg-red-50'
            : 'text-gray-400 hover:text-red-600 hover:bg-red-50'
        } disabled:opacity-50 disabled:cursor-not-allowed`}
        aria-label={t('intelligence.feedback.thumbsDown')}
      >
        <ThumbsDown className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
