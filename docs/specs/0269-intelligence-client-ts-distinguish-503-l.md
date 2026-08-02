# Spec: intelligence-client.ts: distinguish 503 (LLM backend unavailable) from other 5xx

<!-- This is the AI-generated spec document. .github/ISSUE_TEMPLATE/spec.yml is
     the human issue-filing form — different structure, different purpose. -->

Linked issue: Refs #269
ADR: n/a

**Files touched:** `packages/backend/src/services/intelligence/intelligence-client.ts`, `packages/backend/tests/services/intelligence/intelligence-client.test.ts`
**Blocking prerequisites:** none — `bugspotter-intelligence` PR #48 (which introduced the 503 + `Retry-After` + `code:"llm_unavailable"` contract) is already merged in the upstream service.

## Problem

`intelligence-client.ts` routes every upstream 5xx response through the same code path: same retry count, same fixed backoff delay, and the same circuit-breaker trip weight. `bugspotter-intelligence` PR #48 (merged) added a deliberate distinction: a 503 with `{"detail":"LLM backend unavailable","code":"llm_unavailable"}` and `Retry-After: 30` signals a transient, known-recoverable condition (the LLM backend is down or timing out), whereas a generic 500 signals an actual service defect. Nothing on this side reads the status distinction, the response-body code, or the `Retry-After` header: `wrapError` maps any status `>= 500` to the same `'server_error'` code with no 503 special-casing, `isRetryableError` only checks `status >= 500 || status === 429`, and the circuit-breaker trip predicate only checks `code !== 'client_error'`. A transient LLM outage therefore trips the circuit breaker as aggressively as a real intelligence-service defect, causing unnecessary degraded service for all intelligence features during routine LLM cold-starts or restarts.

## Out of scope

- Changes to the `bugspotter-intelligence` service itself (separate repo; PR #48 already merged).
- Admin UI or end-user API responses surfacing the `retryAfter` value or LLM availability state.
- Adjusting circuit-breaker thresholds or window sizes for any error code other than `llm_unavailable`.
- Retry scheduling infrastructure changes beyond passing the per-error delay hint to existing callers.

## Constraints

1. The change must be purely additive branching — no behavioral change for any response that is not `status === 503` with `body.code === 'llm_unavailable'`.
2. A 503 whose body does **not** carry `code: 'llm_unavailable'` must fall through to the existing `>= 500` branch unchanged.
3. The `Retry-After` header must be parsed as an integer (seconds); if absent or non-numeric, default to `30`. The parsed value must be capped at `120` to prevent unbounded backoff.
4. `llm_unavailable` errors must carry `tripCircuitBreaker: false` so that the circuit-breaker predicate — which currently only tests `code !== 'client_error'` — can exclude this recoverable condition without a second ad-hoc string check at every call site.
5. All new test cases must run under `pnpm --filter @bugspotter/backend test:unit` with no Docker or Redis dependency.

## Acceptance criteria

- [ ] A 503 response with `body.code === 'llm_unavailable'` is mapped to an `IntelligenceError` with `.code === 'llm_unavailable'`, distinct from the generic `>= 500` path — verified by test case A.
- [ ] The mapped error's `.retryAfter` equals the `Retry-After` header integer (capped at 120 s, defaulting to 30 s when the header is absent) — verified by test case B.
- [ ] A plain 500 response continues to map exactly as before, with no `.retryAfter` property and no change to `.code` — verified by test case C.
- [ ] A 503 response whose body lacks `code: 'llm_unavailable'` falls through to the existing `>= 500` branch — verified by test case D.
- [ ] The `llm_unavailable` error carries `.tripCircuitBreaker === false`, and the circuit-breaker trip predicate does not count it as a failure — verified by test case E.

## Changes

### `packages/backend/src/services/intelligence/intelligence-client.ts`

Extract the error-mapping logic from the private `wrapError` method into an exported `mapIntelligenceError(error: unknown, method: string, path: string): IntelligenceError` function so that unit tests can call it directly. Extract the circuit-breaker trip predicate into an exported `shouldTripCircuitBreaker(error: IntelligenceError): boolean` function for the same reason.

Add a dedicated 503+`llm_unavailable` branch in `mapIntelligenceError` before the existing `>= 500` fall-through, attach `retryAfter` and `tripCircuitBreaker` to the returned error, and extend the circuit-breaker trip predicate to exclude `llm_unavailable`. Extend the `IntelligenceError` constructor to accept an optional fourth `options` parameter carrying `retryAfter` and `tripCircuitBreaker`.

```ts
// In mapIntelligenceError — insert BEFORE the existing `status >= 500` branch:
if (error.response?.status === 503 && error.response?.data?.code === 'llm_unavailable') {
  const raw = parseInt(error.response.headers?.['retry-after'] ?? '30', 10);
  const retryAfter = Math.min(isNaN(raw) ? 30 : raw, 120);
  return new IntelligenceError(
    error.response.data.detail ?? 'LLM backend unavailable',
    'llm_unavailable',
    503,
    { retryAfter, tripCircuitBreaker: false }
  );
}
```

```ts
// In the circuit-breaker trip predicate — replace:
//   code !== 'client_error'
// with:
code !== 'client_error' && code !== 'llm_unavailable';
```

## Tests

### `packages/backend/tests/services/intelligence/intelligence-client.test.ts`

**Mock/fixture updates required:**

The existing mock error factory `createAxiosError` currently accepts positional arguments `(status: number, detail?: string)` and does not support `headers`. Change its call signature to accept an object `{ status, data, headers }` so that `Retry-After` can be set per-test, and update all existing callers in the file accordingly:

```ts
// Change createAxiosError to accept an object — extend the shape it accepts:
headers: Record<string, string>; // add this field; default to {}
// and wire it into the mock response object:
response: {
  (status, data, headers);
}
```

**Test case A — 503 + llm_unavailable maps to distinct code (AC #1):**

```ts
it('maps 503 llm_unavailable to IntelligenceError with code llm_unavailable', () => {
  const axiosErr = createAxiosError({
    status: 503,
    data: { code: 'llm_unavailable', detail: 'LLM backend unavailable' },
    headers: { 'retry-after': '30' },
  });

  const result = mapIntelligenceError(axiosErr);

  expect(result.code).toBe('llm_unavailable');
});
```

**Test case B — retryAfter extracted from Retry-After header, capped at 120, defaults to 30 (AC #2):**

```ts
it('uses Retry-After header as retryAfter, capped at 120, defaulting to 30', () => {
  const make = (retryAfterHeader?: string) =>
    createAxiosError({
      status: 503,
      data: { code: 'llm_unavailable', detail: 'LLM backend unavailable' },
      headers: retryAfterHeader ? { 'retry-after': retryAfterHeader } : {},
    });

  expect(mapIntelligenceError(make('45')).retryAfter).toBe(45);
  expect(mapIntelligenceError(make('999')).retryAfter).toBe(120);
  expect(mapIntelligenceError(make()).retryAfter).toBe(30);
  expect(mapIntelligenceError(make('notanumber')).retryAfter).toBe(30);
});
```

**Test case C — plain 500 is unchanged (AC #3):**

```ts
it('maps a plain 500 via the existing >=500 branch without retryAfter', () => {
  const axiosErr = createAxiosError({
    status: 500,
    data: { detail: 'Internal server error' },
    headers: {},
  });

  const result = mapIntelligenceError(axiosErr);

  expect(result.code).not.toBe('llm_unavailable');
  expect((result as any).retryAfter).toBeUndefined();
});
```

**Test case D — 503 without llm_unavailable code falls through (AC #4):**

```ts
it('maps 503 without llm_unavailable body code via the generic >=500 branch', () => {
  const axiosErr = createAxiosError({
    status: 503,
    data: { detail: 'Service unavailable' },
    headers: {},
  });

  const result = mapIntelligenceError(axiosErr);

  expect(result.code).not.toBe('llm_unavailable');
  expect((result as any).retryAfter).toBeUndefined();
});
```

**Test case E — llm_unavailable sets tripCircuitBreaker false and is excluded by the predicate (AC #5):**

```ts
it('sets tripCircuitBreaker false on llm_unavailable and the trip predicate excludes it', () => {
  const axiosErr = createAxiosError({
    status: 503,
    data: { code: 'llm_unavailable', detail: 'LLM backend unavailable' },
    headers: { 'retry-after': '30' },
  });

  const err = mapIntelligenceError(axiosErr);
  expect(err.tripCircuitBreaker).toBe(false);

  // The circuit-breaker predicate must evaluate to false for this error:
  expect(shouldTripCircuitBreaker(err)).toBe(false);
});
```

## Verification

```bash
pnpm --filter @bugspotter/backend typecheck
pnpm --filter @bugspotter/backend test:unit
```

Rollback: revert the diff to `packages/backend/src/services/intelligence/intelligence-client.ts` and `packages/backend/tests/services/intelligence/intelligence-client.test.ts`; the change is purely additive branching with no schema, migration, or configuration changes, so no further undo steps are required.
