import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useIntegrationConfig } from '../../hooks/use-integration-config';
import { ConnectionStep } from '../../components/integrations/connection-step';
import { ProjectStep } from '../../components/integrations/project-step';
import { SyncRulesStep } from '../../components/integrations/sync-rules-step';
import { FieldMapperFactory } from '../../components/integrations/field-mappers';
import { CustomPluginConfigStep } from '../../components/integrations/custom-plugin-config-step';

/**
 * Universal integration configuration page
 * Handles all integration types with dynamic field mappers and UI adaptation
 */
const IntegrationConfigPage: React.FC = () => {
  const { type } = useParams<{ type: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [step, setStep] = useState(1);

  // Validate type parameter (but keep hooks at top level)
  const isValidType = type && typeof type === 'string' && type.trim().length > 0;

  // Use shared integration config hook (must be called unconditionally)
  // Hook returns Record<string, unknown> by default for maximum flexibility
  const {
    integration,
    localConfig,
    setLocalConfig,
    save,
    testConnection,
    isLoading,
    isError,
    error,
  } = useIntegrationConfig({
    type: type || '',
    onSaveSuccess: () => navigate('/integrations'),
  });

  // Early return AFTER all hooks
  if (!isValidType) {
    return (
      <div role="alert">
        <h1>{t('integrationConfig.invalidIntegrationType')}</h1>
        <p>{t('integrationConfig.noIntegrationTypeProvided')}</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div role="status" aria-live="polite">
        <h1>{t('integrationConfig.loadingConfiguration', { type })}</h1>
      </div>
    );
  }

  if (isError) {
    return (
      <div role="alert">
        <h1>{t('integrationConfig.errorLoadingConfiguration')}</h1>
        <p>{t('integrationConfig.failedToLoadConfiguration', { type })}</p>
        <p>Error: {error?.message || String(error)}</p>
      </div>
    );
  }

  if (!integration) {
    return (
      <div role="alert">
        <h1>{t('integrationConfig.noIntegrationFound')}</h1>
        <p>{t('integrationConfig.noConfigurationFound', { type })}</p>
      </div>
    );
  }

  const integrationName = integration.name || type || 'Integration';

  // Extract base integration type (e.g., 'jira' from 'jira_e2e_12345')
  const baseType = type.includes('_') ? type.split('_')[0] : type;

  // Check if this is a custom code plugin integration
  const isCustomPlugin = integration.is_custom === true;

  // For custom plugins, config is already Record<string, unknown> from the hook
  if (isCustomPlugin) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <CustomPluginConfigStep
          integrationName={integrationName}
          localConfig={localConfig}
          setLocalConfig={setLocalConfig}
          onBack={() => navigate('/integrations')}
          onSave={save}
        />
      </div>
    );
  }

  // For Jira and other built-in integrations, show multi-step wizard
  return (
    <div>
      <h1 className="text-2xl font-semibold mb-4">
        {t('integrationConfig.configureIntegration', { name: integrationName })}
      </h1>

      <div className="mb-4">
        <div className="flex gap-2">
          <button
            className={`px-3 py-1 ${step === 1 ? 'bg-blue-600 text-white' : 'bg-gray-100'}`}
            onClick={() => setStep(1)}
          >
            {t('integrationConfig.connection')}
          </button>
          <button
            className={`px-3 py-1 ${step === 2 ? 'bg-blue-600 text-white' : 'bg-gray-100'}`}
            onClick={() => setStep(2)}
          >
            {t('integrationConfig.project')}
          </button>
          <button
            className={`px-3 py-1 ${step === 3 ? 'bg-blue-600 text-white' : 'bg-gray-100'}`}
            onClick={() => setStep(3)}
          >
            {t('integrationConfig.fieldMapping')}
          </button>
          <button
            className={`px-3 py-1 ${step === 4 ? 'bg-blue-600 text-white' : 'bg-gray-100'}`}
            onClick={() => setStep(4)}
          >
            {t('integrationConfig.syncRules')}
          </button>
        </div>
      </div>

      {step === 1 && (
        <ConnectionStep
          localConfig={localConfig}
          setLocalConfig={setLocalConfig}
          onTestConnection={async () => {
            await testConnection(baseType);
          }}
          onNext={() => setStep(2)}
          showProjectKey={true}
        />
      )}

      {step === 2 && (
        <ProjectStep
          localConfig={localConfig}
          setLocalConfig={setLocalConfig}
          onBack={() => setStep(1)}
          onNext={() => setStep(3)}
        />
      )}

      {step === 3 && (
        <div className="border p-4 rounded">
          <FieldMapperFactory
            integrationType={baseType}
            localConfig={localConfig}
            setLocalConfig={setLocalConfig}
          />
          <div className="mt-3 flex gap-2">
            <button className="px-3 py-1 bg-gray-100 rounded" onClick={() => setStep(2)}>
              {t('integrationConfig.back')}
            </button>
            <button className="px-3 py-1 bg-blue-600 text-white rounded" onClick={() => setStep(4)}>
              {t('integrationConfig.nextSyncRules')}
            </button>
          </div>
        </div>
      )}

      {step === 4 && (
        <SyncRulesStep
          localConfig={localConfig}
          setLocalConfig={setLocalConfig}
          onBack={() => setStep(3)}
          onSave={save}
          variant="default"
        />
      )}
    </div>
  );
};

export default IntegrationConfigPage;
