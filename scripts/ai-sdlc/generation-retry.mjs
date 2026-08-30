// Shared primitives for the three ai-sdlc generation scripts
// (generate-spec.mjs, generate-adr.mjs, generate-impl.mjs), which each
// independently hand-maintained their own copy of the same small set of
// pieces:
//   1. parsePositiveMs        - parse a budget env var into a non-negative ms
//                                value, falling back to a default on
//                                anything unset/blank/invalid.
//   2. computeRemainingBudgetMs - the step's remaining time budget, after
//                                subtracting a safety buffer and whatever
//                                has already elapsed since the script
//                                started.
//   3. runWithCorrectiveRetry  - the "not enough budget left? give up
//                                (fatal or soft, caller's choice);
//                                otherwise clamp the follow-up call's own
//                                timeout to whatever's left, make one more
//                                call, and hand the result back" shape each
//                                script's corrective call followed.
//
// See #402/#403/#404: three of four review-round findings on PR #403 were
// "one copy has the fix, the other doesn't" specifically because these were
// hand-copied into generate-spec.mjs and generate-adr.mjs (and, independently,
// twice more inside generate-impl.mjs) instead of shared. Extracted here so a
// future fix - or a future script with the same shape - only has one place
// to land.

/**
 * Parses a millisecond duration from an environment variable, falling back
 * to `fallback` if the value is unset, blank, or not a finite non-negative
 * number.
 *
 * Trims and checks for an empty string BEFORE calling Number(): `Number('')`
 * is `0`, not `NaN`, and GitHub Actions resolves an unconfigured `vars.*`
 * reference to an empty string rather than leaving the env var unset - so a
 * plain `envValue !== undefined` check would let an empty override silently
 * collapse a budget to 0 instead of falling back to the intended default.
 *
 * @param {string | undefined} envValue
 * @param {number} fallback
 * @returns {number}
 */
export function parsePositiveMs(envValue, fallback) {
  const trimmed = typeof envValue === 'string' ? envValue.trim() : envValue;
  if (trimmed === undefined || trimmed === '') {
    return fallback;
  }
  const n = Number(trimmed);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/**
 * Computes how much of a step's time budget is left: the configured budget,
 * minus a safety buffer held back for whatever runs after the LLM call(s)
 * return (writing files, downstream gate checks), minus time already
 * elapsed since the script started. Can return a negative number - callers
 * compare it against a minimum-to-attempt floor, not against zero.
 *
 * `scriptStartedAt` must be captured at the very top of the calling script,
 * before any setup file I/O - capturing it late under-counts elapsed time
 * and lets a retry fire with less real budget left than this function
 * reports having.
 *
 * @param {{ stepBudgetMs: number, safetyBufferMs: number, scriptStartedAt: number }} args
 * @returns {number}
 */
export function computeRemainingBudgetMs({ stepBudgetMs, safetyBufferMs, scriptStartedAt }) {
  return stepBudgetMs - safetyBufferMs - (Date.now() - scriptStartedAt);
}

/**
 * Runs one budget-gated follow-up LLM call: attempted only when there's real
 * time left in the step's budget, with its own timeout clamped to whatever's
 * left.
 *
 * Covers two shapes used across the ai-sdlc generation scripts:
 *   - A genuine corrective retry: the primary call already ran and its
 *     result failed some check (a narrated tool-call transcript, a missing
 *     declared file) - this issues one follow-up call with a stronger
 *     prompt (generate-spec.mjs, generate-adr.mjs, and generate-impl.mjs's
 *     missing-declared-files self-correction).
 *   - A budget-gated single call that isn't retrying a prior failure as such
 *     (generate-impl.mjs's quality self-review pass) - same shape (budget
 *     check, timeout clamp, call, handle failure modes), just without a
 *     failed attempt behind it.
 *
 * Fatal-vs-soft failure behavior is entirely the caller's choice, via the
 * onNoBudget/onCallError/onTruncated callbacks: generate-spec.mjs and
 * generate-adr.mjs exit(1) from all three (a narrated transcript must never
 * reach disk); generate-impl.mjs's two call sites log and proceed without
 * the follow-up from all three (a missing file or skipped quality pass is
 * reported by a downstream gate, not fatal here). This function itself never
 * calls process.exit and never throws on a soft failure - it only decides
 * WHETHER to call and WHAT timeout to give it; what a failure *means* is up
 * to the caller.
 *
 * The actual "is this result good enough" check - re-running narration
 * detection, parsing the response as JSON, deciding what to merge or write -
 * is deliberately left to the caller's `onSuccess` callback rather than
 * folded into this function, since that check's shape differs per call site
 * (a boolean re-check vs. a JSON parse-and-merge) in a way a single
 * `isAcceptable`-style parameter can't express cleanly without becoming its
 * own per-call-site branch.
 *
 * @param {object} args
 * @param {number} args.remainingMs - result of computeRemainingBudgetMs, computed by the caller.
 * @param {number} args.retryMinBudgetMs - minimum remainingMs required to attempt the call at all.
 * @param {number} args.maxTimeoutMs - upper bound on the call's own timeout (typically the primary call's own timeout).
 * @param {() => string} args.buildPrompt - builds the prompt for this call. Only invoked if the call is actually attempted (a quality-review prompt can be expensive to assemble - no point building it just to skip).
 * @param {(prompt: string, timeoutMs: number) => Promise<{ text: string, stopReason: string }>} args.callFn - issues the call.
 * @param {(remainingMs: number) => void} [args.onNoBudget] - called instead of attempting the call, when remainingMs < retryMinBudgetMs.
 * @param {(timeoutMs: number) => void} [args.onAttempt] - called right before the call, once the timeout has been clamped - the hook point for a "retrying now, timeout Xs" log line.
 * @param {(err: Error, timeoutMs: number) => void} [args.onCallError] - called when callFn itself throws.
 * @param {(timeoutMs: number) => void} [args.onTruncated] - called when the call's stopReason is 'max_tokens'.
 * @param {(text: string, stopReason: string, timeoutMs: number) => void} [args.onSuccess] - called with a non-truncated result; the caller decides whether it's actually acceptable (e.g. re-checking for narration, or parsing it as JSON) and what to do with it.
 * @returns {Promise<{ attempted: boolean, ok: boolean, text?: string, stopReason?: string, timeoutMs?: number }>}
 */
export async function runWithCorrectiveRetry({
  remainingMs,
  retryMinBudgetMs,
  maxTimeoutMs,
  buildPrompt,
  callFn,
  onNoBudget = () => {},
  onAttempt = () => {},
  onCallError = () => {},
  onTruncated = () => {},
  onSuccess = () => {},
}) {
  if (remainingMs < retryMinBudgetMs) {
    onNoBudget(remainingMs);
    return { attempted: false, ok: false };
  }

  const timeoutMs = Math.min(maxTimeoutMs, remainingMs);
  onAttempt(timeoutMs);
  const prompt = buildPrompt();

  let text, stopReason;
  try {
    ({ text, stopReason } = await callFn(prompt, timeoutMs));
  } catch (err) {
    // callFn is caller-supplied and may throw anything (a string, a plain
    // object) - normalize to a real Error here so onCallError's documented
    // `(err: Error, timeoutMs: number)` contract is actually enforced,
    // rather than relying on every caller's `err.message` access to survive
    // whatever callFn happened to throw. A plain object with its own
    // `message` string (a common shape for a non-Error throw, e.g. a
    // hand-built API error payload) keeps that message instead of
    // collapsing to `String(err)`'s uninformative "[object Object]".
    const normalizedErr =
      err instanceof Error
        ? err
        : new Error(err && typeof err.message === 'string' ? err.message : String(err));
    onCallError(normalizedErr, timeoutMs);
    return { attempted: true, ok: false, timeoutMs };
  }

  if (stopReason === 'max_tokens') {
    onTruncated(timeoutMs);
    return { attempted: true, ok: false, text, stopReason, timeoutMs };
  }

  onSuccess(text, stopReason, timeoutMs);
  return { attempted: true, ok: true, text, stopReason, timeoutMs };
}
