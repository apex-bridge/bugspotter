import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Code, Plug } from 'lucide-react';
import { useOnboardingStatus } from '../../hooks/use-onboarding-status';
import { SdkSnippetDialog } from './sdk-snippet-dialog';

/**
 * Two compact CTAs that surface in the admin top-bar for tenants that
 * have just signed up — i.e. an org with a project but no integrations
 * and no bug reports yet.
 *
 * The component returns null for any other state, so there's no visual
 * footprint once a tenant is past day one. Visibility logic lives in
 * `useOnboardingStatus`.
 */
export function QuickSetupActions() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { shouldShowQuickSetup, primaryProjectId } = useOnboardingStatus();
  const [snippetOpen, setSnippetOpen] = useState(false);

  if (!shouldShowQuickSetup) {
    return null;
  }

  return (
    <>
      <div className="flex items-center gap-2" data-testid="quick-setup-actions">
        <span className="text-xs font-medium text-gray-400 mr-1 hidden sm:inline">
          {t('quickSetup.label')}
        </span>
        <button
          type="button"
          onClick={() => setSnippetOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          <Code className="w-3.5 h-3.5" aria-hidden="true" />
          {t('quickSetup.sdkSnippet')}
        </button>
        <button
          type="button"
          onClick={() => navigate('/integrations/jira')}
          className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          <Plug className="w-3.5 h-3.5" aria-hidden="true" />
          {t('quickSetup.connectJira')}
        </button>
      </div>

      <SdkSnippetDialog
        open={snippetOpen}
        onOpenChange={setSnippetOpen}
        projectId={primaryProjectId}
      />
    </>
  );
}
