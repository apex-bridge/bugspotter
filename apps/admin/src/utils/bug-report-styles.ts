/**
 * Shared styling utilities for bug reports
 */

import type { LucideIcon } from 'lucide-react';
import { AlertCircle, Clock, CheckCircle } from 'lucide-react';

export type BugStatus = 'open' | 'in_progress' | 'resolved' | 'closed';
export type BugPriority = 'low' | 'medium' | 'high' | 'critical';

interface StatusConfig {
  label: string;
  color: string;
  icon: LucideIcon;
}

interface PriorityConfig {
  label: string;
  color: string;
}

/**
 * Status configuration with labels, colors, and icons
 */
export const statusConfig: Record<BugStatus, StatusConfig> = {
  open: { label: 'Open', color: 'bg-blue-100 text-blue-800', icon: AlertCircle },
  in_progress: { label: 'In Progress', color: 'bg-yellow-100 text-yellow-800', icon: Clock },
  resolved: { label: 'Resolved', color: 'bg-green-100 text-green-800', icon: CheckCircle },
  closed: { label: 'Closed', color: 'bg-gray-100 text-gray-800', icon: CheckCircle },
};

/**
 * Priority configuration with labels and colors
 */
export const priorityConfig: Record<BugPriority, PriorityConfig> = {
  low: { label: 'Low', color: 'bg-green-100 text-green-800' },
  medium: { label: 'Medium', color: 'bg-yellow-100 text-yellow-800' },
  high: { label: 'High', color: 'bg-orange-100 text-orange-800' },
  critical: { label: 'Critical', color: 'bg-red-100 text-red-800' },
};

/**
 * Get status badge color classes
 * @param status - Bug report status
 * @returns Tailwind CSS classes for status badge
 */
export function getStatusColor(status: string): string {
  const normalizedStatus = status.replace('-', '_') as BugStatus;
  return statusConfig[normalizedStatus]?.color || 'bg-gray-100 text-gray-800';
}

/**
 * Get priority badge color classes
 * @param priority - Bug report priority
 * @returns Tailwind CSS classes for priority badge
 */
export function getPriorityColor(priority: string): string {
  return priorityConfig[priority as BugPriority]?.color || 'bg-gray-100 text-gray-800';
}
