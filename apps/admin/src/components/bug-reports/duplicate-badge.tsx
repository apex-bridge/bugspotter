import { useTranslation } from 'react-i18next';
import { Copy, ExternalLink } from 'lucide-react';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { SuggestionFeedback } from './suggestion-feedback';

interface DuplicateBadgeProps {
  duplicateOf: string;
  bugReportId: string;
  projectId: string;
  /**
   * Called with the full UUID of the original bug when the user clicks
   * the truncated ID or the "View original" button. Optional — when
   * not provided, the badge renders the truncated ID as static text
   * (no navigation affordance).
   */
  onNavigateToOriginal?: (bugId: string) => void;
}

export function DuplicateBadge({
  duplicateOf,
  bugReportId,
  projectId,
  onNavigateToOriginal,
}: DuplicateBadgeProps) {
  const { t } = useTranslation();

  const truncatedId = duplicateOf.slice(0, 8);
  const canNavigate = !!onNavigateToOriginal;

  return (
    <div className="px-6 py-3 bg-amber-50 border-b border-amber-100">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Copy className="w-4 h-4 text-amber-600 shrink-0" aria-hidden="true" />
          <Badge className="border-transparent bg-amber-500 text-white hover:bg-amber-500/80">
            {t('intelligence.duplicate.badge')}
          </Badge>
          <span className="text-sm text-amber-800">{t('intelligence.duplicate.of')}</span>
          {canNavigate ? (
            // Truncated ID is itself a link — single click opens the
            // original bug. Title shows full UUID for users who want
            // to verify or copy via right-click → inspect.
            <button
              type="button"
              onClick={() => onNavigateToOriginal(duplicateOf)}
              title={duplicateOf}
              className="text-xs bg-amber-100 px-1.5 py-0.5 rounded font-mono text-amber-700 hover:bg-amber-200 hover:underline focus:outline-none focus:ring-2 focus:ring-amber-400"
              // Describe the navigation target (which bug), not the
              // generic action — the sibling "View original" button
              // already covers the action verb. Avoids duplicate
              // screen-reader announcements.
              aria-label={`${t('intelligence.duplicate.of')} ${truncatedId}`}
            >
              {truncatedId}
            </button>
          ) : (
            <code
              className="text-xs bg-amber-100 px-1.5 py-0.5 rounded font-mono text-amber-700"
              title={duplicateOf}
            >
              {truncatedId}
            </code>
          )}
          {canNavigate && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onNavigateToOriginal(duplicateOf)}
              className="h-7 text-amber-700 hover:bg-amber-100 hover:text-amber-900"
            >
              <ExternalLink className="w-3.5 h-3.5 mr-1" aria-hidden="true" />
              {t('intelligence.duplicate.viewOriginal')}
            </Button>
          )}
        </div>
        <SuggestionFeedback
          bugReportId={bugReportId}
          suggestionBugId={duplicateOf}
          projectId={projectId}
          suggestionType="duplicate"
        />
      </div>
    </div>
  );
}
