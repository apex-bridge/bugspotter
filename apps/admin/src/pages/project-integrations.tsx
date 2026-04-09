import { useParams, useNavigate } from 'react-router-dom';
import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Settings2, Wrench, Plus } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';
import { AddIntegrationDropdown } from '../components/integrations/add-integration-dropdown';
import { projectService } from '../services/api';
import { useProjectPermissions } from '../hooks/use-project-permissions';
import { handleApiError } from '../lib/api-client';

export default function ProjectIntegrationsPage() {
  const { t } = useTranslation();
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { canManageIntegrations } = useProjectPermissions(projectId);

  const handleManageRules = useCallback(
    (platform: string) => {
      if (projectId) {
        navigate(`/integrations/${platform}/${projectId}/rules`);
      }
    },
    [projectId, navigate]
  );

  const handleBackToProjects = useCallback(() => {
    navigate('/projects');
  }, [navigate]);

  const {
    data: integrations,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['project-integrations', projectId],
    queryFn: () => projectService.listIntegrations(projectId!),
    enabled: !!projectId,
    staleTime: 30000, // 30 seconds
    retry: false, // Don't retry on error (e.g., invalid project ID)
  });

  // Filter to show only configured integrations
  const configuredIntegrations = integrations?.filter((int) => int.enabled && int.config) || [];

  // Available integrations that are not yet configured
  const availableIntegrations = integrations?.filter((int) => !int.enabled || !int.config) || [];

  // Show error state but still allow navigation
  if (isError && !isLoading) {
    return (
      <div className="container mx-auto py-8 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleBackToProjects}
                aria-label={t('integrations.backToProjects')}
                data-testid="back-to-projects"
              >
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              </Button>
              <h1 className="text-3xl font-bold">{t('integrations.title')}</h1>
            </div>
            <p className="text-gray-600">{t('integrations.description')}</p>
          </div>

          {/* Add Integration Dropdown - disabled in error state */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button disabled aria-label={t('integrations.addIntegrationUnavailable')}>
                <Plus className="w-4 h-4 mr-2" aria-hidden="true" />
                {t('integrations.addIntegration')}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem disabled>
                <div className="flex flex-col">
                  <span className="font-medium text-gray-500">
                    {t('integrations.noIntegrationsAvailable')}
                  </span>
                  <span className="text-xs text-gray-400">
                    {t('integrations.unableToLoadIntegrations')}
                  </span>
                </div>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Error Message */}
        <Card className="border-red-200 bg-red-50">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <h3 className="text-lg font-semibold mb-2 text-red-800">
              {t('integrations.unableToLoadIntegrationsTitle')}
            </h3>
            <p className="text-red-700 mb-4 max-w-md">{handleApiError(error)}</p>
            <Button variant="outline" onClick={() => navigate('/projects')}>
              <ArrowLeft className="w-4 h-4 mr-2" aria-hidden="true" />
              {t('integrations.backToProjectsButton')}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!projectId) {
    return (
      <div className="container mx-auto py-8">
        <p className="text-red-600" data-testid="error-message">
          {t('integrations.missingProjectId')}
        </p>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate('/projects')}
              aria-label={t('integrations.backToProjects')}
              data-testid="back-to-projects"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            </Button>
            <h1 className="text-3xl font-bold">{t('integrations.title')}</h1>
          </div>
          <p className="text-gray-600">{t('integrations.description')}</p>
        </div>

        {/* Add Integration Dropdown */}
        <AddIntegrationDropdown
          projectId={projectId}
          availableIntegrations={availableIntegrations}
          disabled={!canManageIntegrations}
        />
      </div>

      {/* Integration Cards */}
      {isLoading ? (
        <div
          className="flex items-center justify-center min-h-[400px]"
          role="status"
          aria-live="polite"
        >
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
          <span className="sr-only">{t('integrations.loadingIntegrations')}</span>
        </div>
      ) : configuredIntegrations.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Wrench className="w-12 h-12 text-gray-400 mb-4" aria-hidden="true" />
            <h3 className="text-lg font-semibold mb-2">
              {t('integrations.noIntegrationsConfigured')}
            </h3>
            <p className="text-gray-600 mb-4 max-w-md">
              {t('integrations.noIntegrationsDescription')}
            </p>
            <AddIntegrationDropdown
              projectId={projectId}
              availableIntegrations={availableIntegrations}
              buttonText={t('integrations.configureFirstIntegration')}
              align="center"
              disabled={!canManageIntegrations}
            />
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {configuredIntegrations.map((integration) => (
            <Card
              key={integration.platform}
              data-testid={`integration-card-${integration.platform}`}
            >
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle>{integration.name}</CardTitle>
                    <CardDescription className="mt-2">{integration.description}</CardDescription>
                  </div>
                  {integration.hasRules && (
                    <Badge variant="outline" className="ml-2">
                      {t('integrations.rules')}
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full"
                    onClick={() =>
                      navigate(
                        `/projects/${projectId}/integrations/${integration.platform}/configure`
                      )
                    }
                    data-testid={`configure-${integration.platform}`}
                    aria-label={t('integrations.configureIntegration', { name: integration.name })}
                  >
                    <Wrench className="w-4 h-4 mr-2" aria-hidden="true" />
                    {t('integrations.configure')}
                  </Button>
                  {integration.hasRules && projectId && (
                    <Button
                      size="sm"
                      className="w-full"
                      onClick={() => handleManageRules(integration.platform)}
                      data-testid={`manage-rules-${integration.platform}`}
                      aria-label={t('integrations.manageIntegrationRules', {
                        name: integration.name,
                      })}
                    >
                      <Settings2 className="w-4 h-4 mr-2" aria-hidden="true" />
                      {t('integrations.manageRules')}
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Info */}
      <Card data-testid="integration-info-card">
        <CardContent className="pt-6">
          <div className="space-y-2 text-sm text-gray-600">
            <p>
              <strong>{t('integrations.integrationRulesTitle')}</strong>{' '}
              {t('integrations.integrationRulesDescription')}
            </p>
            <p>{t('integrations.manageRulesDescription')}</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
