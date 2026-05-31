import { useTranslation } from 'react-i18next';
import { AlertTriangle, Sparkles } from 'lucide-react';
import { Badge } from '../ui/badge';

/**
 * Three-state visual cue for an LLM ranking's overall confidence.
 *
 *   score < NEEDS_REVIEW_PCT   → yellow "Needs review" badge
 *   score < HIGH_PCT           → muted "AI-suggested" badge
 *   score ≥ HIGH_PCT or null   → render nothing
 *
 * Gating uses the same rounded integer that goes into the tooltip — gating on
 * the raw float would let a 0.596 show "Needs review" while the tooltip says
 * 60%, contradicting itself. Thresholds match the intelligence design doc.
 * Hard-coded for v1; per-org tuning is a follow-up.
 */
const NEEDS_REVIEW_PCT = 60;
const HIGH_PCT = 85;

interface ConfidenceBadgeProps {
  confidence: number | null | undefined;
  /** Optional extra tailwind classes (e.g. spacing in the parent layout). */
  className?: string;
}

export function ConfidenceBadge({ confidence, className }: ConfidenceBadgeProps) {
  const { t } = useTranslation();

  if (typeof confidence !== 'number' || !Number.isFinite(confidence)) {
    return null;
  }
  const score = Math.round(confidence * 100);

  if (score >= HIGH_PCT) {
    return null;
  }
  if (score < NEEDS_REVIEW_PCT) {
    return (
      <Badge
        variant="outline"
        className={`gap-1 border-amber-300 bg-amber-50 text-amber-900 ${className ?? ''}`}
        title={t('intelligence.confidence.needsReviewTooltip', { score })}
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
      title={t('intelligence.confidence.aiSuggestedTooltip', { score })}
    >
      <Sparkles className="h-3 w-3" aria-hidden="true" />
      {t('intelligence.confidence.aiSuggested')}
    </Badge>
  );
}
