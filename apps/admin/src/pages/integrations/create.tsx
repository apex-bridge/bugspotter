import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Textarea } from '../../components/ui/textarea';
import { integrationService } from '../../services/integration-service';
import { handleApiError } from '../../lib/api-client';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { ArrowLeft } from 'lucide-react';
import type { CreateIntegrationRequest } from '../../types';
import IntegrationPluginForm, {
  type PluginFormData,
} from '../../components/integrations/integration-plugin-form';

export default function CreateIntegration() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);

  const [integrationMeta, setIntegrationMeta] = useState({
    type: '',
    name: '',
    description: '',
  });

  const handleSubmit = async (formData: PluginFormData, useGuidedMode: boolean) => {
    // Validate required fields
    if (!integrationMeta.type || !integrationMeta.name) {
      toast.error(t('errors.typeAndNameRequired'));
      return;
    }

    // Validate type format
    if (!/^[a-z0-9_-]+$/.test(integrationMeta.type)) {
      toast.error(t('errors.invalidTypeFormat'));
      return;
    }

    setLoading(true);
    try {
      // Prepare payload based on mode
      const payload: CreateIntegrationRequest = {
        type: integrationMeta.type,
        name: integrationMeta.name,
        description: integrationMeta.description || undefined,
        is_custom: true,
        plugin_source: 'filesystem',
        trust_level: 'custom',
        allow_code_execution: formData.allowCodeExecution,
      };

      // Add guided mode fields or advanced mode code
      if (useGuidedMode) {
        // Guided mode: send structured parts for backend to generate code
        payload.metadata_json = JSON.stringify({
          name: formData.pluginName,
          platform: formData.pluginPlatform,
          version: formData.pluginVersion,
          description: formData.pluginDescription || undefined,
        });
        payload.auth_type = formData.pluginAuthType;
        payload.create_ticket_code = formData.createTicketCode;

        if (formData.includeTestConnection && formData.testConnectionCode) {
          payload.test_connection_code = formData.testConnectionCode;
        }

        if (formData.includeValidateConfig && formData.validateConfigCode) {
          payload.validate_config_code = formData.validateConfigCode;
        }

        // Add metadata to config to make plugin active immediately
        payload.config = {
          plugin_metadata: {
            name: formData.pluginName,
            platform: formData.pluginPlatform,
            version: formData.pluginVersion,
            auth_type: formData.pluginAuthType,
          },
        };
      } else {
        // Advanced mode: send full plugin code
        payload.plugin_code = formData.plugin_code || undefined;

        // Add config to mark plugin as configured (makes it active)
        // Backend sets status='active' when config field is present
        if (formData.plugin_code) {
          payload.config = {
            plugin_code_configured: true,
            allow_code_execution: true,
          };
        }
      }

      await integrationService.create(payload);
      toast.success(t('integrations.createIntegration.createdSuccessfully'));
      navigate('/integrations');
    } catch (error) {
      const message = handleApiError(error);
      toast.error(`${t('errors.failedToCreateIntegration')}: ${message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <Button variant="ghost" onClick={() => navigate('/integrations')} className="mb-2">
            <ArrowLeft className="w-4 h-4 mr-2" aria-hidden="true" />
            {t('integrations.createIntegration.backToIntegrations')}
          </Button>
          <h1 className="text-3xl font-bold">{t('integrations.createIntegration.title')}</h1>
          <p className="text-muted-foreground mt-1">
            {t('integrations.createIntegration.description')}
          </p>
        </div>
      </div>

      {/* Basic Information Card */}
      <Card>
        <CardHeader>
          <CardTitle>{t('integrations.createIntegration.basicInformation')}</CardTitle>
          <CardDescription>
            {t('integrations.createIntegration.basicInformationDescription')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="type">{t('integrations.createIntegration.platformIdentifier')}</Label>
            <Input
              id="type"
              value={integrationMeta.type}
              onChange={(e) =>
                setIntegrationMeta((prev) => ({
                  ...prev,
                  type: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''),
                }))
              }
              placeholder={t('integrations.createIntegration.platformIdentifierPlaceholder')}
              pattern="[a-z0-9_-]+"
              required
            />
            <p className="text-sm text-muted-foreground mt-1">
              {t('integrations.createIntegration.platformIdentifierHelp')}
            </p>
          </div>

          <div>
            <Label htmlFor="name">{t('integrations.createIntegration.displayName')}</Label>
            <Input
              id="name"
              value={integrationMeta.name}
              onChange={(e) =>
                setIntegrationMeta((prev) => ({
                  ...prev,
                  name: e.target.value,
                }))
              }
              placeholder={t('integrations.createIntegration.displayNamePlaceholder')}
              required
            />
          </div>

          <div>
            <Label htmlFor="description">
              {t('integrations.createIntegration.formDescription')}
            </Label>
            <Textarea
              id="description"
              data-testid="integration-description"
              value={integrationMeta.description}
              onChange={(e) =>
                setIntegrationMeta((prev) => ({
                  ...prev,
                  description: e.target.value,
                }))
              }
              placeholder={t('integrations.createIntegration.descriptionPlaceholder')}
              rows={3}
            />
          </div>
        </CardContent>
      </Card>

      {/* Plugin Code Form */}
      <IntegrationPluginForm
        onSubmit={handleSubmit}
        loading={loading}
        onCancel={() => navigate('/integrations')}
        defaultMode="guided"
      />
    </div>
  );
}
