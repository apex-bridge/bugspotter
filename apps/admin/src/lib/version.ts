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

// Date of that commit, YYYYMMDD. Injected at runtime only (there is no
// build-time equivalent), so anything not served by the container - a dev
// server, a unit test - correctly has none.
//
// This is the commit's date, deliberately not `buildDate` below: a build that
// changes no frontend source reuses the cached Vite layer, so `buildDate` can
// legitimately be older than the image. They answer different questions and
// are shown separately.
function getCommitDate(): string | null {
  const raw = window.__RUNTIME_CONFIG__?.commitDate;
  if (!raw || raw === 'unknown') {
    return null;
  }
  return raw;
}

/** `20260905` -> `2026-09-05`; anything else is passed through untouched. */
export function formatCommitDate(yyyymmdd: string): string {
  if (!/^\d{8}$/.test(yyyymmdd)) {
    return yyyymmdd;
  }
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}

// Vite injects these as string replacements at build time
export const APP_VERSION = {
  version: '0.1.0', // from package.json
  get commit() {
    return getGitCommit();
  },
  /** YYYYMMDD, or null when not served by the container. */
  get commitDate() {
    return getCommitDate();
  },
  buildDate: import.meta.env.VITE_BUILD_DATE || new Date().toISOString(),
};

export function getVersionString(): string {
  const shortCommit = APP_VERSION.commit.substring(0, 7);
  const commitDate = APP_VERSION.commitDate;
  // Omitted rather than shown as "unknown" when absent, so a dev server keeps
  // the short form instead of advertising a missing field.
  return commitDate
    ? `v${APP_VERSION.version} (${shortCommit}, ${formatCommitDate(commitDate)})`
    : `v${APP_VERSION.version} (${shortCommit})`;
}

export function getFullVersionInfo(): string {
  const commitDate = APP_VERSION.commitDate;
  const committed = commitDate ? `\nCommitted: ${formatCommitDate(commitDate)}` : '';
  return `Version ${APP_VERSION.version}\nCommit: ${APP_VERSION.commit}${committed}\nBuilt: ${APP_VERSION.buildDate}`;
}
