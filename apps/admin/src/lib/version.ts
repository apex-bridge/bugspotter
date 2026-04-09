/**
 * Application version information
 * Git commit hash can be injected at runtime (Docker) or build time (Vite)
 * Type definition for __RUNTIME_CONFIG__ is in src/types/window.d.ts
 */

// Get git commit from runtime config (Docker) or build-time (Vite)
function getGitCommit(): string {
  // Priority: runtime config > build-time env > dev fallback
  return window.__RUNTIME_CONFIG__?.gitCommit || import.meta.env.VITE_GIT_COMMIT_HASH || 'dev';
}

// Vite injects these as string replacements at build time
export const APP_VERSION = {
  version: '0.1.0', // from package.json
  get commit() {
    return getGitCommit();
  },
  buildDate: import.meta.env.VITE_BUILD_DATE || new Date().toISOString(),
};

export function getVersionString(): string {
  const shortCommit = APP_VERSION.commit.substring(0, 7);
  return `v${APP_VERSION.version} (${shortCommit})`;
}

export function getFullVersionInfo(): string {
  return `Version ${APP_VERSION.version}\nCommit: ${APP_VERSION.commit}\nBuilt: ${APP_VERSION.buildDate}`;
}
