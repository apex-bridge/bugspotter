/**
 * Export utilities for downloading data as JSON or CSV files
 */

/**
 * Sanitize a string for safe CSV export
 * - Escapes double quotes by doubling them
 * - Removes newline characters that would break CSV structure
 * - Prevents CSV injection by prepending single quote to formula characters
 * @param value - String value to sanitize
 * @returns Sanitized string safe for CSV field
 */
export function sanitizeCSVField(value: string): string {
  let sanitized = value.replace(/"/g, '""').replace(/[\r\n]+/g, ' ');

  // Prevent CSV injection: prepend single quote if value starts with formula characters
  // This prevents execution in Excel/Google Sheets
  if (/^[=+\-@|%]/.test(sanitized)) {
    sanitized = "'" + sanitized;
  }

  return sanitized;
}

/**
 * Format a value for CSV output
 * - Sanitizes the value for safety
 * - Wraps in quotes if the value contains commas, quotes, or starts with formula characters
 * @param value - String or number value to format
 * @returns Properly formatted and quoted CSV field
 */
export function formatCSVField(value: string | number): string {
  // Numbers can be returned as-is (negative numbers are safe, not formulas)
  if (typeof value === 'number') {
    return String(value);
  }

  // For strings, sanitize and quote if needed
  const sanitized = sanitizeCSVField(value);

  // Wrap in quotes if needed (contains comma, starts with quote/formula char, or was modified by sanitization)
  if (
    sanitized.includes(',') ||
    sanitized.startsWith('"') ||
    sanitized.startsWith("'") ||
    sanitized !== value
  ) {
    return `"${sanitized}"`;
  }

  return sanitized;
}

/**
 * Export data as JSON file
 * @param data - Array of objects to export
 * @param filenamePrefix - Prefix for the downloaded filename (e.g., 'console-logs')
 */
export function exportAsJSON<T>(data: T[], filenamePrefix: string): void {
  const dataStr = JSON.stringify(data, null, 2);
  const dataBlob = new Blob([dataStr], { type: 'application/json' });
  const url = URL.createObjectURL(dataBlob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${filenamePrefix}-${Date.now()}.json`;
  link.click();
  link.remove();

  // Delay revoking URL to ensure download starts on all browsers
  setTimeout(() => URL.revokeObjectURL(url), 100);
}

/**
 * Export data as CSV file
 * @param data - Array of objects to export
 * @param headers - CSV column headers
 * @param rowMapper - Function to map each object to an array of CSV values
 * @param filenamePrefix - Prefix for the downloaded filename (e.g., 'console-logs')
 */
export function exportAsCSV<T>(
  data: T[],
  headers: string[],
  rowMapper: (item: T) => (string | number)[],
  filenamePrefix: string
): void {
  const rows = data.map((item) => rowMapper(item).map(formatCSVField));
  const formattedHeaders = headers.map(formatCSVField);
  const csvContent = [formattedHeaders.join(','), ...rows.map((row) => row.join(','))].join('\n');

  const dataBlob = new Blob([csvContent], { type: 'text/csv' });
  const url = URL.createObjectURL(dataBlob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${filenamePrefix}-${Date.now()}.csv`;
  link.click();
  link.remove();

  // Delay revoking URL to ensure download starts on all browsers
  setTimeout(() => URL.revokeObjectURL(url), 100);
}
