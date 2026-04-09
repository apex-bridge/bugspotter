/**
 * Utility functions for Jira field mappings
 * Pure functions for parsing and transforming Jira field data
 */

/**
 * Parse JSON array fields (components, labels)
 * Handles both string arrays and object arrays with name property
 * Trims whitespace and filters out empty values
 *
 * @param jsonString - JSON string representation of array
 * @returns Array of non-empty string values, or empty array if invalid
 *
 * @example
 * parseArrayField('["tag1", "tag2"]') // => ["tag1", "tag2"]
 * parseArrayField('[{"name": "Component"}]') // => ["Component"]
 * parseArrayField('["  spaced  "]') // => ["spaced"]
 * parseArrayField('[{"name": ""}, "valid"]') // => ["valid"]
 */
export function parseArrayField(jsonString: string | undefined): string[] {
  if (!jsonString) {
    return [];
  }
  try {
    const parsed = JSON.parse(jsonString);
    if (Array.isArray(parsed)) {
      return parsed
        .map((item) => {
          const value = typeof item === 'string' ? item : item?.name || '';
          return value.trim();
        })
        .filter((value) => value.length > 0);
    }
  } catch {
    // Invalid JSON is an expected scenario - fail silently
  }
  return [];
}

/**
 * Parse priority field from JSON string
 * Returns the name property from the parsed object, or null if invalid
 * Empty string names are treated as invalid and return null
 *
 * @param jsonString - JSON string representation of priority object
 * @returns Priority name string, or null if invalid/empty
 *
 * @example
 * parsePriority('{"name": "High"}') // => "High"
 * parsePriority('{"name": ""}') // => null (empty string treated as invalid)
 * parsePriority('invalid json') // => null
 * parsePriority(undefined) // => null
 */
export function parsePriority(jsonString: string | undefined): string | null {
  if (!jsonString) {
    return null;
  }
  try {
    const parsed = JSON.parse(jsonString);
    return parsed?.name || null;
  } catch {
    return null;
  }
}
