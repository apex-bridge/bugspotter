# Locale File Synchronization

This directory contains the internationalization (i18n) locale files for the BugSpotter Admin Panel.

## Locale Files

- `en.json` - English (reference locale)
- `ru.json` - Russian
- `kk.json` - Kazakh

## Structure Validation

To ensure all locale files remain synchronized, we use a **hash-based validation system** that checks:

1. **Structure Hash** - Verifies all locales have identical keys
2. **Section Hashes** - Validates each top-level section independently

### Running Validation

```bash
# Quick validation script (standalone)
pnpm validate:i18n

# Full test suite with detailed output
pnpm test:i18n
```

### Validation Script

The validation script (`validate-locales.mjs`) performs:

- ✅ Loads all locale files
- ✅ Extracts all keys recursively (e.g., `pages.sharedReplay.loading`)
- ✅ Creates SHA256 hashes for:
  - Overall structure (all keys)
  - Each top-level section (common, nav, auth, pages, etc.)
- ✅ Compares hashes across locales
- ✅ Reports missing/extra keys with detailed output

**Example Output:**

```
🔍 Validating locale file synchronization...

✅ Loaded en.json: 994 keys
✅ Loaded ru.json: 994 keys
✅ Loaded kk.json: 994 keys

📊 Structure Hashes (all keys):
  en: e1b2f7a1435b49e2a717bfafbbfd02910fcb9f21c581d4c7075c84fc61e3a5f3
  ru: e1b2f7a1435b49e2a717bfafbbfd02910fcb9f21c581d4c7075c84fc61e3a5f3
  kk: e1b2f7a1435b49e2a717bfafbbfd02910fcb9f21c581d4c7075c84fc61e3a5f3

✅ All locales have identical structure!

📂 Section Hashes:
  ✅ common
  ✅ nav
  ✅ auth
  ✅ pages
  ✅ integrations
  ... (18 sections total)

🎉 All locale files are perfectly synchronized!
```

### Test Suite

The test suite (`src/tests/i18n/locale-sync.test.ts`) includes **32 automated tests**:

**Structure Tests:**

- ✅ All locale files load without errors
- ✅ Same number of total keys in all locales
- ✅ Identical structure hashes across locales
- ✅ No missing keys in any locale
- ✅ No extra keys in any locale
- ✅ Identical sections across locales

**Section-Level Tests:**

- ✅ Individual validation for each section (18 sections)
- ✅ Critical sections (common, nav, auth, pages, integrations) exist in all locales

**Data Integrity Tests:**

- ✅ Valid JSON structure
- ✅ Consistent nesting depth across locales

## Adding New Translations

When adding new translation keys:

1. **Always add to all three locale files** (en, ru, kk)
2. **Maintain identical structure** - keys must be in the same nested location
3. **Run validation before committing:**
   ```bash
   pnpm validate:i18n
   ```

### Common Pitfalls

❌ **Adding keys to only one locale:**

```json
// en.json
"common": {
  "newKey": "New Feature"  // Added here
}

// ru.json
"common": {
  // Missing newKey! ❌
}
```

✅ **Correct approach:**

```json
// en.json
"common": {
  "newKey": "New Feature"
}

// ru.json
"common": {
  "newKey": "Новая функция"
}

// kk.json
"common": {
  "newKey": "Жаңа функция"
}
```

❌ **Wrong nesting level:**

```json
// en.json (CORRECT)
"pages": {
  "sharedReplay": {
    "loading": "Loading..."
  }
}

// kk.json (WRONG - at root level!)
"sharedReplay": {
  "loading": "Жүктелуде..."
}
```

## CI/CD Integration

The locale synchronization test is **automatically run** as part of the test suite:

```bash
# CI runs this command
pnpm test
```

If locales are out of sync, **the build will fail** with detailed error messages showing:

- Which keys are missing
- Which keys are extra
- Which sections have mismatches

## Hash System Details

### How Hashes Work

1. **Extract all keys** from each locale file recursively
2. **Sort keys alphabetically** to ensure deterministic ordering
3. **Create SHA256 hash** from the concatenated key list
4. **Compare hashes** - identical hashes = identical structure

### Why Hashes?

- ⚡ **Fast** - O(n) comparison vs O(n²) for key-by-key comparison
- 🎯 **Precise** - Any structural difference produces different hash
- 📊 **Granular** - Section-level hashes pinpoint exact mismatch location
- 🔒 **Reliable** - SHA256 collision probability is negligible

### Structure Hash Example

For locale with keys: `["common.add", "common.cancel", "nav.home"]`

```javascript
const keys = ['common.add', 'common.cancel', 'nav.home'];
const content = keys.join('\n');
// "common.add\ncommon.cancel\nnav.home"

const hash = createHash('sha256').update(content).digest('hex');
// "e1b2f7a1435b49e2a717bfafbbfd02910fcb9f21c581d4c7075c84fc61e3a5f3"
```

If any key is added, removed, or renamed → different hash.

## Troubleshooting

### "Structure mismatch detected"

The validation script will show you exactly what's wrong:

```
❌ Structure mismatch detected!

Missing in ru (3 keys):
  - integrations.tabAdvanced
  - integrations.filterCondition
  - pages.sharedReplay.loading

Extra in ru (1 key):
  + pages.queueName
```

**Fix:** Add missing keys and remove extra keys from the affected locale.

### "Section has mismatched keys"

```
📂 Section Hashes:
  ❌ integrations
      en: a1b2c3d4... (45 keys)
      ru: e5f6g7h8... (42 keys)
      kk: e5f6g7h8... (42 keys)
```

**Fix:** The `integrations` section is missing 3 keys in ru and kk. Add them from en.json.

### Running only i18n tests

```bash
# Standalone validation (fastest)
pnpm validate:i18n

# Full test suite with detailed assertions
pnpm test:i18n

# Watch mode during development
pnpm test -- src/tests/i18n/locale-sync.test.ts --watch
```

## Key Statistics

- **Total Keys:** 994 (as of 2026-01-16)
- **Sections:** 18 (common, nav, auth, dashboard, bugReports, users, projects, integrations, integrationConfig, integrationRules, notifications, settings, health, auditLogs, apiKeys, errors, tooltips, pages)
- **Locales:** 3 (en, ru, kk)
- **Structure Hash:** `e1b2f7a1435b49e2a717bfafbbfd02910fcb9f21c581d4c7075c84fc61e3a5f3`
- **Test Coverage:** 32 automated tests

## Related Files

- `../../../../scripts/validate-i18n.mjs` - Standalone validation script
- `src/tests/i18n/locale-sync.test.ts` - Vitest test suite
- `../../TESTING_STRATEGY.md` - Overall testing documentation
