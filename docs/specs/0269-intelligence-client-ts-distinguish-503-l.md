# Spec: intelligence-client.ts: distinguish 503 (LLM backend unavailable) from other 5xx

<!-- This is the AI-generated spec document. .github/ISSUE_TEMPLATE/spec.yml is
     the human issue-filing form — different structure, different purpose. -->

Linked issue: Refs #269
ADR: n/a

**Files touched:** `packages/backend/src/services/intelligence/intelligence-client.ts`, `packages/backend/tests/services/intelligence/intelligence-client.test.ts`
**Blocking prerequisites:** none — `bugspotter-intelligence` PR #48 (which introduced the 503 + `Retry-After` + `code:"llm_unavailable"` contract) is already merged in the upstream service.

## Problem

`intelligence-client.ts` routes every upstream 5xx response through the same code path: same retry count, same backoff policy (`calculateBackoff` is exponential with plus-or-minus 25% jitter, not a fixed delay), and the same circuit-breaker trip weight. `bugspotter-intelligence` PR #48 (merged) added a deliberate distinction: a 503 with `{"detail":"LLM backend unavailable","code":"llm_unavailable"}` and `Retry-After: 30` signals a transient, known-recoverable condition (the LLM backend is down or timing out), whereas a generic 500 signals an actual service defect. Nothing on this side reads the status distinction, the response-body code, or the `Retry-After` header: `wrapError` maps any status `>= 500` to the same `'server_error'` code with no 503 special-casing, `isRetryableError` only checks `status >= 500 || status === 429`, and the circuit-breaker trip predicate only checks `code !== 'client_error'`. A transient LLM outage therefore trips the circuit breaker as aggressively as a real intelligence-service defect, causing unnecessary degraded service for all intelligence features during routine LLM cold-starts or restarts.

## Out of scope

- Changes to the `bugspotter-intelligence` service itself (separate repo; PR #48 already merged).
- Admin UI or end-user API responses surfacing the `retryAfter` value or LLM availability state.
- Adjusting circuit-breaker thresholds or window sizes for any error code other than `llm_unavailable`.
- Retry scheduling. `retryAfter` is attached to the error as metadata only: **no caller reads it in this change**, and neither `isRetryableError` nor `calculateBackoff` is modified. This deliberately narrows issue #269's "honor the `Retry-After` header value for backoff timing" bullet: honouring the hint would mean sleeping up to 120 s inside `requestWithRetry`, which runs in the request path, so acting on it is deferred to a follow-up that can move the wait to a worker. The behavioural half of this spec is the circuit-breaker exclusion, not the delay hint.

## Constraints

1. The change must be purely additive branching — no behavioral change for any response that is not `status === 503` with `body.code === 'llm_unavailable'`.
2. A 503 whose body does **not** carry `code: 'llm_unavailable'` must fall through to the existing `>= 500` branch unchanged.
3. The `Retry-After` header must be parsed as an integer (seconds); if absent or non-numeric, default to `30`. The parsed value must be capped at `120` to prevent unbounded backoff.
4. `llm_unavailable` errors must carry `tripCircuitBreaker: false` so that the circuit-breaker predicate — which currently only tests `code !== 'client_error'` — can exclude this recoverable condition without a second ad-hoc string check at every call site.
5. All new test cases must run under `pnpm --filter @bugspotter/backend test:unit` with no Docker or Redis dependency.

## Acceptance criteria

- [ ] A 503 response with `body.code === 'llm_unavailable'` is mapped to an `IntelligenceError` with `.code === 'llm_unavailable'`, distinct from the generic `>= 500` path — verified by test case A.
- [ ] The mapped error's `.retryAfter` equals the `Retry-After` header integer (capped at 120 s, defaulting to 30 s when the header is absent) — verified by test case B. This asserts the parse only; per Out of scope, nothing consumes the value yet.
- [ ] A plain 500 response continues to map exactly as before, with `.retryAfter` left undefined and `.code` still `'server_error'` — verified by test case C.
- [ ] A 503 response whose body lacks `code: 'llm_unavailable'` falls through to the existing `>= 500` branch — verified by test case D.
- [ ] The `llm_unavailable` error carries `.tripCircuitBreaker === false`, and the circuit-breaker trip predicate does not count it as a failure — verified by test case E.

## Changes

### `packages/backend/src/services/intelligence/intelligence-client.ts`

Extract the error-mapping logic from the private `wrapError` method into an exported `mapIntelligenceError(error: unknown, method: string, path: string): IntelligenceError` function so that unit tests can call it directly. Extract the circuit-breaker trip predicate into an exported `shouldTripCircuitBreaker(error: unknown): boolean` function for the same reason. It takes `unknown`, not `IntelligenceError`, because the current inline predicate also handles non-`IntelligenceError` values (it returns `true` for them) and that branch must survive extraction.

These two exports are additive, not a replacement for the existing coverage: the suite already asserts mapping through the public `IntelligenceClient` methods (`intelligence-client.test.ts:88-150`) and breaker state through `getCircuitState()` (`:234`), and those tests stay as they are. The exports exist because a 503 is retryable, so driving the new branch through a public method would require staging a full retry sequence on the mock adapter for every case, and the trip predicate is an inline lambda passed to `circuitBreaker.execute` with no other observation point.

Add a dedicated 503+`llm_unavailable` branch in `mapIntelligenceError` before the existing `>= 500` fall-through, attach `retryAfter` and `tripCircuitBreaker` to the returned error, and make the circuit-breaker trip predicate read the new flag. Extend the `IntelligenceError` constructor to accept an optional fourth `options` parameter carrying `retryAfter` and `tripCircuitBreaker`, exposed as optional readonly properties (`retryAfter?: number`, `tripCircuitBreaker?: boolean`) so that the predicate and the tests read them without casts.

`method` and `path` stay in the extracted function's signature because `wrapError` uses them to build the message (`Intelligence ${method} ${path} failed: ...`); the tests below pass them explicitly.

```ts
// In mapIntelligenceError, inside the existing `axios.isAxiosError(error)` narrow
// (intelligence-client.ts:432) and BEFORE the `status >= 500` branch, so `error` is
// already an AxiosError here even though the exported signature takes `unknown`.
// `body` reuses the same object-guard wrapError already applies before reading
// `detail` (intelligence-client.ts:434-437) rather than reaching into an
// untyped `data`, which can be a string when the upstream returns an error page.
const body =
  typeof error.response?.data === 'object' && error.response?.data !== null
    ? (error.response.data as Record<string, unknown>)
    : undefined;

if (error.response?.status === 503 && body?.code === 'llm_unavailable') {
  const raw = parseInt(error.response.headers?.['retry-after'] ?? '30', 10);
  const retryAfter = Math.min(Number.isNaN(raw) ? 30 : raw, 120);
  const detail = typeof body.detail === 'string' ? body.detail : 'LLM backend unavailable';
  // Same `Intelligence ${method} ${path} failed: ...` prefix the >= 500 branch uses,
  // so the message format does not diverge for this one code.
  return new IntelligenceError(
    `Intelligence ${method} ${path} failed: ${detail}`,
    'llm_unavailable',
    503,
    {
      retryAfter,
      tripCircuitBreaker: false,
    }
  );
}
```

```ts
// Extract the inline predicate at intelligence-client.ts:315-320 into an
// exported function so test case E can call it directly. It reads the new
// flag and keeps the existing default for every error that does not set one,
// so no `llm_unavailable` string check is needed anywhere (constraint #4).
// The non-IntelligenceError fallback (`return true`) is preserved from the
// current inline predicate.
export function shouldTripCircuitBreaker(error: unknown): boolean {
  if (error instanceof IntelligenceError) {
    return error.tripCircuitBreaker ?? error.code !== 'client_error';
  }
  return true;
}
```

Nothing outside these two files needs to change. The route-level error mapper in `packages/backend/src/api/routes/intelligence.ts` is the only consumer that reads `IntelligenceError.code`, and it is unaffected: the mapped error keeps `statusCode: 503`, so the client-facing status still resolves to 503 (`intelligence.ts:431-433`), and the client-facing message branch only special-cases `network_error` (`:434-437`). The new code surfaces only in the error log field at `:425`.

## Tests

### `packages/backend/tests/services/intelligence/intelligence-client.test.ts`

**Mock/fixture updates required:**

The existing mock error factory `createAxiosError` currently accepts positional arguments `(status: number, detail?: string)` and does not support `headers`. Change its call signature to accept an object `{ status, data, headers }` so that `Retry-After` can be set per-test, and update all existing callers in the file accordingly:

```ts
// Replaces the positional factory at intelligence-client.test.ts:32-46.
// `data` is passed through whole (the old form wrapped a bare `detail`
// string), so callers can set a body `code` as well.
function createAxiosError({
  status,
  data = {},
  headers = {},
}: {
  status: number;
  data?: unknown;
  headers?: Record<string, string>;
}): Error & { isAxiosError: boolean; response?: unknown } {
  const error = new Error(`Request failed with status ${status}`) as Error & {
    isAxiosError: boolean;
    response?: { status: number; data: unknown; headers: Record<string, string> };
  };
  error.isAxiosError = true;
  error.response = { status, data, headers };
  return error;
}
```

Every existing call site in the file uses the positional form (for example
`createAxiosError(500, 'Internal error')`) and must be rewritten to
`createAxiosError({ status: 500, data: { detail: 'Internal error' } })`.
The suite does not compile until all of them are converted.

**Test case A — 503 + llm_unavailable maps to distinct code (AC #1):**

```ts
it('maps 503 llm_unavailable to IntelligenceError with code llm_unavailable', () => {
  const axiosErr = createAxiosError({
    status: 503,
    data: { code: 'llm_unavailable', detail: 'LLM backend unavailable' },
    headers: { 'retry-after': '30' },
  });

  const result = mapIntelligenceError(axiosErr, 'POST', '/analyze');

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

  const map = (e: unknown) => mapIntelligenceError(e, 'POST', '/analyze');

  expect(map(make('45')).retryAfter).toBe(45);
  expect(map(make('999')).retryAfter).toBe(120);
  expect(map(make()).retryAfter).toBe(30);
  expect(map(make('notanumber')).retryAfter).toBe(30);
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

  const result = mapIntelligenceError(axiosErr, 'POST', '/analyze');

  expect(result.code).toBe('server_error');
  expect(result.retryAfter).toBeUndefined();
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

  const result = mapIntelligenceError(axiosErr, 'POST', '/analyze');

  expect(result.code).toBe('server_error');
  expect(result.retryAfter).toBeUndefined();
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

  const err = mapIntelligenceError(axiosErr, 'POST', '/analyze');
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
