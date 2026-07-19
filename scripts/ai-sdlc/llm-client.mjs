// Shared Claude call for ai-sdlc scripts (generate-spec.mjs, verify-spec.mjs).
//
// LLM_BACKEND=api (default) — raw Messages API call, billed per-token,
//   needs ANTHROPIC_API_KEY.
// LLM_BACKEND=cli — routes through the Claude Code CLI so usage draws from a
//   Claude subscription instead of metered API billing, needs
//   CLAUDE_CODE_OAUTH_TOKEN (from `claude setup-token`, requires Pro/Max/
//   Team/Enterprise). Tools are disabled (--allowedTools "") so the call is a
//   plain text completion, matching the API path's behavior — without this,
//   Claude Code's normal agentic tool loop would try to explore/edit files.

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

async function callViaApi({ prompt, maxTokens, timeoutMs }) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
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

async function callViaCli({ prompt, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'claude',
      ['-p', '--output-format', 'json', '--model', CLI_MODEL, '--allowedTools='],
      { stdio: ['pipe', 'pipe', 'pipe'], shell: true }
    );

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`claude CLI timed out after ${timeoutMs}ms`));
    }, timeoutMs);

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
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`claude CLI exited with code ${code}: ${stderr}`));
        return;
      }
      let data;
      try {
        data = JSON.parse(stdout);
      } catch (err) {
        reject(new Error(`Failed to parse claude CLI JSON output: ${err.message}\n${stdout}`));
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

    child.stdin.write(prompt);
    child.stdin.end();
  });
}

// Returns { text, stopReason }, e.g. stopReason 'end_turn' | 'max_tokens'.
export async function callClaude({ prompt, maxTokens, timeoutMs }) {
  if (LLM_BACKEND === 'cli') {
    return callViaCli({ prompt, timeoutMs });
  }
  return callViaApi({ prompt, maxTokens, timeoutMs });
}
