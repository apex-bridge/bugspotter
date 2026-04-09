/**
 * JWT Payload Validation Tests
 * Tests for validateJwtPayload and isPlatformAdmin in JWT context
 */

import { describe, it, expect } from 'vitest';
import { validateJwtPayload } from '../../src/api/routes/auth.js';

describe('validateJwtPayload', () => {
  it('accepts valid payload with userId only (new format)', () => {
    const payload = { userId: 'u1' };
    expect(() => validateJwtPayload(payload)).not.toThrow();
  });

  it('accepts valid payload with userId and isPlatformAdmin', () => {
    const payload = { userId: 'u1', isPlatformAdmin: true };
    expect(() => validateJwtPayload(payload)).not.toThrow();
  });

  it('accepts valid payload with isPlatformAdmin=false', () => {
    const payload = { userId: 'u1', isPlatformAdmin: false };
    expect(() => validateJwtPayload(payload)).not.toThrow();
  });

  it('accepts legacy payload with role (backward compat)', () => {
    const payload = { userId: 'u1', role: 'admin' };
    expect(() => validateJwtPayload(payload)).not.toThrow();
  });

  it('accepts legacy payload with role and isPlatformAdmin', () => {
    const payload = { userId: 'u1', role: 'user', isPlatformAdmin: true };
    expect(() => validateJwtPayload(payload)).not.toThrow();
  });

  it('accepts sub claim as userId alternative', () => {
    const payload = { sub: 'u1' } as Record<string, unknown>;
    expect(() => validateJwtPayload(payload)).not.toThrow();
    expect(payload.userId).toBe('u1');
  });

  it('rejects null payload', () => {
    expect(() => validateJwtPayload(null)).toThrow('Invalid token payload');
  });

  it('rejects non-object payload', () => {
    expect(() => validateJwtPayload('string')).toThrow('Invalid token payload');
  });

  it('rejects missing userId', () => {
    expect(() => validateJwtPayload({ isPlatformAdmin: true })).toThrow(
      'missing or invalid user identifier'
    );
  });

  it('rejects non-string role', () => {
    expect(() => validateJwtPayload({ userId: 'u1', role: 123 })).toThrow('role must be a string');
  });

  it('rejects non-boolean isPlatformAdmin', () => {
    expect(() => validateJwtPayload({ userId: 'u1', isPlatformAdmin: 'yes' })).toThrow(
      'isPlatformAdmin must be boolean'
    );
  });

  it('rejects numeric isPlatformAdmin', () => {
    expect(() => validateJwtPayload({ userId: 'u1', isPlatformAdmin: 1 })).toThrow(
      'isPlatformAdmin must be boolean'
    );
  });
});
