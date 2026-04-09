import { useState, useEffect, useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertCircle, Clock, CheckCircle } from 'lucide-react';
import { Button } from '../ui/button';
import { Select } from '../ui/select';
import { bugReportService } from '../../services/api';
import { handleApiError } from '../../lib/api-client';
import type { BugReport, BugStatus, BugPriority } from '../../types';

interface BugReportStatusControlsProps {
  report: BugReport;
}

const statusOptions = [
  { value: 'open' as BugStatus, label: 'Open', icon: AlertCircle },
  { value: 'in-progress' as BugStatus, label: 'In Progress', icon: Clock },
  { value: 'resolved' as BugStatus, label: 'Resolved', icon: CheckCircle },
  { value: 'closed' as BugStatus, label: 'Closed', icon: CheckCircle },
];

const priorityOptions = [
  { value: 'low' as BugPriority, label: 'Low' },
  { value: 'medium' as BugPriority, label: 'Medium' },
  { value: 'high' as BugPriority, label: 'High' },
  { value: 'critical' as BugPriority, label: 'Critical' },
];

export function BugReportStatusControls({ report }: BugReportStatusControlsProps) {
  const queryClient = useQueryClient();
  const [editMode, setEditMode] = useState(false);
  const [formData, setFormData] = useState<{ status: BugStatus; priority: BugPriority }>({
    status: report.status,
    priority: report.priority,
  });

  useEffect(() => {
    setFormData({ status: report.status, priority: report.priority });
  }, [report]);

  const updateMutation = useMutation({
    mutationFn: (data: { status?: BugStatus; priority?: BugPriority }) =>
      bugReportService.update(report.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bugReport', report.id] });
      queryClient.invalidateQueries({ queryKey: ['bugReports'] });
      toast.success('Bug report updated successfully');
      setEditMode(false);
    },
    onError: (error) => {
      toast.error(handleApiError(error));
    },
  });

  const handleUpdate = useCallback(() => {
    const changes: { status?: BugStatus; priority?: BugPriority } = {};
    if (formData.status !== report.status) {
      changes.status = formData.status;
    }
    if (formData.priority !== report.priority) {
      changes.priority = formData.priority;
    }

    if (Object.keys(changes).length > 0) {
      updateMutation.mutate(changes);
    } else {
      setEditMode(false);
    }
  }, [formData, report, updateMutation]);

  return (
    <div className="px-6 py-4 bg-gray-50 border-b flex items-center gap-4">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-gray-700">Status:</span>
        {editMode ? (
          <Select
            id="edit-status"
            value={formData.status}
            onChange={(e) => setFormData({ ...formData, status: e.target.value as BugStatus })}
            className="text-sm h-8"
          >
            {statusOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </Select>
        ) : (
          <span className="px-3 py-1 bg-white rounded-md text-sm font-medium">
            {statusOptions.find((s) => s.value === report.status)?.label}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-gray-700">Priority:</span>
        {editMode ? (
          <Select
            id="edit-priority"
            value={formData.priority}
            onChange={(e) => setFormData({ ...formData, priority: e.target.value as BugPriority })}
            className="text-sm h-8"
          >
            {priorityOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </Select>
        ) : (
          <span className="px-3 py-1 bg-white rounded-md text-sm font-medium">
            {priorityOptions.find((p) => p.value === report.priority)?.label}
          </span>
        )}
      </div>

      <div className="ml-auto flex gap-2">
        {editMode ? (
          <>
            <Button size="sm" onClick={handleUpdate} isLoading={updateMutation.isPending}>
              Save Changes
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setEditMode(false)}>
              Cancel
            </Button>
          </>
        ) : (
          <Button size="sm" onClick={() => setEditMode(true)}>
            Edit Status/Priority
          </Button>
        )}
      </div>
    </div>
  );
}
