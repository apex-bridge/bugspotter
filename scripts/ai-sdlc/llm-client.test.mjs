// Tests for llm-client.mjs's CLI backend (callViaCli, via callClaude).
// Zero-dependency: run with `node --test`.
//
// Rather than mocking node:child_process.spawn, this puts a fake `claude`
// executable ahead of everything else on PATH, so callViaCli's real spawn()
// call resolves to it. That exercises the actual code path end to end:
// - proves ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN are genuinely absent
//   from the *actual* child process env (the fake binary dumps its own
//   process.env to a file — not an env object we merely inspect on the
//   parent side), while other vars (e.g. CLAUDE_CODE_OAUTH_TOKEN) survive.
// - proves a non-zero exit's stdout content lands in the thrown Error
//   message, not just stderr.
//
// Two entrypoints are written because callViaCli spawns with
// shell: process.platform === 'win32' (see llm-client.mjs): POSIX execs
// `claude` directly via its shebang, Windows resolves `claude.cmd` through
// cmd.exe's PATHEXT search. Both delegate to the same CommonJS impl file
// (the temp dir has no package.json, so a bare `claude` script defaults to
// CommonJS as Node's entry-point module system).

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, rmSync, chmodSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DIR = mkdtempSync(join(tmpdir(), 'llm-client-test-'));
const IMPL = join(DIR, 'fake-claude-impl.cjs');
const ENV_DUMP = join(DIR, 'env-dump.json');
const ARGV_DUMP = join(DIR, 'argv-dump.json');

writeFileSync(
  IMPL,
  [
    "const fs = require('node:fs');",
    'const dumpPath = process.env.FAKE_CLAUDE_ENV_DUMP;',
    'if (dumpPath) fs.writeFileSync(dumpPath, JSON.stringify(process.env));',
    'const argvDumpPath = process.env.FAKE_CLAUDE_ARGV_DUMP;',
    // process.argv[0] is the node executable, [1] is the entry script —
    // IMPL on Windows (claude.cmd invokes `node IMPL`), but the POSIX_BIN
    // wrapper on POSIX (its shebang makes it the entry; requiring IMPL from
    // there doesn't change argv). Either way, slice off [0] and [1] so the
    // dump holds only the args callViaCli passed to `claude` itself
    // (['-p', '--output-format', ...]).
    'if (argvDumpPath) fs.writeFileSync(argvDumpPath, JSON.stringify(process.argv.slice(2)));',
    "const mode = process.env.FAKE_CLAUDE_MODE || 'success';",
    "if (mode === 'error') {",
    "  process.stdout.write('FAKE_STDOUT_MARKER: upstream billing failure detail');",
    '  process.exit(2);',
    '}',
    "process.stdout.write(JSON.stringify({ result: 'fake cli response', stop_reason: 'end_turn' }));",
    'process.exit(0);',
    '',
  ].join('\n')
);

const POSIX_BIN = join(DIR, 'claude');
writeFileSync(POSIX_BIN, `#!/usr/bin/env node\nrequire(${JSON.stringify(IMPL)});\n`);
chmodSync(POSIX_BIN, 0o755);

const WIN_BIN = join(DIR, 'claude.cmd');
writeFileSync(WIN_BIN, `@echo off\r\nnode "${IMPL}" %*\r\n`);

after(() => rmSync(DIR, { recursive: true, force: true }));

// LLM_BACKEND is read at module-load time in llm-client.mjs, so it must be
// set before the dynamic import below.
process.env.LLM_BACKEND = 'cli';
process.env.CLAUDE_CODE_OAUTH_TOKEN = 'test-oauth-token';
process.env.PATH = `${DIR}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH}`;

const { callClaude, logCliTelemetry } = await import('./llm-client.mjs');

// Collects what logCliTelemetry emits so the assertions below read the real
// output rather than trusting the function was called.
function captureLog() {
  const lines = { log: [], warn: [] };
  return {
    lines,
    logger: {
      log: (m) => lines.log.push(m),
      warn: (m) => lines.warn.push(m),
    },
  };
}

test('logCliTelemetry surfaces turns, wall time, tokens and cost from the CLI envelope', () => {
  const { lines, logger } = captureLog();

  logCliTelemetry(
    {
      num_turns: 1,
      duration_ms: 474_000,
      duration_api_ms: 470_500,
      usage: { input_tokens: 21_400, output_tokens: 6594 },
      total_cost_usd: 0.1234,
    },
    logger
  );

  assert.equal(lines.log.length, 1);
  assert.match(lines.log[0], /turns=1/);
  assert.match(lines.log[0], /wall=474s/);
  assert.match(lines.log[0], /api=471s/);
  assert.match(lines.log[0], /in=21400/);
  assert.match(lines.log[0], /out=6594/);
  assert.match(lines.log[0], /cost=\$0\.1234/);
  assert.equal(lines.warn.length, 0, 'a single-turn call must not warn');
});

test('logCliTelemetry warns when the CLI reports more than one turn despite --tools=', () => {
  const { lines, logger } = captureLog();

  logCliTelemetry({ num_turns: 50, duration_ms: 330_000 }, logger);

  assert.equal(lines.warn.length, 1);
  assert.match(lines.warn[0], /50 turns/);
  assert.match(lines.warn[0], /--tools=/);
});

test('logCliTelemetry tolerates an envelope carrying no telemetry fields', () => {
  const { lines, logger } = captureLog();

  // The CLI's JSON shape is not a contract this repo controls. Telemetry must
  // never throw and fail a run that already produced a usable result.
  assert.doesNotThrow(() => logCliTelemetry({ result: 'ok' }, logger));
  assert.doesNotThrow(() => logCliTelemetry(undefined, logger));

  assert.equal(lines.warn.length, 0);
  for (const line of lines.log) {
    assert.match(line, /no telemetry fields/);
  }
});

test('callViaCli strips ANTHROPIC_API_KEY/ANTHROPIC_AUTH_TOKEN from the spawned child env, keeps other vars', async () => {
  process.env.ANTHROPIC_API_KEY = 'sk-ant-leaked-key';
  process.env.ANTHROPIC_AUTH_TOKEN = 'leaked-auth-token';
  process.env.FAKE_CLAUDE_MODE = 'success';
  process.env.FAKE_CLAUDE_ENV_DUMP = ENV_DUMP;

  try {
    const result = await callClaude({ prompt: 'hi', maxTokens: 100, timeoutMs: 10000 });
    assert.equal(result.text, 'fake cli response');
    assert.equal(result.stopReason, 'end_turn');

    const childEnv = JSON.parse(readFileSync(ENV_DUMP, 'utf8'));
    assert.equal(
      childEnv.ANTHROPIC_API_KEY,
      undefined,
      'ANTHROPIC_API_KEY must not reach the child'
    );
    assert.equal(
      childEnv.ANTHROPIC_AUTH_TOKEN,
      undefined,
      'ANTHROPIC_AUTH_TOKEN must not reach the child'
    );
    // Not vacuous: other env vars, including the OAuth token the CLI
    // actually needs, must still be passed through.
    assert.equal(childEnv.CLAUDE_CODE_OAUTH_TOKEN, 'test-oauth-token');
    assert.equal(childEnv.FAKE_CLAUDE_MODE, 'success');
  } finally {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
  }
});

test('callViaCli strips differently-cased ANTHROPIC_API_KEY/ANTHROPIC_AUTH_TOKEN keys too', async () => {
  // { ...process.env } copies keys with whatever casing they happen to
  // have; an exact-case delete would miss a variable set under different
  // casing (e.g. inherited from a case-insensitive OS environment on
  // Windows). Prove the strip is case-insensitive by planting lowercase
  // variants and checking neither casing reaches the child.
  process.env.anthropic_api_key = 'sk-ant-leaked-lowercase-key';
  process.env.Anthropic_Auth_Token = 'leaked-mixed-case-token';
  process.env.FAKE_CLAUDE_MODE = 'success';
  process.env.FAKE_CLAUDE_ENV_DUMP = ENV_DUMP;

  try {
    await callClaude({ prompt: 'hi', maxTokens: 100, timeoutMs: 10000 });

    const childEnv = JSON.parse(readFileSync(ENV_DUMP, 'utf8'));
    assert.equal(
      childEnv.anthropic_api_key,
      undefined,
      'lowercase anthropic_api_key must not reach the child'
    );
    assert.equal(
      childEnv.Anthropic_Auth_Token,
      undefined,
      'mixed-case Anthropic_Auth_Token must not reach the child'
    );
    assert.equal(childEnv.CLAUDE_CODE_OAUTH_TOKEN, 'test-oauth-token');
  } finally {
    delete process.env.anthropic_api_key;
    delete process.env.Anthropic_Auth_Token;
  }
});

test('callViaCli invokes claude with --tools= and --strict-mcp-config, not --allowedTools=', async () => {
  process.env.FAKE_CLAUDE_MODE = 'success';
  process.env.FAKE_CLAUDE_ENV_DUMP = '';
  process.env.FAKE_CLAUDE_ARGV_DUMP = ARGV_DUMP;

  try {
    await callClaude({ prompt: 'hi', maxTokens: 100, timeoutMs: 10000 });

    const argv = JSON.parse(readFileSync(ARGV_DUMP, 'utf8'));
    // Single-token '--tools=' (not a separate '' array element): on Windows,
    // spawn() with shell: true stringifies argv into one command line and a
    // bare '' element gets silently dropped from it (confirmed empirically),
    // which would leave --tools swallowing --strict-mcp-config as its value
    // instead of disabling tools. A single token has nothing to elide.
    assert.deepEqual(argv, [
      '-p',
      '--output-format',
      'json',
      '--model',
      'claude-sonnet-4-6',
      '--tools=',
      '--strict-mcp-config',
    ]);
    // The old, broken flag must be gone: --allowedTools only pre-approves
    // tools for the permission prompt, it does not disable tool availability.
    assert.ok(
      !argv.some((a) => a.startsWith('--allowedTools')),
      'must not pass --allowedTools (does not disable tool availability)'
    );
  } finally {
    delete process.env.FAKE_CLAUDE_ARGV_DUMP;
  }
});

test('callViaCli error path includes stdout content (not just stderr) in the thrown error', async () => {
  process.env.FAKE_CLAUDE_MODE = 'error';
  process.env.FAKE_CLAUDE_ENV_DUMP = '';

  await assert.rejects(callClaude({ prompt: 'hi', maxTokens: 100, timeoutMs: 10000 }), (err) => {
    assert.match(err.message, /FAKE_STDOUT_MARKER: upstream billing failure detail/);
    return true;
  });
});

test('callViaCli forwards a caller-supplied model into --model argv, overriding the CLI default', async () => {
  process.env.FAKE_CLAUDE_MODE = 'success';
  process.env.FAKE_CLAUDE_ENV_DUMP = '';
  process.env.FAKE_CLAUDE_ARGV_DUMP = ARGV_DUMP;

  try {
    // generate-impl.mjs's label-based model router passes `model` through
    // callClaude() to reach the CLI's --model flag on this backend — prove
    // it actually lands there instead of silently falling back to CLI_MODEL.
    await callClaude({ prompt: 'hi', maxTokens: 100, timeoutMs: 10000, model: 'claude-opus-4-8' });

    const argv = JSON.parse(readFileSync(ARGV_DUMP, 'utf8'));
    const modelIndex = argv.indexOf('--model');
    assert.ok(modelIndex !== -1, '--model must be present in argv');
    assert.equal(argv[modelIndex + 1], 'claude-opus-4-8');
  } finally {
    delete process.env.FAKE_CLAUDE_ARGV_DUMP;
  }
});

// --- API backend: model propagation ---
//
// The tests above import llm-client.mjs once with LLM_BACKEND=cli fixed at
// module-load time (LLM_BACKEND is read at import time, not per-call — see
// the comment above the first import). Exercising the API backend in the
// same process needs a second, independently-configured module instance, so
// it's imported here under a cache-busting query string (Node treats
// import specifiers with different query strings as distinct module
// instances, each re-evaluating top-level code — including the
// LLM_BACKEND const — under whatever process.env holds at that moment).
process.env.LLM_BACKEND = 'api';
process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';
const { callClaude: callClaudeApi } = await import('./llm-client.mjs?backend=api');

test("callViaApi forwards a caller-supplied model into the request body's model field", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url, body: JSON.parse(init.body) });
    return new Response(
      JSON.stringify({
        content: [{ type: 'text', text: 'fake api response' }],
        stop_reason: 'end_turn',
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  };

  try {
    const result = await callClaudeApi({
      prompt: 'hi',
      maxTokens: 100,
      timeoutMs: 10000,
      model: 'claude-opus-4-8',
    });
    assert.equal(result.text, 'fake api response');
    assert.equal(requests.length, 1);
    assert.equal(requests[0].body.model, 'claude-opus-4-8');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('callViaApi falls back to the hardcoded default model when none is supplied', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url, body: JSON.parse(init.body) });
    return new Response(
      JSON.stringify({
        content: [{ type: 'text', text: 'fake api response' }],
        stop_reason: 'end_turn',
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  };

  try {
    await callClaudeApi({ prompt: 'hi', maxTokens: 100, timeoutMs: 10000 });
    assert.equal(requests[0].body.model, 'claude-sonnet-4-6');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
