# ADR-0041: AI Factory framework adaptation (mapping, not implementation)

- Status: Accepted (meta/mapping; loop-closure work is in `docs/ai-factory/roadmap.md`)
- Area: meta / ai-strategy
- Source: `docs/ai-factory/term-mapping.md`, `docs/ai-factory/roadmap.md`; external term provenance provided by the repository owner
- Date: 2026-06-12

## Context

The external "AI Factory" framework (and its associated language: `SEED→PLANT→GROW→HARVEST→EVOLVE`
phases, `Flywheel`, `Reusable artefacts`, `Spec-Driven Development`, `Dual obligation`) is used as a
vocabulary for describing AI-product maturity. The question arose: to what extent does BugSpotter's
technical layer already satisfy this framework, and where is the loop still open?

**Important source constraint.** There is no canonical specification of the framework in this repository.
Definitions were assembled from two sources, both recorded here transparently:

1. **Working definitions** ("what this means") are taken verbatim from an earlier mapping artefact
   (`bugspotter-ai-factory-map_1.html`). These are analyst glosses, not framework citations.
2. **Canonical term provenance** was provided by the repository owner and is recorded here as an
   external provenance anchor (see "Term origins" section below).

The authoritative canon for the current code state is `docs/adr/0001…0040` and
`.github/workflows/*.yml`; documents that contradict them are considered stale. Every mapping claim
in `term-mapping.md` is anchored to an ADR number or file path.

## Decision

Record AI Factory as a **descriptive language** overlaid on already-existing decisions, not as a new
implementation. This ADR is a meta-ADR (adaptation); it introduces no code. Concrete technical ADRs
to close the loop (flywheel-loop, eval-gate, etc.) are proposed in the roadmap as "to be written" and
are **not written now**.

Mapping (full table in `docs/ai-factory/term-mapping.md`):

- **Dual obligation** - **present**. One codebase with `DEPLOYMENT_MODE=saas|selfhosted` (ADR-0004),
  residency router keyed on `data_residency_region` at the storage layer (ADR-0014), local-first PII
  sanitisation via `@bugspotter/common` with a second scrub on the backend (ADR-0019).
- **Reusable artefacts** - **present** (as units), **partial** (as a pipeline). DedupKit with
  pluggable `EmbeddingProvider`/`StorageBackend`, the `.claude/skills/bs-backup-health` skill, the
  provider-registry abstractions (ADR-0029), and the storage router (ADR-0014). No systematic rule
  "every generalisable module -> package + skill + ADR" yet.
- **Spec-Driven Development** - **partial**. ADRs serve as specs; MCP tools are defined with JSON
  schemas + AJV validation (ADR-0039); the DedupKit contract was written before the implementation.
  No consistent "spec-first" ritual for every product feature.
- **AI Factory (methodology)** - **partial**. All technical nodes are present (ADR-0026…0040), but
  there is no closed "factory" cycle of idea -> spec -> artefact -> deploy -> **measurable ROI** ->
  reuse: ROI measurement is not wired up, eval-gate is absent.
- **Flywheel** - **partial** (main gap). The left half (collection) works: immutable `intelligence_event`
  and `intelligence_feedback` (ADR-0032), bug lifecycle signal. The right half (returning feedback
  to quality: auto-thresholds / retrain / eval) is absent; ADR-0032 is in "rollout planned" status.
- **SEED→PLANT→GROW→HARVEST→EVOLVE** - **partial, retrospective**. No canonical per-phase definitions
  (owner note: the chain is not a standard public framework; likely proprietary). The content maps
  onto ROADMAP stages, but these are labels, not code; the EVOLVE phase (fine-tune) is not running.

**Excluded from the mapping** at the owner's direction: `L3 delivery` and `AI/Run` are not mapped
(no definitions available / out of scope). The technical gaps previously tagged as "AI/Run" (continuous
eval, drift alerts, eval-gate) are preserved in the roadmap - they are anchored to ADR-0032, not to
the term.

### Term origins (external provenance anchor, per owner)

| Term | Canonical origin |
|---|---|
| AI Factory | Andrew Ng / DeepLearning.AI, *AI Transformation Playbook* (landing.ai, 2019) |
| Flywheel | Jim Collins, *Good to Great* (2001); Amazon virtuous cycle (Bezos, 2001); a16z data network effects |
| Reusable Artefacts | DDD (Evans, 2003); IEEE 1517; MLOps (ml-ops.org, Google MLOps whitepaper) |
| Spec-Driven Development | Design by Contract (Meyer, 1988); OpenAPI spec-first; Stripe Eng Blog |
| Dual Obligation | GDPR art. 5/25 (2018); ACM/IEEE Code of Ethics; fiduciary duty |
| SEED→PLANT→GROW→HARVEST→EVOLVE | Not a standard public framework; likely a proprietary methodology |
| L3 delivery, AI/Run | Excluded by owner (no definitions available) |

## Consequences

### Positive

- The AI Factory technical layer turns out to be almost entirely covered, with an explicit trade-off
  in an ADR behind every decision - adaptation requires no rewriting, only labelling and closing one
  loop.
- The main gap is localised: close the flywheel (feedback -> quality) and introduce an eval-gate.
  Everything else is external vocabulary, not a technical gap.
- Term origins are recorded openly: a future reader can see that the definitions are external glosses
  plus owner provenance anchors, not a canon baked into the product.

### Negative / Trade-offs

- Some terms (`SEED…EVOLVE`) are overlaid **retrospectively**, without canonical per-phase definitions
  - the labels may diverge from what the owner intends by the proprietary methodology.
- Working definitions rely on a previous-pass artefact rather than a framework specification; if a
  canonical document appears, the mapping will need to be re-verified.
- This ADR records the gap (flywheel "rollout planned") but does not close it - closure is deferred
  to the roadmap and depends on future technical ADRs.

## Alternatives considered

- **Write technical ADRs for flywheel-loop / eval-gate now** - premature: this is a documentation
  adaptation session, implementation is not yet chosen. Rejected; proposed in the roadmap as "to be
  written".
- **Adopt industry interpretations of the framework as definitions without noting this** - would
  distort the mapping and hide the absence of a canon. Rejected in favour of an explicit provenance
  table.
- **Silently ignore undefined terms** - would lose the signal "an owner decision is needed here".
  Rejected: `L3`/`AI/Run` are marked as excluded; `SEED…EVOLVE` is marked as retrospective labelling.
