/**
 * Unit tests for `buildPlainTextADF`, the helper that turns a multi-line
 * plain-text string into the Atlassian Document Format payload used by
 * `JiraClient.addComment`.
 *
 * The behaviour we care about: literal `\n` does NOT survive ADF rendering
 * unless we emit `hardBreak` nodes, so this is the unit-test guard against
 * regressions where multi-line rule-engine comments come out as one giant
 * run-on line in Jira.
 */

import { describe, it, expect } from 'vitest';
import { buildPlainTextADF } from '../../../src/integrations/jira/client.js';

describe('buildPlainTextADF', () => {
  it('wraps a single-line body as one text node, no hardBreak', () => {
    const adf = buildPlainTextADF('hello');
    expect(adf.type).toBe('doc');
    expect(adf.version).toBe(1);
    expect(adf.content).toHaveLength(1);
    expect(adf.content[0].type).toBe('paragraph');
    expect(adf.content[0].content).toEqual([{ type: 'text', text: 'hello' }]);
  });

  it('inserts a hardBreak between two lines', () => {
    const adf = buildPlainTextADF('first\nsecond');
    expect(adf.content[0].content).toEqual([
      { type: 'text', text: 'first' },
      { type: 'hardBreak' },
      { type: 'text', text: 'second' },
    ]);
  });

  it('treats a blank line as an extra hardBreak (no empty text node)', () => {
    // "a\n\nb" → ['a', '', 'b'] → text("a"), break, break, text("b")
    const adf = buildPlainTextADF('a\n\nb');
    expect(adf.content[0].content).toEqual([
      { type: 'text', text: 'a' },
      { type: 'hardBreak' },
      { type: 'hardBreak' },
      { type: 'text', text: 'b' },
    ]);
  });

  it('handles \\r\\n line endings (Windows-style)', () => {
    const adf = buildPlainTextADF('first\r\nsecond');
    expect(adf.content[0].content).toEqual([
      { type: 'text', text: 'first' },
      { type: 'hardBreak' },
      { type: 'text', text: 'second' },
    ]);
  });

  it('does not emit a trailing hardBreak', () => {
    // Last line never gets a trailing break — otherwise renderers add
    // a dangling line at the end of the comment.
    const adf = buildPlainTextADF('only');
    expect(adf.content[0].content).toEqual([{ type: 'text', text: 'only' }]);

    const multi = buildPlainTextADF('a\nb');
    const last = multi.content[0].content[multi.content[0].content.length - 1];
    expect(last).toEqual({ type: 'text', text: 'b' });
  });
});
