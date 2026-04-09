import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import integrationService from '../../services/integration-service';
import IntegrationCard from '../../components/integrations/integration-card';
import { useNavigate } from 'react-router-dom';
import { handleApiError } from '../../lib/api-client';
import { Button } from '../../components/ui/button';
import { Plus } from 'lucide-react';
import type { Integration } from '../../types';

type IntegrationStatus = 'not_configured' | 'active' | 'error' | 'disabled';

type IntegrationWithStatus = Integration & {
  status: IntegrationStatus;
  stats?: {
    last_sync_at?: string | Date;
    total?: number;
    success?: number;
    failed?: number;
    avg_duration_ms?: number;
  };
};

const IntegrationsOverview: React.FC = () => {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const {
    data: integrations = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ['integrations'],
    queryFn: integrationService.list,
    refetchInterval: 30000,
  });

  const deleteMutation = useMutation({
    mutationFn: (type: string) => integrationService.delete(type),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['integrations'] }),
  });

  if (isLoading) {
    return (
      <div role="status" aria-live="polite">
        {t('integrations.overviewLoading')}
      </div>
    );
  }
  if (error) {
    return (
      <div role="alert" className="text-red-600">
        {t('integrations.overviewError')}: {handleApiError(error)}
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">{t('integrations.overviewTitle')}</h1>
        <Button onClick={() => navigate('/integrations/create')}>
          <Plus className="w-4 h-4 mr-2" />
          {t('integrations.overviewAddIntegration')}
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {integrations.map((it: Integration) => {
          // Use status from backend (config field consolidation complete)
          // Backend auto-sets status to 'active' when config is provided
          const integrationWithStatus: IntegrationWithStatus = {
            ...it,
            status: it.status || 'not_configured', // Fallback for type safety
          };

          return (
            <IntegrationCard
              key={it.type}
              integration={integrationWithStatus}
              onDelete={(type) => deleteMutation.mutate(type)}
              onEditCode={(type) => navigate(`/integrations/${type}/edit`)}
            />
          );
        })}
      </div>
    </div>
  );
};

export default IntegrationsOverview;
