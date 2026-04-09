import type { IntegrationRule } from '../types';

/**
 * Generates exportable JSON string from an integration rule by excluding internal-only fields.
 * Uses destructuring to automatically include all exportable fields, making it future-proof
 * when new fields are added to IntegrationRule.
 *
 * @param rule - The integration rule to export
 * @returns JSON string with 2-space indentation
 */
function generateExportableJson(rule: IntegrationRule): string {
  // Exclude internal-only fields using destructuring
  // All other fields (including field_mappings, description_template, attachment_config) are automatically included
  const {
    id: _id,
    project_id: _projectId,
    integration_id: _integrationId,
    created_at: _createdAt,
    updated_at: _updatedAt,
    ...exportableData
  } = rule;

  return JSON.stringify(exportableData, null, 2);
}

/**
 * Exports an integration rule as a JSON file by excluding internal-only fields.
 *
 * @param rule - The integration rule to export
 */
export function exportRuleAsJson(rule: IntegrationRule): void {
  // Create JSON blob
  const jsonString = generateExportableJson(rule);
  const blob = new Blob([jsonString], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  // Create download link with sanitized filename and timestamp to prevent collisions
  const link = document.createElement('a');
  link.href = url;
  const sanitizedName = rule.name.replace(/[^a-zA-Z0-9-_]/g, '_');
  link.download = `${sanitizedName}-${Date.now()}.json`;

  // Trigger download (no need to append to DOM in modern browsers)
  link.click();

  // Cleanup
  URL.revokeObjectURL(url);
}

/**
 * Copies an integration rule as JSON to the clipboard by excluding internal-only fields.
 *
 * @param rule - The integration rule to copy
 * @returns Promise that resolves when the JSON is copied to clipboard
 */
export async function copyRuleAsJson(rule: IntegrationRule): Promise<void> {
  const jsonString = generateExportableJson(rule);
  await navigator.clipboard.writeText(jsonString);
}
