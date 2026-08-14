# Spec: intelligence: show match score + threshold in duplicate bug detail view

<!-- This is the AI-generated spec document. .github/ISSUE_TEMPLATE/spec.yml is
     the human issue-filing form — different structure, different purpose. -->

Linked issue: Refs #227
ADR: n/a

**Files touched:**

- `apps/admin/src/components/bug-reports/similar-bugs-widget.tsx` — add a `duplicateOf` prop and the "Duplicate match details" section; reuses the `useQuery` fetch the widget already has, no new hook or request needed.
- `apps/admin/src/components/bug-reports/bug-report-detail.tsx` — pass `duplicateOf={report.duplicate_of}` at the existing `<SimilarBugsWidget bugReportId={report.id} projectId={report.project_id} />` call site (~line 227).
- `apps/admin/src/i18n/locales/{en,ru,kk}.json` — add `intelligence.duplicateDetails.{title,score}` keys.
- `apps/admin/src/tests/components/bug-reports/similar-bugs-widget.test.tsx` (new) — matches the existing `tests/components/bug-reports/` layout (see `ai-enrichment-card.test.tsx`), not a flat `src/tests/` path.

**Blocking prerequisites:** none

## Problem

When the intelligence service auto-closes a bug as a duplicate, org admins see only "marked as duplicate of #N" in the bug-detail view. The similarity score and threshold that drove the decision are not surfaced, so admins who want to tune their dedup threshold have no data to act on: they cannot tell whether a given closure was borderline or decisive, or whether the threshold needs to move up or down.

## Out of scope

- Persisting the historical match score at the moment of auto-close (requires a new DB column and a write-path change in `packages/backend/src/services/intelligence/dedup-service.ts`; tracked separately if ever wanted).
- Changes to the `/similar` backend endpoint — it already returns `similar_bugs` and `threshold_used`.
- Changes to the dedup-rules management UI.
- Surfacing match details for manually marked duplicates (no score exists for those).
- Modifying `DuplicateBadge` (the static "marked as duplicate of #N" banner rendered above the tabs) — it does no data fetching of its own, and adding score/threshold there would mean a second `/similar` request. `SimilarBugsWidget` already makes that request (for its general similar-bugs list), so the new section is added there instead.

## Constraints

1. The displayed score is recomputed live at view time. If the org's threshold or the embedding corpus changed since auto-close, the displayed value may differ from what originally triggered it. UI copy must use "current match" or equivalent, never language implying an audit trail.
2. The "Duplicate match details" section must render only when `report.duplicate_of` is non-null; callers where the prop is absent or null must see no change in layout.
3. The section must be collapsible and open by default.
4. Top-3 results come from the `/similar` response sorted by descending `similarity`; slicing is done client-side — no additional endpoint parameter required. (The response is not guaranteed to already be sorted — sort defensively before slicing.)
5. Loading and error states must be handled without crashing the page.
6. All user-visible strings must use the existing `t()` i18n hook with keys namespaced under `intelligence.duplicateDetails.*`, following the convention of existing i18n keys in the admin app.
7. `SimilarBug` and `SimilarBugsResponse` already exist in `apps/admin/src/types/intelligence.ts` (the latter includes `threshold_used`) and are already used by `intelligenceService.getSimilarBugs`. Import them — do not redefine locally. `packages/types/src/` has no `SimilarBug` type; this response shape is admin-app-local, not a shared cross-package contract.

## Acceptance criteria

- [ ] When `report.duplicate_of` is set, the widget renders a collapsible "Duplicate match details" section — verified by test case A.
- [ ] The section displays the current similarity score and threshold in the form "Current match: 0.92 (threshold: 0.85)", preferring the similarity of the specific bug `duplicate_of` points at (falling back to the top overall match if that bug is no longer in the response) — verified by test case B.
- [ ] The section lists up to the top-3 similar bugs by score, sorted descending — verified by test case B.
- [ ] When `report.duplicate_of` is null or absent, the section is not rendered — verified by test case C.
- [ ] While the shared `/similar` query is in-flight, the widget's existing loading indicator is shown (no separate loading UI for this section) — verified by test case D.
- [ ] If the shared query fails, the widget's existing inline error message is shown and no score data is rendered — verified by test case E.

## Changes

### `apps/admin/src/components/bug-reports/similar-bugs-widget.tsx`

No new hook or request: the widget already fetches similar bugs via `useQuery` + `intelligenceService.getSimilarBugs(projectId, bugReportId)`, and the response (`SimilarBugsResponse`) already includes `threshold_used`. Add a `duplicateOf` prop and derive the new section from the same `data`; the existing top-level loading/error early returns already cover the new section too.

```ts
// Props: add duplicateOf
interface SimilarBugsWidgetProps {
  bugReportId: string;
  projectId: string;
  /** The bug this report was auto-closed as a duplicate of, if any. */
  duplicateOf?: string | null;
}

export function SimilarBugsWidget({ bugReportId, projectId, duplicateOf }: SimilarBugsWidgetProps) {
  // ...existing useQuery, loading/error early returns, and
  // `if (!data || data.similar_bugs.length === 0) return null;` all unchanged...
```

```ts
// After the existing `data` guard, before building the return value:
const matchedBug =
  duplicateOf != null ? data.similar_bugs.find((bug) => bug.bug_id === duplicateOf) : undefined;
const sortedBySimilarity = [...data.similar_bugs].sort((a, b) => b.similarity - a.similarity);
// Prefer the similarity of the bug actually marked as duplicate; fall back to
// the top match if it's no longer in the response (corpus/threshold changed
// since auto-close — see Constraint 1).
const currentMatchScore = matchedBug?.similarity ?? sortedBySimilarity[0]?.similarity ?? 0;
const top3 = sortedBySimilarity.slice(0, 3);
```

This is a JSX child expression (`{ ... }`), not a standalone statement, so it's shown as
plain text below — a code-block formatter parsing it in isolation would (wrongly) treat it
as a block statement and inject a stray `;` before the closing brace:

```text
// Append inside the existing root <div>, after the current similar-bugs list:
{duplicateOf != null && (
  <details open className="duplicate-match-details mt-3 pt-3 border-t border-purple-100">
    <summary className="text-sm font-medium text-purple-900 cursor-pointer">
      {t('intelligence.duplicateDetails.title')}
    </summary>
    <p className="text-sm text-purple-800 mt-2">
      {t('intelligence.duplicateDetails.score', {
        score: currentMatchScore.toFixed(2),
        threshold: data.threshold_used.toFixed(2),
      })}
    </p>
    <ul className="mt-1 space-y-1">
      {top3.map((bug) => (
        <li key={bug.bug_id} className="text-sm text-gray-700">
          {bug.title} — {bug.similarity.toFixed(2)}
        </li>
      ))}
    </ul>
  </details>
)}
```

### `apps/admin/src/components/bug-reports/bug-report-detail.tsx`

Pass the new prop at the existing call site:

```tsx
// Line ~227, replace:
<SimilarBugsWidget bugReportId={report.id} projectId={report.project_id} />
// with:
<SimilarBugsWidget
  bugReportId={report.id}
  projectId={report.project_id}
  duplicateOf={report.duplicate_of}
/>
```

`report.duplicate_of` is already typed `string | null | undefined` (`packages/types/src/api-contract.ts`) and already consumed a few lines above by `<DuplicateBadge duplicateOf={report.duplicate_of} .../>`, the existing "marked as duplicate of #N" banner — no new type needed.

### Locale files: `apps/admin/src/i18n/locales/{en,ru,kk}.json`

Append to the `intelligence` object in each locale. English values shown; translate `ru`/`kk`. Only `title` and `score` are needed — the loading/error states reuse the widget's existing `intelligence.similarBugs.loading` / `intelligence.similarBugs.error` keys.

```json
// Append inside the "intelligence" key of each locale file:
"duplicateDetails": {
  "title": "Duplicate match details",
  "score": "Current match: {{score}} (threshold: {{threshold}})"
}
```

## Tests

### `apps/admin/src/tests/components/bug-reports/similar-bugs-widget.test.tsx` (new file)

Follow the pattern already used by the sibling `ai-enrichment-card.test.tsx`: mock `react-i18next` off the real `en.json` (so string assertions catch key typos), mock `intelligenceService` at module level, and wrap `render()` in a `QueryClientProvider` with `retry: false`.

```ts
// At top of file:
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { SimilarBugsWidget } from '../../../components/bug-reports/similar-bugs-widget';
import { intelligenceService } from '../../../services/intelligence-service';

vi.mock('react-i18next', async () => {
  const en = (await import('../../../i18n/locales/en.json')).default;
  const get = (key: string): string | undefined =>
    key.split('.').reduce<unknown>(
      (obj, part) =>
        obj != null && typeof obj === 'object' ? (obj as Record<string, unknown>)[part] : undefined,
      en
    ) as string | undefined;
  return {
    useTranslation: () => ({
      t: (key: string, opts?: Record<string, unknown>) => {
        const raw = get(key) ?? key;
        return opts ? raw.replace(/\{\{(\w+)\}\}/g, (_, k) => String(opts[k] ?? '')) : raw;
      },
      i18n: { language: 'en-US' },
    }),
  };
});

vi.mock('../../../services/intelligence-service', () => ({
  intelligenceService: { getSimilarBugs: vi.fn() },
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
```

Shared fixture — shape matches `SimilarBugsResponse` in `apps/admin/src/types/intelligence.ts`:

```ts
const mockSimilarData = {
  bug_id: 'bug-x',
  is_duplicate: true,
  similar_bugs: [
    {
      bug_id: 'bug-1',
      title: 'Login page crash',
      description: null,
      status: 'closed',
      resolution: 'duplicate',
      similarity: 0.92,
    },
    {
      bug_id: 'bug-2',
      title: 'Auth timeout',
      description: null,
      status: 'open',
      resolution: null,
      similarity: 0.81,
    },
    {
      bug_id: 'bug-3',
      title: 'Session expiry',
      description: null,
      status: 'open',
      resolution: null,
      similarity: 0.74,
    },
  ],
  threshold_used: 0.85,
};

beforeEach(() => {
  vi.mocked(intelligenceService.getSimilarBugs).mockReset();
});
```

**Test case A — section renders when duplicateOf is set (AC #1):**

```tsx
it('renders duplicate match details section when duplicateOf is set', async () => {
  vi.mocked(intelligenceService.getSimilarBugs).mockResolvedValueOnce(mockSimilarData);
  render(<SimilarBugsWidget bugReportId="bug-x" projectId="proj-1" duplicateOf="bug-1" />, {
    wrapper,
  });
  expect(await screen.findByText(/duplicate match details/i)).toBeInTheDocument();
});
```

**Test case B — score, threshold, and top-3 bugs displayed (AC #2, #3):**

```tsx
it('shows current score, threshold, and top-3 similar bugs', async () => {
  vi.mocked(intelligenceService.getSimilarBugs).mockResolvedValueOnce(mockSimilarData);
  render(<SimilarBugsWidget bugReportId="bug-x" projectId="proj-1" duplicateOf="bug-1" />, {
    wrapper,
  });
  expect(await screen.findByText(/current match: 0\.92 \(threshold: 0\.85\)/i)).toBeInTheDocument();
  expect(screen.getByText(/login page crash/i)).toBeInTheDocument();
  expect(screen.getByText(/auth timeout/i)).toBeInTheDocument();
  expect(screen.getByText(/session expiry/i)).toBeInTheDocument();
});

it("prefers the matched bug's own similarity over the top result when they differ", async () => {
  vi.mocked(intelligenceService.getSimilarBugs).mockResolvedValueOnce(mockSimilarData);
  // duplicateOf points at the #2 result (0.81), not the top result (0.92)
  render(<SimilarBugsWidget bugReportId="bug-x" projectId="proj-1" duplicateOf="bug-2" />, {
    wrapper,
  });
  expect(await screen.findByText(/current match: 0\.81 \(threshold: 0\.85\)/i)).toBeInTheDocument();
});
```

**Test case C — section absent when duplicateOf is null (AC #4):**

```tsx
it('does not render the section when duplicateOf is null', async () => {
  vi.mocked(intelligenceService.getSimilarBugs).mockResolvedValueOnce(mockSimilarData);
  render(<SimilarBugsWidget bugReportId="bug-x" projectId="proj-1" duplicateOf={null} />, {
    wrapper,
  });
  await screen.findByText(/login page crash/i); // wait for the (still-rendered) general list
  expect(screen.queryByText(/duplicate match details/i)).not.toBeInTheDocument();
});
```

**Test case D — loading indicator shown while fetching (AC #5):**

```tsx
it("shows the widget's existing loading indicator while the shared query is in flight", () => {
  vi.mocked(intelligenceService.getSimilarBugs).mockReturnValue(new Promise(() => {})); // never resolves
  render(<SimilarBugsWidget bugReportId="bug-x" projectId="proj-1" duplicateOf="bug-1" />, {
    wrapper,
  });
  expect(screen.getByText(/finding similar bugs/i)).toBeInTheDocument();
});
```

**Test case E — inline error shown on fetch failure (AC #6):**

```tsx
it("shows the widget's existing error message and no score data when the request fails", async () => {
  vi.mocked(intelligenceService.getSimilarBugs).mockRejectedValueOnce(new Error('HTTP 500'));
  render(<SimilarBugsWidget bugReportId="bug-x" projectId="proj-1" duplicateOf="bug-1" />, {
    wrapper,
  });
  expect(await screen.findByText(/failed to find similar bugs/i)).toBeInTheDocument();
  expect(screen.queryByText(/current match/i)).not.toBeInTheDocument();
});
```

## Verification

```bash
pnpm --filter @bugspotter/admin typecheck
pnpm --filter @bugspotter/admin test
pnpm validate:i18n
```

Rollback: remove the `{duplicateOf != null && …}` block and the `duplicateOf` prop from `SimilarBugsWidget`, revert the `duplicateOf={report.duplicate_of}` call-site change in `bug-report-detail.tsx`, and revert the i18n key additions. No database schema or backend route was changed.
