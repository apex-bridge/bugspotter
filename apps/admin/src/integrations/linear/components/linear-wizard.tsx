/**
 * Linear Wizard
 *
 * Replaces Jira's ConnectionStep + ProjectStep for the platform-level
 * integration config page. Linear has no per-instance host (api.linear.app
 * is fixed) and no per-instance username; a single API key + team is
 * enough to configure the integration. Folding both steps into one
 * removes the inter-step state-passing complexity.
 *
 * `IntegrationConfigPage` dispatches to this wizard when `baseType ===
 * 'linear'` (see `TODO(platform-configurator)` anchor there).
 */

import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react';
import { LinearTeamPicker } from './linear-team-picker';
import type { LinearConfig } from '../types';
import type { TestConnectionResult } from '../../../hooks/use-integration-config';

interface LinearWizardProps {
  localConfig: Record<string, unknown>;
  setLocalConfig: React.Dispatch<React.SetStateAction<Record<string, unknown>>>;
  onTestConnection: () => Promise<TestConnectionResult>;
  onSave: () => Promise<void> | void;
  isSaving?: boolean;
}

type TestStatus =
  | { state: 'idle' }
  | { state: 'testing' }
  | { state: 'success' }
  | { state: 'error'; message: string };

export function LinearWizard({
  localConfig,
  setLocalConfig,
  onTestConnection,
  onSave,
  isSaving = false,
}: LinearWizardProps) {
  const { t } = useTranslation();
  const [test, setTest] = useState<TestStatus>({ state: 'idle' });

  // Cast once for typed access — the underlying useState in
  // useIntegrationConfig is generic `Record<string, unknown>`, but for
  // the Linear branch we know its shape.
  const config = localConfig as LinearConfig;

  const updateField = useCallback(
    <K extends keyof LinearConfig>(field: K, value: LinearConfig[K]) => {
      setLocalConfig((prev) => ({ ...prev, [field]: value }));
      // Invalidate any previous test result on edit — a green check
      // that survives a credential change is a lie.
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
      setTest({ state: 'error', message: result.error });
    }
  };

  return (
    <div className="border p-4 rounded space-y-4" data-testid="linear-wizard">
      <div>
        <label htmlFor="linear-api-key" className="block text-sm font-medium">
          {t('linearConfig.apiKey')}
        </label>
        <input
          id="linear-api-key"
          type="password"
          value={config.apiKey ?? ''}
          onChange={(e) => updateField('apiKey', e.target.value)}
          className="w-full border p-2 rounded mt-1 font-mono"
          placeholder={t('linearConfig.apiKeyPlaceholder')}
          autoComplete="off"
          data-testid="linear-api-key-input"
        />
        <p className="mt-1 text-xs text-gray-500">{t('linearConfig.apiKeyHelp')}</p>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">{t('linearConfig.team')}</label>
        <LinearTeamPicker
          config={config}
          onSelect={({ id, key }) => {
            setLocalConfig((prev) => ({ ...prev, teamId: id, teamKey: key }));
            // Reset connection-test state — a green "Connection
            // successful" badge from a previous test would otherwise
            // remain visible across team changes and mislead the user.
            // Mirrors what `updateField` does for apiKey edits.
            setTest((prev) => (prev.state === 'idle' ? prev : { state: 'idle' }));
          }}
        />
      </div>

      <div className="flex items-center gap-3 pt-2 border-t">
        <button
          type="button"
          onClick={handleTest}
          disabled={test.state === 'testing' || !config.apiKey?.trim()}
          className="px-3 py-1 bg-gray-100 rounded disabled:opacity-50"
          data-testid="linear-test-connection"
        >
          {test.state === 'testing' ? (
            <span className="inline-flex items-center gap-1">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              {t('integrationConfig.testingConnection')}
            </span>
          ) : (
            t('integrationConfig.testConnection')
          )}
        </button>

        {test.state === 'success' && (
          <span
            className="inline-flex items-center gap-1 text-sm text-green-700"
            data-testid="linear-test-success"
          >
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            {t('integrationConfig.testSuccess')}
          </span>
        )}
        {test.state === 'error' && (
          <span
            className="inline-flex items-center gap-1 text-sm text-red-700"
            data-testid="linear-test-error"
          >
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            {test.message}
          </span>
        )}
      </div>

      <div className="flex gap-2 pt-2">
        <button
          type="button"
          onClick={onSave}
          // teamKey is required by `validateLinearConfig`; the picker
          // sets it atomically with teamId but devtools edits or stale
          // state can desync them, so gate save on both.
          disabled={
            isSaving || !config.apiKey?.trim() || !config.teamId?.trim() || !config.teamKey?.trim()
          }
          className="px-3 py-1 bg-blue-600 text-white rounded disabled:opacity-50"
          data-testid="linear-save"
        >
          {isSaving
            ? t('integrationConfig.saveConfiguration') + '…'
            : t('integrationConfig.saveConfiguration')}
        </button>
      </div>
    </div>
  );
}
