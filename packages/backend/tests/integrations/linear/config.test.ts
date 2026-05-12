/**
 * Linear Config Tests
 *
 * Pins security-relevant invariants that aren't covered by the plugin-
 * level integration tests. The SaaS-mode env-fallback guard in
 * `fromEnvironment()` is the only thing stopping `LINEAR_API_KEY` from
 * the host environment from being served as a fallback Linear config to
 * every tenant — a regression there silently turns into a cross-tenant
 * credential leak with no signal. Worth a test, even if a small one.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LinearConfigManager } from '../../../src/integrations/linear/config.js';

describe('LinearConfigManager.fromEnvironment', () => {
  // Snapshot the env vars we touch so we can restore them after each
  // test even if vitest runs the file in a worker that shares process
  // state with other suites.
  const snapshot: Record<string, string | undefined> = {};
  const envVars = ['DEPLOYMENT_MODE', 'LINEAR_API_KEY', 'LINEAR_TEAM_ID', 'LINEAR_TEAM_KEY'];

  beforeEach(() => {
    for (const k of envVars) {
      snapshot[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of envVars) {
      if (snapshot[k] === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = snapshot[k];
      }
    }
  });

  it('returns null in SaaS mode even when all env vars are set (cross-tenant leak guard)', () => {
    process.env.DEPLOYMENT_MODE = 'saas';
    process.env.LINEAR_API_KEY = 'lin_api_xxx';
    process.env.LINEAR_TEAM_ID = 'team-uuid';
    process.env.LINEAR_TEAM_KEY = 'ENG';

    expect(LinearConfigManager.fromEnvironment()).toBeNull();
  });

  it('returns config in self-hosted mode when all env vars are set', () => {
    process.env.DEPLOYMENT_MODE = 'selfhosted';
    process.env.LINEAR_API_KEY = 'lin_api_xxx';
    process.env.LINEAR_TEAM_ID = 'team-uuid';
    process.env.LINEAR_TEAM_KEY = 'ENG';

    const config = LinearConfigManager.fromEnvironment();
    expect(config).not.toBeNull();
    expect(config?.apiKey).toBe('lin_api_xxx');
    expect(config?.teamKey).toBe('ENG');
    expect(config?.enabled).toBe(true);
  });

  it('returns null in self-hosted mode when env vars are incomplete', () => {
    process.env.DEPLOYMENT_MODE = 'selfhosted';
    process.env.LINEAR_API_KEY = 'lin_api_xxx';
    // teamId and teamKey deliberately missing

    expect(LinearConfigManager.fromEnvironment()).toBeNull();
  });

  it('returns config when DEPLOYMENT_MODE is unset (treated as non-SaaS)', () => {
    // Belt-and-braces: a deployment that forgot to set DEPLOYMENT_MODE
    // should NOT accidentally become "SaaS mode locked out". Env config
    // is for self-hosted, and unset mode defaults to that behaviour.
    process.env.LINEAR_API_KEY = 'lin_api_xxx';
    process.env.LINEAR_TEAM_ID = 'team-uuid';
    process.env.LINEAR_TEAM_KEY = 'ENG';

    const config = LinearConfigManager.fromEnvironment();
    expect(config).not.toBeNull();
    expect(config?.apiKey).toBe('lin_api_xxx');
  });
});
