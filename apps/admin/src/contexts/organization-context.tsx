/**
 * Organization Context
 * Provides the current user's organization(s) and selected organization.
 * Fetches on mount for authenticated users; no-ops if user has no orgs.
 */

import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from './auth-context';
import { organizationService } from '../services/organization-service';
import type { Organization } from '../types/organization';

interface OrganizationContextType {
  organizations: Organization[];
  currentOrganization: Organization | null;
  setCurrentOrganization: (org: Organization) => void;
  isLoading: boolean;
  hasOrganization: boolean;
}

const OrganizationContext = createContext<OrganizationContextType>({
  organizations: [],
  currentOrganization: null,
  setCurrentOrganization: () => {},
  isLoading: false,
  hasOrganization: false,
});

export function OrganizationProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  const [currentOrganization, setCurrentOrgState] = useState<Organization | null>(null);

  // Track if user manually selected an org (vs automatic selection)
  // Prevents overriding user's choice when organizations list updates
  const hasManuallySelectedRef = useRef(false);

  const { data: organizations = [], isLoading } = useQuery({
    queryKey: ['my-organizations'],
    queryFn: () => organizationService.mine(),
    enabled: isAuthenticated,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  // Auto-selection logic:
  // 1. Initial load: Select first org if none selected and user hasn't manually chosen
  // 2. Org deleted: Re-select if current org no longer exists
  // 3. No orgs: Clear selection
  // 4. Manual selection: Preserve user's choice unless org no longer exists
  const currentOrgId = currentOrganization?.id;
  useEffect(() => {
    if (organizations.length > 0) {
      const stillExists = currentOrgId && organizations.some((o) => o.id === currentOrgId);

      // Auto-select scenarios:
      // 1. Initial load (no current org, not manually selected)
      // 2. Current org no longer exists (could have been deleted)
      if (!currentOrgId && !hasManuallySelectedRef.current) {
        // Initial auto-select
        setCurrentOrgState(organizations[0]);
      } else if (currentOrgId && !stillExists) {
        // Current org was removed, auto-select first available
        setCurrentOrgState(organizations[0]);
        hasManuallySelectedRef.current = false; // Reset manual flag
      }
    } else {
      // No organizations available
      setCurrentOrgState(null);
      hasManuallySelectedRef.current = false;
    }
  }, [organizations, currentOrgId]);

  const setCurrentOrganization = useCallback((org: Organization) => {
    hasManuallySelectedRef.current = true; // Mark as manual selection
    setCurrentOrgState(org);
  }, []);

  return (
    <OrganizationContext.Provider
      value={{
        organizations,
        currentOrganization,
        setCurrentOrganization,
        isLoading,
        hasOrganization: organizations.length > 0,
      }}
    >
      {children}
    </OrganizationContext.Provider>
  );
}

export function useOrganization() {
  return useContext(OrganizationContext);
}
