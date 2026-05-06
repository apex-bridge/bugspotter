import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Code, Plug } from 'lucide-react';
import { useOnboardingStatus } from '../../hooks/use-onboarding-status';
import { SdkSnippetDialog } from './sdk-snippet-dialog';
import type { QuickAction, QuickActionId } from './quick-actions';
import { cn } from '../../lib/utils';

/**
 * Compact CTAs in the admin top-bar that surface during the
 * "fresh tenant" empty state. Each CTA has its own visibility
 * predicate (declared in the registry below) so adding a new one is
 * a pure data change — push another entry, hook up its click handler.
 *
 * The component returns null when no CTA is visible, so there's no
 * visual footprint once a tenant is past day one.
 */
export function QuickSetupActions() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const state = useOnboardingStatus();
  const [snippetOpen, setSnippetOpen] = useState(false);

  // Registry of available quick-actions. To add a new CTA: add an
  // entry here, add its labelKey to en/ru/kk locales, and add a case
  // in the `handleClick` switch below.
  const actions: QuickAction[] = useMemo(
    () => [
      {
        id: 'sdk-snippet',
        labelKey: 'quickSetup.sdkSnippet',
        icon: Code,
        variant: 'primary',
        visible: (s) => s.canConfigure && s.hasProject && s.bugReportCount === 0,
      },
      {
        id: 'connect-jira',
        labelKey: 'quickSetup.connectJira',
        icon: Plug,
        variant: 'secondary',
        visible: (s) => s.canConfigure && s.integrationCount === 0,
      },
    ],
    []
  );

  const visibleActions = actions.filter((action) => action.visible(state));

  const handleClick = (id: QuickActionId) => {
    switch (id) {
      case 'sdk-snippet':
        setSnippetOpen(true);
        break;
      case 'connect-jira':
        navigate('/integrations/jira');
        break;
    }
  };

  if (visibleActions.length === 0) {
    return null;
  }

  return (
    <>
      <div className="flex items-center gap-2" data-testid="quick-setup-actions">
        <span className="text-xs font-medium text-gray-400 mr-1 hidden sm:inline">
          {t('quickSetup.label')}
        </span>
        {visibleActions.map((action) => {
          const Icon = action.icon;
          return (
            <button
              key={action.id}
              type="button"
              data-testid={`quick-setup-${action.id}`}
              onClick={() => handleClick(action.id)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2',
                action.variant === 'primary'
                  ? 'bg-blue-600 text-white hover:bg-blue-700'
                  : 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
              )}
            >
              <Icon className="w-3.5 h-3.5" aria-hidden="true" />
              {t(action.labelKey)}
            </button>
          );
        })}
      </div>

      <SdkSnippetDialog
        open={snippetOpen}
        onOpenChange={setSnippetOpen}
        projectId={state.primaryProjectId}
      />
    </>
  );
}
