import React from 'react';
import { useTranslation } from 'react-i18next';
import { Select } from '../ui/select';
import { isJiraConfig } from '../../utils/type-guards';
import type { JiraConfig } from '../../types';

interface ConnectionStepProps {
  localConfig: Record<string, unknown>;
  setLocalConfig: React.Dispatch<React.SetStateAction<Record<string, unknown>>>;
  onTestConnection: () => Promise<void>;
  onNext: () => void;
  showProjectKey?: boolean;
}

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
  // Validate config structure before accessing properties
  if (!isJiraConfig(localConfig)) {
    return (
      <div className="border p-4 rounded text-sm text-red-600">
        Invalid configuration structure. Please ensure all required fields are present.
      </div>
    );
  }

  // After validation, we can safely access JiraConfig properties
  const config = localConfig as JiraConfig;
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
        onChange={(e) => setLocalConfig({ ...localConfig, instanceUrl: e.target.value })}
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
            setLocalConfig({
              ...localConfig,
              authentication: {
                ...(config.authentication || {}),
                type: e.target.value as 'basic' | 'oauth2' | 'pat',
              },
            })
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
              setLocalConfig({
                ...localConfig,
                authentication: {
                  ...(config.authentication || { type: 'basic' }),
                  email: e.target.value,
                },
              })
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
              setLocalConfig({
                ...localConfig,
                authentication: {
                  ...(config.authentication || { type: 'basic' }),
                  apiToken: e.target.value,
                },
              })
            }
            className="w-full border p-2 rounded mt-1"
            placeholder={t('integrationConfig.apiTokenPlaceholder')}
          />
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
              setLocalConfig({
                ...localConfig,
                authentication: {
                  ...(config.authentication || { type: 'oauth2' }),
                  accessToken: e.target.value,
                },
              })
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
              setLocalConfig({
                ...localConfig,
                projectKey: e.target.value,
              })
            }
            className="w-full border p-2 rounded mt-1"
            placeholder={t('integrationConfig.projectKeyPlaceholder')}
          />
        </>
      )}

      {/* Action Buttons */}
      <div className="mt-3 flex gap-2">
        <button className="px-3 py-1 bg-blue-600 text-white rounded" onClick={onTestConnection}>
          {t('integrationConfig.testConnection')}
        </button>
        <button className="px-3 py-1 bg-gray-100 rounded" onClick={onNext}>
          {t('integrationConfig.nextProject')}
        </button>
      </div>
    </div>
  );
}
