/**
 * Version string composition.
 *
 * `commitDate` arrives only from the container-injected /config.js, so these
 * tests drive `window.__RUNTIME_CONFIG__` directly - that is the real input.
 * The date is the *commit's*, not a build clock: a build that changes no
 * frontend source reuses the cached Vite layer, so `buildDate` can be older
 * than the image and the two are reported separately.
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  APP_VERSION,
  getVersionString,
  getFullVersionInfo,
  formatCommitDate,
} from '../../lib/version';

const setRuntimeConfig = (config: Window['__RUNTIME_CONFIG__']) => {
  window.__RUNTIME_CONFIG__ = config;
};

afterEach(() => {
  delete window.__RUNTIME_CONFIG__;
});

describe('formatCommitDate', () => {
  it('renders YYYYMMDD as an ISO calendar date', () => {
    expect(formatCommitDate('20260905')).toBe('2026-09-05');
  });

  it('passes through anything that is not 8 digits rather than mangling it', () => {
    expect(formatCommitDate('unknown')).toBe('unknown');
    expect(formatCommitDate('2026-09-05')).toBe('2026-09-05');
    expect(formatCommitDate('')).toBe('');
  });
});

describe('APP_VERSION.commitDate', () => {
  it('reads the injected value', () => {
    setRuntimeConfig({ gitCommit: '2fa99b1', commitDate: '20260905' });
    expect(APP_VERSION.commitDate).toBe('20260905');
  });

  it('is null when the container reported "unknown"', () => {
    setRuntimeConfig({ gitCommit: '2fa99b1', commitDate: 'unknown' });
    expect(APP_VERSION.commitDate).toBeNull();
  });

  it('is null when there is no runtime config at all (dev server)', () => {
    expect(APP_VERSION.commitDate).toBeNull();
  });
});

describe('getVersionString', () => {
  it('includes the commit date when one was injected', () => {
    setRuntimeConfig({
      gitCommit: '2fa99b1ef0c10e388086973df0101a494eb7e8c2',
      commitDate: '20260905',
    });
    expect(getVersionString()).toBe('v0.1.0 (2fa99b1, 2026-09-05)');
  });

  it('omits the date rather than printing "unknown" when absent', () => {
    setRuntimeConfig({
      gitCommit: '2fa99b1ef0c10e388086973df0101a494eb7e8c2',
      commitDate: 'unknown',
    });
    expect(getVersionString()).toBe('v0.1.0 (2fa99b1)');
  });

  it('omits the date on a dev server with no runtime config', () => {
    expect(getVersionString()).toBe('v0.1.0 (dev)');
  });
});

describe('getFullVersionInfo', () => {
  it('reports the commit date and the build date as separate lines', () => {
    setRuntimeConfig({ gitCommit: '2fa99b1', commitDate: '20260905' });
    const info = getFullVersionInfo();
    expect(info).toContain('Commit: 2fa99b1');
    expect(info).toContain('Committed: 2026-09-05');
    expect(info).toContain('Built: ');
  });

  it('drops the committed line entirely when no date was injected', () => {
    setRuntimeConfig({ gitCommit: '2fa99b1' });
    expect(getFullVersionInfo()).not.toContain('Committed:');
  });
});
