import { useTranslation } from 'react-i18next';
import { Copy } from 'lucide-react';
import { Badge } from '../ui/badge';
import { SuggestionFeedback } from './suggestion-feedback';

interface DuplicateBadgeProps {
  duplicateOf: string;
  bugReportId: string;
  projectId: string;
}

export function DuplicateBadge({ duplicateOf, bugReportId, projectId }: DuplicateBadgeProps) {
  const { t } = useTranslation();

  return (
    <div className="px-6 py-3 bg-amber-50 border-b border-amber-100">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Copy className="w-4 h-4 text-amber-600" aria-hidden="true" />
          <Badge className="border-transparent bg-amber-500 text-white hover:bg-amber-500/80">
            {t('intelligence.duplicate.badge')}
          </Badge>
          <span className="text-sm text-amber-800">{t('intelligence.duplicate.of')}</span>
          <code className="text-xs bg-amber-100 px-1.5 py-0.5 rounded font-mono text-amber-700">
            {duplicateOf.slice(0, 8)}
          </code>
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
