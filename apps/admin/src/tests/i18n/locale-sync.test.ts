import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { getAllKeys, getKeysBySection, hashKeys } from '../../i18n/locale-utils.mjs';

describe('Locale File Synchronization', () => {
  const localesDir = join(__dirname, '../../i18n/locales');

  // Dynamically discover locale files
  const localeFiles = readdirSync(localesDir).filter((file) => file.endsWith('.json'));
  const locales = localeFiles.map((file) => file.replace('.json', '')).sort();

  // Load all locale files
  const localeData: Record<string, Record<string, unknown>> = {};
  const allKeys: Record<string, string[]> = {};
  const sectionKeys: Record<string, Record<string, string[]>> = {};
  const structureHashes: Record<string, string> = {};
  const sectionHashes: Record<string, Record<string, string>> = {};

  // Pre-load all locale data for tests
  for (const locale of locales) {
    const filePath = join(localesDir, `${locale}.json`);
    const content = readFileSync(filePath, 'utf-8');
    localeData[locale] = JSON.parse(content);
    allKeys[locale] = getAllKeys(localeData[locale]);
    sectionKeys[locale] = getKeysBySection(localeData[locale]);
    structureHashes[locale] = hashKeys(allKeys[locale]);
    sectionHashes[locale] = {};
    for (const section of Object.keys(sectionKeys[locale])) {
      sectionHashes[locale][section] = hashKeys(sectionKeys[locale][section]);
    }
  }

  it('should load all locale files without errors', () => {
    for (const locale of locales) {
      expect(localeData[locale]).toBeDefined();
      expect(typeof localeData[locale]).toBe('object');
    }
  });

  it('should have the same number of total keys in all locales', () => {
    const keyCounts = locales.map((locale) => allKeys[locale].length);
    const referenceCount = keyCounts[0];

    for (let i = 1; i < keyCounts.length; i++) {
      expect(keyCounts[i]).toBe(referenceCount);
    }
  });

  it('should have identical structure hashes across all locales', () => {
    const hashes = locales.map((locale) => structureHashes[locale]);
    const referenceHash = hashes[0];

    for (let i = 1; i < hashes.length; i++) {
      expect(hashes[i]).toBe(referenceHash);
    }
  });

  it('should have no missing keys in any locale', () => {
    const referenceKeys = allKeys['en'];

    for (const locale of locales.slice(1)) {
      const currentKeys = allKeys[locale];
      const currentSet = new Set(currentKeys);
      const missingKeys = referenceKeys.filter((key) => !currentSet.has(key));

      expect(missingKeys).toEqual([]);
    }
  });

  it('should have no extra keys in any locale', () => {
    const referenceKeys = allKeys['en'];
    const referenceSet = new Set(referenceKeys);

    for (const locale of locales.slice(1)) {
      const currentKeys = allKeys[locale];
      const extraKeys = currentKeys.filter((key) => !referenceSet.has(key));

      expect(extraKeys).toEqual([]);
    }
  });

  it('should have identical sections across all locales', () => {
    const referenceSections = Object.keys(sectionKeys['en']).sort();

    for (const locale of locales.slice(1)) {
      const currentSections = Object.keys(sectionKeys[locale]).sort();
      expect(currentSections).toEqual(referenceSections);
    }
  });

  it('should have identical section hashes for each section', () => {
    const allSections = new Set<string>();
    for (const locale of locales) {
      Object.keys(sectionKeys[locale]).forEach((section) => allSections.add(section));
    }

    for (const section of allSections) {
      const hashes = locales.map((locale) => sectionHashes[locale]?.[section]);
      const referenceHash = hashes[0];

      for (let i = 1; i < hashes.length; i++) {
        expect(hashes[i]).toBe(referenceHash);
      }
    }
  });

  describe('Section-level validation', () => {
    const sections = Object.keys(sectionKeys['en']);

    sections.forEach((section) => {
      it(`should have identical keys in "${section}" section across all locales`, () => {
        const referenceKeys = sectionKeys['en'][section];

        for (const locale of locales.slice(1)) {
          const currentKeys = sectionKeys[locale]?.[section] || [];
          expect(currentKeys).toEqual(referenceKeys);
        }
      });
    });
  });

  describe('Critical sections', () => {
    const criticalSections = ['common', 'nav', 'auth', 'pages', 'integrations'];

    criticalSections.forEach((section) => {
      it(`should have "${section}" section in all locales`, () => {
        for (const locale of locales) {
          expect(sectionKeys[locale][section]).toBeDefined();
          expect(sectionKeys[locale][section].length).toBeGreaterThan(0);
        }
      });
    });
  });

  it('should have valid JSON structure in all locale files', () => {
    for (const locale of locales) {
      const filePath = join(localesDir, `${locale}.json`);
      const content = readFileSync(filePath, 'utf-8');

      // Should not throw
      expect(() => JSON.parse(content)).not.toThrow();

      // Should be valid JSON object
      const parsed = JSON.parse(content);
      expect(typeof parsed).toBe('object');
      expect(parsed).not.toBeNull();
      expect(Array.isArray(parsed)).toBe(false);
    }
  });

  it('should have consistent nesting depth across locales', () => {
    function getMaxDepth(obj: Record<string, unknown>, currentDepth = 0): number {
      let maxDepth = currentDepth;
      for (const key of Object.keys(obj)) {
        if (typeof obj[key] === 'object' && obj[key] !== null && !Array.isArray(obj[key])) {
          maxDepth = Math.max(
            maxDepth,
            getMaxDepth(obj[key] as Record<string, unknown>, currentDepth + 1)
          );
        }
      }
      return maxDepth;
    }

    const depths = locales.map((locale) => getMaxDepth(localeData[locale]));
    const referenceDepth = depths[0];

    for (let i = 1; i < depths.length; i++) {
      expect(depths[i]).toBe(referenceDepth);
    }
  });
});
