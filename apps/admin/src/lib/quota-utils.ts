/**
 * Quota Utility Functions
 * Shared utilities for quota calculations and UI rendering
 */

/**
 * Returns the appropriate Tailwind CSS color class for a quota progress bar
 * based on the usage percentage.
 *
 * @param percentage - The usage percentage (0-100)
 * @returns Tailwind CSS color class string
 *
 * @example
 * ```tsx
 * const colorClass = getQuotaProgressColor(85); // returns 'bg-yellow-500'
 * <div className={`h-2 rounded-full ${colorClass}`} />
 * ```
 */
export function getQuotaProgressColor(percentage: number): string {
  if (percentage >= 90) {
    return 'bg-red-500'; // Critical - at or above 90%
  }
  if (percentage >= 70) {
    return 'bg-yellow-500'; // Warning - at or above 70%
  }
  return 'bg-primary'; // Normal - below 70%
}

/**
 * Checks if a resource usage is at a critical level (>= 90%)
 */
export function isQuotaCritical(percentage: number): boolean {
  return percentage >= 90;
}

/**
 * Checks if a resource usage is at a warning level (>= 70% but < 90%)
 */
export function isQuotaWarning(percentage: number): boolean {
  return percentage >= 70 && percentage < 90;
}
