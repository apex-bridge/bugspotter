/**
 * Formatting utilities for numbers, dates, and other data
 */

/**
 * Get the user's preferred locale from browser settings
 * Falls back to 'en-US' if not available
 */
export function getPreferredLocale(): string {
  if (typeof navigator !== 'undefined' && navigator.language) {
    return navigator.language;
  }
  return 'en-US';
}

/**
 * Format a number with locale-specific formatting
 * @param value - Number to format
 * @param locale - Locale to use (defaults to browser locale or 'en-US')
 * @returns Formatted number string with thousand separators
 */
export function formatNumber(value: number | undefined | null, locale?: string): string {
  if (value === undefined || value === null) {
    return '0';
  }
  return value.toLocaleString(locale || getPreferredLocale());
}

/**
 * Format a date string to localized date and time
 * @param dateString - ISO date string to format
 * @param locale - BCP 47 language tag (defaults to browser locale or 'en-US')
 */
export function formatDate(dateString: string, locale?: string): string {
  return new Date(dateString).toLocaleString(locale || getPreferredLocale(), {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/**
 * Format a date string to localized date only (no time)
 * @param dateString - ISO date string to format
 * @param locale - BCP 47 language tag (defaults to browser locale or 'en-US')
 * @returns Formatted date string (e.g., "12/31/2025" for en-US)
 */
export function formatDateShort(dateString: string, locale?: string): string {
  return new Date(dateString).toLocaleDateString(locale || getPreferredLocale(), {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

/**
 * Format a date string to localized long format with month names
 * @param dateString - ISO date string to format
 * @param locale - BCP 47 language tag (defaults to browser locale or 'en-US')
 * @returns Formatted date string (e.g., "December 31, 2025, 02:30 PM" for en-US)
 */
export function formatDateLong(dateString: string, locale?: string): string {
  return new Date(dateString).toLocaleDateString(locale || getPreferredLocale(), {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Format a timestamp (milliseconds) to HH:MM:SS time format
 * @param timestamp - Timestamp in milliseconds
 * @param locale - BCP 47 language tag (defaults to browser locale or 'en-US')
 * @returns Formatted time string (e.g., "14:30:45")
 */
export function formatTimestamp(timestamp: number, locale?: string): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString(locale || getPreferredLocale(), {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}
