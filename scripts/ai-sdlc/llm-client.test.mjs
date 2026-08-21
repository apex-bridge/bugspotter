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
import { writeFileSync, mkdtempSync, rmSync, chmodSync, readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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
    // Writes one real NDJSON thinking_tokens event (so callViaCli's line
    // parser has something to pick up), then a partial/unparseable trailing
    // envelope and never finishes — the parent's timeout path fires with
    // both a known thinking-token count AND raw undecodable bytes already
    // buffered. `return` is legal here: CommonJS wraps the module body in a
    // function.
    "if (mode === 'hang') {",
    "  process.stdout.write(JSON.stringify({ type: 'system', subtype: 'thinking_tokens', estimated_tokens: 42 }) + '\\n');",
    "  process.stdout.write(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'FAKE_VISIBLE_TEXT: drafting the spec' }] } }) + '\\n');",
    "  process.stdout.write('PARTIAL_ENVELOPE_MARKER');",
    "  process.stderr.write('FAKE_STDERR_PROGRESS');",
    '  setTimeout(function () { process.exit(0); }, 5000);',
    '  return;',
    '}',
    // Same as 'hang', except the final assistant event is a genuinely
    // *complete* NDJSON record that simply has not been followed by its
    // trailing newline yet when the kill fires - a real, plausible shape
    // for a large content block (the #353 transcripts this PR was built
    // around had single text blocks up to ~77KB, arriving across several
    // stdout chunks) whose closing '\\n' just hasn't landed by the time the
    // timeout timer fires. consumeLine only runs on '\\n'-delimited slices
    // as data arrives, so this line is deliberately left sitting in
    // callViaCli's internal lineBuf, unconsumed, unless the timeout path
    // flushes it the same way the close handler already does.
    "if (mode === 'hang_no_trailing_newline') {",
    "  process.stdout.write(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'FAKE_UNFLUSHED_TEXT: no trailing newline yet' }] } }));",
    '  setTimeout(function () { process.exit(0); }, 5000);',
    '  return;',
    '}',
    "if (mode === 'error') {",
    "  process.stdout.write('FAKE_STDOUT_MARKER: upstream billing failure detail');",
    '  process.exit(2);',
    '}',
    // stream-json shape: one or more NDJSON lines, the terminal one typed
    // "result" — mirrors the real CLI's `--output-format stream-json` output.
    "process.stdout.write(JSON.stringify({ type: 'system', subtype: 'thinking_tokens', estimated_tokens: 7 }) + '\\n');",
    "process.stdout.write(JSON.stringify({ type: 'result', result: 'fake cli response', stop_reason: 'end_turn' }) + '\\n');",
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

const { callClaude, logCliTelemetry, formatCliTimeout, formatCliProgress } = await import(
  './llm-client.mjs'
);

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

test('logCliTelemetry surfaces ttft and the thinking/output token split when present', () => {
  const { lines, logger } = captureLog();

  logCliTelemetry(
    {
      num_turns: 1,
      duration_ms: 337_000,
      ttft_ms: 198_642,
      usage: { output_tokens: 23_209, output_tokens_details: { thinking_tokens: 12_954 } },
    },
    logger
  );

  assert.equal(lines.log.length, 1);
  assert.match(lines.log[0], /ttft=199s/);
  assert.match(lines.log[0], /out=23209/);
  assert.match(lines.log[0], /thinking=12954/);
});

test('logCliTelemetry omits ttft/thinking fields when the envelope lacks them', () => {
  const { lines, logger } = captureLog();

  logCliTelemetry({ num_turns: 1, duration_ms: 1000, usage: { output_tokens: 4 } }, logger);

  assert.doesNotMatch(lines.log[0], /ttft=/);
  assert.doesNotMatch(lines.log[0], /thinking=/);
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

test('formatCliTimeout reports byte counts and says so explicitly when the child wrote nothing', () => {
  const message = formatCliTimeout({ timeoutMs: 780_000, elapsedMs: 780_142 });

  // The historical prefix must survive: it is how every timeout so far has
  // been identified in run logs.
  assert.match(message, /^claude CLI timed out after 780000ms/);
  assert.match(message, /killed at 780s/);
  assert.match(message, /stdout 0B, stderr 0B/);
  // The distinction the whole diagnostic exists to draw.
  assert.match(message, /wrote nothing at all/);
  assert.match(message, /stalled or still-working call/);
});

test('formatCliTimeout includes the tails when the child did write something', () => {
  const message = formatCliTimeout({
    timeoutMs: 5000,
    stdout: '{"result":"partial',
    stderr: 'progress: thinking',
  });

  assert.match(message, /stdout 18B, stderr 18B/);
  assert.match(message, /\{"result":"partial/);
  assert.match(message, /progress: thinking/);
  // The empty-output explanation must NOT appear when output exists.
  assert.doesNotMatch(message, /wrote nothing at all/);
});

test('formatCliTimeout clips long output so an Error message cannot flood a CI log', () => {
  const huge = 'x'.repeat(50_000);
  const message = formatCliTimeout({ timeoutMs: 5000, stdout: huge, tailChars: 100 });

  assert.match(message, /stdout 50000B/, 'the true size must still be reported');
  assert.match(message, /last 100 chars of 50000/);
  assert.ok(message.length < 1000, `expected a clipped message, got ${message.length} chars`);
});

test('formatCliTimeout counts UTF-8 bytes, not UTF-16 code units', () => {
  // '😀' is one code point, String#length 2, and 4 bytes on the wire. Reporting
  // 2 under a "B" label under-reports what the child actually wrote — and the
  // clipping line must stay in its own unit rather than silently mixing the two.
  const message = formatCliTimeout({ timeoutMs: 5000, stdout: '😀', stderr: 'café' });

  assert.match(message, /stdout 4B/);
  assert.match(message, /stderr 5B/, "'café' is 4 code units but 5 UTF-8 bytes");
  assert.doesNotMatch(message, /stdout 2B/);
});

test('formatCliProgress reports elapsed time and bytes received so far', () => {
  const line = formatCliProgress({ elapsedMs: 120_000, stdoutBytes: 0, stderrBytes: 42 });

  assert.match(line, /still running after 120s/);
  assert.match(line, /stdout 0B, stderr 42B/);
});

test('formatCliProgress includes the thinking-token count when known', () => {
  const withTokens = formatCliProgress({
    elapsedMs: 60_000,
    stdoutBytes: 500,
    stderrBytes: 0,
    thinkingTokens: 1200,
  });
  assert.match(withTokens, /~1200 thinking tokens so far/);

  // Not vacuous: the field must actually be omittable, not just non-throwing.
  const withoutTokens = formatCliProgress({ elapsedMs: 60_000, stdoutBytes: 0, stderrBytes: 0 });
  assert.doesNotMatch(withoutTokens, /thinking tokens/);
});

test('formatCliTimeout reports the last known thinking-token count when present', () => {
  const message = formatCliTimeout({
    timeoutMs: 780_000,
    elapsedMs: 780_050,
    stdout: '{"type":"system","subtype":"thinking_tokens","estimated_tokens":900}\n',
    thinkingTokens: 900,
  });

  assert.match(message, /last known thinking-token count: ~900/);
  assert.match(message, /thinking progress was observed before termination/);
});

test('formatCliTimeout omits the thinking-token line when none arrived', () => {
  const message = formatCliTimeout({ timeoutMs: 780_000, elapsedMs: 780_050 });
  assert.doesNotMatch(message, /thinking-token count/);
});

test('formatCliTimeout includes the visible-text tail, separate from the raw stdout tail', () => {
  const message = formatCliTimeout({
    timeoutMs: 420_000,
    elapsedMs: 420_030,
    stdout:
      '{"type":"assistant","message":{"content":[{"type":"text","text":"I will read the files."}]}}\n',
    visibleText: 'I will read the files.',
  });

  assert.match(message, /last visible assistant text/);
  assert.match(message, /I will read the files\./);
  // Must appear as its own labeled section, not just incidentally present
  // because it also happens to be inside the raw stdout tail.
  assert.match(message, /last visible assistant text[\s\S]*I will read the files\./);
});

test('formatCliTimeout omits the visible-text section when nothing was extracted', () => {
  const message = formatCliTimeout({ timeoutMs: 780_000, elapsedMs: 780_050, stdout: 'raw bytes' });
  assert.doesNotMatch(message, /last visible assistant text/);
});

test('formatCliTimeout clips the visible-text tail independently of the raw stdout tail length', () => {
  const longText = 'y'.repeat(5000);
  const message = formatCliTimeout({
    timeoutMs: 5000,
    stdout: 'short',
    visibleText: longText,
    tailChars: 100,
  });

  assert.match(message, /last visible assistant text \(last 100 chars of 5000\)/);
  assert.ok(
    !message.includes(longText),
    'the full 5000-char text must not appear verbatim, only its clipped tail'
  );
});

test('formatCliProgress includes a short visible-text snippet when known', () => {
  const line = formatCliProgress({
    elapsedMs: 60_000,
    stdoutBytes: 500,
    stderrBytes: 0,
    visibleText: 'I will read the relevant source files before drafting the spec.',
  });

  assert.match(
    line,
    /last text: "I will read the relevant source files before drafting the spec\."/
  );
});

test('formatCliProgress clips a long visible-text snippet to a short tail', () => {
  const longText = `${'a'.repeat(200)}TAIL_MARKER`;
  const line = formatCliProgress({
    elapsedMs: 60_000,
    stdoutBytes: 500,
    stderrBytes: 0,
    visibleText: longText,
    visibleTextTailChars: 20,
  });

  assert.match(line, /last text: "…\w*TAIL_MARKER"/);
  assert.ok(
    !line.includes('a'.repeat(50)),
    'expected the snippet clipped, not the full 200-char run'
  );
});

test('formatCliProgress omits the visible-text field entirely when none was seen yet', () => {
  const line = formatCliProgress({ elapsedMs: 60_000, stdoutBytes: 0, stderrBytes: 0 });
  assert.doesNotMatch(line, /last text/);
});

test('formatCliProgress safely escapes a visible-text snippet that itself contains double quotes', () => {
  // Real transcripts (#353, 2026-08-18 timeouts) show the model's "text"
  // content routinely contains literal `"` - e.g. `<invoke name="Bash">` -
  // since --tools= makes it narrate would-be tool calls as plain text
  // instead of issuing real tool_use blocks. A naive `"${snippet}"` wrap
  // would let that embedded quote visually close the string early.
  const line = formatCliProgress({
    elapsedMs: 60_000,
    stdoutBytes: 500,
    stderrBytes: 0,
    visibleText: '<invoke name="Bash"><parameter name="command">echo hi</parameter></invoke>',
  });

  // The embedded quotes must come through escaped, not as a bare `"` that
  // prematurely ends the `last text: "..."` quoting.
  assert.match(line, /last text: "<invoke name=\\"Bash\\">/);
  // The line must still end with a single closing quote for the whole
  // snippet, not one left dangling mid-string by an unescaped `"`.
  assert.ok(line.endsWith('</invoke>"'), `expected a cleanly closed quoted string, got: ${line}`);
});

test('callViaCli timeout error carries what the child actually wrote before the kill', async () => {
  process.env.FAKE_CLAUDE_MODE = 'hang';
  process.env.FAKE_CLAUDE_ENV_DUMP = '';

  // Proves the forensics reach the real rejection path, not just the pure
  // formatter: without them this error message is the bare one-liner that
  // made impl-agent runs 30761885485 and 31039877104 undiagnosable. The
  // thinking-token assertion proves callViaCli's own NDJSON line parser
  // (not just formatCliTimeout in isolation) picked up the real event the
  // fake CLI streamed before hanging.
  await assert.rejects(callClaude({ prompt: 'hi', maxTokens: 100, timeoutMs: 2500 }), (err) => {
    assert.match(err.message, /claude CLI timed out after 2500ms/);
    assert.match(err.message, /received: stdout \d+B, stderr \d+B/);
    assert.match(err.message, /PARTIAL_ENVELOPE_MARKER/);
    assert.match(err.message, /last known thinking-token count: ~42/);
    // Proves callViaCli's own consumeLine (not just formatCliTimeout in
    // isolation) actually parses the assistant event's text content block
    // out of the real NDJSON stream and carries it through to the
    // rejection - the whole point of this addition, since the raw stdout
    // tail alone (PARTIAL_ENVELOPE_MARKER, asserted above) is not
    // human-readable prose.
    assert.match(err.message, /last visible assistant text/);
    assert.match(err.message, /FAKE_VISIBLE_TEXT: drafting the spec/);
    assert.doesNotMatch(err.message, /wrote nothing at all/);
    return true;
  });
});

test('callViaCli flushes a complete-but-not-yet-newline-terminated NDJSON record before timing out', async () => {
  // CodeRabbit finding on PR #361: the close handler flushes a trailing
  // unterminated line from lineBuf (`if (lineBuf.trim()) consumeLine(lineBuf)`)
  // but, before this fix, the timeout path did not - it killed the child
  // and built the error straight from lastThinkingTokens/latestVisibleText
  // as last updated by the 'data' handler, silently dropping any complete
  // record still sitting in lineBuf without its trailing '\n'. That is a
  // real, plausible race for a large content block (real #353 transcripts
  // had single text blocks up to ~77KB spanning several stdout chunks)
  // whose closing newline just hasn't arrived by the moment the timer
  // fires - exactly the case this diagnostic exists to cover.
  process.env.FAKE_CLAUDE_MODE = 'hang_no_trailing_newline';
  process.env.FAKE_CLAUDE_ENV_DUMP = '';

  await assert.rejects(callClaude({ prompt: 'hi', maxTokens: 100, timeoutMs: 2500 }), (err) => {
    assert.match(err.message, /claude CLI timed out after 2500ms/);
    assert.match(err.message, /last visible assistant text/);
    assert.match(err.message, /FAKE_UNFLUSHED_TEXT: no trailing newline yet/);
    return true;
  });
});

test('callViaCli writes the full raw stdout/stderr to AI_SDLC_CLI_TRANSCRIPT_PATH on a timeout', async () => {
  // formatCliTimeout's tail is clipped to keep a CI log readable, which is
  // exactly what makes a real post-mortem impossible (2026-08-14, impl-agent
  // issue #227: the thinking-token count jumped ~1690 -> ~21857 in the final
  // 60s and the clipped tail alone couldn't say why). This is the escape
  // hatch: the full stream, not a fragment.
  const transcriptPath = join(DIR, 'transcript-timeout.txt');
  process.env.FAKE_CLAUDE_MODE = 'hang';
  process.env.FAKE_CLAUDE_ENV_DUMP = '';
  process.env.AI_SDLC_CLI_TRANSCRIPT_PATH = transcriptPath;

  try {
    await assert.rejects(callClaude({ prompt: 'hi', maxTokens: 100, timeoutMs: 2500 }));

    const transcript = readFileSync(transcriptPath, 'utf8');
    // Full content, not the 1500-char-tail-clipped version formatCliTimeout
    // puts in the Error message.
    assert.match(transcript, /PARTIAL_ENVELOPE_MARKER/);
    assert.match(transcript, /FAKE_STDERR_PROGRESS/);
    assert.match(transcript, /=== stdout \(\d+ bytes, raw NDJSON stream\) ===/);
    assert.match(transcript, /=== stderr \(\d+ bytes\) ===/);
  } finally {
    delete process.env.AI_SDLC_CLI_TRANSCRIPT_PATH;
  }
});

test('callViaCli writes a transcript on a non-zero exit too, not just a timeout', async () => {
  const transcriptPath = join(DIR, 'transcript-error.txt');
  process.env.FAKE_CLAUDE_MODE = 'error';
  process.env.FAKE_CLAUDE_ENV_DUMP = '';
  process.env.AI_SDLC_CLI_TRANSCRIPT_PATH = transcriptPath;

  try {
    await assert.rejects(callClaude({ prompt: 'hi', maxTokens: 100, timeoutMs: 10000 }));

    const transcript = readFileSync(transcriptPath, 'utf8');
    assert.match(transcript, /FAKE_STDOUT_MARKER: upstream billing failure detail/);
  } finally {
    delete process.env.AI_SDLC_CLI_TRANSCRIPT_PATH;
  }
});

test('callViaCli never writes a transcript on success, even when AI_SDLC_CLI_TRANSCRIPT_PATH is set', async () => {
  // A successful call needs no forensics — dumping every run's full stream
  // would make the artifact noise instead of signal.
  const transcriptPath = join(DIR, 'transcript-success.txt');
  process.env.FAKE_CLAUDE_MODE = 'success';
  process.env.FAKE_CLAUDE_ENV_DUMP = '';
  process.env.AI_SDLC_CLI_TRANSCRIPT_PATH = transcriptPath;

  try {
    await callClaude({ prompt: 'hi', maxTokens: 100, timeoutMs: 10000 });
    assert.equal(existsSync(transcriptPath), false);
  } finally {
    delete process.env.AI_SDLC_CLI_TRANSCRIPT_PATH;
  }
});

test('callViaCli writes no transcript file when AI_SDLC_CLI_TRANSCRIPT_PATH is unset, even on failure', async () => {
  const transcriptPath = join(DIR, 'transcript-unset.txt');
  process.env.FAKE_CLAUDE_MODE = 'error';
  process.env.FAKE_CLAUDE_ENV_DUMP = '';
  delete process.env.AI_SDLC_CLI_TRANSCRIPT_PATH;

  await assert.rejects(callClaude({ prompt: 'hi', maxTokens: 100, timeoutMs: 10000 }));
  assert.equal(existsSync(transcriptPath), false);
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
      'stream-json',
      '--verbose',
      '--model',
      'claude-sonnet-5',
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
    assert.equal(requests[0].body.model, 'claude-sonnet-5');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// --- maxTokens visibility on the CLI backend (#313) ---
//
// All four generators pass a maxTokens they believe bounds the response, and
// callViaCli cannot honour it. Dropping it silently is how generate-impl.mjs
// came to reason about a "16384 cap" that was never in force, and how a run
// emitting 50,304 output tokens against that nominal cap did not look
// anomalous (#296). These assert the drop is announced, and only when it
// actually happens.

async function captureWarnings(fn) {
  const original = console.warn;
  const seen = [];
  console.warn = (...args) => seen.push(args.join(' '));
  try {
    await fn();
  } finally {
    console.warn = original;
  }
  return seen;
}

test('callClaude warns that maxTokens is ignored on the CLI backend', async () => {
  process.env.FAKE_CLAUDE_MODE = 'success';

  const warnings = await captureWarnings(() =>
    callClaude({ prompt: 'hi', maxTokens: 16384, timeoutMs: 10000 })
  );

  const hit = warnings.find((w) => w.includes('maxTokens'));
  assert.ok(hit, 'a silently-dropped parameter must say so');
  assert.match(hit, /16384/, 'the warning names the value that was discarded');
  assert.match(hit, /ignored/);
  assert.match(hit, /LLM_BACKEND=cli/);
  // Not "unbounded": generate-impl.mjs's truncation guard tells the reader the
  // response hit the model's own limit, and a warning claiming no limit exists
  // would contradict it. Two places, one fact.
  assert.doesNotMatch(hit, /unbounded/);
  assert.match(hit, /model's own output limit still applies/);
});

test('callClaude stays quiet when no maxTokens was passed', async () => {
  // Not vacuous: without this the warning could be unconditional, which would
  // train the reader to ignore it.
  process.env.FAKE_CLAUDE_MODE = 'success';

  const warnings = await captureWarnings(() => callClaude({ prompt: 'hi', timeoutMs: 10000 }));

  assert.equal(
    warnings.filter((w) => w.includes('maxTokens')).length,
    0,
    'nothing was dropped, so there is nothing to report'
  );
});

// --- LLM_DEFAULT_MODEL override (CLI_MODEL) --------------------------------
//
// CLI_MODEL is computed once at module-load time from process.env, same as
// LLM_BACKEND above - so unlike every other test in this file, which shares
// the ONE dynamic import() at the top (LLM_DEFAULT_MODEL deliberately left
// unset there, so the 35 tests above keep asserting the plain default), this
// needs a genuinely fresh process with the env var already set before
// llm-client.mjs is ever imported. A subprocess, not a second in-process
// import - Node's ESM loader caches by resolved specifier, so re-importing
// the same file in-process would just return the already-evaluated module.
// pathToFileURL, not a raw path: dynamic import() requires a valid URL
// scheme, and a bare Windows path ('C:\...') isn't one.
const LLM_CLIENT_URL = pathToFileURL(
  join(dirname(fileURLToPath(import.meta.url)), 'llm-client.mjs')
).href;

/** Runs a fresh `node` process that calls callClaude() once and returns the argv the fake claude received. */
function runInSubprocess(envOverrides) {
  const scriptPath = join(DIR, `model-override-check-${Date.now()}-${Math.random()}.mjs`);
  const dumpPath = join(DIR, `model-override-argv-${Date.now()}-${Math.random()}.json`);
  writeFileSync(
    scriptPath,
    [
      `const { callClaude } = await import(${JSON.stringify(LLM_CLIENT_URL)});`,
      `await callClaude({ prompt: 'hi', maxTokens: 100, timeoutMs: 10000 });`,
      '',
    ].join('\n')
  );

  // Clean slate for LLM_DEFAULT_MODEL specifically: the parent test-runner
  // process must not leak its own value (there shouldn't be one, but the
  // "unset" test below needs that guaranteed, not assumed) into a child
  // whose whole point is proving what happens when it truly is unset.
  const env = { ...process.env };
  delete env.LLM_DEFAULT_MODEL;

  const result = spawnSync(process.execPath, [scriptPath], {
    encoding: 'utf8',
    env: {
      ...env,
      ...envOverrides,
      LLM_BACKEND: 'cli',
      CLAUDE_CODE_OAUTH_TOKEN: 'test-oauth-token',
      PATH: `${DIR}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH}`,
      FAKE_CLAUDE_MODE: 'success',
      FAKE_CLAUDE_ARGV_DUMP: dumpPath,
    },
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(readFileSync(dumpPath, 'utf8'));
}

test('LLM_DEFAULT_MODEL overrides CLI_MODEL, verified via a fresh process', () => {
  const argv = runInSubprocess({ LLM_DEFAULT_MODEL: 'claude-custom-test-model' });
  const modelIdx = argv.indexOf('--model');
  assert.notEqual(modelIdx, -1);
  assert.equal(argv[modelIdx + 1], 'claude-custom-test-model');
});

test('LLM_DEFAULT_MODEL unset falls back to the hardcoded default, verified via a fresh process', () => {
  const argv = runInSubprocess({});
  const modelIdx = argv.indexOf('--model');
  assert.notEqual(modelIdx, -1);
  assert.equal(argv[modelIdx + 1], 'claude-sonnet-5');
});
