// Deterministic detector for a specific, already-observed LLM_BACKEND=cli
// failure shape: the model narrates a FAKE tool call as plain text instead of
// just answering directly, because `--tools=` (llm-client.mjs) gives it no
// real tool access but it still reflexively wants to "look around" first.
// The narrated text then reads like normal prose to every check downstream -
// it is not malformed JSON, it does not trip a stop_reason=max_tokens check -
// so nothing before this module has ever caught it.
//
// Real evidence, not a hypothetical: issue #353 (2026-08-18) first documented
// this via raw CLI transcripts (see llm-client.mjs's "since --tools=" and
// formatCliProgress's comments). Issue #355 (2026-08-24) hit the identical
// shape fresh - docs/specs/0355-sso-4-4-admin-ui-sso-config-page-and-log.md
// (PR #401) was written verbatim from a response that opened with "I'll
// inspect the relevant admin UI files..." and then rendered a fake bash
// invocation as markdown, cut off mid-transcript. No detection fired; the
// pipeline treated 32 lines of narration as a valid, ratifiable spec.
//
// Detection is intentionally narrow, split into two confidence tiers so a
// legitimate spec that happens to document, say, an API endpoint's request/
// response shape under its own "### Parameters"/"### Result" headings can
// never trip this alone (confirmed against exactly that case while writing
// this - see detect-narration.test.mjs).
//
// STRONG markers are artifacts of the CLI's own narrated-tool-call
// rendering that no legitimate spec/ADR has any natural reason to ever
// contain, in any context - an italic "_Tool: <name>_" label, or a literal
// "<invoke name=...>" tag (the other narration shape llm-client.mjs's own
// comments document, e.g. formatCliProgress's). Either one is trusted alone.
//
// WEAK markers ("### Parameters:"/"### Result:" headings) are common enough
// in ordinary API-documentation prose that they are never trusted alone -
// only as corroboration once the opening line has already shown the
// response is narrating intent instead of starting with the required
// document title.
const STRONG_MARKERS = [
  { name: 'a "_Tool: ..._" label', re: /^_Tool:\s*\S.*_\s*$/m },
  { name: 'an "<invoke name=...>" tag', re: /<invoke\s+name=/i },
];
const WEAK_MARKERS = [
  { name: 'a "### Parameters:" heading', re: /^###\s*Parameters:\s*$/m },
  { name: 'a "### Result:" heading', re: /^###\s*Result:\s*$/m },
];

/**
 * A response that opens by announcing first-person intent instead of with
 * content. Every real spec/ADR response is required (by its own prompt) to
 * start with a "# Spec: ..." or "# ADR-NNNN: ..." title line - this pattern
 * essentially never legitimately appears as the very first line.
 */
const NARRATION_OPENER = /^(?:i(?:['’]ll| will|['’]m going to| am going to| need to)|let me)\b/i;

/**
 * Returns a human-readable finding string if `text` looks like a narrated
 * tool-call transcript rather than real document content, or null if it
 * looks like normal content (including normal content that happens to
 * contain a code block or shell command example, or its own "### Parameters"/
 * "### Result" style headings documenting an API).
 */
export function detectNarratedToolCall(text) {
  const trimmed = (text ?? '').trim();
  if (!trimmed) {
    return null;
  }

  const firstLine = trimmed.split('\n', 1)[0].trim();
  const opensWithNarration = NARRATION_OPENER.test(firstLine);
  const strongHits = STRONG_MARKERS.filter((m) => m.re.test(trimmed));
  const weakHits = WEAK_MARKERS.filter((m) => m.re.test(trimmed));

  // A strong marker alone is enough - it is not vocabulary any legitimate
  // spec/ADR would ever produce, opener or not.
  if (strongHits.length > 0) {
    const openerNote = opensWithNarration
      ? ` and opens with narrated intent ("${firstLine.slice(0, 80)}") instead of the required ` +
        `document title`
      : '';
    return (
      `response contains ${strongHits.map((m) => m.name).join(' and ')}${openerNote} - this is ` +
      `the shape of a narrated (fake) tool-call transcript, not real content. LLM_BACKEND=cli ` +
      `disables real tool access (--tools=); the model narrated one instead of answering ` +
      `directly (see issue #353, #355).`
    );
  }

  // Weak markers only count as corroboration once the opening line has
  // already shown the response is narrating intent rather than starting
  // with the required title - never on their own.
  if (opensWithNarration && weakHits.length > 0) {
    return (
      `response opens with narrated intent ("${firstLine.slice(0, 80)}") instead of the ` +
      `required document title, and contains ${weakHits.map((m) => m.name).join(' and ')} - ` +
      `this is the shape of a narrated (fake) tool-call transcript, not real content. ` +
      `LLM_BACKEND=cli disables real tool access (--tools=); the model narrated one instead ` +
      `of answering directly (see issue #353, #355).`
    );
  }

  return null;
}
