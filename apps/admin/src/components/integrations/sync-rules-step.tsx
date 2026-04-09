import React from 'react';
import { useTranslation } from 'react-i18next';
import { isJiraConfig } from '../../utils/type-guards';
import type { JiraConfig } from '../../types';

interface SyncRulesStepProps {
  localConfig: Record<string, unknown>;
  setLocalConfig: React.Dispatch<React.SetStateAction<Record<string, unknown>>>;
  onBack: () => void;
  onSave: () => Promise<void>;
  variant?: 'default' | 'minimal';
}

/**
 * Reusable sync rules configuration step
 * Handles auto-create and bidirectional sync settings
 * Works with generic config but expects Jira-like structure
 *
 * @param variant - 'default' shows both sync direction and auto-create, 'minimal' shows only auto-create
 */
export function SyncRulesStep({
  localConfig,
  setLocalConfig,
  onBack,
  onSave,
  variant = 'default',
}: SyncRulesStepProps) {
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
      {variant === 'default' && (
        <>
          <label className="block text-sm">{t('integrationConfig.syncDirection')}</label>
          <select
            value={config.syncRules?.bidirectionalSync ? 'two-way' : 'one-way'}
            onChange={(e) =>
              setLocalConfig({
                ...localConfig,
                syncRules: {
                  ...config.syncRules,
                  bidirectionalSync: e.target.value === 'two-way',
                },
              })
            }
            className="w-full border p-2 rounded mt-1"
          >
            <option value="one-way">{t('integrationConfig.oneWay')}</option>
            <option value="two-way">{t('integrationConfig.twoWay')}</option>
          </select>
        </>
      )}

      <div className={variant === 'default' ? 'mt-4' : ''}>
        <label className="inline-flex items-center">
          <input
            type="checkbox"
            checked={config.syncRules?.autoCreate ?? false}
            onChange={(e) =>
              setLocalConfig({
                ...localConfig,
                syncRules: {
                  ...config.syncRules,
                  autoCreate: e.target.checked,
                },
              })
            }
            className="mr-2"
          />
          <span className="text-sm">{t('integrationConfig.autoCreateTickets')}</span>
        </label>
      </div>

      <div className="mt-3 flex gap-2">
        <button className="px-3 py-1 bg-gray-100 rounded" onClick={onBack}>
          {t('integrationConfig.back')}
        </button>
        <button
          className={`px-3 py-1 text-white rounded ${
            variant === 'default' ? 'bg-blue-600' : 'bg-green-600'
          }`}
          onClick={onSave}
        >
          {variant === 'default'
            ? t('integrationConfig.saveConfiguration')
            : t('integrationConfig.saveAndActivate')}
        </button>
      </div>
    </div>
  );
}
