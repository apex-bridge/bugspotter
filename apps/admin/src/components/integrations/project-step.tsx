import React from 'react';
import { useTranslation } from 'react-i18next';
import { isJiraConfig } from '../../utils/type-guards';
import type { JiraConfig } from '../../types';

interface ProjectStepProps {
  localConfig: Record<string, unknown>;
  setLocalConfig: React.Dispatch<React.SetStateAction<Record<string, unknown>>>;
  onBack: () => void;
  onNext: () => void;
}

/**
 * Reusable project configuration step
 * Handles project key and issue type settings
 * Works with generic config but expects Jira-like structure
 */
export function ProjectStep({ localConfig, setLocalConfig, onBack, onNext }: ProjectStepProps) {
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
      <label htmlFor="project-key" className="block text-sm font-medium">
        {t('integrationConfig.projectKey')}
      </label>
      <input
        id="project-key"
        type="text"
        value={config.projectKey ?? ''}
        onChange={(e) => setLocalConfig({ ...localConfig, projectKey: e.target.value })}
        className="w-full border p-2 rounded mt-1"
        placeholder={t('integrationConfig.projectKeyPlaceholder')}
      />

      <label htmlFor="issue-type" className="block text-sm font-medium mt-3">
        {t('integrationConfig.issueType')}
      </label>
      <input
        id="issue-type"
        type="text"
        value={config.issueType ?? 'Bug'}
        onChange={(e) => setLocalConfig({ ...localConfig, issueType: e.target.value })}
        className="w-full border p-2 rounded mt-1"
        placeholder={t('integrationConfig.issueTypePlaceholder')}
      />

      <div className="mt-3 flex gap-2">
        <button className="px-3 py-1 bg-gray-100 rounded" onClick={onBack}>
          {t('integrationConfig.back')}
        </button>
        <button className="px-3 py-1 bg-blue-600 text-white rounded" onClick={onNext}>
          {t('integrationConfig.nextFieldMapping')}
        </button>
      </div>
    </div>
  );
}
