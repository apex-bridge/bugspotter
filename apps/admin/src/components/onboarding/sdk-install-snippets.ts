/**
 * Declarative install-snippet definitions for the BugSpotter SDK.
 *
 * Kept separate from the dialog so adding a new framework variant is a
 * pure data change (push another entry; no JSX to touch). The API key
 * is intentionally a placeholder — plaintext keys are only revealed
 * at creation time (see `services/api-key-service.ts`), so the dialog
 * routes users to `/api-keys` for the secret rather than re-creating
 * keys behind their back.
 */

import type { SnippetTab } from '../ui/snippet-tabs';

const API_KEY_TOKEN = "'<paste your API key>'";

function projectIdToken(projectId: string | null): string {
  // `JSON.stringify` so a pathological project id with quotes /
  // backslashes / newlines doesn't break the generated snippet.
  return projectId ? JSON.stringify(projectId) : "'<your-project-id>'";
}

export function buildSdkInstallSnippets(projectId: string | null): SnippetTab[] {
  const projId = projectIdToken(projectId);

  return [
    {
      id: 'javascript',
      label: 'JavaScript',
      language: 'javascript',
      code: `import BugSpotter from '@bugspotter/sdk';

BugSpotter.init({
  apiKey: ${API_KEY_TOKEN},
  projectId: ${projId},
});`,
    },
    {
      id: 'typescript',
      label: 'TypeScript',
      language: 'typescript',
      code: `import BugSpotter from '@bugspotter/sdk';

BugSpotter.init({
  apiKey: ${API_KEY_TOKEN},
  projectId: ${projId},
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
  projectId: ${projId},
});`,
    },
  ];
}
