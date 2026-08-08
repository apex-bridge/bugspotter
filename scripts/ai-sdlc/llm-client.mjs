// Shared Claude call for ai-sdlc scripts (generate-spec.mjs, verify-spec.mjs).
//
// LLM_BACKEND=api (default) — raw Messages API call, billed per-token,
//   needs ANTHROPIC_API_KEY.
// LLM_BACKEND=cli — routes through the Claude Code CLI so usage draws from a
//   Claude subscription instead of metered API billing, needs
//   CLAUDE_CODE_OAUTH_TOKEN (from `claude setup-token`, requires Pro/Max/
//   Team/Enterprise). Tools are disabled with --tools= (plus
//   --strict-mcp-config to also block MCP tools) so the call is a plain text
//   completion, matching the API path's behavior — without this, Claude
//   Code's normal agentic tool loop would try to explore/edit files.
//   --allowedTools "" does NOT achieve this: it only pre-approves which
//   tools skip the permission prompt, it does not control tool
//   *availability* — read-only tools (Read, Grep, Glob, read-only Bash)
//   still run unprompted regardless of the allow-list, so a CLI call made
//   with --allowedTools "" silently runs a full multi-turn exploration loop
//   instead of a single-shot completion (confirmed empirically: 50 turns,
//   5m30s, vs. 1-2 turns, well under a minute, with --tools=). See
//   callViaCli below for why --tools= (one token) is used instead of the
//   two-token ['--tools', ''] form the CLI's own --help implies.
//   ANTHROPIC_API_KEY/ANTHROPIC_AUTH_TOKEN are deliberately stripped from the
//   CLI subprocess env (see callViaCli) since they outrank the OAuth token
//   in Claude Code's auth precedence and would otherwise silently shadow it.
//
// callClaude({ prompt, maxTokens, timeoutMs, model }) — `model` is optional
//   (defaults to claude-sonnet-4-6 on both backends) and lets a caller like
//   generate-impl.mjs's label-based model router (complexity:high ->
//   claude-opus-4-8, pii-sensitive -> claude-haiku, default -> sonnet)
//   pick a different model per call on either backend.
//   `maxTokens` only takes effect on the API backend (becomes max_tokens in
//   the request body). callViaCli ignores it — `claude --help` has no flag
//   to cap output tokens per call (only --max-budget-usd, a dollar budget,
//   not a token count) — so it cannot be forwarded to the CLI backend.
//   Callers should not assume it bounds CLI-backend output length; both
//   backends still return stopReason, so a truncated response is equally
//   detectable via stopReason === 'max_tokens' regardless of backend.

import { spawn } from 'node:child_process';
import { Buffer } from 'node:buffer';

const LLM_BACKEND = process.env.LLM_BACKEND || 'api';

const CLI_MODEL = 'claude-sonnet-4-6';

export function requireLlmCredentials() {
  if (LLM_BACKEND === 'cli') {
    if (!process.env.CLAUDE_CODE_OAUTH_TOKEN) {
      console.error('Missing CLAUDE_CODE_OAUTH_TOKEN (required when LLM_BACKEND=cli)');
      process.exit(1);
    }
  } else if (!process.env.ANTHROPIC_API_KEY) {
    console.error('Missing ANTHROPIC_API_KEY');
    process.exit(1);
  }
}

async function callViaApi({ prompt, maxTokens, timeoutMs, model }) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify({
      model: model || 'claude-sonnet-4-6',
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) {
    let detail = '';
    try {
      const raw = await res.text();
      try {
        detail = JSON.stringify(JSON.parse(raw), null, 2);
      } catch {
        detail = raw;
      }
    } catch {
      /* body unreadable */
    }
    throw new Error(`Claude API error (${res.status}): ${detail}`);
  }

  const data = await res.json();
  if (data?.content?.[0]?.type !== 'text') {
    throw new Error(`Unexpected API response shape: ${JSON.stringify(data, null, 2)}`);
  }
  return { text: data.content[0].text, stopReason: data.stop_reason };
}

// The CLI's `--output-format json` envelope carries operational fields this
// module used to discard: turn count, wall time, and token usage. Without them
// a slow call is a black box. impl-agent run 30761885485 spent its entire 780s
// timeout on a response the script itself had measured at ~6594 output tokens,
// and nothing in the log could distinguish one slow turn from a multi-turn loop.
//
// `num_turns` is the load-bearing field. callViaCli passes `--tools=` precisely
// to get a single-shot completion; a call reporting more than one turn means
// that flag is not holding and an agentic loop is running, which is a bug with
// a fix rather than latency to wait out. Surfaced as a warning so it cannot be
// missed in a CI log.
//
// Every field is read defensively: the CLI's envelope is not a contract this
// repo controls, and telemetry must never be able to fail a run that produced
// a usable result.
export function logCliTelemetry(data, log = console) {
  const turns = typeof data?.num_turns === 'number' ? data.num_turns : null;
  const parts = [];
  if (turns !== null) {
    parts.push(`turns=${turns}`);
  }
  if (typeof data?.duration_ms === 'number') {
    parts.push(`wall=${Math.round(data.duration_ms / 1000)}s`);
  }
  if (typeof data?.duration_api_ms === 'number') {
    parts.push(`api=${Math.round(data.duration_api_ms / 1000)}s`);
  }
  if (typeof data?.usage?.input_tokens === 'number') {
    parts.push(`in=${data.usage.input_tokens}`);
  }
  if (typeof data?.usage?.output_tokens === 'number') {
    parts.push(`out=${data.usage.output_tokens}`);
  }
  if (typeof data?.total_cost_usd === 'number') {
    parts.push(`cost=$${data.total_cost_usd.toFixed(4)}`);
  }

  log.log(`claude CLI: ${parts.length > 0 ? parts.join(' ') : 'no telemetry fields in response'}`);

  if (turns !== null && turns > 1) {
    log.warn(
      `claude CLI reported ${turns} turns for a call made with --tools=, which should be ` +
        `single-shot. Tool disabling is not holding and this call ran an agentic loop.`
    );
  }
}

// How often callViaCli reports that a call is still in flight. The CLI buffers
// its whole `--output-format json` envelope to the end, so a long call is
// otherwise indistinguishable from a hung one until the timeout fires.
const CLI_HEARTBEAT_MS = 60_000;

// logCliTelemetry only ever runs on the success path — it needs a parsed
// envelope, and a timed-out call never produces one. That left the failure
// mode we most need to explain as the one emitting no diagnostics at all:
// impl-agent runs 30761885485 and 31039877104 both burned the full 780s and
// logged exactly one line, `claude CLI timed out after 780000ms`, discarding
// every byte the child had written.
//
// The byte counts are the load-bearing part, not the tails. `stdout 0B` after
// 780s means the CLI never emitted its envelope — it was still working, or
// wedged, and the timeout is the symptom rather than the cause. Non-zero
// stdout means it produced something we then threw away, which is a parsing
// or size problem instead. Those need opposite fixes, and today's log cannot
// tell them apart.
//
// Tails are bounded because stderr can carry progress spew and this string
// goes into an Error message that lands in a CI log.
export function formatCliTimeout({
  timeoutMs,
  elapsedMs = null,
  stdout = '',
  stderr = '',
  tailChars = 1500,
}) {
  // Keep this exact prefix: it is the string the run logs have been
  // identified by across every timeout so far.
  let message = `claude CLI timed out after ${timeoutMs}ms`;
  if (typeof elapsedMs === 'number') {
    message += ` (killed at ${Math.round(elapsedMs / 1000)}s)`;
  }

  // Real UTF-8 byte counts, not String#length: that counts UTF-16 code units,
  // so any non-ASCII the CLI emits would be under-reported under a "B" label.
  const stdoutBytes = Buffer.byteLength(stdout, 'utf8');
  const stderrBytes = Buffer.byteLength(stderr, 'utf8');

  message += `\n  received: stdout ${stdoutBytes}B, stderr ${stderrBytes}B`;

  if (stdoutBytes === 0 && stderrBytes === 0) {
    message +=
      '\n  the child wrote nothing at all before being killed — it produced no ' +
      'envelope, so this is a stalled or still-working call, not an oversized ' +
      'or malformed response.';
    return message;
  }

  // Clipping is deliberately character-based (slice operates on code units,
  // and cutting a UTF-8 buffer at a byte offset can split a character), so the
  // unit is spelled out to keep it distinct from the byte counts above.
  const tail = (label, text) => {
    if (text.length === 0) {
      return '';
    }
    const clipped = text.length > tailChars;
    return `\n  ${label} tail${clipped ? ` (last ${tailChars} chars of ${text.length})` : ''}:\n${
      clipped ? text.slice(-tailChars) : text
    }`;
  };

  return message + tail('stderr', stderr.trim()) + tail('stdout', stdout.trim());
}

// Emitted every CLI_HEARTBEAT_MS while a call is in flight. Byte counts make
// the difference between "streaming, just slow" and "silent since the first
// second" visible while the run is still happening, instead of only in the
// post-mortem.
export function formatCliProgress({ elapsedMs, stdoutBytes, stderrBytes }) {
  return (
    `claude CLI: still running after ${Math.round(elapsedMs / 1000)}s ` +
    `(stdout ${stdoutBytes}B, stderr ${stderrBytes}B)`
  );
}

// No `maxTokens` param here (deliberately) — the CLI has no per-call
// output-token cap to forward it to. See the module header comment.
async function callViaCli({ prompt, timeoutMs, model }) {
  return new Promise((resolve, reject) => {
    // ANTHROPIC_API_KEY (and ANTHROPIC_AUTH_TOKEN) outrank the OAuth token in
    // Claude Code's own auth precedence, so a stale/low-balance key set
    // anywhere in the parent environment silently overrides
    // CLAUDE_CODE_OAUTH_TOKEN. Strip both from the child's env so the OAuth
    // token is what actually authenticates this call.
    // { ...process.env } yields a plain object with whatever key casing the
    // OS reported; on Windows that copy is case-sensitive even though
    // process.env itself is not, so an exact-case delete can miss a
    // variable set with different casing. Strip case-insensitively.
    const childEnv = { ...process.env };
    for (const key of Object.keys(childEnv)) {
      const upperKey = key.toUpperCase();
      if (upperKey === 'ANTHROPIC_API_KEY' || upperKey === 'ANTHROPIC_AUTH_TOKEN') {
        delete childEnv[key];
      }
    }

    const child = spawn(
      'claude',
      // --tools takes a following value ('claude -p --help': "--tools
      // <tools...>"), so the natural form is a separate '' array element.
      // But on Windows, spawn() with shell: true stringifies the args array
      // into a single command line for cmd.exe, and a bare '' element gets
      // silently elided from that command line (confirmed empirically) —
      // the same class of bug that forced --allowedTools='' (a single
      // token) instead of ['--allowedTools', ''] originally. '--tools='
      // (one token, value baked in) sidesteps that: nothing to elide.
      // Confirmed empirically on both Windows (shell: true) and POSIX
      // (shell: false, tested under WSL) that '--tools=' parses correctly
      // and disables tools, so one token form is used unconditionally.
      [
        '-p',
        '--output-format',
        'json',
        '--model',
        model || CLI_MODEL,
        '--tools=',
        '--strict-mcp-config',
      ],
      // shell only on Windows, where npm's global bin is a .cmd shim spawn()
      // can't exec directly. On POSIX (CI runs on ubuntu-latest) spawning
      // claude directly means SIGKILL on timeout kills the actual process
      // instead of orphaning it under an intermediate shell.
      { stdio: ['pipe', 'pipe', 'pipe'], shell: process.platform === 'win32', env: childEnv }
    );

    let stdout = '';
    let stderr = '';
    const startedAt = Date.now();

    // unref'd so a stray interval can never hold the process open on a path
    // that forgets to clear it; every exit path below clears it anyway.
    const heartbeat = setInterval(() => {
      console.log(
        formatCliProgress({
          elapsedMs: Date.now() - startedAt,
          stdoutBytes: Buffer.byteLength(stdout, 'utf8'),
          stderrBytes: Buffer.byteLength(stderr, 'utf8'),
        })
      );
    }, CLI_HEARTBEAT_MS);
    heartbeat.unref?.();

    const timer = setTimeout(() => {
      clearInterval(heartbeat);
      child.kill('SIGKILL');
      reject(
        new Error(
          formatCliTimeout({ timeoutMs, elapsedMs: Date.now() - startedAt, stdout, stderr })
        )
      );
    }, timeoutMs);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d) => {
      stdout += d;
    });
    child.stderr.on('data', (d) => {
      stderr += d;
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      clearInterval(heartbeat);
      reject(err);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      clearInterval(heartbeat);
      if (code !== 0 || signal) {
        const reason = code !== null ? `code ${code}` : `signal ${signal}`;
        // The claude CLI's error detail (e.g. a billing/auth failure) lands
        // in the JSON on stdout, not stderr — include both.
        const detail = [stderr.trim(), stdout.trim()].filter(Boolean).join('\n');
        reject(new Error(`claude CLI exited with ${reason}${detail ? `: ${detail}` : ''}`));
        return;
      }
      let data;
      try {
        data = JSON.parse(stdout);
      } catch (err) {
        reject(new Error(`Failed to parse claude CLI JSON output: ${err.message}\n${stdout}`));
        return;
      }
      if (!data || typeof data !== 'object') {
        reject(new Error(`Unexpected claude CLI JSON output (not an object): ${stdout}`));
        return;
      }
      if (data.is_error) {
        reject(new Error(`claude CLI reported an error: ${JSON.stringify(data)}`));
        return;
      }
      if (typeof data.result !== 'string') {
        reject(new Error(`Unexpected claude CLI response shape: ${JSON.stringify(data)}`));
        return;
      }
      logCliTelemetry(data);
      resolve({ text: data.result, stopReason: data.stop_reason });
    });

    child.stdin.on('error', () => {});
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

// Returns { text, stopReason }, e.g. stopReason 'end_turn' | 'max_tokens'.
// `model` is optional and overrides the hardcoded per-backend default —
// used by generate-impl.mjs's label-based model router (complexity:high /
// pii-sensitive / default). Callers that omit it get the same model as
// before this option existed.
export async function callClaude({ prompt, maxTokens, timeoutMs, model }) {
  if (LLM_BACKEND === 'cli') {
    // Say so rather than dropping it silently. All four generators pass a
    // maxTokens they believe bounds the response, and on this backend none of
    // them do - which is how `generate-impl.mjs` came to reason about a "16384
    // cap" that was never in force, and how a run emitting 50,304 output tokens
    // against that nominal cap did not look anomalous (#296, #313).
    //
    // Warn, do not throw: the parameter is correct for the API backend, callers
    // are right to pass it, and this module must never be the reason a pipeline
    // run fails.
    if (maxTokens != null) {
      console.warn(
        `llm-client: maxTokens=${maxTokens} is ignored on LLM_BACKEND=cli ` +
          `(the CLI has no per-call output cap). The model's own output limit still ` +
          `applies, so a response can still stop at stop_reason=max_tokens - it just ` +
          `will not stop at ${maxTokens}. Budget and time out accordingly.`
      );
    }
    return callViaCli({ prompt, timeoutMs, model });
  }
  return callViaApi({ prompt, maxTokens, timeoutMs, model });
}
