# ADR-0043: Intelligence — surface current match score and threshold in duplicate bug detail view

- Status: Accepted
- Area: admin UI / intelligence
- Date: 2026-08-14
- Refs: #227; ADR-0028 (tunable similarity thresholds); #226, #237 (threshold end-to-end plumbing, closed)

## Context

When the intelligence service auto-closes a bug as a duplicate it writes only
`duplicate_of` and `status` to the bug record
(`IntelligenceDedupService.autoCloseAsDuplicate` in
`packages/backend/src/services/intelligence/dedup-service.ts`). No match score
or threshold value is ever persisted at that moment.

Org admins looking at a closed duplicate in the admin UI have no signal
explaining _why_ the bug was closed: they cannot see the similarity score that
crossed the threshold, nor which threshold was in effect. Threshold tuning
(ADR-0028) is therefore opaque — admins have to guess whether raising or
lowering the threshold would have changed the outcome.

The `GET /api/v1/intelligence/projects/:projectId/bugs/:id/similar` endpoint
already returns a `similar_bugs` array (each entry carrying a `similarity`
score) and a `threshold_used` field in a single response
(`packages/backend/src/api/routes/intelligence.ts`). The `SimilarBugsWidget`
component (`apps/admin/src/components/bug-reports/similar-bugs-widget.tsx`)
already exists in the admin app (`bugspotter-public` repo, `apps/admin/`). No
new backend endpoint and no new intelligence-service route is required.

The key constraint: the score that would be shown is **always freshly
recomputed at view time**, because no historical score was stored when the
auto-close fired. If the embedding corpus or the per-org threshold changed
after the auto-close, the value shown today may differ from the value that
actually triggered the closure. Any UI copy that implies an audit record of the
original decision would be misleading.

## Options considered

1. **Recompute-at-view-time via the existing `/similar` endpoint** — Extend
   `SimilarBugsWidget` to show a collapsible "Duplicate match details" section
   (score, threshold, top-3 similar bugs) when `report.duplicate_of` is set.
   Data comes from the same endpoint the widget already calls. UI copy frames
   the values as the _current_ similarity, not a historical record.
   Rollback is a one-line conditional hide; no schema change.
   **Tradeoff:** the displayed score is not guaranteed to match what triggered
   the original auto-close; admins must understand this limitation.

2. **Persist the historical score at dedup time** — Add a `duplicate_score`
   column to the bugs table, write it inside `autoCloseAsDuplicate`, and
   display the stored value. Gives a genuine audit trail.
   **Tradeoff:** new migration, write-path change in the dedup service, and
   a backfill story for existing closed bugs — substantially larger scope with
   no unblocking need from issue #227.

3. **Hybrid: persist for audit, recompute for the top-3 panel** — Show the
   stored historical score in the "why was this closed" line and a live
   recomputed top-3 panel beside it.
   **Tradeoff:** combines the complexity of option 2 with a two-source UI that
   could show contradictory scores if corpus/threshold drift is large. Higher
   maintenance surface.

## Decision

Implement **option 1**: extend `SimilarBugsWidget` in `apps/admin/` to show
a collapsible "Duplicate match details" section — current similarity score,
current threshold, top-3 similar bugs with per-entry scores — visible only
when `report.duplicate_of` is set. All data comes from the existing
`/similar` endpoint; no new endpoint, migration, or write-path change is
introduced.

UI copy must use language such as "current match score" or "similarity today"
and must not suggest the values are a timestamped record of the original
auto-close decision. A tooltip or note explaining the recompute behavior is
acceptable and encouraged.

Persisting the historical score (option 2) is explicitly deferred and should
be tracked as a separate issue if the audit-trail need becomes concrete.

## Consequences

**Positive:**

- Admins immediately gain enough signal to understand why a bug is closed and
  to reason about threshold changes (ADR-0028 per-org tuning).
- No schema migration, no new backend route, no change to the intelligence
  service (`bugspotter-intelligence` repo is unaffected).
- Rollback is trivially hiding one conditional UI block.
- The prerequisite threshold plumbing (`threshold_used` in the `/similar`
  response) is already shipped (#226, #237); no blocking dependency remains.

**Negative / accepted:**

- The score shown is a present-day recomputation, not a historical record.
  Corpus drift or threshold edits between the auto-close event and the admin's
  viewing moment can make the displayed score differ from the value that
  actually triggered closure. This is a known, accepted limitation — the UI
  must be explicit about it.
- Org admins who need a hard audit trail (e.g. for compliance) cannot get one
  from this feature; that requires option 2.

**Neutral:**

- No additional network call: the "Duplicate match details" section is
  derived from the same `/similar` response the widget already fetches on
  mount, so opening a duplicate's detail view adds no new request.
- Top-3 ranking in the display is by descending `similarity` score from the
  recomputed response; if the corpus changes between page loads the ordering
  can shift, which is consistent with the "current match" framing.
