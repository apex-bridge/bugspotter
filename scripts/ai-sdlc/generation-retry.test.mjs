// Tests for generation-retry.mjs's three shared primitives - see that
// file's header for why they were extracted (#402/#403/#404). Unlike
// generate-spec.test.mjs/generate-adr.test.mjs/generate-impl.test.mjs (which
// spawn the real top-level scripts as subprocesses, since those files have no
// exports), this module has real exports and is tested directly, in-process.
//
// Zero-dependency, run with `node --test`.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  parsePositiveMs,
  computeRemainingBudgetMs,
  runWithCorrectiveRetry,
} from './generation-retry.mjs';

describe('parsePositiveMs', () => {
  test('parses a valid numeric string', () => {
    assert.equal(parsePositiveMs('5000', 1000), 5000);
  });

  test('parses zero as a valid value, not a falsy fallback trigger', () => {
    assert.equal(parsePositiveMs('0', 1000), 0);
  });

  test('falls back on undefined (env var genuinely unset)', () => {
    assert.equal(parsePositiveMs(undefined, 1234), 1234);
  });

  test('falls back on an empty string rather than treating it as 0', () => {
    // GitHub Actions resolves an unconfigured `vars.*` reference to an empty
    // string, not an unset env var - Number('') is 0, not NaN, so this must
    // be caught explicitly rather than relying on Number()'s own coercion.
    assert.equal(parsePositiveMs('', 1234), 1234);
  });

  test('falls back on a whitespace-only string', () => {
    assert.equal(parsePositiveMs('   ', 1234), 1234);
  });

  test('trims surrounding whitespace on an otherwise-valid value', () => {
    assert.equal(parsePositiveMs('  2500  ', 1000), 2500);
  });

  test('falls back on a negative number', () => {
    assert.equal(parsePositiveMs('-100', 1234), 1234);
  });

  test('falls back on a non-numeric string', () => {
    assert.equal(parsePositiveMs('not-a-number', 1234), 1234);
  });

  test('falls back on NaN/Infinity-producing input', () => {
    assert.equal(parsePositiveMs('Infinity', 1234), 1234);
  });
});

describe('computeRemainingBudgetMs', () => {
  test('subtracts the safety buffer and elapsed time from the step budget', () => {
    const before = Date.now();
    const scriptStartedAt = before - 10_000; // 10s elapsed
    const remaining = computeRemainingBudgetMs({
      stepBudgetMs: 60_000,
      safetyBufferMs: 5_000,
      scriptStartedAt,
    });
    const after = Date.now();
    // remaining = 60_000 - 5_000 - (Date.now() - scriptStartedAt), and the
    // function's own Date.now() call landed somewhere in [before, after].
    // Deriving the expected bounds from that *measured* window - rather than
    // assuming the call is instantaneous, or padding a fixed guess with
    // extra slack - makes this exact regardless of scheduler jitter, instead
    // of merely less likely to hit an arbitrary threshold under CI load.
    const maxRemaining = 60_000 - 5_000 - (before - scriptStartedAt); // == 45_000
    const minRemaining = 60_000 - 5_000 - (after - scriptStartedAt);
    assert.ok(
      remaining <= maxRemaining && remaining >= minRemaining,
      `expected remaining in [${minRemaining}, ${maxRemaining}], got ${remaining}`
    );
  });

  test('can go negative when elapsed time plus buffer exceed the budget', () => {
    const scriptStartedAt = Date.now() - 100_000;
    const remaining = computeRemainingBudgetMs({
      stepBudgetMs: 60_000,
      safetyBufferMs: 5_000,
      scriptStartedAt,
    });
    assert.ok(remaining < 0, `expected a negative remainder, got ${remaining}`);
  });

  test('returns exactly stepBudgetMs - safetyBufferMs when scriptStartedAt is now', () => {
    const before = Date.now();
    const scriptStartedAt = before;
    const remaining = computeRemainingBudgetMs({
      stepBudgetMs: 60_000,
      safetyBufferMs: 5_000,
      scriptStartedAt,
    });
    const after = Date.now();
    // Same reasoning as the test above: bound against the real elapsed
    // window around the call (before/after), not a fixed ms guess, so this
    // can't flake under scheduler jitter. Equality with the 55_000 upper
    // bound holds only if the internal Date.now() call lands in the same
    // millisecond as `before`.
    const maxRemaining = 60_000 - 5_000 - (before - scriptStartedAt); // == 55_000
    const minRemaining = 60_000 - 5_000 - (after - scriptStartedAt);
    assert.ok(
      remaining <= maxRemaining && remaining >= minRemaining,
      `expected remaining in [${minRemaining}, ${maxRemaining}], got ${remaining}`
    );
  });
});

describe('runWithCorrectiveRetry - budget gate', () => {
  test('does not call callFn or buildPrompt when remainingMs is below retryMinBudgetMs', async () => {
    let callFnInvoked = false;
    let buildPromptInvoked = false;
    let noBudgetArg;
    const result = await runWithCorrectiveRetry({
      remainingMs: 500,
      retryMinBudgetMs: 1000,
      maxTimeoutMs: 60_000,
      buildPrompt: () => {
        buildPromptInvoked = true;
        return 'prompt';
      },
      callFn: async () => {
        callFnInvoked = true;
        return { text: 'x', stopReason: 'end_turn' };
      },
      onNoBudget: (remaining) => {
        noBudgetArg = remaining;
      },
    });
    assert.equal(callFnInvoked, false, 'callFn must not fire without enough budget');
    assert.equal(buildPromptInvoked, false, 'buildPrompt must not fire without enough budget');
    assert.equal(noBudgetArg, 500);
    assert.deepEqual(result, { attempted: false, ok: false });
  });

  test('treats remainingMs exactly equal to retryMinBudgetMs as sufficient (boundary is inclusive)', async () => {
    let callFnInvoked = false;
    const result = await runWithCorrectiveRetry({
      remainingMs: 1000,
      retryMinBudgetMs: 1000,
      maxTimeoutMs: 60_000,
      buildPrompt: () => 'prompt',
      callFn: async () => {
        callFnInvoked = true;
        return { text: 'ok', stopReason: 'end_turn' };
      },
    });
    assert.equal(callFnInvoked, true, 'exactly-at-floor budget should still attempt the call');
    assert.equal(result.attempted, true);
    assert.equal(result.ok, true);
  });

  test('treats remainingMs one below retryMinBudgetMs as insufficient', async () => {
    let callFnInvoked = false;
    const result = await runWithCorrectiveRetry({
      remainingMs: 999,
      retryMinBudgetMs: 1000,
      maxTimeoutMs: 60_000,
      buildPrompt: () => 'prompt',
      callFn: async () => {
        callFnInvoked = true;
        return { text: 'ok', stopReason: 'end_turn' };
      },
    });
    assert.equal(callFnInvoked, false);
    assert.equal(result.attempted, false);
  });

  test('a negative remainingMs is treated as insufficient, not coerced to zero', async () => {
    let callFnInvoked = false;
    const result = await runWithCorrectiveRetry({
      remainingMs: -5000,
      retryMinBudgetMs: 1000,
      maxTimeoutMs: 60_000,
      buildPrompt: () => 'prompt',
      callFn: async () => {
        callFnInvoked = true;
        return { text: 'ok', stopReason: 'end_turn' };
      },
    });
    assert.equal(callFnInvoked, false);
    assert.equal(result.attempted, false);
  });
});

describe('runWithCorrectiveRetry - timeout clamp', () => {
  test('clamps the call timeout to remainingMs when it is below maxTimeoutMs', async () => {
    let seenTimeout;
    await runWithCorrectiveRetry({
      remainingMs: 5_000,
      retryMinBudgetMs: 1000,
      maxTimeoutMs: 60_000,
      buildPrompt: () => 'prompt',
      callFn: async (prompt, timeoutMs) => {
        seenTimeout = timeoutMs;
        return { text: 'ok', stopReason: 'end_turn' };
      },
    });
    assert.equal(seenTimeout, 5_000, 'timeout should clamp down to remainingMs');
  });

  test('clamps the call timeout to maxTimeoutMs when remainingMs exceeds it', async () => {
    let seenTimeout;
    await runWithCorrectiveRetry({
      remainingMs: 500_000,
      retryMinBudgetMs: 1000,
      maxTimeoutMs: 60_000,
      buildPrompt: () => 'prompt',
      callFn: async (prompt, timeoutMs) => {
        seenTimeout = timeoutMs;
        return { text: 'ok', stopReason: 'end_turn' };
      },
    });
    assert.equal(seenTimeout, 60_000, 'timeout should clamp down to maxTimeoutMs');
  });

  test('at the exact boundary (remainingMs === maxTimeoutMs) uses that value with no rounding drift', async () => {
    let seenTimeout;
    await runWithCorrectiveRetry({
      remainingMs: 60_000,
      retryMinBudgetMs: 1000,
      maxTimeoutMs: 60_000,
      buildPrompt: () => 'prompt',
      callFn: async (prompt, timeoutMs) => {
        seenTimeout = timeoutMs;
        return { text: 'ok', stopReason: 'end_turn' };
      },
    });
    assert.equal(seenTimeout, 60_000);
  });

  test('onAttempt receives the same clamped timeout that callFn receives', async () => {
    let attemptTimeout;
    let callFnTimeout;
    await runWithCorrectiveRetry({
      remainingMs: 12_345,
      retryMinBudgetMs: 1000,
      maxTimeoutMs: 60_000,
      buildPrompt: () => 'prompt',
      onAttempt: (timeoutMs) => {
        attemptTimeout = timeoutMs;
      },
      callFn: async (prompt, timeoutMs) => {
        callFnTimeout = timeoutMs;
        return { text: 'ok', stopReason: 'end_turn' };
      },
    });
    assert.equal(attemptTimeout, 12_345);
    assert.equal(callFnTimeout, 12_345);
  });
});

describe('runWithCorrectiveRetry - call outcomes', () => {
  test('passes buildPrompt output through to callFn', async () => {
    let seenPrompt;
    await runWithCorrectiveRetry({
      remainingMs: 10_000,
      retryMinBudgetMs: 1000,
      maxTimeoutMs: 60_000,
      buildPrompt: () => 'the built prompt',
      callFn: async (prompt) => {
        seenPrompt = prompt;
        return { text: 'ok', stopReason: 'end_turn' };
      },
    });
    assert.equal(seenPrompt, 'the built prompt');
  });

  test('onCallError fires and ok:false is returned when callFn throws', async () => {
    let caughtErr;
    let successCalled = false;
    const result = await runWithCorrectiveRetry({
      remainingMs: 10_000,
      retryMinBudgetMs: 1000,
      maxTimeoutMs: 60_000,
      buildPrompt: () => 'prompt',
      callFn: async () => {
        throw new Error('boom');
      },
      onCallError: (err) => {
        caughtErr = err;
      },
      onSuccess: () => {
        successCalled = true;
      },
    });
    assert.equal(caughtErr?.message, 'boom');
    assert.equal(successCalled, false, 'onSuccess must not fire after a call error');
    assert.equal(result.attempted, true);
    assert.equal(result.ok, false);
  });

  test('normalizes a non-Error thrown by callFn (string) into a real Error before onCallError', async () => {
    let caughtErr;
    await runWithCorrectiveRetry({
      remainingMs: 10_000,
      retryMinBudgetMs: 1000,
      maxTimeoutMs: 60_000,
      buildPrompt: () => 'prompt',
      callFn: async () => {
        throw 'plain string failure';
      },
      onCallError: (err) => {
        caughtErr = err;
      },
    });
    assert.ok(caughtErr instanceof Error, 'onCallError must receive an Error instance');
    assert.equal(caughtErr.message, 'plain string failure');
  });

  test('normalizes a non-Error thrown by callFn (plain object with a message) into a real Error before onCallError', async () => {
    let caughtErr;
    await runWithCorrectiveRetry({
      remainingMs: 10_000,
      retryMinBudgetMs: 1000,
      maxTimeoutMs: 60_000,
      buildPrompt: () => 'prompt',
      callFn: async () => {
        throw { code: 'ECONNRESET', message: 'socket hang up' };
      },
      onCallError: (err) => {
        caughtErr = err;
      },
    });
    assert.ok(caughtErr instanceof Error, 'onCallError must receive an Error instance');
    assert.equal(caughtErr.message, 'socket hang up');
  });

  test('normalizes a non-Error thrown by callFn (plain object with no message) into a real Error before onCallError', async () => {
    let caughtErr;
    await runWithCorrectiveRetry({
      remainingMs: 10_000,
      retryMinBudgetMs: 1000,
      maxTimeoutMs: 60_000,
      buildPrompt: () => 'prompt',
      callFn: async () => {
        throw { code: 'ECONNRESET' };
      },
      onCallError: (err) => {
        caughtErr = err;
      },
    });
    assert.ok(caughtErr instanceof Error, 'onCallError must receive an Error instance');
    assert.equal(caughtErr.message, '[object Object]');
  });

  test('onTruncated fires and onSuccess does not when stopReason is max_tokens', async () => {
    let truncatedFired = false;
    let successCalled = false;
    const result = await runWithCorrectiveRetry({
      remainingMs: 10_000,
      retryMinBudgetMs: 1000,
      maxTimeoutMs: 60_000,
      buildPrompt: () => 'prompt',
      callFn: async () => ({ text: 'cut off mid-sen', stopReason: 'max_tokens' }),
      onTruncated: () => {
        truncatedFired = true;
      },
      onSuccess: () => {
        successCalled = true;
      },
    });
    assert.equal(truncatedFired, true);
    assert.equal(successCalled, false, 'onSuccess must not fire for a truncated response');
    assert.equal(result.ok, false);
    assert.equal(result.stopReason, 'max_tokens');
  });

  test('onSuccess fires with the response text and stopReason for a normal completion', async () => {
    let seenText, seenStopReason;
    const result = await runWithCorrectiveRetry({
      remainingMs: 10_000,
      retryMinBudgetMs: 1000,
      maxTimeoutMs: 60_000,
      buildPrompt: () => 'prompt',
      callFn: async () => ({ text: 'real content', stopReason: 'end_turn' }),
      onSuccess: (text, stopReason) => {
        seenText = text;
        seenStopReason = stopReason;
      },
    });
    assert.equal(seenText, 'real content');
    assert.equal(seenStopReason, 'end_turn');
    assert.equal(result.ok, true);
    assert.equal(result.text, 'real content');
  });

  test('missing optional callbacks default to no-ops rather than throwing', async () => {
    // No onNoBudget/onAttempt/onCallError/onTruncated/onSuccess provided at all.
    await assert.doesNotReject(
      runWithCorrectiveRetry({
        remainingMs: 10_000,
        retryMinBudgetMs: 1000,
        maxTimeoutMs: 60_000,
        buildPrompt: () => 'prompt',
        callFn: async () => ({ text: 'ok', stopReason: 'end_turn' }),
      })
    );
    await assert.doesNotReject(
      runWithCorrectiveRetry({
        remainingMs: 100,
        retryMinBudgetMs: 1000,
        maxTimeoutMs: 60_000,
        buildPrompt: () => 'prompt',
        callFn: async () => ({ text: 'ok', stopReason: 'end_turn' }),
      })
    );
  });
});
