/**
 * Default field mapping configurations for integrations
 * Maps BugSpotter fields to platform-specific fields
 */

export interface FieldMapping {
  from: string;
  to: string;
}

/**
 * Default field mappings for each integration type
 * These are used when an integration doesn't have a custom mapper
 */
export const DEFAULT_FIELD_MAPPINGS: Record<string, FieldMapping[]> = {
  jira: [
    { from: 'Title', to: 'Summary' },
    { from: 'Description', to: 'Description' },
    { from: 'Priority', to: 'Priority' },
  ],
  github: [
    { from: 'Title', to: 'Title' },
    { from: 'Description', to: 'Body' },
    { from: 'Priority', to: 'Labels' },
  ],
  linear: [
    { from: 'Title', to: 'Title' },
    { from: 'Description', to: 'Description' },
    { from: 'Priority', to: 'Priority' },
  ],
  slack: [
    { from: 'Title', to: 'Message Title' },
    { from: 'Description', to: 'Message Body' },
  ],
};

/**
 * Get field mappings for a specific integration type
 * Falls back to Jira mappings if type is not found
 */
export function getFieldMappings(integrationType: string): FieldMapping[] {
  return DEFAULT_FIELD_MAPPINGS[integrationType] || DEFAULT_FIELD_MAPPINGS.jira;
}
