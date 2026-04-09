import type { FieldMappings } from '@bugspotter/types';

/**
 * Error message constants for field mapping validation
 */
export const ERROR_MESSAGES = {
  FIELD_ID_EMPTY: 'Field ID cannot be empty',
  BUGSPOTTER_FIELD_EMPTY: 'BugSpotter field cannot be empty',
  FIELD_ID_EXISTS: (fieldId: string) => `Field ID "${fieldId}" already exists`,
} as const;

/**
 * Validates field mapping inputs and returns error messages
 * @param allowEmptyValue - If true, allows empty BugSpotter field values (for Quick Add buttons)
 */
export function validateMapping(
  fieldId: string,
  value: string,
  existingMappings: FieldMappings | null,
  oldKey?: string,
  allowEmptyValue: boolean = false
): { key?: string; value?: string } {
  const errors: { key?: string; value?: string } = {};

  if (!fieldId) {
    errors.key = ERROR_MESSAGES.FIELD_ID_EMPTY;
  }

  if (!value && !allowEmptyValue) {
    errors.value = ERROR_MESSAGES.BUGSPOTTER_FIELD_EMPTY;
  }

  // Check for duplicate field IDs (only when renaming or adding new)
  if (fieldId && oldKey !== fieldId && existingMappings && fieldId in existingMappings) {
    errors.key = ERROR_MESSAGES.FIELD_ID_EXISTS(fieldId);
  }

  return errors;
}
