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
import {
  buildPlainTextADF,
  JIRA_COMMENT_MAX_CHARS,
  JIRA_COMMENT_TRUNCATION_SUFFIX,
} from '../../../src/integrations/jira/client.js';

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

  describe('trimming', () => {
    it('strips trailing newlines before constructing nodes', () => {
      // Trailing newlines used to leak through as `hardBreak` nodes,
      // producing a visible blank line at the end of the Jira comment.
      const adf = buildPlainTextADF('hello\n\n');
      expect(adf.content[0].content).toEqual([{ type: 'text', text: 'hello' }]);
    });

    it('strips leading whitespace too', () => {
      const adf = buildPlainTextADF('\n\nhello');
      expect(adf.content[0].content).toEqual([{ type: 'text', text: 'hello' }]);
    });

    it('preserves internal blank lines as expected', () => {
      // Internal whitespace is intentional — only leading/trailing is
      // stripped. `a\n\nb` still becomes text/break/break/text.
      const adf = buildPlainTextADF('  \na\n\nb\n  ');
      expect(adf.content[0].content).toEqual([
        { type: 'text', text: 'a' },
        { type: 'hardBreak' },
        { type: 'hardBreak' },
        { type: 'text', text: 'b' },
      ]);
    });
  });

  describe('length cap', () => {
    it('passes through bodies under the cap unchanged', () => {
      const body = 'a'.repeat(JIRA_COMMENT_MAX_CHARS - 10);
      const adf = buildPlainTextADF(body);
      // Single text node, no truncation marker
      expect(adf.content[0].content).toHaveLength(1);
      expect(adf.content[0].content[0]).toEqual({ type: 'text', text: body });
    });

    it('truncates bodies over the cap and appends a marker', () => {
      const body = 'x'.repeat(JIRA_COMMENT_MAX_CHARS + 1_000);
      const adf = buildPlainTextADF(body);

      // Flatten back to the rendered text — the truncation marker
      // contains a newline, so we expect text/hardBreak/text.
      const nodes = adf.content[0].content;
      const lastText = nodes.filter((n) => n.type === 'text').pop();
      expect(lastText?.text).toBe(JIRA_COMMENT_TRUNCATION_SUFFIX.trimStart());

      // Combined "raw" content length stays at the cap (suffix replaces
      // the equivalent number of trailing chars of input).
      const reconstructed = nodes.map((n) => (n.type === 'text' ? n.text : '\n')).join('');
      expect(reconstructed.length).toBeLessThanOrEqual(JIRA_COMMENT_MAX_CHARS);
    });
  });
});
