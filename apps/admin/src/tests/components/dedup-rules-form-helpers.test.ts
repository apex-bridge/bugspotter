/**
 * Unit tests for the pure helpers exported from
 * `components/dedup-rules/rule-form-dialog.tsx`. The form itself
 * round-trips a `DedupRule` through these on every keystroke — a
 * regression here would silently produce backend-invalid bodies that
 * Zod rejects at submit time with a generic message.
 *
 * The functions under test:
 *  - `parseConditionValue(field, op, raw)` — input-side parser.
 *  - `displayConditionValue(value)` — inverse for the input's value
 *    prop.
 *
 * Together they form the contract that an arbitrary
 * `DedupRule.conditions` round-trip survives an edit cycle.
 */

import { describe, it, expect } from 'vitest';
import {
  parseConditionValue,
  displayConditionValue,
} from '../../components/dedup-rules/rule-form-dialog';
import { TRIGGER_TYPES, ACTION_TYPES } from '../../services/dedup-rules-service';
import enLocale from '../../i18n/locales/en.json';
import ruLocale from '../../i18n/locales/ru.json';
import kkLocale from '../../i18n/locales/kk.json';

describe('parseConditionValue', () => {
  describe('string field + scalar op (canonical.status / eq)', () => {
    it('keeps a plain string value', () => {
      expect(parseConditionValue('canonical.status', 'eq', 'closed')).toBe('closed');
    });

    it('preserves whitespace inside the value (no trim on scalars)', () => {
      expect(parseConditionValue('canonical.status', 'eq', '  closed  ')).toBe('  closed  ');
    });
  });

  describe('string field + list op (canonical.status / in)', () => {
    it('splits a comma-separated list', () => {
      expect(parseConditionValue('canonical.status', 'in', 'open, in_progress, closed')).toEqual([
        'open',
        'in_progress',
        'closed',
      ]);
    });

    it('trims and drops empty entries', () => {
      expect(parseConditionValue('canonical.status', 'in', 'open,, ,closed')).toEqual([
        'open',
        'closed',
      ]);
    });

    it('returns an empty array for blank input', () => {
      expect(parseConditionValue('canonical.status', 'in', '')).toEqual([]);
    });
  });

  describe('numeric field (hits_in_window)', () => {
    it('parses a clean integer string to number for scalar ops', () => {
      expect(parseConditionValue('hits_in_window', 'eq', '5')).toBe(5);
      expect(parseConditionValue('hits_in_window', 'gte', '10')).toBe(10);
    });

    it('falls through to string when input is not a number (eq with stale string value)', () => {
      // The form-state bug Claude flagged: user picks
      // canonical.status, types "open", then changes field to
      // hits_in_window. The parser must not silently coerce.
      expect(parseConditionValue('hits_in_window', 'eq', 'open')).toBe('open');
    });

    it('parses each list entry as a number for in/not_in', () => {
      expect(parseConditionValue('hits_in_window', 'in', '1, 5, 10')).toEqual([1, 5, 10]);
    });

    it('mixed list keeps unparseable entries as strings', () => {
      expect(parseConditionValue('hits_in_window', 'in', '1, abc, 3')).toEqual([1, 'abc', 3]);
    });
  });

  describe('numeric field (canonical.closed_days_ago)', () => {
    it('parses to number for scalar ops', () => {
      expect(parseConditionValue('canonical.closed_days_ago', 'gte', '7')).toBe(7);
    });
  });

  describe('non-numeric fields stay as strings even for gte/lte', () => {
    // The Zod schema's transform coerces string→number for gte/lte
    // server-side too. Client side, we only parse known numeric
    // fields — leaves `severity` (string priority labels like 'high')
    // to flow through as a string.
    it('severity gte stays string', () => {
      expect(parseConditionValue('severity', 'gte', 'high')).toBe('high');
    });
  });
});

describe('displayConditionValue', () => {
  it('returns string values verbatim', () => {
    expect(displayConditionValue('open')).toBe('open');
  });

  it('coerces numbers via String()', () => {
    expect(displayConditionValue(7)).toBe('7');
  });

  it('joins arrays with comma + space (matches the parser split)', () => {
    expect(displayConditionValue(['open', 'closed'])).toBe('open, closed');
    expect(displayConditionValue([1, 5, 10])).toBe('1, 5, 10');
  });

  it('renders booleans as their string form', () => {
    expect(displayConditionValue(true)).toBe('true');
  });

  it('renders empty array as empty string', () => {
    expect(displayConditionValue([])).toBe('');
  });
});

describe('round-trip: display(parse(raw))', () => {
  // These two helpers form the form-state contract: parsing user
  // input then displaying the result should equal the canonical
  // rendered form. Regressions here surface as input-field jitter
  // (cursor jumps, characters reordering on keystroke).
  it('list op round-trip', () => {
    const parsed = parseConditionValue('canonical.status', 'in', 'open,closed');
    expect(displayConditionValue(parsed)).toBe('open, closed');
  });

  it('numeric field round-trip', () => {
    const parsed = parseConditionValue('hits_in_window', 'eq', '42');
    expect(displayConditionValue(parsed)).toBe('42');
  });
});

/**
 * The form looks up hint text via dynamic keys derived from the
 * selected variant: `triggerHints.${type}` for triggers and
 * `actionHints.${type.replace(/\./g, '_')}` for actions. If a schema
 * variant is ever added without the matching i18n key, the form
 * silently renders the raw key string to admins.
 *
 * This guard iterates `TRIGGER_TYPES` and `ACTION_TYPES` (the same
 * arrays the form imports from the service) and asserts every member
 * has a non-empty hint in every shipped locale. New trigger / action
 * lands → CI fails until en/ru/kk all carry the hint.
 */
describe('rule-form hint i18n coverage', () => {
  const locales = { en: enLocale, ru: ruLocale, kk: kkLocale } as const;

  type HintBag = Record<string, string>;
  function hintsAt(localeJson: unknown, leaf: 'triggerHints' | 'actionHints'): HintBag {
    const root = localeJson as { dedupRules: { form: Record<string, HintBag> } };
    return root.dedupRules.form[leaf];
  }

  for (const [name, json] of Object.entries(locales)) {
    describe(`${name} locale`, () => {
      it.each([...TRIGGER_TYPES])('has a triggerHints entry for %s', (type) => {
        const bag = hintsAt(json, 'triggerHints');
        expect(bag[type]).toBeTruthy();
        expect(typeof bag[type]).toBe('string');
      });

      it.each([...ACTION_TYPES])('has an actionHints entry for %s', (type) => {
        const key = type.replace(/\./g, '_');
        const bag = hintsAt(json, 'actionHints');
        expect(bag[key]).toBeTruthy();
        expect(typeof bag[key]).toBe('string');
      });

      // The plural rate-limit hint is a third dynamic-key pattern —
      // i18next picks `_one` vs `_other` based on the runtime `count`.
      // Both forms must exist per locale; a locale that ships only
      // one form would render the raw key for the missing branch.
      it.each(['rateLimitHint_one', 'rateLimitHint_other'])('has %s', (key) => {
        const root = json as { dedupRules: { form: Record<string, unknown> } };
        const value = root.dedupRules.form[key];
        expect(value).toBeTruthy();
        expect(typeof value).toBe('string');
      });
    });
  }
});
