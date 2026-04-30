import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Trans } from 'react-i18next';
import { CheckCircle2, AlertTriangle, ExternalLink, Loader2 } from 'lucide-react';
import { Select } from '../ui/select';
import { isJiraConfig } from '../../utils/type-guards';
import type { JiraConfig } from '../../types';
import type { TestConnectionResult } from '../../hooks/use-integration-config';
import { mapJiraError, ATLASSIAN_API_TOKEN_DOCS } from './jira-error-friendly';

interface ConnectionStepProps {
  localConfig: Record<string, unknown>;
  setLocalConfig: React.Dispatch<React.SetStateAction<Record<string, unknown>>>;
  onTestConnection: () => Promise<TestConnectionResult>;
  onNext: () => void;
  showProjectKey?: boolean;
}

type TestStatus =
  | { state: 'idle' }
  | { state: 'testing' }
  | { state: 'success' }
  | { state: 'error'; result: ReturnType<typeof mapJiraError> };

/**
 * Reusable connection configuration step
 * Handles instance URL, authentication, and optional project key
 * Works with generic config but expects Jira-like structure
 */
export function ConnectionStep({
  localConfig,
  setLocalConfig,
  onTestConnection,
  onNext,
  showProjectKey = true,
}: ConnectionStepProps) {
  const { t } = useTranslation();

  // Persistent state for the last test result. Survives re-renders so
  // a user looking away doesn't miss the toast.
  const [test, setTest] = useState<TestStatus>({ state: 'idle' });

  // Validate config structure before accessing properties
  if (!isJiraConfig(localConfig)) {
    return (
      <div className="border p-4 rounded text-sm text-red-600" role="alert">
        {t('integrationConfig.invalidConfigStructure')}
      </div>
    );
  }

  // After validation, we can safely access JiraConfig properties
  const config = localConfig as JiraConfig;

  // Single helper for "user edited a field" flow:
  //   1. apply the patch via setLocalConfig
  //   2. invalidate any previous test result so a stale green check
  //      can't lie about credentials the user just changed
  // Functional setTest avoids re-creating this callback when test
  // state changes — the dep array stays stable.
  const handleConfigChange = useCallback(
    (patch: (prev: Record<string, unknown>) => Record<string, unknown>) => {
      setLocalConfig(patch);
      setTest((prev) => (prev.state === 'idle' ? prev : { state: 'idle' }));
    },
    [setLocalConfig]
  );

  const handleTest = async () => {
    setTest({ state: 'testing' });
    const result = await onTestConnection();
    if (result.ok) {
      setTest({ state: 'success' });
    } else {
      setTest({
        state: 'error',
        result: mapJiraError(result.error, result.statusCode),
      });
    }
  };

  const isTesting = test.state === 'testing';

  return (
    <div className="border p-4 rounded">
      {/* Instance URL */}
      <label htmlFor="instance-url" className="block text-sm font-medium">
        {t('integrationConfig.instanceUrl')}
      </label>
      <input
        id="instance-url"
        type="url"
        value={config.instanceUrl ?? ''}
        onChange={(e) => handleConfigChange((prev) => ({ ...prev, instanceUrl: e.target.value }))}
        className="w-full border p-2 rounded mt-1"
        placeholder={t('integrationConfig.instanceUrlPlaceholder')}
      />

      {/* Authentication Type */}
      <div className="mt-4">
        <Select
          id="authentication-type"
          label={t('integrationConfig.authentication')}
          value={config.authentication?.type ?? 'basic'}
          onChange={(e) =>
            handleConfigChange((prev) => ({
              ...prev,
              authentication: {
                ...(prev as JiraConfig).authentication,
                type: e.target.value as 'basic' | 'oauth2' | 'pat',
              },
            }))
          }
        >
          <option value="basic">{t('integrationConfig.basicAuth')}</option>
          <option value="oauth2">{t('integrationConfig.oauth2')}</option>
          <option value="pat">{t('integrationConfig.pat')}</option>
        </Select>
      </div>

      {/* Email and API Token for Basic Auth */}
      {(config.authentication?.type === 'basic' || !config.authentication?.type) && (
        <>
          <label htmlFor="email-input" className="block text-sm mt-3">
            {t('integrationConfig.email')}
          </label>
          <input
            id="email-input"
            type="email"
            value={config.authentication?.email ?? ''}
            onChange={(e) =>
              handleConfigChange((prev) => ({
                ...prev,
                authentication: {
                  ...(prev as JiraConfig).authentication,
                  email: e.target.value,
                },
              }))
            }
            className="w-full border p-2 rounded mt-1"
            placeholder={t('integrationConfig.emailPlaceholder')}
          />

          <label htmlFor="api-token-input" className="block text-sm mt-3">
            {t('integrationConfig.apiToken')}
          </label>
          <input
            id="api-token-input"
            type="password"
            value={config.authentication?.apiToken ?? ''}
            onChange={(e) =>
              handleConfigChange((prev) => ({
                ...prev,
                authentication: {
                  ...(prev as JiraConfig).authentication,
                  apiToken: e.target.value,
                },
              }))
            }
            className="w-full border p-2 rounded mt-1"
            placeholder={t('integrationConfig.apiTokenPlaceholder')}
          />
          {/* Inline link to Atlassian's "create API token" docs — the
              single most common stumble point for first-time setup. */}
          <p className="text-xs text-gray-500 mt-1">
            <Trans
              i18nKey="integrationConfig.apiTokenHelp"
              components={{
                a: (
                  <a
                    href={ATLASSIAN_API_TOKEN_DOCS}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline inline-flex items-center gap-1"
                  />
                ),
                icon: <ExternalLink className="w-3 h-3 inline" aria-hidden="true" />,
              }}
            />
          </p>
        </>
      )}

      {/* Access Token for OAuth2 and PAT */}
      {(config.authentication?.type === 'oauth2' || config.authentication?.type === 'pat') && (
        <>
          <label htmlFor="access-token-input" className="block text-sm mt-3">
            {t('integrationConfig.accessToken')}
          </label>
          <input
            id="access-token-input"
            type="password"
            value={config.authentication?.accessToken ?? ''}
            onChange={(e) =>
              handleConfigChange((prev) => ({
                ...prev,
                authentication: {
                  ...(prev as JiraConfig).authentication,
                  accessToken: e.target.value,
                },
              }))
            }
            className="w-full border p-2 rounded mt-1"
            placeholder={
              config.authentication?.type === 'pat'
                ? t('integrationConfig.personalAccessToken')
                : t('integrationConfig.accessTokenPlaceholder')
            }
          />
        </>
      )}

      {/* Project Key (optional, shown in generic config) */}
      {showProjectKey && (
        <>
          <label htmlFor="project-key-input" className="block text-sm mt-3">
            {t('integrationConfig.projectKey')}
          </label>
          <input
            id="project-key-input"
            type="text"
            value={config.projectKey ?? ''}
            onChange={(e) =>
              handleConfigChange((prev) => ({ ...prev, projectKey: e.target.value }))
            }
            className="w-full border p-2 rounded mt-1"
            placeholder={t('integrationConfig.projectKeyPlaceholder')}
          />
        </>
      )}

      {/* Action Buttons */}
      <div className="mt-3 flex gap-2 items-center">
        <button
          className="px-3 py-1 bg-blue-600 text-white rounded disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1"
          onClick={handleTest}
          disabled={isTesting}
          type="button"
        >
          {isTesting && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />}
          {isTesting
            ? t('integrationConfig.testingConnection')
            : t('integrationConfig.testConnection')}
        </button>
        <button
          className="px-3 py-1 bg-gray-100 rounded disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={onNext}
          disabled={isTesting}
          type="button"
        >
          {t('integrationConfig.nextProject')}
        </button>
      </div>

      {/* Inline test-result feedback. Persists until the user edits
          the form (which clears it back to idle in the onChange
          handlers above). */}
      {test.state === 'success' && (
        <div
          role="status"
          className="mt-3 flex items-center gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800"
        >
          <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span>{t('integrationConfig.testSuccess')}</span>
        </div>
      )}
      {test.state === 'error' && (
        <div
          role="alert"
          className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900"
        >
          <div className="flex items-center gap-2 font-medium">
            <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>{t(test.result.titleKey)}</span>
          </div>
          <p className="mt-1 ml-6 text-red-800">{t(test.result.hintKey)}</p>
          {test.result.docHref && (
            <a
              href={test.result.docHref}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 ml-6 inline-flex items-center gap-1 text-xs text-red-900 hover:underline"
            >
              {t('integrationConfig.jiraErrors.docsLink')}
              <ExternalLink className="w-3 h-3" aria-hidden="true" />
            </a>
          )}
          {/* Show raw server message under a <details> so non-dev
              users see the friendly hint, but devs can still copy
              the verbatim error for issue reports. */}
          <details className="mt-2 ml-6">
            <summary className="cursor-pointer text-xs text-red-700 hover:text-red-900">
              {t('integrationConfig.jiraErrors.showRaw')}
            </summary>
            <pre className="mt-1 whitespace-pre-wrap break-all text-xs text-red-800">
              {test.result.raw}
            </pre>
          </details>
        </div>
      )}

      {/* Soft hint if the user hasn't tested yet — non-blocking. */}
      {test.state === 'idle' && (
        <p className="mt-3 text-xs text-gray-500">{t('integrationConfig.testHint')}</p>
      )}
    </div>
  );
}
