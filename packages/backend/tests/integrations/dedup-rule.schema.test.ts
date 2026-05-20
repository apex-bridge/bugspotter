/**
 * Schema-level tests for `DedupRule` (Zod) — TypeScript mirror of
 * `bugspotter-intelligence/tests/models/test_dedup_rule.py`. The two
 * suites should stay aligned: if the Python model accepts a shape, the
 * TS schema should accept it too (and vice-versa for rejections).
 *
 * The non-obvious checks worth pinning down:
 *  - ActionSlack requires exactly one of `channel` / `user`
 *  - Window pattern rejects zero-duration and non-`<n><unit>` shapes
 *  - Cron pattern catches prose like "every monday"
 *  - ConditionSpec coerces (scalar -> list for in/not_in, string -> number
 *    for gte/lte) and rejects bool for gte/lte
 *  - `hits_in_window` requires a `window` parameter
 *  - The `if` (wire) / `conditions` (TS) alias both produce the same shape
 */

import { describe, it, expect } from 'vitest';
import {
  conditionSpecSchema,
  dedupRuleSchema,
  parseDedupRule,
  rateLimitSchema,
  triggerSpecSchema,
} from '../../src/integrations/dedup-rule.schema.js';

describe('triggerSpecSchema', () => {
  it('accepts duplicate_detected with no extra fields', () => {
    expect(() => triggerSpecSchema.parse({ type: 'duplicate_detected' })).not.toThrow();
  });

  it('accepts cluster_growing with threshold + window', () => {
    expect(() =>
      triggerSpecSchema.parse({ type: 'cluster_growing', threshold: 5, window: '24h' })
    ).not.toThrow();
  });

  it('rejects threshold < 2 on cluster_growing', () => {
    expect(() =>
      triggerSpecSchema.parse({ type: 'cluster_growing', threshold: 1, window: '24h' })
    ).toThrow();
  });

  it.each(['1s', '30s', '1h', '24h', '7d', '1w', '100h'])(
    'accepts well-formed window %s',
    (good) => {
      expect(() =>
        triggerSpecSchema.parse({ type: 'cluster_growing', threshold: 5, window: good })
      ).not.toThrow();
    }
  );

  it.each(['', '1', '1 h', '1hr', 'one hour', '1m30s', 'h1'])(
    'rejects malformed window %s',
    (bad) => {
      expect(() =>
        triggerSpecSchema.parse({ type: 'cluster_growing', threshold: 5, window: bad })
      ).toThrow();
    }
  );

  it.each(['0s', '0h', '0d', '00h'])('rejects zero-duration window %s', (bad) => {
    // Zero-duration windows would make conditions meaningless. The
    // Python model rejects these via the leading `[1-9]` in the regex;
    // mirror that here.
    expect(() =>
      triggerSpecSchema.parse({ type: 'cluster_growing', threshold: 5, window: bad })
    ).toThrow();
  });

  it.each(['0 9 * * 1', '*/5 * * * *', '0 0 1 1 *', '30 9 * * 1-5'])(
    'accepts well-formed cron %s',
    (good) => {
      expect(() => triggerSpecSchema.parse({ type: 'schedule', cron: good })).not.toThrow();
    }
  );

  it.each(['every monday', '0 9 * *', '0 9 * * 1 0', '', 'monday at 9'])(
    'rejects malformed cron %s',
    (bad) => {
      expect(() => triggerSpecSchema.parse({ type: 'schedule', cron: bad })).toThrow();
    }
  );

  it('rejects unknown trigger type via the discriminator', () => {
    expect(() => triggerSpecSchema.parse({ type: 'made_up' })).toThrow();
  });
});

describe('conditionSpecSchema', () => {
  it('accepts a known field with a list value for `in`', () => {
    expect(() =>
      conditionSpecSchema.parse({ field: 'canonical.status', op: 'in', value: ['closed'] })
    ).not.toThrow();
  });

  it('rejects unknown fields', () => {
    expect(() =>
      conditionSpecSchema.parse({ field: 'canonical.priority', op: 'eq', value: 'high' })
    ).toThrow();
  });

  it('coerces scalar -> singleton list for `in`', () => {
    const parsed = conditionSpecSchema.parse({
      field: 'canonical.status',
      op: 'in',
      value: 'closed',
    });
    expect(parsed.value).toEqual(['closed']);
  });

  it('coerces scalar -> singleton list for `not_in`', () => {
    const parsed = conditionSpecSchema.parse({
      field: 'severity',
      op: 'not_in',
      value: 'low',
    });
    expect(parsed.value).toEqual(['low']);
  });

  it('rejects non-coercible value for `in` (object)', () => {
    expect(() =>
      conditionSpecSchema.parse({ field: 'canonical.status', op: 'in', value: { bad: true } })
    ).toThrow();
  });

  it('coerces numeric-string -> number for `gte`', () => {
    const parsed = conditionSpecSchema.parse({
      field: 'hits_in_window',
      op: 'gte',
      value: '3',
      window: '24h',
    });
    expect(parsed.value).toBe(3);
  });

  it('rejects non-numeric string for `gte`', () => {
    expect(() =>
      conditionSpecSchema.parse({
        field: 'hits_in_window',
        op: 'gte',
        value: 'lots',
        window: '24h',
      })
    ).toThrow();
  });

  it.each(['', '   ', '\t\n'])(
    'rejects empty / whitespace-only string for `gte` (Number("") is 0 in JS, not NaN)',
    (bad) => {
      // Regression test: `Number("")` evaluates to 0, so an unguarded
      // coercion would silently treat a blank value as zero — diverging
      // from the Pydantic model where `int("")` raises a ValueError.
      // Guard with a trim + non-empty check before delegating to Number().
      expect(() =>
        conditionSpecSchema.parse({
          field: 'hits_in_window',
          op: 'gte',
          value: bad,
          window: '24h',
        })
      ).toThrow();
    }
  );

  it('rejects bool for `gte` (JS coerces `true > 5` silently)', () => {
    expect(() =>
      conditionSpecSchema.parse({
        field: 'hits_in_window',
        op: 'gte',
        value: true,
        window: '24h',
      })
    ).toThrow();
  });

  it.each([NaN, Infinity, -Infinity])(
    'rejects non-finite number %s for `gte` (passes typeof check, breaks every comparison)',
    (bad) => {
      // `NaN >= 3` is always `false`, so a rule with NaN/Infinity would
      // silently never fire — worst case for a rule engine. Catch at
      // parse time via Number.isFinite.
      expect(() =>
        conditionSpecSchema.parse({
          field: 'hits_in_window',
          op: 'gte',
          value: bad,
          window: '24h',
        })
      ).toThrow();
    }
  );

  it('requires `window` when field is `hits_in_window`', () => {
    expect(() =>
      conditionSpecSchema.parse({ field: 'hits_in_window', op: 'gte', value: 3 })
    ).toThrow();
  });

  it('does not require window for non-windowed fields', () => {
    expect(() =>
      conditionSpecSchema.parse({ field: 'severity', op: 'eq', value: 'high' })
    ).not.toThrow();
  });
});

describe('dedupRuleSchema — actions', () => {
  const baseRule = {
    name: 'test',
    when: { type: 'duplicate_detected' },
    then: [{ type: 'notify.email', to: 'reporter', template: 'ack' }],
  };

  it('accepts a minimal rule with one notify.email action', () => {
    expect(() => dedupRuleSchema.parse(baseRule)).not.toThrow();
  });

  it('rejects empty `then` array', () => {
    expect(() => dedupRuleSchema.parse({ ...baseRule, then: [] })).toThrow();
  });

  it('rejects unknown action type via the discriminator', () => {
    expect(() =>
      dedupRuleSchema.parse({ ...baseRule, then: [{ type: 'ticket.delete' }] })
    ).toThrow();
  });

  it.each([
    'reporter',
    'closer',
    'all_reporters',
    'team@example.com',
    'alice+ops@sub.example.co.uk',
  ])('notify.email accepts valid target %s', (good) => {
    expect(() =>
      dedupRuleSchema.parse({
        ...baseRule,
        then: [{ type: 'notify.email', to: good, template: 'ack' }],
      })
    ).not.toThrow();
  });

  it.each(['Reporter', 'everyone', 'not-an-email', '@example.com', 'alice@', 'alice@nodot'])(
    'notify.email rejects invalid target %s',
    (bad) => {
      expect(() =>
        dedupRuleSchema.parse({
          ...baseRule,
          then: [{ type: 'notify.email', to: bad, template: 'ack' }],
        })
      ).toThrow();
    }
  );

  it('notify.slack accepts channel-only', () => {
    expect(() =>
      dedupRuleSchema.parse({
        ...baseRule,
        then: [{ type: 'notify.slack', channel: '#regressions', message: 'hi' }],
      })
    ).not.toThrow();
  });

  it('notify.slack accepts user-only', () => {
    expect(() =>
      dedupRuleSchema.parse({
        ...baseRule,
        then: [{ type: 'notify.slack', user: 'closer', message: 'hi' }],
      })
    ).not.toThrow();
  });

  it('notify.slack rejects both channel and user set', () => {
    expect(() =>
      dedupRuleSchema.parse({
        ...baseRule,
        then: [{ type: 'notify.slack', channel: '#x', user: 'alice', message: 'hi' }],
      })
    ).toThrow();
  });

  it('notify.slack rejects neither channel nor user set', () => {
    expect(() =>
      dedupRuleSchema.parse({
        ...baseRule,
        then: [{ type: 'notify.slack', message: 'hi' }],
      })
    ).toThrow();
  });

  it('notify.slack rejects whitespace-only channel + empty user (would smuggle past a naive XOR)', () => {
    expect(() =>
      dedupRuleSchema.parse({
        ...baseRule,
        then: [{ type: 'notify.slack', channel: '   ', user: '', message: 'hi' }],
      })
    ).toThrow();
  });

  it('notify.webhook accepts a valid https URL', () => {
    expect(() =>
      dedupRuleSchema.parse({
        ...baseRule,
        then: [{ type: 'notify.webhook', url: 'https://example.com/hook' }],
      })
    ).not.toThrow();
  });

  it('notify.webhook rejects non-URL strings', () => {
    expect(() =>
      dedupRuleSchema.parse({
        ...baseRule,
        then: [{ type: 'notify.webhook', url: 'not-a-url' }],
      })
    ).toThrow();
  });

  it.each([
    'http://127.0.0.1:6379',
    'http://localhost:3000',
    'http://10.0.0.1/hook',
    'http://192.168.1.1/hook',
    'http://172.16.0.1/hook',
    'http://169.254.169.254/latest/meta-data/', // AWS metadata
    'http://[::1]/hook',
  ])('notify.webhook rejects internal / private host %s (SSRF)', (bad) => {
    // `z.string().url()` only validates syntax — without the SSRF refine
    // an admin could persist a rule that makes the executor POST to
    // internal services. Reject at parse time. The executor re-validates
    // as defense-in-depth.
    expect(() =>
      dedupRuleSchema.parse({
        ...baseRule,
        then: [{ type: 'notify.webhook', url: bad }],
      })
    ).toThrow();
  });

  // notify.telegram — KZ launch needs a first-class action because raw
  // webhook is too friction-heavy for the typical org admin. chat_id is
  // a string (Telegram supports negative numeric ids and @usernames),
  // message is plain text (no parse mode by default — markdown/HTML
  // expansion lands later if needed).
  it('notify.telegram accepts numeric chat_id', () => {
    expect(() =>
      dedupRuleSchema.parse({
        ...baseRule,
        then: [{ type: 'notify.telegram', chat_id: '-1001234567890', message: 'hi' }],
      })
    ).not.toThrow();
  });

  it('notify.telegram accepts @username chat_id', () => {
    expect(() =>
      dedupRuleSchema.parse({
        ...baseRule,
        then: [{ type: 'notify.telegram', chat_id: '@my_channel', message: 'hi' }],
      })
    ).not.toThrow();
  });

  it('notify.telegram rejects an empty chat_id', () => {
    expect(() =>
      dedupRuleSchema.parse({
        ...baseRule,
        then: [{ type: 'notify.telegram', chat_id: '', message: 'hi' }],
      })
    ).toThrow();
  });

  it('notify.telegram rejects an empty message', () => {
    expect(() =>
      dedupRuleSchema.parse({
        ...baseRule,
        then: [{ type: 'notify.telegram', chat_id: '@chan', message: '' }],
      })
    ).toThrow();
  });

  it('notify.telegram rejects missing chat_id', () => {
    expect(() =>
      dedupRuleSchema.parse({
        ...baseRule,
        then: [{ type: 'notify.telegram', message: 'hi' }],
      })
    ).toThrow();
  });
});

describe('dedupRuleSchema — top-level', () => {
  const baseRule = {
    name: 'test',
    when: { type: 'duplicate_detected' },
    then: [{ type: 'notify.email', to: 'reporter', template: 'ack' }],
  };

  it('normalizes `if` (wire) and `conditions` (TS) to the same shape', () => {
    const fromWire = dedupRuleSchema.parse({
      ...baseRule,
      if: [{ field: 'severity', op: 'eq', value: 'high' }],
    });
    const fromTs = dedupRuleSchema.parse({
      ...baseRule,
      conditions: [{ field: 'severity', op: 'eq', value: 'high' }],
    });
    expect(fromWire.conditions).toHaveLength(1);
    expect(fromTs.conditions).toHaveLength(1);
    expect(fromWire.conditions).toEqual(fromTs.conditions);
  });

  it('defaults `conditions` to an empty array when neither `if` nor `conditions` is set', () => {
    const parsed = dedupRuleSchema.parse(baseRule);
    expect(parsed.conditions).toEqual([]);
  });

  it('defaults `enabled` to true', () => {
    const parsed = dedupRuleSchema.parse(baseRule);
    expect(parsed.enabled).toBe(true);
  });

  it('rejects name longer than 120 chars', () => {
    expect(() => dedupRuleSchema.parse({ ...baseRule, name: 'x'.repeat(121) })).toThrow();
  });

  it('rejects empty name', () => {
    expect(() => dedupRuleSchema.parse({ ...baseRule, name: '' })).toThrow();
  });
});

describe('rateLimitSchema', () => {
  it('accepts count + window', () => {
    expect(() => rateLimitSchema.parse({ count: 1, window: '1h' })).not.toThrow();
  });

  it('rejects malformed window', () => {
    expect(() => rateLimitSchema.parse({ count: 1, window: 'every hour' })).toThrow();
  });

  it('rejects count < 1', () => {
    expect(() => rateLimitSchema.parse({ count: 0, window: '1h' })).toThrow();
  });
});

describe('parseDedupRule', () => {
  it('parses a fully-loaded realistic rule end-to-end', () => {
    // Mirrors the B3 "auto-reopen on regression" preset from the
    // Phase 0.5 plan — this is the shape the executor will load.
    const wire = {
      name: 'Auto-reopen on regression',
      when: { type: 'outbox_about_to_skip' },
      if: [
        { field: 'canonical.status', op: 'in', value: ['closed', 'wont_fix'] },
        { field: 'hits_in_window', op: 'gte', value: 3, window: '24h' },
      ],
      then: [
        { type: 'ticket.transition', target: 'canonical', to: 'in_progress' },
        {
          type: 'ticket.add_comment',
          target: 'canonical',
          body: 'Auto-reopened: {hits_24h} new hits in 24h.',
        },
      ],
      rate_limit: { count: 1, window: '24h' },
      enabled: true,
    };
    const parsed = parseDedupRule(wire);
    expect(parsed.name).toBe('Auto-reopen on regression');
    expect(parsed.when.type).toBe('outbox_about_to_skip');
    expect(parsed.conditions).toHaveLength(2);
    expect(parsed.then).toHaveLength(2);
    expect(parsed.rate_limit?.window).toBe('24h');
  });
});
