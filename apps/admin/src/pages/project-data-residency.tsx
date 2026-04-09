/**
 * Project Data Residency Page
 *
 * Configure data residency policies for a project to comply with
 * regulatory requirements (KZ, RF, EU, US, or global).
 */

import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  dataResidencyService,
  type DataResidencyRegion,
  type StorageRegion,
} from '../services/data-residency-service';
import { projectService } from '../services/project-service';
import { handleApiError } from '../lib/api-client';
import { Button } from '../components/ui/button';
import { toast } from 'sonner';
import { ShieldCheck, ArrowLeft } from 'lucide-react';
import { ErrorState } from '../components/data-residency/error-state';
import { ComplianceStatusCard } from '../components/data-residency/compliance-status-card';
import { RegionSelectionCard } from '../components/data-residency/region-selection-card';
import { CurrentPolicyCard } from '../components/data-residency/current-policy-card';

export function ProjectDataResidencyPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [selectedRegion, setSelectedRegion] = useState<DataResidencyRegion>('global');
  const [selectedStorageRegion, setSelectedStorageRegion] = useState<StorageRegion | undefined>();
  const [isInitialized, setIsInitialized] = useState(false);

  // Guard clause: projectId is required
  if (!projectId) {
    return (
      <ErrorState title={t('errors.invalid_project')} message={t('errors.project_id_required')} />
    );
  }

  // Fetch project details
  const { data: project, isLoading: projectLoading } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => projectService.getById(projectId),
  });

  // Fetch available regions
  const { data: regions = [], isLoading: regionsLoading } = useQuery({
    queryKey: ['dataResidency', 'regions'],
    queryFn: dataResidencyService.getRegions,
  });

  // Fetch current policy
  const {
    data: policyData,
    isLoading: policyLoading,
    error: policyError,
  } = useQuery({
    queryKey: ['dataResidency', 'policy', projectId],
    queryFn: () => dataResidencyService.getPolicy(projectId),
  });

  // Fetch compliance summary
  const { data: complianceSummary } = useQuery({
    queryKey: ['dataResidency', 'compliance', projectId],
    queryFn: () => dataResidencyService.getComplianceSummary(projectId),
  });

  // Initialize form with current policy
  useEffect(() => {
    if (policyData?.policy) {
      setSelectedRegion(policyData.policy.region);
      setSelectedStorageRegion(policyData.policy.storageRegion);
      setIsInitialized(true);
    }
  }, [policyData]);

  // Update policy mutation
  const updatePolicyMutation = useMutation({
    mutationFn: ({
      region,
      storageRegion,
    }: {
      region: DataResidencyRegion;
      storageRegion?: StorageRegion;
    }) => dataResidencyService.updatePolicy(projectId, region, storageRegion),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dataResidency', 'policy', projectId] });
      queryClient.invalidateQueries({ queryKey: ['dataResidency', 'compliance', projectId] });
      toast.success(t('pages.data_residency.policy_updated'));
    },
    onError: (error) => {
      toast.error(handleApiError(error));
    },
  });

  const handleRegionChange = useCallback(
    (region: DataResidencyRegion, defaultStorage: StorageRegion) => {
      setSelectedRegion(region);
      setSelectedStorageRegion(defaultStorage);
    },
    []
  );

  const handleStorageRegionChange = useCallback((region: StorageRegion) => {
    setSelectedStorageRegion(region);
  }, []);

  const handleUpdatePolicy = useCallback(() => {
    updatePolicyMutation.mutate({
      region: selectedRegion,
      storageRegion: selectedStorageRegion,
    });
  }, [selectedRegion, selectedStorageRegion, updatePolicyMutation]);

  const hasChanges =
    isInitialized &&
    (selectedRegion !== policyData?.policy.region ||
      selectedStorageRegion !== policyData?.policy.storageRegion);

  if (projectLoading || regionsLoading || policyLoading) {
    return (
      <div className="p-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-1/4"></div>
          <div className="h-64 bg-gray-200 rounded"></div>
        </div>
      </div>
    );
  }

  if (policyError) {
    return <ErrorState title={t('errors.failed_to_load')} message={handleApiError(policyError)} />;
  }

  return (
    <div className="p-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <Button variant="ghost" size="sm" onClick={() => navigate('/projects')} className="mb-4">
          <ArrowLeft className="h-4 w-4 mr-2" aria-hidden="true" />
          {t('common.back_to_projects')}
        </Button>
        <div className="flex items-center gap-3">
          <ShieldCheck className="h-8 w-8 text-blue-600" aria-hidden="true" />
          <div>
            <h1 className="text-3xl font-bold text-gray-900" data-testid="data-residency-heading">
              {t('pages.data_residency.title')}
            </h1>
            <p className="text-gray-600">{project?.name}</p>
          </div>
        </div>
      </div>

      {/* Compliance Status */}
      {complianceSummary && (
        <div className="mb-6">
          <ComplianceStatusCard summary={complianceSummary} />
        </div>
      )}

      {/* Policy Configuration */}
      <div className="mb-6">
        <RegionSelectionCard
          regions={regions}
          selectedRegion={selectedRegion}
          selectedStorageRegion={selectedStorageRegion}
          onRegionChange={handleRegionChange}
          onStorageRegionChange={handleStorageRegionChange}
          onSave={handleUpdatePolicy}
          hasChanges={hasChanges}
          isSaving={updatePolicyMutation.isPending}
        />
      </div>

      {/* Current Policy Details */}
      {policyData && <CurrentPolicyCard policy={policyData.policy} />}
    </div>
  );
}
