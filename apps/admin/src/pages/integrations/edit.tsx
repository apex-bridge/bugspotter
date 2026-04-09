import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '../../components/ui/button';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { integrationService } from '../../services/integration-service';
import { handleApiError } from '../../lib/api-client';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, AlertTriangle } from 'lucide-react';
import type { CreateIntegrationRequest } from '../../types';
import IntegrationPluginForm, {
  type PluginFormData,
} from '../../components/integrations/integration-plugin-form';

export default function IntegrationEditPage() {
  const { t } = useTranslation();
  const { type } = useParams<{ type: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(false);

  // Initial form data from parsed code or raw code
  const [initialFormData, setInitialFormData] = useState<Partial<PluginFormData>>({});

  // Fetch integration details
  const { data: integration, isLoading } = useQuery({
    queryKey: ['integration', type],
    queryFn: () => integrationService.getDetails(type!),
    enabled: !!type,
  });

  // Fetch parsed plugin code for guided mode initialization
  const { data: parsedCode } = useQuery({
    queryKey: ['integration-parsed', type],
    queryFn: () => integrationService.parsePluginCode(type!),
    enabled: !!type && !!integration?.plugin_code,
  });

  // Initialize form data when integration loads
  useEffect(() => {
    if (integration && parsedCode) {
      // If code can be parsed, initialize guided mode fields
      setInitialFormData({
        plugin_code: integration.plugin_code || '',
        pluginName: parsedCode.metadata.name,
        pluginPlatform: parsedCode.metadata.platform,
        pluginVersion: parsedCode.metadata.version,
        pluginDescription: parsedCode.metadata.description || '',
        pluginAuthType: parsedCode.authType,
        createTicketCode: parsedCode.createTicketCode,
        testConnectionCode: parsedCode.testConnectionCode || '',
        validateConfigCode: parsedCode.validateConfigCode || '',
        includeTestConnection: !!parsedCode.testConnectionCode,
        includeValidateConfig: !!parsedCode.validateConfigCode,
        allowCodeExecution: integration.allow_code_execution ?? false,
      });
    } else if (integration && !parsedCode) {
      // Code cannot be parsed, use advanced mode
      setInitialFormData({
        plugin_code: integration.plugin_code || '',
        allowCodeExecution: integration.allow_code_execution ?? false,
      });
    }
  }, [integration, parsedCode]);

  const handleSubmit = async (formData: PluginFormData, useGuidedMode: boolean) => {
    if (!type) {
      toast.error(t('errors.integrationTypeRequired'));
      return;
    }

    setLoading(true);
    try {
      // Prepare payload based on mode
      const payload: Partial<CreateIntegrationRequest> = {};

      // Add guided mode fields or advanced mode code
      if (useGuidedMode) {
        // Guided mode: send structured parts for backend to generate code
        const metadata = {
          name: formData.pluginName,
          platform: formData.pluginPlatform,
          version: formData.pluginVersion,
          description: formData.pluginDescription || undefined,
        };

        payload.metadata_json = JSON.stringify(metadata);
        payload.auth_type = formData.pluginAuthType;
        payload.create_ticket_code = formData.createTicketCode;

        if (formData.includeTestConnection && formData.testConnectionCode) {
          payload.test_connection_code = formData.testConnectionCode;
        }

        if (formData.includeValidateConfig && formData.validateConfigCode) {
          payload.validate_config_code = formData.validateConfigCode;
        }
      } else {
        // Advanced mode: send full plugin code
        payload.plugin_code = formData.plugin_code;
      }

      // Always include allow_code_execution flag
      payload.allow_code_execution = formData.allowCodeExecution;

      await integrationService.update(type, payload);

      queryClient.invalidateQueries({ queryKey: ['integration', type] });
      queryClient.invalidateQueries({ queryKey: ['integrations'] });
      toast.success('Integration updated successfully');
      navigate('/integrations');
    } catch (error) {
      const message = handleApiError(error);
      toast.error(`${t('errors.failedToUpdateIntegration')}: ${message}`);
    } finally {
      setLoading(false);
    }
  };

  if (!type) {
    return (
      <div role="alert">
        <h1>Invalid Integration</h1>
        <p>No integration type provided.</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex items-center justify-center min-h-screen"
      >
        <div className="text-center">
          <div className="animate-pulse text-lg font-medium">
            {t('pages.loadingIntegrationDetails')}
          </div>
        </div>
      </div>
    );
  }

  if (!integration) {
    return (
      <div role="alert">
        <h1>Integration Not Found</h1>
        <p>Integration "{type}" does not exist.</p>
      </div>
    );
  }

  if (!integration.is_custom) {
    return (
      <div role="alert">
        <h1>Cannot Edit Built-in Integration</h1>
        <p>This is a built-in integration and cannot be edited.</p>
        <Button onClick={() => navigate('/integrations')}>Back to Integrations</Button>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="flex items-center gap-4 mb-6">
        <Button
          variant="outline"
          size="sm"
          onClick={() => navigate('/integrations')}
          aria-label="Back to integrations list"
        >
          <ArrowLeft className="w-4 h-4 mr-2" aria-hidden="true" />
          Back
        </Button>
        <div>
          <h1 className="text-2xl font-semibold">Edit Plugin Code</h1>
          <p className="text-sm text-muted-foreground">{integration?.name}</p>
        </div>
      </div>

      <Alert role="alert" className="bg-yellow-50 border-yellow-200 mb-6">
        <AlertTriangle className="h-4 w-4 text-yellow-600" aria-hidden="true" />
        <AlertDescription className="text-yellow-800">
          <strong>Warning:</strong> Editing plugin code will affect all projects using this
          integration. Make sure to test your changes thoroughly before saving.
        </AlertDescription>
      </Alert>

      <IntegrationPluginForm
        key={`${type}-${integration?.updated_at || 'new'}`}
        initialData={initialFormData}
        onSubmit={handleSubmit}
        loading={loading}
        onCancel={() => navigate('/integrations')}
        guidedModeDisabled={!parsedCode}
        defaultMode={parsedCode ? 'guided' : 'advanced'}
        submitButtonText="Update Integration"
      />
    </div>
  );
}
