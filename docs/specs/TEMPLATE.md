# Spec: <title>

<!-- This is the AI-generated spec document. .github/ISSUE_TEMPLATE/spec.yml is
     the human issue-filing form — different structure, different purpose. -->

Linked issue: Refs #NNN
ADR: pending / docs/adr/NNNN-slug.md / n/a

**Files touched:** <!-- list every file this change edits or creates, e.g. `packages/backend/src/api/routes/foo.ts` -->
**Blocking prerequisites:** <!-- #NNN — one-line reason, or "none" -->

## Problem

<!-- One paragraph. What breaks, who is affected, why it matters. -->

## Out of scope

- <!-- explicit exclusion to prevent scope creep during review -->

## Constraints

<!-- Hard requirements the implementation must satisfy: type-safety gotchas, backward-compat
     rules, test-infrastructure gaps, schema interactions, etc. Number them so ACs can reference them. -->

1. <!-- constraint -->

## Acceptance criteria

<!-- Specific, testable, written from the caller's perspective.
     Each bullet should map to a named test case in the Tests section. -->

- [ ] <!-- condition — verified by test case X -->

## Changes

<!-- One subsection per file. Show only new/changed lines in ```ts blocks.
     Always indicate the insertion point ("Append after X", "Replace Y with Z").
     Never show the full existing file as if it were new code to write. -->

### `packages/…/file.ts`

<!-- What changes and why (one sentence). -->

```ts
// Append after <existing line or function name>:
```

## Tests

<!-- One subsection per test file. Separate mock/fixture updates from new test cases. -->

### `packages/…/tests/file.test.ts`

**Mock/fixture updates required:**

<!-- List any changes to test helpers or mocks needed before new test cases can pass.
     If a helper is missing a key (e.g. db.organizations), call it out explicitly here
     rather than discovering it at CI runtime. -->

```ts
// example: add to createMockX():
```

**Test case A — description (AC #N):**

<!-- Show the concrete vitest/jest setup and assertion, not pseudocode.
     For ES-module mocks: vi.mock() must be at top level; use vi.mocked() to configure return values. -->

```ts

```

## Verification

<!-- Only runnable shell commands here — no pseudocode, no file edits. -->

```bash
pnpm --filter <package> build
pnpm --filter <package> test:unit
```

Rollback: <!-- describe rollback for any irreversible action, or "n/a" if all steps are additive -->
