/**
 * Create Channel Dialog
 * Form for creating new notification channels
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { notificationService, projectService } from '../../services/api';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select-radix';
import { Textarea } from '../ui/textarea';
import type { ChannelType } from '../../types';

interface CreateChannelDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function CreateChannelDialog({ open, onOpenChange, onSuccess }: CreateChannelDialogProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState({
    name: '',
    type: 'email' as ChannelType,
    project_id: '',
    config: {} as Record<string, string>,
  });

  const { data: projects } = useQuery({
    queryKey: ['projects'],
    queryFn: projectService.getAll,
  });

  const createMutation = useMutation({
    mutationFn: notificationService.createChannel,
    onSuccess: () => {
      toast.success(t('notifications.createChannel.createdSuccess'));
      queryClient.invalidateQueries({ queryKey: ['notification-channels'] });
      onSuccess();
      // Reset form
      setFormData({
        name: '',
        type: 'email',
        project_id: '',
        config: {},
      });
    },
    onError: (error: Error) => {
      toast.error(`${t('errors.failedToCreateChannel')}: ${error.message}`);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.name || !formData.type || !formData.project_id) {
      toast.error(t('notifications.createChannel.fillAllFields'));
      return;
    }

    // Build config based on channel type
    const config: Record<string, unknown> = {};

    switch (formData.type) {
      case 'email':
        if (!formData.config.smtp_host || !formData.config.from_address) {
          toast.error(t('errors.provideSmtpDetails'));
          return;
        }
        config.type = 'email';
        config.smtp_host = formData.config.smtp_host;
        config.smtp_port = parseInt(formData.config.smtp_port || '587');
        config.smtp_secure = formData.config.smtp_secure === 'true';
        config.smtp_user = formData.config.smtp_user || '';
        config.smtp_pass = formData.config.smtp_pass || '';
        config.from_address = formData.config.from_address;
        config.from_name = formData.config.from_name || 'BugSpotter';
        break;

      case 'slack':
        if (!formData.config.webhook_url) {
          toast.error(t('errors.provideSlackWebhook'));
          return;
        }
        config.type = 'slack';
        config.webhook_url = formData.config.webhook_url;
        config.username = formData.config.username || 'BugSpotter';
        config.icon_emoji = formData.config.icon_emoji || ':bug:';
        break;

      case 'webhook':
        if (!formData.config.url) {
          toast.error(t('errors.provideWebhookUrl'));
          return;
        }
        config.type = 'webhook';
        config.url = formData.config.url;
        config.method = formData.config.method || 'POST';
        if (formData.config.headers) {
          try {
            config.headers = JSON.parse(formData.config.headers);
          } catch {
            toast.error(t('errors.invalidJsonHeaders'));
            return;
          }
        }
        break;

      case 'discord':
        if (!formData.config.webhook_url) {
          toast.error(t('errors.provideDiscordWebhook'));
          return;
        }
        config.type = 'discord';
        config.webhook_url = formData.config.webhook_url;
        config.username = formData.config.username || 'BugSpotter';
        break;

      case 'teams':
        if (!formData.config.webhook_url) {
          toast.error(t('errors.provideTeamsWebhook'));
          return;
        }
        config.type = 'teams';
        config.webhook_url = formData.config.webhook_url;
        break;
    }

    createMutation.mutate({
      ...formData,
      config,
      active: true,
    });
  };

  const updateConfig = (key: string, value: string) => {
    setFormData((prev) => ({
      ...prev,
      config: { ...prev.config, [key]: value },
    }));
  };

  const renderConfigFields = () => {
    switch (formData.type) {
      case 'email':
        return (
          <>
            <div className="space-y-2">
              <Label htmlFor="smtp_host">{t('notifications.createChannel.smtpHost')}</Label>
              <Input
                id="smtp_host"
                value={formData.config.smtp_host || ''}
                onChange={(e) => updateConfig('smtp_host', e.target.value)}
                placeholder={t('notifications.createChannel.smtpHostPlaceholder')}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="smtp_port">{t('notifications.createChannel.smtpPort')}</Label>
                <Input
                  id="smtp_port"
                  type="number"
                  value={formData.config.smtp_port || '587'}
                  onChange={(e) => updateConfig('smtp_port', e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="smtp_secure">{t('notifications.createChannel.smtpSecure')}</Label>
                <Select
                  value={formData.config.smtp_secure || 'false'}
                  onValueChange={(value) => updateConfig('smtp_secure', value)}
                >
                  <SelectTrigger id="smtp_secure">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="true">{t('notifications.createChannel.yes')}</SelectItem>
                    <SelectItem value="false">{t('notifications.createChannel.no')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="smtp_user">{t('notifications.createChannel.smtpUsername')}</Label>
              <Input
                id="smtp_user"
                value={formData.config.smtp_user || ''}
                onChange={(e) => updateConfig('smtp_user', e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="smtp_pass">{t('notifications.createChannel.smtpPassword')}</Label>
              <Input
                id="smtp_pass"
                type="password"
                value={formData.config.smtp_pass || ''}
                onChange={(e) => updateConfig('smtp_pass', e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="from_address">{t('notifications.createChannel.fromAddress')}</Label>
              <Input
                id="from_address"
                type="email"
                value={formData.config.from_address || ''}
                onChange={(e) => updateConfig('from_address', e.target.value)}
                placeholder={t('notifications.createChannel.fromAddressPlaceholder')}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="from_name">{t('notifications.createChannel.fromName')}</Label>
              <Input
                id="from_name"
                value={formData.config.from_name || 'BugSpotter'}
                onChange={(e) => updateConfig('from_name', e.target.value)}
                placeholder={t('notifications.createChannel.fromNamePlaceholder')}
              />
            </div>
          </>
        );

      case 'slack':
        return (
          <>
            <div className="space-y-2">
              <Label htmlFor="webhook_url">{t('notifications.createChannel.webhookUrl')}</Label>
              <Input
                id="webhook_url"
                value={formData.config.webhook_url || ''}
                onChange={(e) => updateConfig('webhook_url', e.target.value)}
                placeholder={t('notifications.createChannel.webhookUrlPlaceholderSlack')}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="username">{t('notifications.createChannel.botUsername')}</Label>
              <Input
                id="username"
                value={formData.config.username || 'BugSpotter'}
                onChange={(e) => updateConfig('username', e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="icon_emoji">{t('notifications.createChannel.iconEmoji')}</Label>
              <Input
                id="icon_emoji"
                value={formData.config.icon_emoji || ':bug:'}
                onChange={(e) => updateConfig('icon_emoji', e.target.value)}
                placeholder={t('notifications.createChannel.iconEmojiPlaceholder')}
              />
            </div>
          </>
        );

      case 'webhook':
        return (
          <>
            <div className="space-y-2">
              <Label htmlFor="url">{t('notifications.createChannel.webhookUrl')}</Label>
              <Input
                id="url"
                value={formData.config.url || ''}
                onChange={(e) => updateConfig('url', e.target.value)}
                placeholder={t('notifications.createChannel.webhookUrlPlaceholderGeneric')}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="method">{t('notifications.createChannel.httpMethod')}</Label>
              <Select
                value={formData.config.method || 'POST'}
                onValueChange={(value) => updateConfig('method', value)}
              >
                <SelectTrigger id="method">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="POST">{t('notifications.createChannel.httpPost')}</SelectItem>
                  <SelectItem value="PUT">{t('notifications.createChannel.httpPut')}</SelectItem>
                  <SelectItem value="PATCH">
                    {t('notifications.createChannel.httpPatch')}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="headers">{t('notifications.createChannel.headersJson')}</Label>
              <Textarea
                id="headers"
                value={formData.config.headers || ''}
                onChange={(e) => updateConfig('headers', e.target.value)}
                placeholder={t('notifications.createChannel.headersJsonPlaceholder')}
                rows={3}
              />
            </div>
          </>
        );

      case 'discord':
        return (
          <>
            <div className="space-y-2">
              <Label htmlFor="webhook_url">{t('notifications.createChannel.webhookUrl')}</Label>
              <Input
                id="webhook_url"
                value={formData.config.webhook_url || ''}
                onChange={(e) => updateConfig('webhook_url', e.target.value)}
                placeholder={t('notifications.createChannel.webhookUrlPlaceholderDiscord')}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="username">{t('notifications.createChannel.botUsername')}</Label>
              <Input
                id="username"
                value={formData.config.username || 'BugSpotter'}
                onChange={(e) => updateConfig('username', e.target.value)}
              />
            </div>
          </>
        );

      case 'teams':
        return (
          <div className="space-y-2">
            <Label htmlFor="webhook_url">{t('notifications.createChannel.webhookUrl')}</Label>
            <Input
              id="webhook_url"
              value={formData.config.webhook_url || ''}
              onChange={(e) => updateConfig('webhook_url', e.target.value)}
              placeholder={t('notifications.createChannel.webhookUrlPlaceholderTeams')}
            />
          </div>
        );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('notifications.createChannel.title')}</DialogTitle>
          <DialogDescription>{t('notifications.createChannel.description')}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">{t('notifications.createChannel.channelName')}</Label>
            <Input
              id="name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder={t('notifications.createChannel.channelNamePlaceholder')}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="type">{t('notifications.createChannel.channelType')}</Label>
            <Select
              value={formData.type}
              onValueChange={(value) =>
                setFormData({ ...formData, type: value as ChannelType, config: {} })
              }
            >
              <SelectTrigger id="type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="email">{t('notifications.createChannel.typeEmail')}</SelectItem>
                <SelectItem value="slack">{t('notifications.createChannel.typeSlack')}</SelectItem>
                <SelectItem value="webhook">
                  {t('notifications.createChannel.typeWebhook')}
                </SelectItem>
                <SelectItem value="discord">
                  {t('notifications.createChannel.typeDiscord')}
                </SelectItem>
                <SelectItem value="teams">{t('notifications.createChannel.typeTeams')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="project">{t('notifications.createChannel.project')}</Label>
            <Select
              value={formData.project_id}
              onValueChange={(value) => setFormData({ ...formData, project_id: value })}
            >
              <SelectTrigger id="project">
                <SelectValue placeholder={t('notifications.createChannel.selectProject')} />
              </SelectTrigger>
              <SelectContent>
                {projects?.map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {renderConfigFields()}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={createMutation.isPending}
            >
              {t('notifications.createChannel.cancel')}
            </Button>
            <Button type="submit" disabled={createMutation.isPending}>
              {createMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  {t('notifications.createChannel.creating')}
                </>
              ) : (
                t('notifications.createChannel.button')
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
