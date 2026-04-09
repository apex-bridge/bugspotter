/**
 * Type definitions for locale-utils.mjs
 */

/**
 * Recursively get all leaf keys from an object (translation keys only, not intermediate paths)
 * @param obj - The object to extract keys from
 * @param prefix - The current key prefix
 * @returns Sorted array of leaf keys in dot notation
 */
export function getAllKeys(obj: Record<string, unknown>, prefix?: string): string[];

/**
 * Get keys grouped by top-level sections
 * @param obj - The object to process
 * @returns Object mapping section names to their keys
 */
export function getKeysBySection(obj: Record<string, unknown>): Record<string, string[]>;

/**
 * Create SHA256 hash from array of keys
 * @param keys - Array of keys to hash
 * @returns SHA256 hash as hex string
 */
export function hashKeys(keys: string[]): string;
