import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyRound, Save, AlertCircle } from 'lucide-react';
import { usePermissions } from '../../hooks/use-permissions';
import { useSsoConfig } from '../../hooks/use-sso-config';
import { useOrganization } from '../../contexts/organization-context';
import { canManageSso } from '../../lib/sso-permissions';
import { SsoSetupInstructions } from '../../components/organization/sso-setup-instructions';

interface SsoFormValues {
  issuerUrl: string;
  clientId: string;
  allowedDomains: string;
  enforceSso: boolean;
}

const DEFAULT_FORM_VALUES: SsoFormValues = {
  issuerUrl: '',
  clientId: '',
  allowedDomains: '',
  enforceSso: false,
};

const INPUT_CLASSES =
  'w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500';

export default function OrgSsoPage() {
  const { isSystemAdmin, orgRole, isLoading: isLoadingPermissions } = usePermissions();
  // Same rule the sidebar entry applies, so the link can't offer a page this
  // then refuses to render. See `lib/sso-permissions.ts`.
  const allowed = canManageSso(isSystemAdmin, orgRole);

  if (isLoadingPermissions) {
    return null;
  }
  if (!allowed) {
    // Fails closed without an API round trip, and without even mounting
    // useSsoConfig()'s query: OrgSsoForm - the only thing that calls that
    // hook - is simply never rendered for a non-admin. useSsoConfig()
    // (#407 / PR #419, already merged) takes no arguments and has no
    // `enabled` option, so it can't be told not to fire; keeping it out of
    // this component entirely is what actually keeps the request from
    // going out for a member. orgRole/isSystemAdmin come from the
    // already-resolved usePermissions() query.
    return null;
  }

  return <OrgSsoForm />;
}

function OrgSsoForm() {
  const { t } = useTranslation();
  const { config, isLoading, error, updateConfig } = useSsoConfig();
  // Only for the callback path shown in the instructions - the form itself is
  // org-scoped through useSsoConfig().
  const { currentOrganization } = useOrganization();

  const [formValues, setFormValues] = useState<SsoFormValues>(DEFAULT_FORM_VALUES);
  const [clientSecretInput, setClientSecretInput] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // useSsoConfig() rebuilds `config` via `stripClientSecret`'s object
  // spread on every call (use-sso-config.ts), so it's a new object
  // identity on every render even when the underlying data hasn't
  // changed. A plain `[config]` dependency would therefore re-fire this
  // effect - and stomp any in-progress edit back to the loaded values -
  // on every keystroke, since each keystroke's setFormValues triggers a
  // re-render that calls the hook again. Guard with a ref so the form is
  // hydrated from the loaded config exactly once per mount, not once per
  // render.
  const hasHydratedRef = useRef(false);

  useEffect(() => {
    if (!config || hasHydratedRef.current) {
      return;
    }
    hasHydratedRef.current = true;
    setFormValues({
      issuerUrl: config.issuerUrl ?? '',
      clientId: config.clientId ?? '',
      allowedDomains: (config.allowedDomains ?? []).join(', '),
      enforceSso: config.enforceSso ?? false,
    });
  }, [config]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitError(null);
    setIsSaving(true);
    try {
      await updateConfig({
        issuerUrl: formValues.issuerUrl,
        clientId: formValues.clientId,
        allowedDomains: formValues.allowedDomains
          .split(',')
          .map((domain) => domain.trim())
          .filter(Boolean),
        enforceSso: formValues.enforceSso,
        // Omit clientSecret entirely when the user didn't type a new one -
        // never coerce to an empty string, which would defeat the
        // optional-field contract on the backend.
        ...(clientSecretInput ? { clientSecret: clientSecretInput } : {}),
      });
      setClientSecretInput('');
    } catch {
      setSubmitError(t('errors.failedToSaveConfiguration'));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">
          <KeyRound className="inline-block h-6 w-6 mr-2" aria-hidden="true" />
          {t('sso.title')}
        </h1>
        <p className="mt-1 text-sm text-gray-500">{t('sso.description')}</p>
      </div>

      {/* Side by side once there is room: the form is the task and the
          guidance is reference, so stacking them put the first input roughly a
          screen down. Below `lg` they stack in the original order. */}
      <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
        {/* Rendered outside the isLoading branch on purpose: the guidance is
            static, and someone landing on a page whose config query is still
            loading - or failing - still needs to know what the fields mean.
            Second in source order so the form comes first for keyboard and
            screen-reader users, but placed left on wide screens. */}
        {isLoading ? (
          <div className="text-center py-12 text-gray-500 lg:order-2">{t('common.loading')}</div>
        ) : (
          <form className="space-y-4 lg:order-2" onSubmit={handleSubmit}>
            {error && (
              <div className="flex items-center gap-2 text-sm text-red-600" role="alert">
                <AlertCircle className="h-4 w-4" aria-hidden="true" />
                {error.message}
              </div>
            )}

            <div>
              <label
                htmlFor="sso-issuer-url"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                {t('sso.settings.issuerUrl')}
              </label>
              <input
                id="sso-issuer-url"
                type="text"
                value={formValues.issuerUrl}
                onChange={(event) =>
                  setFormValues((prev) => ({ ...prev, issuerUrl: event.target.value }))
                }
                className={INPUT_CLASSES}
              />
            </div>

            <div>
              <label
                htmlFor="sso-client-id"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                {t('sso.settings.clientId')}
              </label>
              <input
                id="sso-client-id"
                type="text"
                value={formValues.clientId}
                onChange={(event) =>
                  setFormValues((prev) => ({ ...prev, clientId: event.target.value }))
                }
                className={INPUT_CLASSES}
              />
            </div>

            <div>
              <label
                htmlFor="sso-client-secret"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                {t('sso.settings.clientSecret')}
                {config?.hasClientSecret && (
                  <span className="ml-2 text-xs font-normal text-gray-500">
                    ({t('sso.settings.clientSecretConfigured')})
                  </span>
                )}
              </label>
              {/* Never populate value/defaultValue with a real secret - only the
                boolean hasClientSecret drives the "currently set" indicator. */}
              <input
                id="sso-client-secret"
                type="password"
                value={clientSecretInput}
                placeholder={config?.hasClientSecret ? '••••••••' : ''}
                onChange={(event) => setClientSecretInput(event.target.value)}
                className={INPUT_CLASSES}
              />
              <p className="mt-1 text-xs text-gray-400">
                {t('sso.settings.clientSecretPlaceholder')}
              </p>
            </div>

            <div>
              <label
                htmlFor="sso-allowed-domains"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                {t('sso.settings.allowedDomains')}
              </label>
              <input
                id="sso-allowed-domains"
                type="text"
                value={formValues.allowedDomains}
                onChange={(event) =>
                  setFormValues((prev) => ({ ...prev, allowedDomains: event.target.value }))
                }
                className={INPUT_CLASSES}
              />
            </div>

            <div className="flex items-start gap-2">
              <input
                id="sso-enforce"
                type="checkbox"
                checked={formValues.enforceSso}
                onChange={(event) =>
                  setFormValues((prev) => ({ ...prev, enforceSso: event.target.checked }))
                }
                className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <label htmlFor="sso-enforce" className="text-sm text-gray-700">
                <span className="font-medium">{t('sso.settings.enforceSso')}</span>
                <p className="text-xs text-gray-500">{t('sso.settings.enforceSsoDescription')}</p>
                {/* The full lockout warning lives in the instructions panel, but
                  that can be a long scroll away - and on wide screens it is in
                  a different column entirely. Repeat the operative half where
                  the switch actually is. */}
                {formValues.enforceSso && (
                  <p className="mt-1 text-xs font-medium text-amber-700" role="note">
                    {t('sso.settings.enforceSsoLockoutHint')}
                  </p>
                )}
              </label>
            </div>

            {submitError && (
              <div className="flex items-center gap-2 text-sm text-red-600" role="alert">
                <AlertCircle className="h-4 w-4" aria-hidden="true" />
                {submitError}
              </div>
            )}

            <button
              type="submit"
              disabled={isSaving}
              className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              <Save className="h-4 w-4" aria-hidden="true" />
              {t('common.save')}
            </button>
          </form>
        )}

        <SsoSetupInstructions
          organizationId={currentOrganization?.id}
          redirectUri={config?.redirectUri}
          isConfigured={Boolean(config?.issuerUrl)}
        />
      </div>
    </div>
  );
}
