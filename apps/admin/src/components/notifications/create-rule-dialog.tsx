/**
 * Create Rule Dialog
 * Form for creating new notification rules
 */

import { useState } from 'react';
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
import { Checkbox } from '../ui/checkbox';
import type { TriggerEvent } from '../../types';

interface CreateRuleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function CreateRuleDialog({ open, onOpenChange, onSuccess }: CreateRuleDialogProps) {
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState({
    name: '',
    project_id: '',
    enabled: true,
    priority: 5,
    trigger_event: 'new_bug' as TriggerEvent,
    channel_ids: [] as string[],
  });

  const { data: projects } = useQuery({
    queryKey: ['projects'],
    queryFn: projectService.getAll,
  });

  const { data: channelsData } = useQuery({
    queryKey: ['notification-channels', formData.project_id],
    queryFn: () =>
      notificationService.getChannels({
        project_id: formData.project_id || undefined,
        active: true,
        limit: 100,
      }),
    enabled: !!formData.project_id,
  });

  const createMutation = useMutation({
    mutationFn: notificationService.createRule,
    onSuccess: () => {
      toast.success('Notification rule created successfully');
      queryClient.invalidateQueries({ queryKey: ['notification-rules'] });
      onSuccess();
      // Reset form
      setFormData({
        name: '',
        project_id: '',
        enabled: true,
        priority: 5,
        trigger_event: 'new_bug',
        channel_ids: [],
      });
    },
    onError: (error: Error) => {
      toast.error(`Failed to create rule: ${error.message}`);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.name || !formData.project_id || formData.channel_ids.length === 0) {
      toast.error('Please fill in all required fields and select at least one channel');
      return;
    }

    createMutation.mutate({
      ...formData,
      triggers: [
        {
          event: formData.trigger_event,
        },
      ],
    });
  };

  const toggleChannel = (channelId: string) => {
    setFormData((prev) => ({
      ...prev,
      channel_ids: prev.channel_ids.includes(channelId)
        ? prev.channel_ids.filter((id) => id !== channelId)
        : [...prev.channel_ids, channelId],
    }));
  };

  const channels = channelsData?.channels || [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Create Notification Rule</DialogTitle>
          <DialogDescription>Define when and where notifications should be sent</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Rule Name *</Label>
            <Input
              id="name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="Critical Bug Alert"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="project">Project *</Label>
            <Select
              value={formData.project_id}
              onValueChange={(value) =>
                setFormData({ ...formData, project_id: value, channel_ids: [] })
              }
            >
              <SelectTrigger id="project">
                <SelectValue placeholder="Select a project" />
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

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="trigger">Trigger Event *</Label>
              <Select
                value={formData.trigger_event}
                onValueChange={(value) =>
                  setFormData({ ...formData, trigger_event: value as TriggerEvent })
                }
              >
                <SelectTrigger id="trigger">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="new_bug">New Bug Report</SelectItem>
                  <SelectItem value="bug_resolved">Bug Resolved</SelectItem>
                  <SelectItem value="priority_change">Priority Changed</SelectItem>
                  <SelectItem value="threshold_reached">Threshold Reached</SelectItem>
                  <SelectItem value="error_spike">Error Spike Detected</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="priority">Priority (1-10)</Label>
              <Input
                id="priority"
                type="number"
                min="1"
                max="10"
                value={formData.priority}
                onChange={(e) =>
                  setFormData({ ...formData, priority: parseInt(e.target.value) || 5 })
                }
              />
            </div>
          </div>

          {formData.project_id && (
            <div className="space-y-2">
              <Label>Notification Channels * (Select at least one)</Label>
              {channels.length === 0 ? (
                <p className="text-sm text-gray-500">
                  No active channels found for this project. Create a channel first.
                </p>
              ) : (
                <div className="border rounded-md p-4 space-y-2 max-h-48 overflow-y-auto">
                  {channels.map((channel) => (
                    <div key={channel.id} className="flex items-center space-x-2">
                      <Checkbox
                        id={channel.id}
                        checked={formData.channel_ids.includes(channel.id)}
                        onCheckedChange={() => toggleChannel(channel.id)}
                      />
                      <label
                        htmlFor={channel.id}
                        className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                      >
                        {channel.name} ({channel.type})
                      </label>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="flex items-center space-x-2">
            <Checkbox
              id="enabled"
              checked={formData.enabled}
              onCheckedChange={(checked) => setFormData({ ...formData, enabled: !!checked })}
            />
            <label
              htmlFor="enabled"
              className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
            >
              Enable rule immediately
            </label>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={createMutation.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={createMutation.isPending}>
              {createMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                'Create Rule'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
