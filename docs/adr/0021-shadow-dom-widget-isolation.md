# ADR-0021: Shadow DOM widget isolation

- Status: Accepted
- Area: widget
- Source: `bugspotter-sdk/widget/modal.ts`; `bugspotter-extension/src/content/content-main.ts`
- Date: SDK v0.1.0 (2025-11-01)

## Context

The bug-report widget (button, modal, annotation overlay) is injected into arbitrary customer pages. Host-page CSS and JS must not leak into the widget, and the widget's styles must not bleed into the host.

## Decision

Render the modal/overlay inside a **Shadow DOM** host with inline styles (CSP-safe). The SDK modal uses `attachShadow({mode:'open'})`; the extension annotation overlay uses a closed Shadow DOM at `document.body`. The floating button sits at top-level DOM with max `z-index` (2147483647) for reliable stacking.

## Consequences

### Positive

- Style encapsulation in both directions; works on any site without CSP violations from injected `<style>`.
- Open mode (SDK) still allows intentional host customization.

### Negative / Trade-offs

- Very old browsers lacking Shadow DOM fall back to light DOM; `::part` host customization is limited.
- Slightly slower initial render.

## Alternatives considered

- **CSS namespacing** — fragile, collisions possible. Rejected.
- **iframe** — slow, cross-frame communication overhead. Rejected.
