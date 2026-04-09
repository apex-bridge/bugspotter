#!/usr/bin/env node
import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { getAllKeys, getKeysBySection, hashKeys } from '../apps/admin/src/i18n/locale-utils.mjs';
import { findDuplicateKeys } from './shared/duplicate-key-detector.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ============================================================================
// VALIDATION LOGIC
// ============================================================================

/**
 * Validate locale files
 */
function validateLocales() {
  const localesDir = join(__dirname, '..', 'apps', 'admin', 'src', 'i18n', 'locales');
  const referenceLocale = 'en';
  
  // Dynamically discover locale files
  const localeFiles = readdirSync(localesDir).filter(file => file.endsWith('.json'));
  const locales = localeFiles.map(file => file.replace('.json', '')).sort();
  
  // Validate reference locale exists
  if (!locales.includes(referenceLocale)) {
    console.error(`❌ Reference locale '${referenceLocale}.json' not found in ${localesDir}`);
    process.exit(1);
  }
  
  console.log('🔍 Validating locale file synchronization...\n');
  console.log(`📌 Reference locale: ${referenceLocale}`);
  console.log(`📁 Found ${locales.length} locale(s): ${locales.join(', ')}\n`);

  // Load all locale files
  const localeData = {};
  const allKeys = {};
  const sectionKeys = {};
  const hashes = {
    structure: {},
    sections: {}
  };

  for (const locale of locales) {
    const filePath = join(localesDir, `${locale}.json`);
    try {
      const content = readFileSync(filePath, 'utf-8');
      
      // Check for duplicate keys before parsing
      const duplicates = findDuplicateKeys(content, locale);
      if (duplicates.length > 0) {
        console.error(`❌ Duplicate keys found in ${locale}.json:`);
        duplicates.forEach(({ key, line }) => {
          console.error(`   Line ${line}: "${key}"`);
        });
        console.error(`\n💡 Tip: JSON.parse() silently overwrites duplicate keys with the last value.`);
        console.error(`   Remove all but one occurrence of each duplicate key.\n`);
        process.exit(1);
      }
      
      localeData[locale] = JSON.parse(content);
      
      // Get all keys
      allKeys[locale] = getAllKeys(localeData[locale]);
      
      // Get keys by section
      sectionKeys[locale] = getKeysBySection(localeData[locale]);
      
      // Calculate structure hash (all keys)
      hashes.structure[locale] = hashKeys(allKeys[locale]);
      
      // Calculate section hashes
      hashes.sections[locale] = {};
      for (const section of Object.keys(sectionKeys[locale])) {
        hashes.sections[locale][section] = hashKeys(sectionKeys[locale][section]);
      }
      
      console.log(`✅ Loaded ${locale}.json: ${allKeys[locale].length} keys`);
    } catch (error) {
      console.error(`❌ Error loading ${locale}.json:`, error.message);
      process.exit(1);
    }
  }

  console.log('\n📊 Structure Hashes (all keys):');
  for (const locale of locales) {
    console.log(`  ${locale}: ${hashes.structure[locale]}`);
  }

  // Compare structure hashes
  const structureHashes = Object.values(hashes.structure);
  const structuresMatch = structureHashes.every(hash => hash === structureHashes[0]);
  
  if (structuresMatch) {
    console.log('\n✅ All locales have identical structure!');
  } else {
    console.log('\n❌ Structure mismatch detected!');
    
    // Find differences against reference locale
    const referenceKeys = allKeys[referenceLocale];
    for (const locale of locales) {
      if (locale === referenceLocale) continue;
      
      const currentKeys = allKeys[locale];
      
      // Use Sets for O(n+m) complexity instead of O(n*m)
      const referenceSet = new Set(referenceKeys);
      const currentSet = new Set(currentKeys);
      const missingKeys = referenceKeys.filter(key => !currentSet.has(key));
      const extraKeys = currentKeys.filter(key => !referenceSet.has(key));
      
      if (missingKeys.length > 0) {
        console.log(`\n  Missing in ${locale} (${missingKeys.length} keys):`);
        missingKeys.slice(0, 10).forEach(key => console.log(`    - ${key}`));
        if (missingKeys.length > 10) {
          console.log(`    ... and ${missingKeys.length - 10} more`);
        }
      }
      
      if (extraKeys.length > 0) {
        console.log(`\n  Extra in ${locale} (${extraKeys.length} keys):`);
        extraKeys.slice(0, 10).forEach(key => console.log(`    + ${key}`));
        if (extraKeys.length > 10) {
          console.log(`    ... and ${extraKeys.length - 10} more`);
        }
      }
    }
    
    process.exit(1);
  }

  // Compare section hashes
  console.log('\n📂 Section Hashes:');
  const allSections = new Set();
  for (const locale of locales) {
    Object.keys(sectionKeys[locale]).forEach(section => allSections.add(section));
  }

  let sectionMismatch = false;
  for (const section of Array.from(allSections).sort()) {
    const sectionHashValues = locales.map(locale => hashes.sections[locale]?.[section] || 'missing');
    const sectionMatch = sectionHashValues.every(hash => hash === sectionHashValues[0]);
    
    const status = sectionMatch ? '✅' : '❌';
    console.log(`  ${status} ${section}`);
    
    if (!sectionMatch) {
      sectionMismatch = true;
      for (const locale of locales) {
        const hash = hashes.sections[locale]?.[section] || 'missing';
        const keyCount = sectionKeys[locale]?.[section]?.length || 0;
        console.log(`      ${locale}: ${hash.substring(0, 8)}... (${keyCount} keys)`);
      }
    }
  }

  if (sectionMismatch) {
    console.log('\n⚠️  Some sections have mismatched keys');
    process.exit(1);
  }

  console.log('\n🎉 All locale files are perfectly synchronized!');
  console.log(`\n📋 Summary:`);
  console.log(`  - Locales: ${locales.length}`);
  console.log(`  - Total keys: ${allKeys[referenceLocale].length}`);
  console.log(`  - Sections: ${allSections.size}`);
  console.log(`  - Structure hash: ${hashes.structure[referenceLocale].substring(0, 16)}...`);
  
  return true;
}

// ============================================================================
// MAIN EXECUTION
// ============================================================================

try {
  validateLocales();
} catch (error) {
  console.error('💥 Validation failed:', error.message);
  process.exit(1);
}
