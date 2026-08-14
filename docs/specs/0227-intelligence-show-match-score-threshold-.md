# Spec: intelligence: show match score + threshold in duplicate bug detail view

<!-- This is the AI-generated spec document. .github/ISSUE_TEMPLATE/spec.yml is
     the human issue-filing form — different structure, different purpose. -->

Linked issue: Refs #227
ADR: n/a

**Files touched:**

- `apps/admin/src/hooks/use-similar-bugs.ts` (new)
- `apps/admin/src/components/bug-reports/similar-bugs-widget.tsx`
- Locale files under `apps/admin/src/i18n/` (all supported locales; exact filenames to be read from the directory before editing)
- `apps/admin/src/tests/similar-bugs-widget.test.tsx` (new)

**Blocking prerequisites:** none

## Problem

When the intelligence service auto-closes a bug as a duplicate, org admins see only "marked as duplicate of #N" in the bug-detail view. The similarity score and threshold that drove the decision are not surfaced, so admins who want to tune their dedup threshold have no data to act on: they cannot tell whether a given closure was borderline or decisive, or whether the threshold needs to move up or down.

## Out of scope

- Persisting the historical match score at the moment of auto-close (requires a new DB column and a write-path change in `packages/backend/src/services/intelligence/dedup-service.ts`; tracked separately if ever wanted).
- Changes to the `/similar` backend endpoint — it already returns `similar_bugs` and `threshold_used`.
- Changes to the dedup-rules management UI.
- Surfacing match details for manually marked duplicates (no score exists for those).

## Constraints

1. The displayed score is recomputed live at view time. If the org's threshold or the embedding corpus changed since auto-close, the displayed value may differ from what originally triggered it. UI copy must use "current match" or equivalent, never language implying an audit trail.
2. The "Duplicate match details" section must render only when `report.duplicate_of` is non-null; callers where the prop is absent or null must see no change in layout.
3. The section must be collapsible and open by default.
4. Top-3 results come from the `/similar` response sorted by descending `similarity`; slicing is done client-side — no additional endpoint parameter required.
5. Loading and error states must be handled without crashing the page.
6. All user-visible strings must use the existing `t()` i18n hook with keys namespaced under `intelligence.duplicateDetails.*`, following the convention of existing i18n keys in the admin app.
7. The `SimilarBug` and response types should be checked against `packages/types/src/api-types.ts` and `packages/types/src/api-contract.ts` before defining local types; import shared types if they already exist there.

## Acceptance criteria

- [ ] When `report.duplicate_of` is set, the widget renders a collapsible "Duplicate match details" section — verified by test case A.
- [ ] The section displays the current similarity score and threshold in the form "Current match: 0.92 (threshold: 0.85)" — verified by test case B.
- [ ] The section lists up to the top-3 similar bugs by score, showing title and score for each — verified by test case B.
- [ ] When `report.duplicate_of` is null or absent, the section is not rendered — verified by test case C.
- [ ] While the `/similar` request is in-flight, a loading indicator text is shown within the section — verified by test case D.
- [ ] If the request fails, an inline error message is shown and no score data is rendered — verified by test case E.

## Changes

### `apps/admin/src/hooks/use-similar-bugs.ts` (new file)

New hook encapsulating the fetch from `/api/v1/intelligence/projects/:projectId/bugs/:id/similar`. The `enabled` flag lets the widget skip the request when `duplicateOf` is null without conditional hook calls. Replace `fetch` with whatever API client wrapper is used by existing hooks in `apps/admin/src/hooks/` — **ASSUMED to be plain fetch or a thin wrapper; verify the pattern in `use-intelligence-status.ts` before writing**.

```ts
// New file
import { useState, useEffect } from 'react';

export interface SimilarBug {
  bug_id: string;
  title: string;
  similarity: number;
}

export interface SimilarBugsResponse {
  similar_bugs: SimilarBug[];
  threshold_used: number;
}

export interface UseSimilarBugsState {
  data: SimilarBugsResponse | null;
  loading: boolean;
  error: string | null;
}

export function useSimilarBugs(
  projectId: string | null,
  bugId: string | null,
  enabled: boolean
): UseSimilarBugsState {
  const [state, setState] = useState<UseSimilarBugsState>({
    data: null,
    loading: false,
    error: null,
  });

  useEffect(() => {
    if (!enabled || !projectId || !bugId) return;
    setState({ data: null, loading: true, error: null });
    let cancelled = false;
    fetch(`/api/v1/intelligence/projects/${projectId}/bugs/${bugId}/similar`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<SimilarBugsResponse>;
      })
      .then((data) => {
        if (!cancelled) setState({ data, loading: false, error: null });
      })
      .catch((err: Error) => {
        if (!cancelled) setState({ data: null, loading: false, error: err.message });
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, bugId, enabled]);

  return state;
}
```

### `apps/admin/src/components/bug-reports/similar-bugs-widget.tsx`

The exact existing props interface is not visible in the source tree; the changes below assume the component already receives `projectId: string` and `bugId: string`. A `duplicateOf: string | null` prop must be added — **ASSUMED not currently present; verify before editing**. Add the import and the conditional section.

```ts
// Append after existing imports at top of file:
import { useSimilarBugs } from '../../hooks/use-similar-bugs';
```

```ts
// Add duplicateOf to the component props interface (name may differ — match existing interface):
duplicateOf?: string | null;
```

```ts
// Append inside the component body, after existing hook calls and before the return statement:
const {
  data: similarData,
  loading: similarLoading,
  error: similarError,
} = useSimilarBugs(projectId, bugId, duplicateOf != null);
```

```tsx
// Append after the existing JSX content inside the component's return, before the closing root element:
{
  duplicateOf != null && (
    <details open className="duplicate-match-details">
      <summary>{t('intelligence.duplicateDetails.title')}</summary>
      {similarLoading && <p>{t('intelligence.duplicateDetails.loading')}</p>}
      {similarError != null && <p className="error">{t('intelligence.duplicateDetails.error')}</p>}
      {similarData != null && (
        <>
          <p>
            {t('intelligence.duplicateDetails.score', {
              score: (similarData.similar_bugs[0]?.similarity ?? 0).toFixed(2),
              threshold: similarData.threshold_used.toFixed(2),
            })}
          </p>
          <ul>
            {similarData.similar_bugs.slice(0, 3).map((bug) => (
              <li key={bug.bug_id}>
                {bug.title} — {bug.similarity.toFixed(2)}
              </li>
            ))}
          </ul>
        </>
      )}
    </details>
  );
}
```

### Locale files under `apps/admin/src/i18n/`

Read the directory to identify all locale files before editing. Append to the `intelligence` object in each locale. English values shown; translate for other locales.

```json
// Append inside the "intelligence" key of each locale file:
"duplicateDetails": {
  "title": "Duplicate match details",
  "loading": "Loading match details…",
  "error": "Could not load match details.",
  "score": "Current match: {{score}} (threshold: {{threshold}})"
}
```

## Tests

### `apps/admin/src/tests/similar-bugs-widget.test.tsx` (new file)

**Mock/fixture updates required:**

The `useSimilarBugs` hook must be mocked at module level so test cases can control its return value without real fetch calls. Check `apps/admin/src/tests/` for an existing test-setup file or render wrapper (e.g. i18n provider) that must be used here — if a wrapper exists, wrap `render()` calls accordingly.

```ts
// At top of file — vi.mock must be top-level:
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import * as useSimilarBugsModule from '../../hooks/use-similar-bugs';
import { SimilarBugsWidget } from '../../components/bug-reports/similar-bugs-widget';

vi.mock('../../hooks/use-similar-bugs');

const mockUseSimilarBugs = vi.mocked(useSimilarBugsModule.useSimilarBugs);
```

Shared fixture:

```ts
const mockSimilarData = {
  similar_bugs: [
    { bug_id: 'bug-1', title: 'Login page crash', similarity: 0.92 },
    { bug_id: 'bug-2', title: 'Auth timeout', similarity: 0.81 },
    { bug_id: 'bug-3', title: 'Session expiry', similarity: 0.74 },
  ],
  threshold_used: 0.85,
};

const idle = { data: null, loading: false, error: null };
```

**Test case A — section renders when duplicateOf is set (AC #1):**

```ts
it('renders duplicate match details section when duplicateOf is set', () => {
  mockUseSimilarBugs.mockReturnValue({ data: mockSimilarData, loading: false, error: null });
  render(<SimilarBugsWidget projectId="proj-1" bugId="bug-x" duplicateOf="bug-1" />);
  expect(screen.getByText(/duplicate match details/i)).toBeInTheDocument();
});
```

**Test case B — score, threshold, and top-3 bugs displayed (AC #2, #3):**

```ts
it('shows current score, threshold, and top-3 similar bugs', () => {
  mockUseSimilarBugs.mockReturnValue({ data: mockSimilarData, loading: false, error: null });
  render(<SimilarBugsWidget projectId="proj-1" bugId="bug-x" duplicateOf="bug-1" />);
  expect(screen.getByText(/current match: 0\.92 \(threshold: 0\.85\)/i)).toBeInTheDocument();
  expect(screen.getByText(/login page crash/i)).toBeInTheDocument();
  expect(screen.getByText(/auth timeout/i)).toBeInTheDocument();
  expect(screen.getByText(/session expiry/i)).toBeInTheDocument();
});
```

**Test case C — section absent when duplicateOf is null (AC #4):**

```ts
it('does not render the section when duplicateOf is null', () => {
  mockUseSimilarBugs.mockReturnValue(idle);
  render(<SimilarBugsWidget projectId="proj-1" bugId="bug-x" duplicateOf={null} />);
  expect(screen.queryByText(/duplicate match details/i)).not.toBeInTheDocument();
});
```

**Test case D — loading indicator shown while fetching (AC #5):**

```ts
it('shows loading text while the similar-bugs request is in flight', () => {
  mockUseSimilarBugs.mockReturnValue({ data: null, loading: true, error: null });
  render(<SimilarBugsWidget projectId="proj-1" bugId="bug-x" duplicateOf="bug-1" />);
  expect(screen.getByText(/loading match details/i)).toBeInTheDocument();
});
```

**Test case E — inline error shown on fetch failure (AC #6):**

```ts
it('shows inline error message and no score data when fetch fails', () => {
  mockUseSimilarBugs.mockReturnValue({ data: null, loading: false, error: 'HTTP 500' });
  render(<SimilarBugsWidget projectId="proj-1" bugId="bug-x" duplicateOf="bug-1" />);
  expect(screen.getByText(/could not load match details/i)).toBeInTheDocument();
  expect(screen.queryByText(/current match/i)).not.toBeInTheDocument();
});
```

## Verification

```bash
pnpm --filter @bugspotter/admin typecheck
pnpm --filter @bugspotter/admin test:unit
```

Rollback: Remove the `{duplicateOf != null && …}` block from `SimilarBugsWidget`, remove the `useSimilarBugs` import, delete `apps/admin/src/hooks/use-similar-bugs.ts`, and revert the i18n key additions. No database schema or backend route was changed.
