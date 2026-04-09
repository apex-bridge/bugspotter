/**
 * Rules List Component
 * Displays and manages notification rules
 */

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Trash2, Power, Loader2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { notificationService } from '../../services/api';
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

interface RulesListProps {
  onRefresh?: () => void;
  readOnly?: boolean;
}

export function RulesList({ onRefresh, readOnly }: RulesListProps) {
  const queryClient = useQueryClient();
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const { t } = useTranslation();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['notification-rules'],
    queryFn: () => notificationService.getRules({ limit: 100 }),
  });

  const deleteMutation = useMutation({
    mutationFn: notificationService.deleteRule,
    onSuccess: () => {
      toast.success('Rule deleted successfully');
      queryClient.invalidateQueries({ queryKey: ['notification-rules'] });
      setDeleteId(null);
      onRefresh?.();
    },
    onError: (error: Error) => {
      toast.error(`Failed to delete rule: ${error.message}`);
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      notificationService.updateRule(id, { enabled }),
    onSuccess: () => {
      toast.success('Rule status updated');
      queryClient.invalidateQueries({ queryKey: ['notification-rules'] });
    },
    onError: (error: Error) => {
      toast.error(`Failed to update rule: ${error.message}`);
    },
  });

  useEffect(() => {
    if (onRefresh) {
      refetch();
    }
  }, [onRefresh, refetch]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
      </div>
    );
  }

  const rules = data?.rules || [];

  if (rules.length === 0) {
    return (
      <div className="text-center py-12">
        <AlertTriangle className="w-12 h-12 text-gray-400 mx-auto mb-4" />
        <p className="text-gray-600 mb-2">{t('pages.noNotificationRulesConfigured')}</p>
        <p className="text-sm text-gray-500">{t('pages.createFirstRule')}</p>
      </div>
    );
  }

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Project</TableHead>
            <TableHead>Triggers</TableHead>
            <TableHead>Channels</TableHead>
            <TableHead>Order</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rules.map((rule) => (
            <TableRow key={rule.id}>
              <TableCell className="font-medium">{rule.name}</TableCell>
              <TableCell className="text-sm text-gray-600">
                {rule.project_id.slice(0, 8)}...
              </TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-1">
                  {rule.triggers.map((trigger, idx) => (
                    <Badge key={idx} variant="outline" className="text-xs">
                      {trigger.event}
                    </Badge>
                  ))}
                </div>
              </TableCell>
              <TableCell>
                <Badge variant="secondary">{rule.channels?.length || 0} channels</Badge>
              </TableCell>
              <TableCell>
                <Badge
                  variant={rule.priority >= 8 ? 'destructive' : 'outline'}
                  className="font-mono"
                  aria-label={`Execution order: ${rule.priority}`}
                >
                  {rule.priority}
                </Badge>
              </TableCell>
              <TableCell>
                {rule.enabled ? (
                  <Badge variant="default" className="bg-green-600">
                    Enabled
                  </Badge>
                ) : (
                  <Badge variant="secondary">Disabled</Badge>
                )}
              </TableCell>
              <TableCell className="text-right">
                <div className="flex items-center justify-end gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={readOnly}
                    aria-label={rule.enabled ? 'Disable rule' : 'Enable rule'}
                    onClick={() => toggleMutation.mutate({ id: rule.id, enabled: !rule.enabled })}
                  >
                    <Power className="w-4 h-4" aria-hidden="true" />
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={readOnly}
                    aria-label="Delete rule"
                    onClick={() => setDeleteId(rule.id)}
                  >
                    <Trash2 className="w-4 h-4" aria-hidden="true" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Rule</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this notification rule? This action cannot be undone
              and notifications will no longer be sent for this rule.
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
