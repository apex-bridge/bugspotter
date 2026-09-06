import { useTranslation } from 'react-i18next';
import { AlertTriangle, BookOpen } from 'lucide-react';
import { CodeSnippet } from '../ui/code-snippet';

interface SsoSetupInstructionsProps {
  /**
   * The organization whose callback path is shown. Rendered verbatim into the
   * snippet, so the reader copies their own tenant's URI rather than a
   * placeholder they have to remember to substitute.
   */
  organizationId: string | undefined;
}

/**
 * Setup guidance for the SSO config form (#439).
 *
 * Static content on purpose: it renders while the config query is still
 * loading, and while it is failing. Someone arriving at a page that cannot
 * reach its backend still needs to know what the fields mean.
 */
export function SsoSetupInstructions({ organizationId }: SsoSetupInstructionsProps) {
  const { t } = useTranslation();

  // Path only, never a fully-qualified URI. OIDC_REDIRECT_BASE_URL lives on the
  // server and the admin origin is not necessarily the API origin, so anything
  // more complete would be a guess - and a wrong redirect URI is the single
  // most tedious OIDC failure to diagnose. #438 adds a server-computed
  // `redirectUri` to the config response; switch to it once that lands.
  const callbackPath = organizationId
    ? `/api/v1/auth/oidc/${organizationId}/callback`
    : `/api/v1/auth/oidc/<organization-id>/callback`;

  const steps = [
    'sso.setup.steps.createApp',
    'sso.setup.steps.registerRedirect',
    'sso.setup.steps.copyCredentials',
    'sso.setup.steps.allowedDomains',
    'sso.setup.steps.verifyLogin',
    'sso.setup.steps.enforce',
  ] as const;

  return (
    <section
      className="rounded-lg border border-gray-200 bg-gray-50 p-4 max-w-xl"
      aria-labelledby="sso-setup-heading"
    >
      <h2 id="sso-setup-heading" className="flex items-center text-sm font-semibold text-gray-900">
        <BookOpen className="h-4 w-4 mr-2" aria-hidden="true" />
        {t('sso.setup.title')}
      </h2>
      <p className="mt-1 text-sm text-gray-600">{t('sso.setup.intro')}</p>

      <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm text-gray-700 marker:text-gray-400">
        {steps.map((key) => (
          <li key={key}>{t(key)}</li>
        ))}
      </ol>

      <div className="mt-4">
        <p className="text-sm font-medium text-gray-700">{t('sso.setup.redirectUriLabel')}</p>
        <p className="mt-0.5 mb-2 text-xs text-gray-500">{t('sso.setup.redirectUriHint')}</p>
        <CodeSnippet code={callbackPath} testId="sso-callback-path" />
      </div>

      <div
        className="mt-4 flex gap-2 rounded-md border border-amber-200 bg-amber-50 p-3"
        role="note"
      >
        <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 mt-0.5" aria-hidden="true" />
        <p className="text-xs text-amber-900">{t('sso.setup.lockoutWarning')}</p>
      </div>

      <p className="mt-3 text-xs text-gray-500">{t('sso.setup.providers')}</p>
    </section>
  );
}
