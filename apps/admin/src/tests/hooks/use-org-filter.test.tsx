import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useOrgFilter } from '../../hooks/use-org-filter';
import type { ReactNode } from 'react';

function makeWrapper(initialEntries: string[]) {
  return ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={initialEntries}>{children}</MemoryRouter>
  );
}

describe('useOrgFilter', () => {
  it('reads `organizationId` from the URL on mount', () => {
    const { result } = renderHook(() => useOrgFilter(), {
      wrapper: makeWrapper(['/projects?organizationId=acme-id']),
    });
    expect(result.current.selectedOrgId).toBe('acme-id');
  });

  it('returns null when the param is absent', () => {
    const { result } = renderHook(() => useOrgFilter(), {
      wrapper: makeWrapper(['/projects']),
    });
    expect(result.current.selectedOrgId).toBeNull();
  });

  it('setSelectedOrgId(id) updates the URL param', () => {
    const { result } = renderHook(() => useOrgFilter(), {
      wrapper: makeWrapper(['/projects']),
    });

    act(() => {
      result.current.setSelectedOrgId('acme-id');
    });

    expect(result.current.selectedOrgId).toBe('acme-id');
  });

  it('setSelectedOrgId(null) deletes the param without nuking other query params', () => {
    const { result } = renderHook(() => useOrgFilter(), {
      // Existing pagination + sort that the page is using; switching org
      // scope must not blow these away.
      wrapper: makeWrapper(['/users?organizationId=acme-id&page=3&sort=name']),
    });

    expect(result.current.selectedOrgId).toBe('acme-id');

    act(() => {
      result.current.setSelectedOrgId(null);
    });

    expect(result.current.selectedOrgId).toBeNull();
  });

  it('setSelectedOrgId replaces an existing value', () => {
    const { result } = renderHook(() => useOrgFilter(), {
      wrapper: makeWrapper(['/projects?organizationId=acme-id']),
    });

    act(() => {
      result.current.setSelectedOrgId('initech-id');
    });

    expect(result.current.selectedOrgId).toBe('initech-id');
  });
});
