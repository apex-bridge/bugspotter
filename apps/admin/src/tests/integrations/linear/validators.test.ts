/**
 * Linear admin-UI validators tests.
 *
 * `validateLinearConfig` is the gate between the wizard and the
 * persistence layer — a regression here means broken or silently
 * mis-configured Linear integrations land in production. Worth
 * pinning the shape and the empty-field error paths.
 */

import { describe, it, expect } from 'vitest';
import { isLinearConfig, validateLinearConfig } from '../../../integrations/linear';
import type { LinearConfig } from '../../../integrations/linear';

describe('isLinearConfig', () => {
  it('accepts the default seed shape (apiKey as empty string)', () => {
    expect(isLinearConfig({ apiKey: '', teamId: '', teamKey: '' })).toBe(true);
  });

  it('accepts a complete config', () => {
    expect(isLinearConfig({ apiKey: 'lin_api_xxx', teamId: 'uuid', teamKey: 'ENG' })).toBe(true);
  });

  it('rejects null / undefined / non-objects', () => {
    expect(isLinearConfig(null)).toBe(false);
    expect(isLinearConfig(undefined)).toBe(false);
    expect(isLinearConfig('lin_api_xxx')).toBe(false);
    expect(isLinearConfig(42)).toBe(false);
  });

  it('rejects when apiKey field is missing or non-string', () => {
    expect(isLinearConfig({ teamId: 'uuid', teamKey: 'ENG' })).toBe(false);
    expect(isLinearConfig({ apiKey: 42, teamId: 'uuid', teamKey: 'ENG' })).toBe(false);
    expect(isLinearConfig({ apiKey: null, teamId: 'uuid', teamKey: 'ENG' })).toBe(false);
  });

  it('rejects when teamId/teamKey have wrong types (but allows undefined)', () => {
    expect(isLinearConfig({ apiKey: 'lin_api_xxx', teamId: 42 })).toBe(false);
    expect(isLinearConfig({ apiKey: 'lin_api_xxx', teamKey: ['ENG'] })).toBe(false);
    // Undefined teamId/teamKey are fine — represents a fresh form
    expect(isLinearConfig({ apiKey: 'lin_api_xxx' })).toBe(true);
  });
});

describe('validateLinearConfig', () => {
  const valid: LinearConfig = {
    apiKey: 'lin_api_xxx',
    teamId: 'uuid',
    teamKey: 'ENG',
  };

  it('returns null for a complete config', () => {
    expect(validateLinearConfig(valid)).toBeNull();
  });

  it('rejects empty / whitespace-only apiKey', () => {
    expect(validateLinearConfig({ ...valid, apiKey: '' })).toMatch(/api key/i);
    expect(validateLinearConfig({ ...valid, apiKey: '   ' })).toMatch(/api key/i);
    expect(validateLinearConfig({ ...valid, apiKey: undefined })).toMatch(/api key/i);
  });

  it('rejects empty teamId', () => {
    expect(validateLinearConfig({ ...valid, teamId: '' })).toMatch(/team/i);
    expect(validateLinearConfig({ ...valid, teamId: undefined })).toMatch(/team/i);
  });

  it('rejects empty teamKey', () => {
    expect(validateLinearConfig({ ...valid, teamKey: '' })).toMatch(/team key/i);
    expect(validateLinearConfig({ ...valid, teamKey: undefined })).toMatch(/team key/i);
  });

  it('reports the first missing field — apiKey takes precedence', () => {
    // Order matters for UX: surface the field the user is likeliest to
    // edit next. apiKey first because nothing else works without it.
    const result = validateLinearConfig({ apiKey: '', teamId: '', teamKey: '' });
    expect(result).toMatch(/api key/i);
    expect(result).not.toMatch(/team/i);
  });
});
