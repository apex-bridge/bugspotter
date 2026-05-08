/**
 * Declarative install-snippet definitions for the BugSpotter SDK.
 *
 * Kept separate from the dialog so adding a new framework variant is
 * a pure data change (push another entry; no JSX to touch). The API
 * key is intentionally a placeholder — plaintext keys are only
 * revealed at creation time (see `services/api-key-service.ts`), so
 * the dialog routes users to `/api-keys` for the secret rather than
 * re-creating keys behind their back.
 *
 * The SDK config matches `BugSpotterConfig` in
 * `bugspotter-sdk/src/index.ts` — only `apiKey` (required) and
 * `endpoint` (optional, base URL of the BugSpotter API). There is
 * NO `projectId` field; the API key already encodes which projects
 * it can write to via the `allowed_projects` server-side scope.
 *
 * `endpoint` is filled in with the dialog caller's current origin
 * because:
 *   - SaaS: each tenant lives at `<subdomain>.kz.bugspotter.io`,
 *     so `window.location.origin` is exactly the URL they need.
 *   - Self-hosted: the user is on their own deployment, same
 *     story.
 * The caller passes `null` for SSR / unknown contexts; the snippet
 * then shows a placeholder the user replaces by hand.
 */

import type { SnippetTab } from '../ui/snippet-tabs';

const API_KEY_TOKEN = "'<paste your API key>'";

function endpointToken(endpoint: string | null): string {
  // `JSON.stringify` so a pathological origin with quotes /
  // backslashes can't break the generated snippet.
  return endpoint ? JSON.stringify(endpoint) : "'<your BugSpotter URL>'";
}

export function buildSdkInstallSnippets(endpoint: string | null): SnippetTab[] {
  const ep = endpointToken(endpoint);

  return [
    {
      id: 'javascript',
      label: 'JavaScript',
      language: 'javascript',
      code: `import BugSpotter from '@bugspotter/sdk';

BugSpotter.init({
  apiKey: ${API_KEY_TOKEN},
  endpoint: ${ep},
});`,
    },
    {
      id: 'typescript',
      label: 'TypeScript',
      language: 'typescript',
      code: `import BugSpotter from '@bugspotter/sdk';

BugSpotter.init({
  apiKey: ${API_KEY_TOKEN},
  endpoint: ${ep},
});`,
    },
    {
      id: 'react',
      label: 'React',
      language: 'tsx',
      code: `import BugSpotter from '@bugspotter/sdk';

// Place once near your app's entry point (e.g. main.tsx, _app.tsx)
BugSpotter.init({
  apiKey: ${API_KEY_TOKEN},
  endpoint: ${ep},
});`,
    },
  ];
}
