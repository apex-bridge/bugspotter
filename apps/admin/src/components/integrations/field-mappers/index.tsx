import React from 'react';
import { JiraFieldMapper } from './jira-field-mapper';
import { DefaultFieldMapper } from './default-field-mapper';

interface FieldMapperProps {
  integrationType: string;
  localConfig: Record<string, unknown>;
  setLocalConfig: React.Dispatch<React.SetStateAction<Record<string, unknown>>>;
}

/**
 * Factory function that returns the appropriate field mapper component
 * based on integration type
 *
 * @param integrationType - The base integration type (e.g., 'jira', 'github')
 * @returns The appropriate field mapper component
 */
export function getFieldMapper(integrationType: string): React.ComponentType<FieldMapperProps> {
  switch (integrationType) {
    case 'jira':
      return JiraFieldMapper;
    // Future: Add more integration-specific mappers
    // case 'linear':
    //   return LinearFieldMapper;
    // case 'github':
    //   return GithubFieldMapper;
    default:
      return DefaultFieldMapper;
  }
}

/**
 * Field mapper component that dynamically selects the appropriate mapper
 * based on integration type
 */
export function FieldMapperFactory({
  integrationType,
  localConfig,
  setLocalConfig,
}: FieldMapperProps) {
  const FieldMapperComponent = getFieldMapper(integrationType);

  return (
    <FieldMapperComponent
      integrationType={integrationType}
      localConfig={localConfig}
      setLocalConfig={setLocalConfig}
    />
  );
}
