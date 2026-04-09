import { useState, useEffect } from 'react';

/**
 * Debounce hook - delays updating value until after delay period
 * Useful for preventing excessive API calls while typing
 *
 * @param value - Value to debounce
 * @param delay - Delay in milliseconds (default 300ms)
 * @returns Debounced value that updates after delay period
 *
 * @example
 * ```tsx
 * const [searchQuery, setSearchQuery] = useState('');
 * const debouncedQuery = useDebounce(searchQuery, 500);
 *
 * useEffect(() => {
 *   if (debouncedQuery) {
 *     fetchResults(debouncedQuery);
 *   }
 * }, [debouncedQuery]);
 * ```
 */
export function useDebounce<T>(value: T, delay: number = 300): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
}
