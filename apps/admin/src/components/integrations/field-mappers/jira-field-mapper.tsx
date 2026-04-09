import React from 'react';
import FieldMapper from '../field-mapper';
import { isJiraConfig } from '../../../utils/type-guards';
import type { JiraConfig } from '../../../types';

interface JiraFieldMapperProps {
  integrationType: string;
  localConfig: Record<string, unknown>;
  setLocalConfig: React.Dispatch<React.SetStateAction<Record<string, unknown>>>;
}

/**
 * Jira-specific field mapper with interactive drag-and-drop UI
 * Works with generic config but expects Jira-like structure
 */
export function JiraFieldMapper({ localConfig, setLocalConfig }: JiraFieldMapperProps) {
  // Validate config structure before accessing properties
  if (!isJiraConfig(localConfig)) {
    return (
      <div className="text-sm text-red-600">
        Invalid configuration structure. Please ensure all required fields are present.
      </div>
    );
  }

  // After validation, we can safely access JiraConfig properties
  const config = localConfig as JiraConfig;

  return (
    <FieldMapper
      sourceFields={[
        { id: 'title', name: 'title' },
        { id: 'description', name: 'description' },
      ]}
      targetFields={[
        { id: 'summary', name: 'summary' },
        { id: 'description', name: 'description' },
      ]}
      mappings={config.fieldMapping?.customFields ?? []}
      onChange={(m) =>
        setLocalConfig({
          ...localConfig,
          fieldMapping: { ...(config.fieldMapping || {}), customFields: m },
        })
      }
    />
  );
}
