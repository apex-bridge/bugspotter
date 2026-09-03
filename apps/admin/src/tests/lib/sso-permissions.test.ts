import { describe, it, expect } from 'vitest';
import { canManageSso } from '../../lib/sso-permissions';

describe('canManageSso', () => {
  it('allows org admins and owners', () => {
    expect(canManageSso(false, 'admin')).toBe(true);
    expect(canManageSso(false, 'owner')).toBe(true);
  });

  it('allows platform admins regardless of org role', () => {
    expect(canManageSso(true, null)).toBe(true);
    expect(canManageSso(true, 'member')).toBe(true);
  });

  it('refuses members and users with no org role', () => {
    expect(canManageSso(false, 'member')).toBe(false);
    expect(canManageSso(false, null)).toBe(false);
  });

  it('refuses an unrecognised role rather than falling open', () => {
    expect(canManageSso(false, 'Admin')).toBe(false);
    expect(canManageSso(false, 'viewer')).toBe(false);
  });
});
