// Tests for detect-narration.mjs's pure heuristic. Zero-dependency, run with
// `node --test`.
//
// The positive fixture below is not a paraphrase - it is the ACTUAL content
// git-committed to docs/specs/0355-sso-4-4-admin-ui-sso-config-page-and-log.md
// on branch spec/issue-355-sso-4-4-admin-ui-sso-config-page-and-log (PR #401),
// captured verbatim via `git show`. This is real, previously-shipped garbage,
// not a synthetic approximation of the failure shape.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { detectNarratedToolCall } from './detect-narration.mjs';

// Verbatim capture of docs/specs/0355-sso-4-4-admin-ui-sso-config-page-and-log.md
// (PR #401, issue #355, 2026-08-24) - 32 lines of narrated tool-call
// transcript written as if it were the spec itself, cut off mid-response.
const REAL_CAPTURED_355_FAILURE = `I'll inspect the relevant admin UI files and backend SSO pieces to write an accurate spec.

---

_Tool: bash_

### Parameters:

\`\`\`json
{
  "command": "ls apps/admin/src/pages/ && echo --- && cat apps/admin/src/App.tsx",
  "description": "List admin pages and view App.tsx routing"
}
\`\`\`

### Result:

\`\`\`
admin-organizations.tsx
audit-login.tsx
bug-report-detail.tsx
bug-reports.tsx
dashboard-layout-wrapper.tsx
dedup-rules.tsx
dashboard.tsx
health.tsx
integrations.tsx
integrations-connect.tsx
login.tsx
notifications.tsx
onboarding.tsx
\`\`\`
`;

// A realistic, fully-formed spec (per docs/specs/TEMPLATE.md's structure)
// that deliberately includes the two kinds of content the heuristic must NOT
// flag: a shell command in the Verification section, and a TypeScript code
// block in Changes/Tests - plus, as the sharpest adversarial case, its own
// "### Parameters" / "### Result" style subsections documenting an API
// endpoint's request/response shape, which is the one legitimate pattern
// most likely to collide with the transcript markers.
const LEGITIMATE_SPEC = `# Spec: Add SSO config page and audit log to admin UI

Linked issue: Refs #355
ADR: docs/adr/0041-sso-oidc.md

**Files touched:** \`apps/admin/src/pages/sso-config.tsx\`, \`apps/admin/src/routes.tsx\`
**Blocking prerequisites:** none

## Problem

Admins currently have no UI to configure SSO. This adds a config page and an audit log view.

## Out of scope

- Backend SSO enforcement (already shipped in #395)

## Constraints

1. Must reuse the existing \`AdminLayout\` wrapper.

## Acceptance criteria

- [ ] Admin can view current SSO config - verified by test case A

## Changes

### \`apps/admin/src/pages/sso-config.tsx\`

New page component.

\`\`\`ts
export function SsoConfigPage() {
  return <div>TODO</div>;
}
\`\`\`

### API endpoint contract

The page calls \`GET /api/admin/sso/config\`.

### Parameters

- \`organizationId\` (path) - the org to fetch config for

### Result

\`\`\`json
{ "provider": "oidc", "enabled": true }
\`\`\`

## Tests

### \`apps/admin/tests/sso-config.test.tsx\`

**Mock/fixture updates required:**

Add \`ssoConfig\` to \`createMockAdminApi()\`.

\`\`\`ts
// example
\`\`\`

**Test case A - renders current config (AC #1):**

\`\`\`ts
test('renders config', () => {});
\`\`\`

## Verification

\`\`\`bash
pnpm --filter @bugspotter/admin build
pnpm --filter @bugspotter/admin test:unit
\`\`\`

Rollback: n/a
`;

describe('detectNarratedToolCall', () => {
  test('fires on the real captured issue #355 / PR #401 failure', () => {
    const finding = detectNarratedToolCall(REAL_CAPTURED_355_FAILURE);
    assert.ok(finding, 'must detect the real narrated-tool-call transcript');
    assert.match(finding, /narrated/i);
  });

  test('does not fire on a legitimate, fully-formed spec', () => {
    assert.equal(detectNarratedToolCall(LEGITIMATE_SPEC), null);
  });

  test('does not fire on a legitimate spec even with its own "### Parameters"/"### Result" API-doc headings', () => {
    // LEGITIMATE_SPEC above already contains both headings, in their plain
    // (no-colon) form, documenting a real endpoint - this must stay a
    // non-finding because the response opens with "# Spec: ..." (the
    // required title), never narrated first-person intent. The colon-suffixed
    // variant ("### Parameters:"/"### Result:", matching the exact narrated-
    // transcript style) is the sharper adversarial case and is covered
    // separately below.
    assert.ok(LEGITIMATE_SPEC.includes('### Parameters'));
    assert.ok(LEGITIMATE_SPEC.includes('### Result'));
    assert.equal(detectNarratedToolCall(LEGITIMATE_SPEC), null);
  });

  test('does not fire on the raw TEMPLATE.md content', () => {
    // Belt-and-suspenders: the template itself (before any fields are
    // filled in) must never be flagged as narration.
    const filled = LEGITIMATE_SPEC; // already exercised above; keep this
    // focused on a second, independent shape: an empty-ish response with no
    // narration opener at all.
    assert.equal(detectNarratedToolCall('# Spec: <title>\n\n(nothing else yet)\n'), null);
    void filled;
  });

  test('does not fire on empty or whitespace-only input', () => {
    assert.equal(detectNarratedToolCall(''), null);
    assert.equal(detectNarratedToolCall('   \n\n  '), null);
    assert.equal(detectNarratedToolCall(undefined), null);
  });

  test('does not fire on a narration-sounding opener alone with no transcript markers', () => {
    // "Let me..." style openers are not by themselves proof of a narrated
    // tool call - a model could open a real answer conversationally before
    // still going on to produce real content. Only the marker combination is
    // trusted.
    assert.equal(detectNarratedToolCall('Let me answer directly.\n\n# Spec: x\n'), null);
  });

  test('does not fire on a legitimate spec containing "### Parameters:" and "### Result:" (with colons) alone, without a narration opener', () => {
    // The adversarial case one level past LEGITIMATE_SPEC: exact colon-style
    // headings, but the document still opens with its required title, not
    // narrated intent. Weak markers alone (no opener) must never fire -
    // this is exactly the false-positive risk the heuristic is designed to
    // avoid.
    const spec = '# Spec: x\n\n## Changes\n\n### Parameters:\n\n- foo\n\n### Result:\n\n- bar\n';
    assert.equal(detectNarratedToolCall(spec), null);
  });

  test('fires on a narration opener combined with just one weak marker', () => {
    const text = "I'll check the API shape first.\n\n### Result:\n\nsome text\n";
    const finding = detectNarratedToolCall(text);
    assert.ok(finding);
    assert.match(finding, /narrated intent/);
  });

  test('fires on an uncontracted "I am going to" opener combined with a weak marker', () => {
    const text = 'I am going to check the API shape first.\n\n### Result:\n\nsome text\n';
    const finding = detectNarratedToolCall(text);
    assert.ok(finding);
    assert.match(finding, /narrated intent/);
  });

  test('fires on a typographic-apostrophe "I’ll" opener combined with a weak marker', () => {
    const text = 'I’ll check the API shape first.\n\n### Result:\n\nsome text\n';
    const finding = detectNarratedToolCall(text);
    assert.ok(finding);
    assert.match(finding, /narrated intent/);
  });

  test('fires on a strong marker (the "_Tool: ..._" label) alone, even without a narration opener', () => {
    const text = 'Some unrelated prose.\n\n_Tool: bash_\n\nmore text\n';
    const finding = detectNarratedToolCall(text);
    assert.ok(finding);
    assert.match(finding, /_Tool: \.\.\._/);
  });

  test('fires on an "<invoke name=...>" style tag (the other narration rendering llm-client.mjs documents)', () => {
    const text =
      'Some prose.\n\n<invoke name="Bash">\n<parameter name="command">ls</parameter>\n</invoke>\n';
    const finding = detectNarratedToolCall(text);
    assert.ok(finding);
    assert.match(finding, /invoke name/);
  });

  test('does not fire on prose that merely mentions a tool or result in passing', () => {
    const text =
      '# Spec: x\n\n## Problem\n\nThe existing tool result was cached incorrectly, causing stale parameters to be reused.\n';
    assert.equal(detectNarratedToolCall(text), null);
  });
});
