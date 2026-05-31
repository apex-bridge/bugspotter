import { useTranslation } from 'react-i18next';
import { AlertTriangle, Sparkles } from 'lucide-react';
import { Badge } from '../ui/badge';

/**
 * Three-state visual cue for an LLM ranking's overall confidence.
 *
 *   confidence < NEEDS_REVIEW   → yellow "Needs review" badge
 *   confidence < HIGH           → muted "AI-suggested" badge
 *   confidence ≥ HIGH or null   → render nothing
 *
 * Thresholds match docs/ai-observability-design.md in bugspotter-intelligence.
 * Hard-coded for v1; per-org tuning is a follow-up.
 */
const NEEDS_REVIEW = 0.6;
const HIGH = 0.85;

interface ConfidenceBadgeProps {
  confidence: number | null | undefined;
  /** Optional extra tailwind classes (e.g. spacing in the parent layout). */
  className?: string;
}

export function ConfidenceBadge({ confidence, className }: ConfidenceBadgeProps) {
  const { t } = useTranslation();

  if (typeof confidence !== 'number' || Number.isNaN(confidence)) {
    return null;
  }
  if (confidence >= HIGH) {
    return null;
  }
  if (confidence < NEEDS_REVIEW) {
    return (
      <Badge
        variant="outline"
        className={`gap-1 border-amber-300 bg-amber-50 text-amber-900 ${className ?? ''}`}
        title={t('intelligence.confidence.needsReviewTooltip', {
          score: Math.round(confidence * 100),
        })}
      >
        <AlertTriangle className="h-3 w-3" aria-hidden="true" />
        {t('intelligence.confidence.needsReview')}
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className={`gap-1 text-gray-600 ${className ?? ''}`}
      title={t('intelligence.confidence.aiSuggestedTooltip', {
        score: Math.round(confidence * 100),
      })}
    >
      <Sparkles className="h-3 w-3" aria-hidden="true" />
      {t('intelligence.confidence.aiSuggested')}
    </Badge>
  );
}
