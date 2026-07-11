# AI Factory - gap closure roadmap

Accompanies [ADR-0041](../adr/0041-ai-factory-adaptation.md) and
[term-mapping.md](./term-mapping.md). Priority is by **loop closure**: flywheel-loop and
eval-gate rank above cosmetic work (phase labels). Technical ADRs are marked "to be written" -
they are not written in this session.

Each item: framework phase (per working definitions) - technical step - affected ADRs -
definition of done - proposed technical ADR.

---

## R1 - Close the Flywheel (phase GROW → EVOLVE) - priority: highest

**Why first.** This is the only genuinely open loop: feedback accumulates but does not feed back
into quality. The main gap from term-mapping.

- **Step:** nightly job `intelligence_feedback` -> per-tenant eval metric -> auto-adjust
  `similarity_threshold` (ADR-0028) within guardrails (min/max, step, audit) -> retrain candidate
  flag. (ADR-0032 status transition requires full rollout coverage: event/feedback persistence,
  `record_generate()` instrumentation, and observability endpoints - not only threshold tuning.)
- **Affected ADRs:** 0032 (status), 0028 (thresholds).
- **Definition of done:** a verdict in `intelligence_feedback` measurably shifts the next per-tenant
  threshold, with an audit trail and rollback path; the `linked` gold signal is taken into account.
- **Technical ADR (to be written):** "Flywheel closure: feedback -> threshold auto-tuning".

## R2 - Eval-gate in CI (AI Factory: measurable ROI) - priority: high

- **Step:** eval job in `ci.yml`: run Intelligence against a golden set; block release if accuracy
  falls below threshold. Separate from `claude-review.yml` (which must not block merge).
- **Affected ADRs:** 0032 (accuracy/cost source); new ADR.
- **Definition of done:** an Intelligence release fails when accuracy on the golden set drops below
  the configured floor.
- **Technical ADR (to be written):** "Intelligence eval-gate in CI".

## R3 - Active monitoring + drift alerts - priority: high

- **Step:** scheduler periodically calls `/observability/accuracy` -> alert when it falls below
  threshold (drift detection). Turns the pull endpoint into an active loop.
- **Affected ADRs:** 0032.
- **Definition of done:** accuracy dropping below the floor raises an alert without a human
  manually polling the endpoint.
- **Technical ADR (to be written):** "Continuous AI eval + drift alerting".

## R4 - Estimate-vs-actual loop (estimation data) - priority: medium

- **Step:** dashboard reconciling financial model assumptions (cost-per-session, conversion) with
  `intelligence_event` aggregates per tenant.
- **Affected ADRs:** 0032 + financial model.
- **Definition of done:** planned cost is regularly compared to actual cost per tenant.

## R5 - End-to-end agentic workflow (phase HARVEST) - priority: medium

- **Step:** document and test the end-to-end autonomous flow
  "new bug -> `find_similar` -> categorisation -> `update_bug_status`" across 6 tools (ADR-0038);
  behavioural logs (ADR-0040) confirm the agent is not overreaching.
- **Affected ADRs:** 0038, 0040.
- **Definition of done:** a passing end-to-end test covers all six ADR-0038 tools and includes
  ADR-0040 boundary assertions; flow is documented; logs confirm the agent stays within the surface boundary.

## R6 - Spec-first ritual (Spec-Driven Development) - priority: medium-low

- **Step:** adopt contract -> tests -> code order for every product feature, extending the
  schema-as-contract pattern (ADR-0039).
- **Definition of done:** rule is written into the process; first feature shipped under it.

## R7 - Reusable-artefact pipeline - priority: low

- **Step:** process rule "every generalisable module -> package + skill + ADR" by default in the SDLC.
- **Definition of done:** rule is recorded; individual artefacts (DedupKit, skills) are brought
  under it.

## R8 - SEED...EVOLVE phase labels on ROADMAP (cosmetic) - priority: low

- **Step:** overlay phase labels on existing ROADMAP stages (retrospectively, no code).
- **Definition of done:** ROADMAP is annotated **with an explicit note** that these are
  proprietary/non-standard labels with no public canonical definition (see ADR-0041).
- **Dependency:** EVOLVE content (fine-tune) depends on R1 (closing the flywheel).

---

## Priority summary

| #   | Item                 | Phase              | Priority       | Affected ADRs |
| --- | -------------------- | ------------------ | -------------- | ------------- |
| R1  | Close the Flywheel   | GROW→EVOLVE        | highest        | 0032, 0028    |
| R2  | Eval-gate in CI      | AI Factory / ROI   | high           | 0032 (+new)   |
| R3  | Monitoring + alerts  | -                  | high           | 0032 (+new)   |
| R4  | Estimate-vs-actual   | estimation         | medium         | 0032          |
| R5  | E2E agentic workflow | HARVEST            | medium         | 0038, 0040    |
| R6  | Spec-first ritual    | Spec-Driven        | medium-low     | 0039          |
| R7  | Reuse pipeline       | Reusable artefacts | low            | -             |
| R8  | Phase labels         | SEED...EVOLVE      | low (cosmetic) | -             |
