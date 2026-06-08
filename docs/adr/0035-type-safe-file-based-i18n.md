# ADR-0035: Type-safe file-based i18n (props-only to React)

- Status: Accepted
- Area: i18n
- Source: `bugspotter-landing/src/i18n/index.ts`, `CLAUDE.md`, `src/pages/{en,ru,kk}/index.astro`
- Date: Landing phase 1

## Context

Three languages (en, ru, kk) must stay in sync and be type-checked across both Astro and React components, without coupling React to an i18n runtime (which would complicate Playwright testing).

## Decision

Translations live in `src/i18n/{en,ru,kk}.ts` as typed objects with a `TranslationKeys` type derived from `en.ts`. Astro pages resolve strings via `t(lang)`; **React components receive pre-resolved labels as props only** — they never import the i18n runtime. Three page files per route share the same components.

## Consequences

### Positive

- Compile-time type checking catches missing keys; React stays environment-agnostic and testable without i18n setup.
- No react-i18next runtime coupling.

### Negative / Trade-offs

- en/ru/kk files and the three page files must be kept in sync manually; all three locales deploy together.

## Alternatives considered

- **i18next / react-i18next** — couples React to an i18n runtime. Rejected.
- **Dynamic `[lang]` routing** — more complex redirect/canonical handling. Rejected for explicit per-language files.
