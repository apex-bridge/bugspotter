/**
 * Jira Field Mappings
 * Applies integration rule field mappings to Jira issue fields
 */

import type { JiraIssueFields } from './types.js';

/**
 * Apply field mappings from integration rules to Jira issue fields.
 * Supports: assignee, components, labels, priority, description, custom fields.
 */
export function applyFieldMappings(
  issueFields: JiraIssueFields,
  fieldMappings: Record<string, unknown>
): void {
  Object.entries(fieldMappings).forEach(([fieldName, fieldValue]) => {
    // Only skip null/undefined - allow falsy values like false, 0, "" which are valid
    if (fieldValue === null || fieldValue === undefined) {
      return;
    }

    switch (fieldName) {
      case 'assignee': {
        if (typeof fieldValue === 'object') {
          const accountId = (fieldValue as Record<string, unknown>).accountId;
          if (typeof accountId === 'string') {
            issueFields.assignee = { accountId };
          }
        }
        break;
      }

      case 'components': {
        if (Array.isArray(fieldValue)) {
          issueFields.components = fieldValue
            .filter((c): c is Record<string, unknown> => c && typeof c === 'object')
            .flatMap((comp): Array<{ id?: string; name?: string }> => {
              if (comp.id != null) {
                return [{ id: String(comp.id) }];
              }
              if (comp.name != null) {
                return [{ name: String(comp.name) }];
              }
              return [];
            });
        }
        break;
      }

      case 'labels': {
        if (Array.isArray(fieldValue)) {
          const newLabels = fieldValue.filter((l) => typeof l === 'string') as string[];
          issueFields.labels = [...(issueFields.labels || []), ...newLabels];
        }
        break;
      }

      case 'priority': {
        // Standard Jira Cloud priority values: 'Highest', 'High', 'Medium', 'Low', 'Lowest'
        // Custom Jira instances may have different priority schemes
        // Invalid priority names will be rejected by Jira API with a descriptive error
        if (typeof fieldValue === 'object') {
          const priorityName = (fieldValue as Record<string, unknown>).name;
          if (typeof priorityName === 'string') {
            issueFields.priority = { name: priorityName };
          }
        }
        break;
      }

      case 'description': {
        if (typeof fieldValue === 'string') {
          issueFields.description = fieldValue;
        }
        break;
      }

      default: {
        // Handle custom fields: customfield_* or any other Jira field
        // Pass through as-is (Jira will validate on their end)
        if (fieldName.startsWith('customfield_') || fieldName.startsWith('custom_')) {
          (issueFields as Record<string, unknown>)[fieldName] = fieldValue;
        }
        break;
      }
    }
  });
}
