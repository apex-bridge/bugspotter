/**
 * Parse a confidence/similarity threshold input (a 0-1 fraction).
 *
 * Returns the parsed number when it's a valid in-range value, or null when the
 * input is empty, non-numeric, or out of [0, 1]. Callers use null to decide
 * whether to persist the value or revert the field to the last saved one.
 */
export function parseThresholdInput(value: string): number | null {
  const num = Number.parseFloat(value);
  return !Number.isNaN(num) && num >= 0 && num <= 1 ? num : null;
}
