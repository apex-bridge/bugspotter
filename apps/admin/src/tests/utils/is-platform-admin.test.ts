import { describe, it, expect } from 'vitest';
import { isPlatformAdmin } from '../../types';
import type { User } from '../../types';

function makeUser(overrides: Partial<User> = {}): User {
  return { id: '1', email: 'test@test.com', name: 'Test', ...overrides };
}

describe('isPlatformAdmin', () => {
  it('returns false for null', () => {
    expect(isPlatformAdmin(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isPlatformAdmin(undefined)).toBe(false);
  });

  it('returns true when security.is_platform_admin is true', () => {
    expect(isPlatformAdmin(makeUser({ role: 'user', security: { is_platform_admin: true } }))).toBe(
      true
    );
  });

  it('returns false when security.is_platform_admin is false', () => {
    expect(
      isPlatformAdmin(makeUser({ role: 'user', security: { is_platform_admin: false } }))
    ).toBe(false);
  });

  it('returns false when security.is_platform_admin is false even with role=admin', () => {
    expect(
      isPlatformAdmin(makeUser({ role: 'admin', security: { is_platform_admin: false } }))
    ).toBe(false);
  });

  it('falls back to role=admin when security is missing', () => {
    expect(isPlatformAdmin(makeUser({ role: 'admin' }))).toBe(true);
  });

  it('falls back to role=admin when security is empty (no is_platform_admin key)', () => {
    expect(isPlatformAdmin(makeUser({ role: 'admin', security: {} }))).toBe(true);
  });

  it('returns false for role=user without security', () => {
    expect(isPlatformAdmin(makeUser({ role: 'user' }))).toBe(false);
  });

  it('returns false for role=viewer without security', () => {
    expect(isPlatformAdmin(makeUser({ role: 'viewer' }))).toBe(false);
  });
});
