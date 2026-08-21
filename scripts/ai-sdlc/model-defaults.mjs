// Single source of truth for this pipeline's hardcoded model-id fallbacks.
//
// Every call site still overrides independently via its own env var
// (LLM_DEFAULT_MODEL, IMPL_MODEL_HIGH/_DEFAULT/_LOW) - this module only fixes
// what each falls back to when that env var isn't set, so bumping the
// pipeline's default model touches one file instead of every consumer.
// claude-review.yml can't import this (plain GitHub Actions YAML), so its own
// vars.*-driven fallbacks are kept in sync with these by hand - see the
// comment above its --model line.

export const DEFAULT_MODEL = 'claude-sonnet-5';
export const HIGH_MODEL = 'claude-opus-4-8';
export const LOW_MODEL = 'claude-haiku-4-5-20251001';
