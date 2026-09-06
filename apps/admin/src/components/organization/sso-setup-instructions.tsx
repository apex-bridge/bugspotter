import { useTranslation } from 'react-i18next';
import { AlertTriangle, BookOpen, ChevronDown } from 'lucide-react';
import { CodeSnippet } from '../ui/code-snippet';

interface SsoSetupInstructionsProps {
  /**
   * The organization whose callback path is shown. Rendered verbatim into the
   * snippet, so the reader copies their own tenant's value rather than a
   * placeholder they have to remember to substitute.
   */
  organizationId: string | undefined;
  /**
   * The fully-qualified callback the server actually sends as `redirect_uri`,
   * from the config response (#438). Preferred over the locally-built path
   * whenever present, because it is the string that must match at the IdP
   * byte for byte.
   *
   * `null`/undefined means the operator has not set `OIDC_REDIRECT_BASE_URL`
   * (or the config has not loaded): fall back to showing the path alone rather
   * than inventing a host.
   */
  redirectUri?: string | null;
  /**
   * Whether the org already has a stored SSO config.
   *
   * Drives whether the panel starts expanded. First-time setup needs the steps
   * in front of it; someone returning to change one field does not want six
   * numbered paragraphs between them and the form on every visit. The redirect
   * URI stays visible either way - it is the one thing people come back for.
   */
  isConfigured?: boolean;
}

/**
 * Setup guidance for the SSO config form (#439).
 *
 * Static content on purpose: it renders while the config query is still
 * loading, and while it is failing. Someone arriving at a page that cannot
 * reach its backend still needs to know what the fields mean.
 */
export function SsoSetupInstructions({
  organizationId,
  redirectUri,
  isConfigured = false,
}: SsoSetupInstructionsProps) {
  const { t } = useTranslation();

  // Prefer the server's own value: it is built from OIDC_REDIRECT_BASE_URL by
  // the same expression the login route uses, so what is shown here and what
  // the IdP is sent cannot drift. Without it, show the path alone - the admin
  // origin is not necessarily the API origin, so a locally-assembled host
  // would be a guess, and a wrong redirect URI is the single most tedious OIDC
  // failure to diagnose.
  const callbackPath =
    redirectUri ??
    (organizationId
      ? `/api/v1/auth/oidc/${organizationId}/callback`
      : `/api/v1/auth/oidc/<organization-id>/callback`);
  const isFullUri = Boolean(redirectUri);

  const steps = [
    'sso.setup.steps.createApp',
    'sso.setup.steps.registerRedirect',
    'sso.setup.steps.copyCredentials',
    'sso.setup.steps.allowedDomains',
    'sso.setup.steps.verifyLogin',
    'sso.setup.steps.enforce',
  ] as const;

  return (
    <section className="rounded-lg border border-gray-200 bg-gray-50 p-4">
      {/* <details> rather than React state: it keeps the steps in the DOM for
          find-in-page and for screen readers, and the browser handles the
          toggle semantics. Open by default only until a config exists. */}
      <details open={!isConfigured} className="group">
        <summary className="flex cursor-pointer items-center text-sm font-semibold text-gray-900 marker:content-['']">
          <BookOpen className="h-4 w-4 mr-2 shrink-0" aria-hidden="true" />
          {t('sso.setup.title')}
          <ChevronDown
            className="ml-auto h-4 w-4 shrink-0 text-gray-400 transition-transform group-open:rotate-180"
            aria-hidden="true"
          />
        </summary>

        <p className="mt-2 text-sm text-gray-600">{t('sso.setup.intro')}</p>

        <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm text-gray-700 marker:text-gray-400">
          {steps.map((key) => (
            <li key={key}>{t(key)}</li>
          ))}
        </ol>

        <p className="mt-3 text-xs text-gray-500">{t('sso.setup.providers')}</p>
      </details>

      {/* Outside the <details>: the redirect URI is the reason people come
          back to this page, so it stays visible when the steps are collapsed. */}
      <div className="mt-4 border-t border-gray-200 pt-4">
        <p className="text-sm font-medium text-gray-700">{t('sso.setup.redirectUriLabel')}</p>
        {/* Only tell the reader to prepend a host when we are showing a bare
            path. With the server's own URI there is nothing to prepend, and
            repeating the hint would invite them to double it up. */}
        <p className="mt-0.5 mb-2 text-xs text-gray-500">
          {isFullUri ? t('sso.setup.redirectUriExact') : t('sso.setup.redirectUriHint')}
        </p>
        {/* `wrap`: this value has to be checked against the IdP character for
            character, and the scrolling variant hides part of it under the
            copy button. */}
        <CodeSnippet code={callbackPath} testId="sso-callback-path" wrap />
      </div>

      <div
        className="mt-4 flex gap-2 rounded-md border border-amber-200 bg-amber-50 p-3"
        role="note"
      >
        <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 mt-0.5" aria-hidden="true" />
        <p className="text-xs text-amber-900">{t('sso.setup.lockoutWarning')}</p>
      </div>
    </section>
  );
}
