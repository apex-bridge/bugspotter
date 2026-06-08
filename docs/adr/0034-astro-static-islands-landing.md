# ADR-0034: Astro static + islands for the landing site

- Status: Accepted
- Area: framework
- Source: `bugspotter-landing/astro.config.mjs`, `CLAUDE.md`, `README.md`
- Date: Landing phase 1

## Context

The landing site is mostly marketing content in three languages that must load fast and rank well, with a few interactive pieces (signup/registration forms). A full SPA would ship needless JS; plain HTML would duplicate structure across languages.

## Decision

Use **Astro 5 with `output: 'static'`** and the **islands architecture**: pages are pre-rendered HTML, and React is hydrated only for interactive islands (forms) via `client:load`. Deployed static behind a CDN (Vercel adapter).

## Consequences

### Positive

- Zero-JS marketing content; React downloaded only when a form island renders.
- CDN-cacheable static output; pages pre-rendered at build.

### Negative / Trade-offs

- Every deploy regenerates all pages; server API routes must opt out of prerender.
- Page-level i18n needs separate files per language (see [0035](0035-type-safe-file-based-i18n.md)).

## Alternatives considered

- **Next.js SSR** — server cost for mostly-static content. Rejected.
- **Pure React SPA** — bloated initial load, worse SEO. Rejected.
- **Hand-written HTML** — duplication across languages. Rejected.
