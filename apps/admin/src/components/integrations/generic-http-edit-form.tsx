import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Label } from '../ui/label';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select-radix';
import type { GenericHttpConfig } from '../../types';
import type { IntegrationResponse } from '../../types/integration';

interface GenericHttpEditFormProps {
  integration: IntegrationResponse;
  onSave: () => Promise<void>;
  localConfig: Record<string, unknown>;
  setLocalConfig: (config: Record<string, unknown>) => void;
  description?: string;
  onDescriptionChange?: (description: string) => void;
}

// ============================================================================
// TYPE GUARDS & HELPERS
// ============================================================================

/**
 * Type guard to check if config is a valid GenericHttpConfig
 */
function isGenericHttpConfig(config: unknown): config is GenericHttpConfig {
  return (
    config !== null &&
    typeof config === 'object' &&
    'baseUrl' in config &&
    'auth' in config &&
    typeof (config as Record<string, unknown>).auth === 'object'
  );
}

/**
 * Safely cast config to GenericHttpConfig with fallback values
 */
function getGenericHttpConfig(config: Record<string, unknown>): GenericHttpConfig {
  if (isGenericHttpConfig(config)) {
    return config;
  }
  // Return default config structure
  return {
    baseUrl: '',
    auth: { type: 'bearer' },
    endpoints: {
      create: {
        path: '/tickets',
        method: 'POST',
        responseMapping: {
          idField: 'id',
          urlTemplate: '',
        },
      },
    },
    fieldMappings: [],
  };
}

// ============================================================================
// AUTH FIELD COMPONENTS (DRY)
// ============================================================================

interface AuthFieldProps {
  id: string;
  label: string;
  type?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

const AuthField: React.FC<AuthFieldProps> = ({
  id,
  label,
  type = 'password',
  value,
  onChange,
  placeholder,
}) => (
  <div>
    <Label htmlFor={id}>{label}</Label>
    <Input
      id={id}
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
    />
  </div>
);

// ============================================================================
// MAIN COMPONENT
// ============================================================================

/**
 * Simple edit form for Generic HTTP integrations
 * Allows editing base URL and authentication credentials
 */
export const GenericHttpEditForm: React.FC<GenericHttpEditFormProps> = ({
  integration,
  onSave,
  localConfig,
  setLocalConfig,
  description = '',
  onDescriptionChange,
}) => {
  const { t } = useTranslation();
  const [isSaving, setIsSaving] = useState(false);
  const [validationError, setValidationError] = useState<string>('');
  const initializedRef = useRef(false);

  // Initialize form from integration once (no setState during render)
  useEffect(() => {
    if (!initializedRef.current && Object.keys(localConfig).length === 0 && integration.config) {
      setLocalConfig(integration.config as Record<string, unknown>);
      initializedRef.current = true;
    }
  }, [integration.config, localConfig, setLocalConfig]);

  // Memoized typed config accessor - eliminates repetitive casting
  const config = useMemo(() => getGenericHttpConfig(localConfig), [localConfig]);

  // Memoized update handlers
  const updateConfig = useCallback(
    (updates: Partial<GenericHttpConfig>) => {
      setLocalConfig({
        ...localConfig,
        ...updates,
      });
    },
    [localConfig, setLocalConfig]
  );

  const updateAuth = useCallback(
    (authUpdates: Partial<GenericHttpConfig['auth']>) => {
      updateConfig({
        auth: {
          ...config.auth,
          ...authUpdates,
        } as GenericHttpConfig['auth'],
      });
    },
    [config.auth, updateConfig]
  );

  const handleSave = useCallback(async () => {
    // Validate base URL
    if (!config.baseUrl) {
      setValidationError(t('integrations.genericHttp.baseUrlRequired'));
      return;
    }
    try {
      new URL(config.baseUrl);
      setValidationError('');
    } catch {
      setValidationError(t('integrations.genericHttp.baseUrlInvalid'));
      return;
    }

    setIsSaving(true);
    try {
      await onSave();
      // Reset form to server values after successful save
      if (integration.config) {
        setLocalConfig(integration.config as Record<string, unknown>);
      }
    } finally {
      setIsSaving(false);
    }
  }, [config.baseUrl, onSave, integration.config, setLocalConfig]);

  // Render auth fields based on type (DRY approach)
  const renderAuthFields = (): JSX.Element | null => {
    const { auth } = config;

    switch (auth.type) {
      case 'bearer':
        return (
          <AuthField
            id="bearer-token"
            label={t('integrations.genericHttp.bearerToken')}
            value={auth.token || ''}
            onChange={(value) => updateAuth({ token: value })}
            placeholder={t('integrations.genericHttp.bearerTokenPlaceholder')}
          />
        );

      case 'basic':
        return (
          <>
            <AuthField
              id="username"
              label={t('integrations.genericHttp.username')}
              type="text"
              value={auth.username || ''}
              onChange={(value) => updateAuth({ username: value })}
              placeholder={t('integrations.genericHttp.usernamePlaceholder')}
            />
            <AuthField
              id="password"
              label={t('integrations.genericHttp.password')}
              value={auth.password || ''}
              onChange={(value) => updateAuth({ password: value })}
              placeholder={t('integrations.genericHttp.passwordPlaceholder')}
            />
          </>
        );

      case 'api_key':
        return (
          <>
            <AuthField
              id="api-key"
              label={t('integrations.genericHttp.apiKey')}
              value={auth.apiKey || ''}
              onChange={(value) => updateAuth({ apiKey: value })}
              placeholder={t('integrations.genericHttp.apiKeyPlaceholder')}
            />
            <AuthField
              id="header-name"
              label={t('integrations.genericHttp.headerName')}
              type="text"
              value={auth.header || 'X-API-Key'}
              onChange={(value) => updateAuth({ header: value })}
              placeholder="X-API-Key"
            />
          </>
        );

      case 'oauth2':
        return (
          <AuthField
            id="oauth-token"
            label={t('integrations.genericHttp.oauth2Token')}
            value={auth.token || ''}
            onChange={(value) => updateAuth({ token: value })}
            placeholder={t('integrations.genericHttp.oauth2TokenPlaceholder')}
          />
        );

      default:
        return null;
    }
  };

  return (
    <div className="space-y-6">
      {/* Basic Information */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">{t('integrations.genericHttp.basicInformation')}</h2>

        <div>
          <Label htmlFor="display-name">{t('integrations.genericHttp.displayName')}</Label>
          <Input id="display-name" value={integration.name} disabled className="bg-gray-50" />
          <p className="text-sm text-gray-500 mt-1">
            {t('integrations.genericHttp.nameCannotChange')}
          </p>
        </div>

        <div>
          <Label htmlFor="description">{t('integrations.genericHttp.description')}</Label>
          <Input
            id="description"
            value={description}
            onChange={(e) => onDescriptionChange?.(e.target.value)}
            placeholder={t('integrations.genericHttp.descriptionPlaceholder')}
          />
        </div>
      </div>

      {/* Connection Settings */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">
          {t('integrations.genericHttp.connectionSettings')}
        </h2>

        <div>
          <Label htmlFor="base-url">{t('integrations.genericHttp.baseUrl')}</Label>
          <Input
            id="base-url"
            type="url"
            value={config.baseUrl}
            onChange={(e) => {
              updateConfig({ baseUrl: e.target.value });
              if (validationError) {
                setValidationError('');
              }
            }}
            placeholder={t('integrations.genericHttp.baseUrlPlaceholder')}
            required
            aria-invalid={validationError ? 'true' : 'false'}
            aria-describedby={validationError ? 'base-url-error' : undefined}
          />
          {validationError && (
            <p id="base-url-error" className="text-sm text-red-600 mt-1" role="alert">
              {validationError}
            </p>
          )}
        </div>

        <div>
          <Label htmlFor="auth-type">{t('integrations.genericHttp.authenticationType')}</Label>
          <Select
            value={config.auth.type}
            onValueChange={(value) =>
              updateAuth({
                type: value as GenericHttpConfig['auth']['type'],
              })
            }
          >
            <SelectTrigger id="auth-type">
              <SelectValue placeholder={t('integrations.genericHttp.selectAuthType')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="bearer">{t('integrations.genericHttp.bearerToken')}</SelectItem>
              <SelectItem value="api_key">{t('integrations.genericHttp.apiKey')}</SelectItem>
              <SelectItem value="basic">{t('integrations.genericHttp.basicAuth')}</SelectItem>
              <SelectItem value="oauth2">{t('integrations.genericHttp.oauth2')}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Authentication Fields */}
        {renderAuthFields()}
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-3">
        <Button
          variant="outline"
          onClick={() => {
            // Reset to integration values
            if (integration.config) {
              setLocalConfig(integration.config as Record<string, unknown>);
            }
            setValidationError('');
          }}
          disabled={isSaving}
        >
          {t('integrations.genericHttp.reset')}
        </Button>
        <Button onClick={handleSave} disabled={isSaving || !config.baseUrl}>
          {isSaving
            ? t('integrations.genericHttp.saving')
            : t('integrations.genericHttp.saveChanges')}
        </Button>
      </div>
    </div>
  );
};
