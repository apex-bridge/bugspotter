import { createHash } from 'crypto';

/**
 * Recursively get all leaf keys from an object (translation keys only, not intermediate paths)
 * @param {Record<string, any>} obj - The object to extract keys from
 * @param {string} prefix - The current key prefix
 * @returns {string[]} Sorted array of leaf keys in dot notation
 */
export function getAllKeys(obj, prefix = '') {
  const keys = [];
  for (const key of Object.keys(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (typeof obj[key] === 'object' && obj[key] !== null && !Array.isArray(obj[key])) {
      // Recurse for nested objects - only collect leaf keys
      keys.push(...getAllKeys(obj[key], fullKey));
    } else {
      // Leaf node - this is an actual translation key
      keys.push(fullKey);
    }
  }
  return keys.sort();
}

/**
 * Get keys grouped by top-level sections
 * @param {Record<string, any>} obj - The object to process
 * @returns {Record<string, string[]>} Object mapping section names to their keys
 */
export function getKeysBySection(obj) {
  const sections = {};
  for (const key of Object.keys(obj)) {
    if (typeof obj[key] === 'object' && obj[key] !== null && !Array.isArray(obj[key])) {
      sections[key] = getAllKeys(obj[key], key);
    } else {
      // Handle primitive values at root level
      if (!sections['_root']) {
        sections['_root'] = [];
      }
      sections['_root'].push(key);
    }
  }
  return sections;
}

/**
 * Create SHA256 hash from array of keys
 * @param {string[]} keys - Array of keys to hash
 * @returns {string} SHA256 hash as hex string
 */
export function hashKeys(keys) {
  const content = keys.join('\n');
  return createHash('sha256').update(content).digest('hex');
}
