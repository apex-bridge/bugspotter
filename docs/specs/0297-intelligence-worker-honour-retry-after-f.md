# Spec: intelligence-worker: honour Retry-After from llm_unavailable when rescheduling jobs

Linked issue: Refs #297
ADR: n/a

**Files touched:**

- `packages/backend/src/queue/workers/intelligence-worker.ts`
- `packages/backend/tests/queue/intelligence-worker.test.ts`
- `packages/message-broker/src/interfaces.ts` — `IJobHandle` has no `moveToDelayed` member today; add one.
- `packages/message-broker/src/adapters/bullmq/job-handle.ts` — implement it on `BullMQJobHandle` by delegating to the wrapped BullMQ `Job.moveToDelayed`.
- `packages/message-broker/tests/job-handle.test.ts` — cover the new delegation, matching the existing per-method test convention in that file.

The scope grew beyond the original two backend files: `job` in `processIntelligenceJob` is typed `IJobHandle<IntelligenceJobData, IntelligenceJobResult>`, not the raw BullMQ `Job`, and that interface currently exposes only `id`, `name`, `data`, `attemptsMade`, `updateProgress()`, and `log()` — no reschedule method. The mechanism this spec depends on does not exist in the abstraction layer yet; it has to be added there before the worker-level change can even compile.

**Blocking prerequisites:** none — `IntelligenceError.retryAfter` was parsed and `llm_unavailable` was excluded from the circuit breaker in #283 (merged).

## Problem

When the intelligence service responds with `llm_unavailable` and a `Retry-After` header, `IntelligenceError.retryAfter` is populated (since #283) but nothing reads it. `intelligence-worker` falls through to BullMQ's standard exponential backoff (5 s, 10 s, 20 s — exhausted in ~35 s), ignoring the server-supplied hint entirely. A `Retry-After: 120` response causes three failed attempts in rapid succession before the job is dead-lettered, precisely when the LLM is most overloaded. The fix is confined to the worker, which is the only caller that can absorb a multi-minute wait; the shared `IntelligenceClient` and all HTTP request-path routes are unaffected.

## Out of scope

- Any change to `IntelligenceClient` or `requestWithRetry` — the parse of `Retry-After` into `IntelligenceError.retryAfter` already landed in #283.
- Any change to `sdk-similar.ts`, `intelligence.ts`, `self-service.ts`, or `admin-intelligence.ts` — request-path routes must continue to fail fast.
- Correcting `src/queue/README.md:387` (stale "1s, 2s, 4s" claim) — valid but a separate PR.
- Changing `MAX_JOB_RETRIES` or `BACKOFF_DELAY` defaults in `queue.config.ts`.

## Constraints

1. `job` in `processIntelligenceJob` is `IJobHandle<IntelligenceJobData, IntelligenceJobResult>` (`packages/message-broker/src/interfaces.ts`), not the raw BullMQ `Job`, and `IJobHandle` does not expose a reschedule method today. Add `moveToDelayed(timestamp: number, token?: string): Promise<void>` to `IJobHandle` and implement it on `BullMQJobHandle` (`packages/message-broker/src/adapters/bullmq/job-handle.ts`) by delegating to the wrapped job's own `moveToDelayed`. This is a prerequisite for constraint 2, not an afterthought — the worker-level change cannot compile without it.
2. BullMQ v5 `Job.moveToDelayed(timestamp: number, token?: string): Promise<void>` requires the worker token. The processor at `intelligence-worker.ts:588` currently receives only `(job)` — widening to `(job, token)` and threading the token through `processIntelligenceJob` down to `job.moveToDelayed` is required.
3. `DelayedError` must be thrown after `moveToDelayed`; throwing any other error consumes an attempt and re-applies exponential backoff, defeating the purpose.
4. The fallback when `err.retryAfter` is absent or zero must be 30 s (matching the minimum the LLM proxy enforces). Use `err.retryAfter || 30`, not `err.retryAfter ?? 30` — `??` only falls through on `null`/`undefined`, so `0 ?? 30` evaluates to `0`, silently violating this constraint for an explicit `retryAfter: 0` response. `||` treats `0` as falsy and falls through correctly.
5. Non-`llm_unavailable` `IntelligenceError` codes and all other error types must reach the existing error path unchanged.
6. The attempt-accounting behaviour of `moveToDelayed` (whether repeated delays eventually exhaust `job.opts.attempts`) must be explicitly documented in the PR body. The spec does not mandate a specific resolution, but the choice must be deliberate and recorded.
7. Implementation must remain type-safe: `token` is typed `string | undefined` in BullMQ v5; pass it through as-is and let `moveToDelayed` handle the undefined case (it will throw — acceptable, since token is always provided by the framework to a registered processor).

## Acceptance criteria

- [ ] An `llm_unavailable` error with `retryAfter: 45` causes `job.moveToDelayed` to be called with approximately `Date.now() + 45000` and `DelayedError` to be thrown — verified by test case A.
- [ ] An `llm_unavailable` error with `retryAfter` undefined causes `job.moveToDelayed` to be called with approximately `Date.now() + 30000` — verified by test case B.
- [ ] An `llm_unavailable` error with `retryAfter: 0` (explicit zero, not absent) also causes `job.moveToDelayed` to be called with approximately `Date.now() + 30000` — verified by test case D. This is the case `??` would get wrong and `||` gets right; it needs its own assertion, not just a mention alongside the undefined case.
- [ ] A non-`llm_unavailable` `IntelligenceError` (e.g. `server_error`) does not call `moveToDelayed` and propagates normally — verified by test case C.
- [ ] `typecheck` passes with no new errors introduced by the token threading change or by the `IJobHandle.moveToDelayed` addition.

## Changes

### `packages/backend/src/queue/workers/intelligence-worker.ts`

Widen the processor lambda to accept the BullMQ token, then thread it through to `processIntelligenceJob`. Add the `llm_unavailable` reschedule branch inside a new try-catch in `processIntelligenceJob`. Export `processIntelligenceJob` so the new test suite can drive it directly (matching the pattern already used for `processAnalyzeJob`).

```ts
// Replace (at the processor registration, currently line ~588):
//   processor: async (job) => processIntelligenceJob(job, clientFactory, db, ruleExecutor),
// with:
processor: async (job, token) => processIntelligenceJob(job, token, clientFactory, db, ruleExecutor),
```

```ts
// Replace the function signature of processIntelligenceJob:
//   async function processIntelligenceJob(job: IJobHandle<IntelligenceJobData, IntelligenceJobResult>, clientFactory: ..., db: ..., ruleExecutor: ...)
// with (add export keyword and insert token as second parameter):
export async function processIntelligenceJob(
  job: IJobHandle<IntelligenceJobData, IntelligenceJobResult>,
  token: string | undefined,
  clientFactory: ...,   // preserve existing parameter types verbatim
  db: ...,
  ruleExecutor: ...,
)
```

```ts
// Append after existing imports at top of file:
import { DelayedError } from 'bullmq';
```

```ts
// processIntelligenceJob currently has no catch block.
// Wrap the type-dispatch block (the if/else-if chain that follows the resolveClient call)
// in a try-catch. The catch re-throws all errors except llm_unavailable, which is
// rescheduled via moveToDelayed instead of consuming a retry attempt:
try {
  if (type === 'analyze') {
    return processAnalyzeJob(job, client, db, orgId, startTime, ruleExecutor);
  }
  if (type === 'resolution') {
    return processResolutionJob(job, client, startTime);
  }
  if (type === 'enrich') {
    return processEnrichJob(job, client, db, orgId, startTime);
  }
  if (type === 'mitigation') {
    return processMitigationJob(job, client, db, startTime);
  }
  throw new JobProcessingError(job.id || 'unknown', `Unsupported intelligence job type: ${type}`, {
    type,
    bugReportId,
  });
} catch (err) {
  if (err instanceof IntelligenceError && err.code === 'llm_unavailable') {
    // `||`, not `??` — retryAfter can be an explicit 0 (constraint 4), and
    // `0 ?? 30` evaluates to `0` since `0` is not nullish. `||` treats `0` as
    // falsy and falls through to the 30s floor as intended.
    const ms = (err.retryAfter || 30) * 1000;
    await job.moveToDelayed(Date.now() + ms, token);
    throw new DelayedError();
  }
  throw err;
}
```

### `packages/message-broker/src/interfaces.ts`

Add a `moveToDelayed` member to `IJobHandle`, matching BullMQ's own `Job.moveToDelayed(timestamp: number, token?: string): Promise<void>` signature:

```ts
export interface IJobHandle<D = unknown, _R = unknown> {
  readonly id: string;
  readonly name: string;
  readonly data: D;
  readonly attemptsMade: number;
  updateProgress(value: number | object): Promise<void>;
  log(message: string): Promise<void>;
  moveToDelayed(timestamp: number, token?: string): Promise<void>;
}
```

### `packages/message-broker/src/adapters/bullmq/job-handle.ts`

Implement it on `BullMQJobHandle` by delegating to the wrapped job, following the existing `updateProgress`/`log` delegation pattern:

```ts
async moveToDelayed(timestamp: number, token?: string): Promise<void> {
  await this.job.moveToDelayed(timestamp, token);
}
```

Any other `IJobHandle` implementer (in-repo: only `BullMQJobHandle`; check for synthetic/literal `IJobHandle`-shaped objects built without an `as` cast, e.g. `createSyntheticJobHandle` in `packages/backend/src/queue/workers/outbox/ticket-creation-outbox.worker.ts`) must be updated with a `moveToDelayed` member too, or `typecheck` fails.

## Tests

### `packages/backend/tests/queue/intelligence-worker.test.ts`

**Additional imports required:**

The new test suite calls `processIntelligenceJob` and asserts on `DelayedError`; add both imports alongside the existing ones:

```ts
import { processIntelligenceJob } from '../../src/queue/workers/intelligence-worker.js';
import { DelayedError } from 'bullmq';
import { IntelligenceError } from '../../src/services/intelligence/intelligence-client.js';
```

**Mock/fixture setup for the new describe block:**

The three new test cases test `processIntelligenceJob` end-to-end. That function calls `resolveClient`, which calls `db.projects.findById` and then `clientFactory.getGlobalClient()` (self-hosted path — no `organizationId` in job data). The job mock must include a `type` field to pass `validateIntelligenceJobData`, and must expose `moveToDelayed`. Set these up in a dedicated `beforeEach`:

```ts
describe('Intelligence Worker - processIntelligenceJob llm_unavailable rescheduling', () => {
  let mockJob: any;
  let mockClient: any;
  let mockClientFactory: any;
  let mockDb: any;
  let mockRuleExecutor: DedupRuleExecutor;

  beforeEach(() => {
    mockJob = {
      id: 'job-1',
      data: {
        type: 'analyze',
        bugReportId: 'bug-1',
        projectId: 'proj-1',
        payload: { bug_id: 'bug-1' },
      },
      updateProgress: vi.fn(),
      moveToDelayed: vi.fn().mockResolvedValue(undefined),
    };

    mockClient = {
      analyzeBug: vi.fn(),
      getSimilarBugs: vi.fn().mockResolvedValue({ is_duplicate: false, similar_bugs: [] }),
    };

    // resolveClient uses getGlobalClient() when the project has no organization_id
    mockClientFactory = {
      getGlobalClient: vi.fn().mockReturnValue(mockClient),
      getClientForOrg: vi.fn(),
    };

    // resolveClient calls db.projects.findById; return a project with no org (self-hosted path)
    mockDb = {
      projects: {
        findById: vi.fn().mockResolvedValue({ id: 'proj-1', organization_id: null }),
      },
    };

    mockRuleExecutor = {} as DedupRuleExecutor;
  });
```

**Test case A — llm_unavailable with retryAfter reschedules at server-supplied delay (AC #1):**

```ts
it('moves job to delayed using retryAfter when llm_unavailable', async () => {
  const retryAfter = 45;
  // IntelligenceError's constructor is (message, code, statusCode, options?) — statusCode
  // is required, and retryAfter is `public readonly`, set from options in the constructor
  // body, not assignable after construction. Object.assign onto a readonly field is not
  // how this type is meant to be built; call the real constructor instead.
  mockClient.analyzeBug.mockRejectedValueOnce(
    new IntelligenceError('LLM unavailable', 'llm_unavailable', 503, { retryAfter })
  );

  const before = Date.now();
  await expect(
    processIntelligenceJob(mockJob, 'test-token', mockClientFactory, mockDb, mockRuleExecutor)
  ).rejects.toBeInstanceOf(DelayedError);
  const after = Date.now();

  expect(mockJob.moveToDelayed).toHaveBeenCalledOnce();
  const [calledAt, calledToken] = (mockJob.moveToDelayed as ReturnType<typeof vi.fn>).mock.calls[0];
  expect(calledAt).toBeGreaterThanOrEqual(before + retryAfter * 1000);
  expect(calledAt).toBeLessThanOrEqual(after + retryAfter * 1000);
  expect(calledToken).toBe('test-token');
});
```

**Test case B — llm_unavailable with absent retryAfter falls back to 30 s (AC #2):**

```ts
it('falls back to 30 s delay when retryAfter is absent', async () => {
  mockClient.analyzeBug.mockRejectedValueOnce(
    new IntelligenceError('LLM unavailable', 'llm_unavailable', 503)
    // retryAfter not set — leaves the field undefined
  );

  const before = Date.now();
  await expect(
    processIntelligenceJob(mockJob, 'test-token', mockClientFactory, mockDb, mockRuleExecutor)
  ).rejects.toBeInstanceOf(DelayedError);
  const after = Date.now();

  const [calledAt] = (mockJob.moveToDelayed as ReturnType<typeof vi.fn>).mock.calls[0];
  expect(calledAt).toBeGreaterThanOrEqual(before + 30_000);
  expect(calledAt).toBeLessThanOrEqual(after + 30_000);
});
```

**Test case D — llm_unavailable with retryAfter: 0 falls back to 30 s (AC #3):**

Distinct from test case B: this proves the fix handles an explicit falsy `0`, not just an absent field. Under the original `?? 30`, `0 ?? 30` evaluates to `0` and this assertion would fail (`moveToDelayed` would be called with `Date.now() + 0`, not `+ 30000`); under `|| 30` it passes.

```ts
it('falls back to 30 s delay when retryAfter is explicitly 0', async () => {
  mockClient.analyzeBug.mockRejectedValueOnce(
    new IntelligenceError('LLM unavailable', 'llm_unavailable', 503, { retryAfter: 0 })
  );

  const before = Date.now();
  await expect(
    processIntelligenceJob(mockJob, 'test-token', mockClientFactory, mockDb, mockRuleExecutor)
  ).rejects.toBeInstanceOf(DelayedError);
  const after = Date.now();

  const [calledAt] = (mockJob.moveToDelayed as ReturnType<typeof vi.fn>).mock.calls[0];
  expect(calledAt).toBeGreaterThanOrEqual(before + 30_000);
  expect(calledAt).toBeLessThanOrEqual(after + 30_000);
});
```

**Test case C — non-llm_unavailable error does not call moveToDelayed (AC #4):**

```ts
  it('does not call moveToDelayed for non-llm_unavailable errors', async () => {
    mockClient.analyzeBug.mockRejectedValueOnce(
      new IntelligenceError('Service error', 'server_error', 500),
    );

    await expect(
      processIntelligenceJob(mockJob, 'test-token', mockClientFactory, mockDb, mockRuleExecutor),
    ).rejects.not.toBeInstanceOf(DelayedError);

    expect(mockJob.moveToDelayed).not.toHaveBeenCalled();
  });
});
```

## Verification

```bash
pnpm --filter @bugspotter/message-broker test
pnpm --filter @bugspotter/message-broker typecheck
pnpm --filter @bugspotter/backend test:unit
pnpm --filter @bugspotter/backend typecheck
```

Rollback: Revert the diff to `intelligence-worker.ts`, `intelligence-worker.test.ts`, and the `packages/message-broker` files (`interfaces.ts`, `adapters/bullmq/job-handle.ts`, `tests/job-handle.test.ts`), plus the `moveToDelayed` stub added to `createSyntheticJobHandle` in `ticket-creation-outbox.worker.ts` to keep that file compiling against the widened interface. No schema change, no migration, no config change. Jobs already sitting in the BullMQ delayed set at rollback time drain normally under the reverted code, since `moveToDelayed` uses the standard BullMQ delayed queue mechanism.
