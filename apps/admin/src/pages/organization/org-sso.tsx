import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { usePermissions } from '../../hooks/use-permissions';
import { useSsoConfig } from '../../hooks/use-sso-config';

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

export default function OrgSsoPage() {
  const { isSystemAdmin, orgRole, isLoading: isLoadingPermissions } = usePermissions();
  const canManageSso = isSystemAdmin || orgRole === 'admin' || orgRole === 'owner';

  // Hooks always run regardless of the early returns below, so the query
  // itself (not just the rendered form) must stay disabled for a
  // non-admin or while permissions are still resolving.
  const { config, isLoading, error, updateConfig } = useSsoConfig({
    enabled: canManageSso && !isLoadingPermissions,
  });

  const [formValues, setFormValues] = useState<SsoFormValues>(DEFAULT_FORM_VALUES);
  const [clientSecretInput, setClientSecretInput] = useState('');

  useEffect(() => {
    if (!config) {
      return;
    }
    setFormValues({
      issuerUrl: config.issuerUrl ?? '',
      clientId: config.clientId ?? '',
      allowedDomains: (config.allowedDomains ?? []).join(', '),
      enforceSso: config.enforceSso ?? false,
    });
  }, [config]);

  if (isLoadingPermissions) {
    return null;
  }
  if (!canManageSso) {
    // Fails closed without an API round trip: orgRole/isSystemAdmin come
    // from the already-resolved usePermissions() query, and useSsoConfig()
    // above never fired for this user.
    return null;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
  }

  return (
    <div>
      <h1>SSO Configuration</h1>
      {isLoading && <p>Loading...</p>}
      {error && <p role="alert">{error.message}</p>}
      <form onSubmit={handleSubmit}>
        <label htmlFor="sso-issuer-url">Issuer URL</label>
        <input
          id="sso-issuer-url"
          type="text"
          value={formValues.issuerUrl}
          onChange={(event) =>
            setFormValues((prev) => ({ ...prev, issuerUrl: event.target.value }))
          }
        />

        <label htmlFor="sso-client-id">Client ID</label>
        <input
          id="sso-client-id"
          type="text"
          value={formValues.clientId}
          onChange={(event) => setFormValues((prev) => ({ ...prev, clientId: event.target.value }))}
        />

        {/* Never populate value/defaultValue with a real secret - only the
            boolean hasClientSecret drives the "currently set" indicator. */}
        <label htmlFor="sso-client-secret">
          Client Secret {config?.hasClientSecret ? '(currently set)' : '(not set)'}
        </label>
        <input
          id="sso-client-secret"
          type="password"
          value={clientSecretInput}
          placeholder={config?.hasClientSecret ? '••••••••' : ''}
          onChange={(event) => setClientSecretInput(event.target.value)}
        />

        <label htmlFor="sso-allowed-domains">Allowed Domains (comma-separated)</label>
        <input
          id="sso-allowed-domains"
          type="text"
          value={formValues.allowedDomains}
          onChange={(event) =>
            setFormValues((prev) => ({ ...prev, allowedDomains: event.target.value }))
          }
        />

        <label htmlFor="sso-enforce">
          <input
            id="sso-enforce"
            type="checkbox"
            checked={formValues.enforceSso}
            onChange={(event) =>
              setFormValues((prev) => ({ ...prev, enforceSso: event.target.checked }))
            }
          />
          Enforce SSO
        </label>

        <button type="submit">Save</button>
      </form>
    </div>
  );
}
