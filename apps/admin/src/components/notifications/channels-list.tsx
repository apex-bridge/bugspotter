/**
 * Channels List Component
 * Displays and manages notification channels
 */

import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Mail,
  MessageSquare,
  Webhook,
  Hash,
  Users,
  Trash2,
  Power,
  TestTube,
  Loader2,
  Bell,
  Pencil,
} from 'lucide-react';
import { toast } from 'sonner';
import { notificationService, projectService } from '../../services/api';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../ui/alert-dialog';
import { EditChannelDialog } from './edit-channel-dialog';
import type { ChannelType, NotificationChannel } from '../../types';

interface ChannelsListProps {
  onRefresh?: () => void;
  readOnly?: boolean;
}

const channelIcons: Record<ChannelType, React.ReactNode> = {
  email: <Mail className="w-4 h-4" />,
  slack: <MessageSquare className="w-4 h-4" />,
  webhook: <Webhook className="w-4 h-4" />,
  discord: <Hash className="w-4 h-4" />,
  teams: <Users className="w-4 h-4" />,
};

export function ChannelsList({ onRefresh, readOnly }: ChannelsListProps) {
  const queryClient = useQueryClient();
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [editChannel, setEditChannel] = useState<NotificationChannel | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['notification-channels'],
    queryFn: () => notificationService.getChannels({ limit: 100 }),
  });

  const { data: projects, isLoading: projectsLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: projectService.getAll,
  });

  const projectMap = useMemo(() => {
    if (!projects) {
      return new Map();
    }
    return new Map(projects.map((p) => [p.id, p.name]));
  }, [projects]);

  const deleteMutation = useMutation({
    mutationFn: notificationService.deleteChannel,
    onSuccess: () => {
      toast.success('Channel deleted successfully');
      queryClient.invalidateQueries({ queryKey: ['notification-channels'] });
      setDeleteId(null);
      onRefresh?.();
    },
    onError: (error: Error) => {
      toast.error(`Failed to delete channel: ${error.message}`);
    },
  });

  const testMutation = useMutation({
    mutationFn: ({ id, message }: { id: string; message?: string }) =>
      notificationService.testChannel(id, message),
    onSuccess: (result) => {
      if (result.delivered) {
        toast.success('Test notification sent successfully');
      } else {
        toast.error(`Test failed: ${result.error || 'Unknown error'}`);
      }
      setTestingId(null);
    },
    onError: (error: Error) => {
      toast.error(`Test failed: ${error.message}`);
      setTestingId(null);
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      notificationService.updateChannel(id, { active }),
    onSuccess: () => {
      toast.success('Channel status updated');
      queryClient.invalidateQueries({ queryKey: ['notification-channels'] });
    },
    onError: (error: Error) => {
      toast.error(`Failed to update channel: ${error.message}`);
    },
  });

  useEffect(() => {
    if (onRefresh) {
      refetch();
    }
  }, [onRefresh, refetch]);

  if (isLoading || projectsLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
      </div>
    );
  }

  const channels = data?.channels || [];

  if (channels.length === 0) {
    return (
      <div className="text-center py-12">
        <Bell className="w-12 h-12 text-gray-400 mx-auto mb-4" />
        <p className="text-gray-600 mb-2">No notification channels configured</p>
        <p className="text-sm text-gray-500">Create your first channel to get started</p>
      </div>
    );
  }

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Project</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Last Success</TableHead>
            <TableHead>Failures</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {channels.map((channel) => (
            <TableRow key={channel.id}>
              <TableCell className="font-medium">
                <div className="flex items-center gap-2">
                  {channelIcons[channel.type]}
                  {channel.name}
                </div>
              </TableCell>
              <TableCell>
                <Badge variant="outline" className="capitalize">
                  {channel.type}
                </Badge>
              </TableCell>
              <TableCell className="text-sm text-gray-600">
                {projectMap.get(channel.project_id) || channel.project_id}
              </TableCell>
              <TableCell>
                {channel.active ? (
                  <Badge variant="default" className="bg-green-600">
                    Active
                  </Badge>
                ) : (
                  <Badge variant="secondary">Inactive</Badge>
                )}
              </TableCell>
              <TableCell className="text-sm text-gray-600">
                {channel.last_success_at
                  ? new Date(channel.last_success_at).toLocaleString()
                  : 'Never'}
              </TableCell>
              <TableCell>
                {channel.failure_count > 0 ? (
                  <Badge variant="destructive">{channel.failure_count}</Badge>
                ) : (
                  <span className="text-sm text-gray-500">0</span>
                )}
              </TableCell>
              <TableCell className="text-right">
                <div className="flex items-center justify-end gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setTestingId(channel.id);
                      testMutation.mutate({
                        id: channel.id,
                        message: 'Test notification from BugSpotter admin panel',
                      });
                    }}
                    disabled={readOnly || testingId === channel.id}
                    aria-label="Test channel"
                  >
                    {testingId === channel.id ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <TestTube className="w-4 h-4" />
                    )}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={readOnly}
                    onClick={() => setEditChannel(channel)}
                    aria-label="Edit channel"
                  >
                    <Pencil className="w-4 h-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={readOnly}
                    onClick={() =>
                      toggleMutation.mutate({ id: channel.id, active: !channel.active })
                    }
                    aria-label={channel.active ? 'Deactivate channel' : 'Activate channel'}
                  >
                    <Power className="w-4 h-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={readOnly}
                    onClick={() => setDeleteId(channel.id)}
                    aria-label="Delete channel"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <EditChannelDialog
        channel={editChannel}
        open={!!editChannel}
        onOpenChange={(open) => !open && setEditChannel(null)}
        onSuccess={() => {
          setEditChannel(null);
          onRefresh?.();
        }}
      />

      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Channel</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this notification channel? This action cannot be
              undone and will remove all associated notification rules.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteId && deleteMutation.mutate(deleteId)}
              className="bg-red-600 hover:bg-red-700"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
