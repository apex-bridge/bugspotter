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
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`claude CLI timed out after ${timeoutMs}ms`));
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
      reject(err);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
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
    return callViaCli({ prompt, timeoutMs, model });
  }
  return callViaApi({ prompt, maxTokens, timeoutMs, model });
}
