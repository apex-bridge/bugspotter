# Spec: intelligence-worker: honour Retry-After from llm_unavailable when rescheduling jobs

Linked issue: Refs #297
ADR: n/a

**Files touched:**

- `packages/backend/src/queue/workers/intelligence-worker.ts`
- `packages/backend/tests/queue/intelligence-worker.test.ts`

**Blocking prerequisites:** none — `IntelligenceError.retryAfter` was parsed and `llm_unavailable` was excluded from the circuit breaker in #283 (merged).

## Problem

When the intelligence service responds with `llm_unavailable` and a `Retry-After` header, `IntelligenceError.retryAfter` is populated (since #283) but nothing reads it. `intelligence-worker` falls through to BullMQ's standard exponential backoff (5 s, 10 s, 20 s — exhausted in ~35 s), ignoring the server-supplied hint entirely. A `Retry-After: 120` response causes three failed attempts in rapid succession before the job is dead-lettered, precisely when the LLM is most overloaded. The fix is confined to the worker, which is the only caller that can absorb a multi-minute wait; the shared `IntelligenceClient` and all HTTP request-path routes are unaffected.

## Out of scope

- Any change to `IntelligenceClient` or `requestWithRetry` — the parse of `Retry-After` into `IntelligenceError.retryAfter` already landed in #283.
- Any change to `sdk-similar.ts`, `intelligence.ts`, `self-service.ts`, or `admin-intelligence.ts` — request-path routes must continue to fail fast.
- Correcting `src/queue/README.md:387` (stale "1s, 2s, 4s" claim) — valid but a separate PR.
- Changing `MAX_JOB_RETRIES` or `BACKOFF_DELAY` defaults in `queue.config.ts`.

## Constraints

1. BullMQ v5 `job.moveToDelayed(timestamp, token)` requires the worker token. The processor at `intelligence-worker.ts:588` currently receives only `(job)` — widening to `(job, token)` and threading the token through is a prerequisite, not an afterthought.
2. `DelayedError` must be thrown after `moveToDelayed`; throwing any other error consumes an attempt and re-applies exponential backoff, defeating the purpose.
3. The fallback when `err.retryAfter` is absent or zero must be 30 s (matching the minimum the LLM proxy enforces).
4. Non-`llm_unavailable` `IntelligenceError` codes and all other error types must reach the existing error path unchanged.
5. The attempt-accounting behaviour of `moveToDelayed` (whether repeated delays eventually exhaust `job.opts.attempts`) must be explicitly documented in the PR body. The spec does not mandate a specific resolution, but the choice must be deliberate and recorded.
6. Implementation must remain type-safe: `token` is typed `string | undefined` in BullMQ v5; pass it through as-is and let `moveToDelayed` handle the undefined case (it will throw — acceptable, since token is always provided by the framework to a registered processor).

## Acceptance criteria

- [ ] An `llm_unavailable` error with `retryAfter: 45` causes `job.moveToDelayed` to be called with approximately `Date.now() + 45000` and `DelayedError` to be thrown — verified by test case A.
- [ ] An `llm_unavailable` error with `retryAfter` undefined (or zero) causes `job.moveToDelayed` to be called with approximately `Date.now() + 30000` — verified by test case B.
- [ ] A non-`llm_unavailable` `IntelligenceError` (e.g. `server_error`) does not call `moveToDelayed` and propagates normally — verified by test case C.
- [ ] `typecheck` passes with no new errors introduced by the token threading change.

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
    const ms = (err.retryAfter ?? 30) * 1000;
    await job.moveToDelayed(Date.now() + ms, token);
    throw new DelayedError();
  }
  throw err;
}
```

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
  mockClient.analyzeBug.mockRejectedValueOnce(
    Object.assign(new IntelligenceError('LLM unavailable', 'llm_unavailable'), {
      retryAfter,
    })
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
    new IntelligenceError('LLM unavailable', 'llm_unavailable')
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

**Test case C — non-llm_unavailable error does not call moveToDelayed (AC #3):**

```ts
  it('does not call moveToDelayed for non-llm_unavailable errors', async () => {
    mockClient.analyzeBug.mockRejectedValueOnce(
      new IntelligenceError('Service error', 'server_error'),
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
pnpm --filter @bugspotter/backend test:unit
pnpm --filter @bugspotter/backend typecheck
```

Rollback: Revert the diff to `intelligence-worker.ts` and `intelligence-worker.test.ts`. No schema change, no migration, no config change. Jobs already sitting in the BullMQ delayed set at rollback time drain normally under the reverted code, since `moveToDelayed` uses the standard BullMQ delayed queue mechanism.
