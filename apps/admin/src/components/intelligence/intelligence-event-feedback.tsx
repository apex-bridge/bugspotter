import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ThumbsUp, ThumbsDown } from 'lucide-react';
import { toast } from 'sonner';
import { intelligenceService } from '../../services/intelligence-service';
import { handleApiError } from '../../lib/api-client';
import type { IntelligenceEventVerdict } from '../../types/intelligence';
import { cn } from '../../lib/utils';

interface IntelligenceEventFeedbackProps {
  eventId: string;
  projectId: string;
}

/**
 * Thumbs-up / thumbs-down vote on a specific intelligence_event (LLM call).
 *
 * Different from `SuggestionFeedback`: that one writes to the local
 * `suggestion_feedback` table keyed by `(bug_report_id, suggestion_bug_id,
 * user_id)`; this one writes upstream to `intelligence_feedback` keyed by
 * `event_id` and reports against an LLM-call audit row.
 *
 * Upstream upserts on `(event_id, user_ref)`, so re-voting is idempotent.
 * We keep local state for the chosen verdict so the UI reflects the click
 * immediately and disables further voting; on mount we don't fetch prior
 * state because the upstream doesn't expose a per-event verdict read.
 */
export function IntelligenceEventFeedback({ eventId, projectId }: IntelligenceEventFeedbackProps) {
  const { t } = useTranslation();
  const [verdict, setVerdict] = useState<IntelligenceEventVerdict | null>(null);

  const mutation = useMutation({
    mutationFn: (newVerdict: IntelligenceEventVerdict) =>
      intelligenceService.submitEventFeedback({
        project_id: projectId,
        event_id: eventId,
        verdict: newVerdict,
      }),
    onSuccess: (_data, newVerdict) => {
      setVerdict(newVerdict);
      toast.success(t('intelligence.feedback.submitted'));
    },
    onError: (error) => {
      toast.error(handleApiError(error));
    },
  });

  const isSubmitting = mutation.isPending;

  return (
    <div className="flex items-center gap-1">
      <span className="text-xs text-gray-500 mr-1">{t('intelligence.feedback.helpful')}</span>
      <button
        type="button"
        onClick={() => mutation.mutate('correct')}
        disabled={isSubmitting || verdict !== null}
        className={cn(
          'p-1 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
          verdict === 'correct'
            ? 'text-green-600 bg-green-50'
            : 'text-gray-400 hover:text-green-600 hover:bg-green-50'
        )}
        aria-label={t('intelligence.feedback.thumbsUp')}
        aria-pressed={verdict === 'correct'}
      >
        <ThumbsUp className="w-3.5 h-3.5" aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={() => mutation.mutate('incorrect')}
        disabled={isSubmitting || verdict !== null}
        className={cn(
          'p-1 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
          verdict === 'incorrect'
            ? 'text-red-600 bg-red-50'
            : 'text-gray-400 hover:text-red-600 hover:bg-red-50'
        )}
        aria-label={t('intelligence.feedback.thumbsDown')}
        aria-pressed={verdict === 'incorrect'}
      >
        <ThumbsDown className="w-3.5 h-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}
