/**
 * Field Mappings Transformation Utilities
 * Handles conversion between UI format (strings) and API format (objects)
 */

/**
 * Transform field mappings from API format (objects) to UI format (strings)
 *
 * The backend stores field mappings as JSONB objects/arrays/primitives,
 * but the UI form expects string values (for easier editing in text inputs).
 *
 * This function:
 * - Converts objects/arrays to JSON strings (e.g., {accountId:"123"} -> '{"accountId":"123"}')
 * - Keeps primitive strings as-is (e.g., "Sprint 23" -> "Sprint 23")
 * - Converts other primitives to strings (e.g., 42 -> "42", true -> "true")
 * - Preserves null/undefined values (for proper form state management)
 *
 * @param fieldMappings - Field mappings from the backend API (or null)
 * @returns Transformed field mappings for UI form (or null)
 *
 * @example
 * // Objects are stringified
 * transformFieldMappingsForUI({ assignee: { accountId: "123" } })
 * // => { assignee: '{"accountId":"123"}' }
 *
 * @example
 * // Strings are kept as-is
 * transformFieldMappingsForUI({ customfield_10001: "Sprint 23" })
 * // => { customfield_10001: "Sprint 23" }
 *
 * @example
 * // Numbers/booleans are converted to strings
 * transformFieldMappingsForUI({ priority: 5, archived: true })
 * // => { priority: "5", archived: "true" }
 *
 * @example
 * // Null/undefined are preserved
 * transformFieldMappingsForUI({ assignee: null })
 * // => { assignee: null }
 */
export function transformFieldMappingsForUI(
  fieldMappings: Record<string, unknown> | null
): Record<string, string | null | undefined> | null {
  if (!fieldMappings) {
    return null;
  }

  return Object.entries(fieldMappings).reduce(
    (acc, [key, value]) => {
      // Preserve null/undefined for form state management
      if (value === null || value === undefined) {
        acc[key] = value;
      } else if (typeof value === 'string') {
        // Keep strings as-is
        acc[key] = value;
      } else if (typeof value === 'object') {
        // Convert objects/arrays to JSON strings
        acc[key] = JSON.stringify(value);
      } else {
        // Convert other primitives (numbers, booleans) to strings
        acc[key] = String(value);
      }
      return acc;
    },
    {} as Record<string, string | null | undefined>
  );
}

/**
 * Transform field mappings from UI format (strings) to API format (objects)
 *
 * JiraFieldMappings uses string values in the UI (JSON strings for complex objects),
 * but the backend expects the actual objects/primitives in JSONB format.
 *
 * This function:
 * - Parses JSON strings to objects/arrays/primitives (e.g., '{"accountId":"..."}' -> {accountId:"..."})
 * - Keeps plain text values as strings (for custom fields that use plain text)
 * - Allows falsy values like empty strings, false, 0 (to clear or set fields)
 * - Skips null/undefined values (removes them from the output)
 *
 * @param fieldMappings - Field mappings from the UI form (or null)
 * @returns Transformed field mappings for API submission (or null)
 *
 * @example
 * // JSON object strings are parsed
 * transformFieldMappingsForApi({ assignee: '{"accountId":"123"}' })
 * // => { assignee: { accountId: "123" } }
 *
 * @example
 * // Plain text is kept as-is
 * transformFieldMappingsForApi({ customfield_10001: 'Sprint 23' })
 * // => { customfield_10001: "Sprint 23" }
 *
 * @example
 * // Empty strings are preserved (to clear fields)
 * transformFieldMappingsForApi({ description: '' })
 * // => { description: "" }
 *
 * @example
 * // Null/undefined values are omitted
 * transformFieldMappingsForApi({ assignee: null, priority: undefined })
 * // => {}
 */
export function transformFieldMappingsForApi(
  fieldMappings: Record<string, string | unknown> | null
): Record<string, unknown> | null {
  if (!fieldMappings) {
    return null;
  }

  return Object.entries(fieldMappings).reduce(
    (acc, [key, value]) => {
      // Allow falsy values like empty strings (to clear fields) - only skip null/undefined
      if (value !== null && value !== undefined) {
        try {
          // If value is a string, try to parse it as JSON
          // Parse JSON string to object (e.g., '{"accountId":"..."}' -> {accountId:"..."})
          if (typeof value === 'string') {
            acc[key] = JSON.parse(value);
          } else {
            // If not a string, keep as-is (already the correct type)
            acc[key] = value;
          }
        } catch {
          // If not valid JSON, keep as string (custom fields might be plain text)
          acc[key] = value;
        }
      }
      return acc;
    },
    {} as Record<string, unknown>
  );
}
