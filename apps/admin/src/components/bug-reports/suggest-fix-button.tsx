import { useEffect, useState } from 'react';
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

/**
 * How long to keep polling for a mitigation result before giving up.
 * The backend's INTELLIGENCE_TIMEOUT_MS is 300s (5 min); a polling
 * cap of 3 min keeps the UI honest — if the worker hasn't landed a
 * result by then, either the LLM is overloaded or a job died, and
 * the user gets a retry CTA instead of an indefinite spinner.
 */
const POLLING_TIMEOUT_MS = 3 * 60 * 1000;
const POLLING_INTERVAL_MS = 3000;

// Mounted by bug-report-detail only when intelligence_enabled is
// true, so no self-gating here.
export function SuggestFixButton({ bugReportId, projectId }: SuggestFixButtonProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  // Timestamp when polling started (set by trigger.onSuccess). Cleared
  // on result arrival or manual retry. Used by both refetchInterval
  // (to stop after the timeout) and the timed-out useEffect below.
  const [pollingStartedAt, setPollingStartedAt] = useState<number | null>(null);
  const [isTimedOut, setIsTimedOut] = useState(false);

  // Trigger async generation (POST → 202).
  // Defined before useQuery so refetchInterval can reference isSuccess.
  const triggerMutation = useMutation({
    mutationFn: () => intelligenceService.triggerMitigation(projectId, bugReportId),
    onSuccess: () => {
      setPollingStartedAt(Date.now());
      setIsTimedOut(false);
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
      // Don't poll until the user has triggered generation, after we
      // have a result, or after the timeout cap has been reached.
      if (!pollingStartedAt || query.state.data || isTimedOut) {
        return false;
      }
      if (Date.now() - pollingStartedAt > POLLING_TIMEOUT_MS) {
        return false;
      }
      return POLLING_INTERVAL_MS;
    },
  });

  // Flip `isTimedOut` once the polling window expires. refetchInterval
  // will stop on its own at that boundary, but we need an explicit
  // state flip to re-render the UI into the "took too long" branch
  // (otherwise the spinner sits there until something else triggers a
  // re-render).
  useEffect(() => {
    if (!pollingStartedAt || result) {
      return;
    }
    const elapsed = Date.now() - pollingStartedAt;
    const remaining = POLLING_TIMEOUT_MS - elapsed;
    if (remaining <= 0) {
      setIsTimedOut(true);
      return;
    }
    const timer = window.setTimeout(() => setIsTimedOut(true), remaining);
    return () => window.clearTimeout(timer);
  }, [pollingStartedAt, result]);

  const handleRetry = () => {
    setIsTimedOut(false);
    setPollingStartedAt(null);
    // Reset the query so a stale `isError` from the previous poll
    // attempt doesn't flicker the UI between spinner and error during
    // the next polling cycle.
    queryClient.resetQueries({ queryKey: ['mitigation', projectId, bugReportId] });
    triggerMutation.reset();
    triggerMutation.mutate();
  };

  // The mutation-pending branch is unconditional: the spinner should
  // show during the POST itself even if the *previous* polling cycle
  // ended in error (e.g. user is retrying). The polling-active branch
  // additionally requires no errors — otherwise the button stays
  // disabled with a spinner *and* the error box renders below,
  // trapping the user until the 3-minute timeout.
  const isGenerating =
    triggerMutation.isPending ||
    (!isTimedOut && !isError && !triggerMutation.isError && triggerMutation.isSuccess && !result);

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

  // Polling timed out without a result — explain and offer retry.
  if (isTimedOut) {
    return (
      <div className="border rounded-lg p-4 bg-amber-50 border-amber-200">
        <div className="flex items-center gap-2 mb-2">
          <Lightbulb className="w-4 h-4 text-amber-600" aria-hidden="true" />
          <h4 className="text-sm font-semibold text-amber-900">
            {t('intelligence.mitigation.timeoutTitle')}
          </h4>
        </div>
        <p className="text-sm text-amber-800 mb-3">
          {t('intelligence.mitigation.timeoutDescription')}
        </p>
        <Button
          variant="secondary"
          size="sm"
          onClick={handleRetry}
          className="bg-white border-amber-300 text-amber-700 hover:bg-amber-100"
        >
          <Lightbulb className="w-4 h-4 mr-2" aria-hidden="true" />
          {t('intelligence.mitigation.retry')}
        </Button>
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
