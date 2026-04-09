/**
 * History List Component
 * Displays notification delivery history
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Loader2, CheckCircle, XCircle, Clock, Ban, ChevronDown, ChevronRight } from 'lucide-react';
import { notificationService } from '../../services/api';
import { Badge } from '../ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select-radix';
import type { NotificationStatus } from '../../types';

const statusIcons: Record<NotificationStatus, React.ReactNode> = {
  sent: <CheckCircle className="w-4 h-4 text-green-600" />,
  failed: <XCircle className="w-4 h-4 text-red-600" />,
  pending: <Clock className="w-4 h-4 text-yellow-600" />,
  throttled: <Ban className="w-4 h-4 text-orange-600" />,
};

const statusColors: Record<NotificationStatus, string> = {
  sent: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
  pending: 'bg-yellow-100 text-yellow-800',
  throttled: 'bg-orange-100 text-orange-800',
};

export function HistoryList() {
  const { t } = useTranslation();
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [page, setPage] = useState(1);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const limit = 20;

  const { data, isLoading } = useQuery({
    queryKey: ['notification-history', statusFilter, page],
    queryFn: () =>
      notificationService.getHistory({
        status: statusFilter === 'all' ? undefined : statusFilter,
        page,
        limit,
      }),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
      </div>
    );
  }

  const history = data?.history || [];
  const pagination = data?.pagination;

  const toggleRow = (id: string) => {
    const newExpanded = new Set(expandedRows);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedRows(newExpanded);
  };

  if (history.length === 0) {
    return (
      <div className="text-center py-12">
        <Clock className="w-12 h-12 text-gray-400 mx-auto mb-4" />
        <p className="text-gray-600 mb-2">{t('pages.noNotificationHistory')}</p>
        <p className="text-sm text-gray-500">{t('pages.notificationDeliveriesAppearHere')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex items-center gap-4">
        <div className="flex-1">
          <label className="text-sm font-medium text-gray-700 mb-2 block">Filter by status</label>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="sent">Sent</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="throttled">Throttled</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Table */}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10"></TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Channel</TableHead>
            <TableHead>Rule</TableHead>
            <TableHead>Recipients</TableHead>
            <TableHead>Attempts</TableHead>
            <TableHead>Delivered</TableHead>
            <TableHead>Created</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {history.map((item) => {
            const isExpanded = expandedRows.has(item.id);
            return (
              <>
                <TableRow
                  key={item.id}
                  className="cursor-pointer hover:bg-gray-50"
                  onClick={() => toggleRow(item.id)}
                >
                  <TableCell>
                    {isExpanded ? (
                      <ChevronDown className="w-4 h-4 text-gray-500" />
                    ) : (
                      <ChevronRight className="w-4 h-4 text-gray-500" />
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {statusIcons[item.status]}
                      <Badge className={statusColors[item.status]} variant="secondary">
                        {item.status}
                      </Badge>
                    </div>
                  </TableCell>
                  <TableCell>
                    {item.channel_name ? (
                      <div>
                        <div className="font-medium">{item.channel_name}</div>
                        <div className="text-xs text-gray-500 capitalize">{item.channel_type}</div>
                      </div>
                    ) : (
                      <span className="text-gray-400">N/A</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {item.rule_name ? (
                      <span className="text-sm">{item.rule_name}</span>
                    ) : (
                      <span className="text-gray-400">N/A</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{item.recipients.length} recipients</Badge>
                  </TableCell>
                  <TableCell>
                    <span className="text-sm text-gray-600">{item.attempts}</span>
                  </TableCell>
                  <TableCell>
                    {item.delivered_at ? (
                      <span className="text-sm text-gray-600">
                        {new Date(item.delivered_at).toLocaleString()}
                      </span>
                    ) : (
                      <span className="text-gray-400">Not delivered</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <span className="text-sm text-gray-600">
                      {new Date(item.created_at).toLocaleString()}
                    </span>
                  </TableCell>
                </TableRow>

                {/* Expanded Details Row */}
                {isExpanded && (
                  <TableRow key={`${item.id}-details`}>
                    <TableCell colSpan={8} className="bg-gray-50 p-6">
                      <div className="space-y-4">
                        {/* Recipients */}
                        <div>
                          <h4 className="text-sm font-semibold text-gray-700 mb-2">Recipients</h4>
                          <div className="flex flex-wrap gap-2">
                            {item.recipients.map((recipient, idx) => (
                              <Badge key={idx} variant="outline" className="text-xs">
                                {recipient}
                              </Badge>
                            ))}
                          </div>
                        </div>

                        {/* Payload */}
                        {item.payload && (
                          <div>
                            <h4 className="text-sm font-semibold text-gray-700 mb-2">Payload</h4>
                            <pre className="bg-white p-3 rounded border text-xs overflow-x-auto">
                              {JSON.stringify(item.payload, null, 2)}
                            </pre>
                          </div>
                        )}

                        {/* Response */}
                        {item.response && (
                          <div>
                            <h4 className="text-sm font-semibold text-gray-700 mb-2">Response</h4>
                            <pre className="bg-white p-3 rounded border text-xs overflow-x-auto">
                              {JSON.stringify(item.response, null, 2)}
                            </pre>
                          </div>
                        )}

                        {/* Error */}
                        {item.error && (
                          <div>
                            <h4 className="text-sm font-semibold text-red-700 mb-2">Error</h4>
                            <div className="bg-red-50 p-3 rounded border border-red-200 text-sm text-red-800">
                              {item.error}
                            </div>
                          </div>
                        )}

                        {/* Bug Details */}
                        {item.bug_title && (
                          <div>
                            <h4 className="text-sm font-semibold text-gray-700 mb-2">Bug Report</h4>
                            <div className="text-sm text-gray-600">{item.bug_title}</div>
                          </div>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </>
            );
          })}
        </TableBody>
      </Table>

      {/* Pagination */}
      {pagination && pagination.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <div className="text-sm text-gray-600">
            Page {pagination.page} of {pagination.totalPages} ({pagination.total} total)
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={pagination.page === 1}
              className="px-3 py-1 text-sm border rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Previous
            </button>
            <button
              onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
              disabled={pagination.page === pagination.totalPages}
              className="px-3 py-1 text-sm border rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
