import React from 'react';
import { getFieldMappings } from './field-mapping-config';

interface DefaultFieldMapperProps {
  localConfig: Record<string, unknown>;
  setLocalConfig: React.Dispatch<React.SetStateAction<Record<string, unknown>>>;
  integrationType: string;
}

/**
 * Default static field mapper for integrations without custom mappers
 * Displays field mappings based on integration type
 */
export function DefaultFieldMapper({ integrationType }: DefaultFieldMapperProps) {
  const fieldMappings = getFieldMappings(integrationType);
  const platformName = integrationType.charAt(0).toUpperCase() + integrationType.slice(1);

  return (
    <div className="space-y-3">
      <label className="block text-sm font-medium">Field Mapping</label>
      <div className="text-sm text-gray-600">
        <p>Map BugSpotter fields to {platformName} fields:</p>
        <ul className="list-disc list-inside mt-2 space-y-1">
          {fieldMappings.map((mapping, index) => (
            <li key={index}>
              {mapping.from} → {mapping.to}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
