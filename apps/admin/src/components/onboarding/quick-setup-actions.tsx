import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Code, Plug, X } from 'lucide-react';
import { useOnboardingStatus } from '../../hooks/use-onboarding-status';
import { SdkSnippetDialog } from './sdk-snippet-dialog';
import type { QuickAction, QuickActionId } from './quick-actions';
import { cn } from '../../lib/utils';

/**
 * localStorage key for the SDK CTA's per-user dismiss flag. Key is
 * intentionally NOT scoped per-org because in production the org
 * resolves from the subdomain (`[org].kz.bugspotter.io`), so each
 * org gets its own localStorage origin and the flag is naturally
 * tenant-scoped already.
 */
const SDK_CTA_DISMISSED_KEY = 'bugspotter:quick-setup:sdk-dismissed';

function readSdkDismissed(): boolean {
  try {
    return (
      typeof window !== 'undefined' && window.localStorage.getItem(SDK_CTA_DISMISSED_KEY) === '1'
    );
  } catch {
    return false;
  }
}

function writeSdkDismissed() {
  try {
    window.localStorage.setItem(SDK_CTA_DISMISSED_KEY, '1');
  } catch {
    /* localStorage unavailable (private mode, quota, etc.) — fall back to in-memory */
  }
}

/**
 * Compact CTAs in the admin top-bar that surface during the
 * "fresh tenant" empty state. Each CTA has its own visibility
 * predicate (declared in the registry below) so adding a new one is
 * a pure data change — push another entry, hook up its click handler.
 *
 * The SDK CTA is manually dismissable because we have no reliable
 * server-side signal for "the SDK has been installed" (bug-reports
 * could come from the Chrome extension instead, and the existing
 * count endpoint scopes by project membership rather than org).
 *
 * The component returns null when no CTA is visible, so there's no
 * visual footprint once a tenant is past day one.
 */
export function QuickSetupActions() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const state = useOnboardingStatus();
  const [snippetOpen, setSnippetOpen] = useState(false);
  const [sdkDismissed, setSdkDismissed] = useState<boolean>(() => readSdkDismissed());

  // Pick up cross-tab dismissals so a click in one tab hides the CTA
  // in the others without a refresh.
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === SDK_CTA_DISMISSED_KEY && e.newValue === '1') {
        setSdkDismissed(true);
      }
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const dismissSdk = useCallback(() => {
    writeSdkDismissed();
    setSdkDismissed(true);
  }, []);

  // Registry of available quick-actions. To add a new CTA: add an
  // entry here, add its labelKey to en/ru/kk locales, and add a case
  // in the `handleClick` switch below.
  const actions: QuickAction[] = useMemo(
    () => [
      {
        // Visibility doesn't gate on bug-report count because we can't
        // tell whether incoming reports are from the SDK or from the
        // Chrome extension. Manual dismiss handles "I've installed it"
        // — see `dismissSdk` below.
        id: 'sdk-snippet',
        labelKey: 'quickSetup.sdkSnippet',
        icon: Code,
        variant: 'primary',
        visible: (s) => s.canConfigure && s.hasProject,
      },
      {
        // Required to gate on `hasProject`: configuring Jira without a
        // project to associate is empty-state pollution.
        id: 'connect-jira',
        labelKey: 'quickSetup.connectJira',
        icon: Plug,
        variant: 'secondary',
        visible: (s) => s.canConfigure && s.hasProject && s.integrationCount === 0,
      },
    ],
    []
  );

  const visibleActions = actions.filter((action) => {
    if (!action.visible(state)) {
      return false;
    }
    if (action.id === 'sdk-snippet' && sdkDismissed) {
      return false;
    }
    return true;
  });

  const handleClick = (id: QuickActionId) => {
    switch (id) {
      case 'sdk-snippet':
        setSnippetOpen(true);
        break;
      case 'connect-jira':
        // Single-project tenants get one-click into the configure form
        // for that project. Multi-project tenants land on the projects
        // list — they pick the right project, and click Integrations →
        // Jira from there.
        //
        // Why not `/integrations/jira` for the multi-project case: that
        // route is wrapped in `<AdminRoute>` (platform-admin only). An
        // org admin clicking Connect Jira would otherwise hit a 403/
        // redirect, not a configure flow. The project-scoped route
        // `/projects/:id/integrations/:platform/configure` is the one
        // actually open to org admins.
        if (state.projectCount === 1 && state.primaryProjectId) {
          navigate(`/projects/${state.primaryProjectId}/integrations/jira/configure`);
        } else {
          navigate('/projects');
        }
        break;
      default: {
        // Exhaustiveness check: if `QuickActionId` gains a new variant
        // without a matching case here, this assignment becomes a
        // compile error.
        const _exhaustiveCheck: never = id;
        return _exhaustiveCheck;
      }
    }
  };

  if (visibleActions.length === 0) {
    return null;
  }

  return (
    <>
      <div className="flex items-center gap-3" data-testid="quick-setup-actions">
        <span className="text-xs font-medium text-gray-600 mr-1 hidden sm:inline">
          {t('quickSetup.label')}
        </span>
        {visibleActions.map((action) => {
          const Icon = action.icon;
          const isSdk = action.id === 'sdk-snippet';
          return (
            <span key={action.id} className="inline-flex items-center">
              <button
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
              {isSdk && (
                <button
                  type="button"
                  data-testid="quick-setup-sdk-snippet-dismiss"
                  onClick={dismissSdk}
                  aria-label={t('quickSetup.dismissSdk')}
                  className="ml-0.5 inline-flex items-center justify-center rounded-md p-1 text-gray-600 hover:bg-gray-100 hover:text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <X className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              )}
            </span>
          );
        })}
      </div>

      <SdkSnippetDialog open={snippetOpen} onOpenChange={setSnippetOpen} />
    </>
  );
}
