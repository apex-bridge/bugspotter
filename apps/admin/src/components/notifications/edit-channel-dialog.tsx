/**
 * Edit Channel Dialog
 * Form for editing existing notification channels
 */

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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
import { Checkbox } from '../ui/checkbox';
import type { NotificationChannel } from '../../types';

interface EditChannelDialogProps {
  channel: NotificationChannel | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function EditChannelDialog({
  channel,
  open,
  onOpenChange,
  onSuccess,
}: EditChannelDialogProps) {
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState({
    name: '',
    active: true,
    config: {} as Record<string, string>,
  });

  const { data: projects } = useQuery({
    queryKey: ['projects'],
    queryFn: projectService.getAll,
  });

  // Initialize form when channel changes
  useEffect(() => {
    if (channel) {
      setFormData({
        name: channel.name,
        active: channel.active,
        config: channel.config as Record<string, string>,
      });
    }
  }, [channel]);

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      notificationService.updateChannel(id, data),
    onSuccess: () => {
      toast.success('Channel updated successfully');
      queryClient.invalidateQueries({ queryKey: ['notification-channels'] });
      onOpenChange(false);
      onSuccess();
    },
    onError: (error: Error) => {
      toast.error(`Failed to update channel: ${error.message}`);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!channel) {
      return;
    }

    if (!formData.name.trim()) {
      toast.error('Please enter a channel name');
      return;
    }

    updateMutation.mutate({
      id: channel.id,
      data: {
        name: formData.name,
        active: formData.active,
        config: formData.config,
      },
    });
  };

  const renderConfigFields = () => {
    if (!channel) {
      return null;
    }

    switch (channel.type) {
      case 'email':
        return (
          <>
            <div className="space-y-2">
              <Label htmlFor="smtp_host">SMTP Host *</Label>
              <Input
                id="smtp_host"
                value={formData.config.smtp_host || ''}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    config: { ...formData.config, smtp_host: e.target.value },
                  })
                }
                placeholder="smtp.gmail.com"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="smtp_port">SMTP Port *</Label>
              <Input
                id="smtp_port"
                type="number"
                value={formData.config.smtp_port || ''}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    config: { ...formData.config, smtp_port: e.target.value },
                  })
                }
                placeholder="587"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="smtp_user">SMTP Username *</Label>
              <Input
                id="smtp_user"
                value={formData.config.smtp_user || ''}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    config: { ...formData.config, smtp_user: e.target.value },
                  })
                }
                placeholder="your-email@example.com"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="smtp_pass">SMTP Password *</Label>
              <Input
                id="smtp_pass"
                type="password"
                value={formData.config.smtp_pass || ''}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    config: { ...formData.config, smtp_pass: e.target.value },
                  })
                }
                placeholder="••••••••"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="from_address">From Address *</Label>
              <Input
                id="from_address"
                type="email"
                value={formData.config.from_address || ''}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    config: { ...formData.config, from_address: e.target.value },
                  })
                }
                placeholder="notifications@example.com"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="from_name">From Name</Label>
              <Input
                id="from_name"
                value={formData.config.from_name || ''}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    config: { ...formData.config, from_name: e.target.value },
                  })
                }
                placeholder="BugSpotter Notifications"
              />
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox
                id="smtp_secure"
                checked={formData.config.smtp_secure === 'true'}
                onCheckedChange={(checked) =>
                  setFormData({
                    ...formData,
                    config: { ...formData.config, smtp_secure: checked ? 'true' : 'false' },
                  })
                }
              />
              <Label htmlFor="smtp_secure" className="text-sm font-normal">
                Use secure connection (TLS)
              </Label>
            </div>
          </>
        );

      case 'slack':
        return (
          <>
            <div className="space-y-2">
              <Label htmlFor="webhook_url">Webhook URL *</Label>
              <Input
                id="webhook_url"
                value={formData.config.webhook_url || ''}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    config: { ...formData.config, webhook_url: e.target.value },
                  })
                }
                placeholder="https://hooks.slack.com/services/..."
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="channel">Channel</Label>
              <Input
                id="channel"
                value={formData.config.channel || ''}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    config: { ...formData.config, channel: e.target.value },
                  })
                }
                placeholder="#alerts"
              />
            </div>
          </>
        );

      case 'webhook':
        return (
          <>
            <div className="space-y-2">
              <Label htmlFor="url">Webhook URL *</Label>
              <Input
                id="url"
                value={formData.config.url || ''}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    config: { ...formData.config, url: e.target.value },
                  })
                }
                placeholder="https://api.example.com/webhook"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="method">HTTP Method</Label>
              <Select
                value={formData.config.method || 'POST'}
                onValueChange={(value) =>
                  setFormData({ ...formData, config: { ...formData.config, method: value } })
                }
              >
                <SelectTrigger id="method">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="POST">POST</SelectItem>
                  <SelectItem value="PUT">PUT</SelectItem>
                  <SelectItem value="PATCH">PATCH</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="headers">Custom Headers (JSON)</Label>
              <Textarea
                id="headers"
                value={formData.config.headers || ''}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    config: { ...formData.config, headers: e.target.value },
                  })
                }
                placeholder='{"Authorization": "Bearer token"}'
                rows={3}
              />
            </div>
          </>
        );

      case 'discord':
        return (
          <div className="space-y-2">
            <Label htmlFor="webhook_url">Discord Webhook URL *</Label>
            <Input
              id="webhook_url"
              value={formData.config.webhook_url || ''}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  config: { ...formData.config, webhook_url: e.target.value },
                })
              }
              placeholder="https://discord.com/api/webhooks/..."
            />
          </div>
        );

      case 'teams':
        return (
          <div className="space-y-2">
            <Label htmlFor="webhook_url">Teams Webhook URL *</Label>
            <Input
              id="webhook_url"
              value={formData.config.webhook_url || ''}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  config: { ...formData.config, webhook_url: e.target.value },
                })
              }
              placeholder="https://outlook.office.com/webhook/..."
            />
          </div>
        );

      default:
        return null;
    }
  };

  if (!channel) {
    return null;
  }

  const projectName = projects?.find((p) => p.id === channel.project_id)?.name || 'Unknown';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Channel</DialogTitle>
          <DialogDescription>
            Update configuration for this {channel.type} notification channel
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Channel Name *</Label>
            <Input
              id="name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="Production Alerts"
            />
          </div>

          <div className="space-y-2">
            <Label>Project</Label>
            <div className="px-3 py-2 bg-gray-50 rounded-md text-sm text-gray-600">
              {projectName}
            </div>
            <p className="text-xs text-gray-500">Project cannot be changed after creation</p>
          </div>

          <div className="flex items-center space-x-2">
            <Checkbox
              id="active"
              checked={formData.active}
              onCheckedChange={(checked) => setFormData({ ...formData, active: !!checked })}
            />
            <Label htmlFor="active" className="text-sm font-normal">
              Channel is active
            </Label>
          </div>

          {renderConfigFields()}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={updateMutation.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={updateMutation.isPending}>
              {updateMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Updating...
                </>
              ) : (
                'Update Channel'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
