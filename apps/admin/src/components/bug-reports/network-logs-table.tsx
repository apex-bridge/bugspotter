import { useState, useMemo, useCallback } from 'react';
import { Download, CheckCircle, XCircle, Clock } from 'lucide-react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select-radix';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import type { NetworkLogEntry } from '../../types/log-types';
import { formatTimestamp } from '../../utils/format';
import { exportAsJSON, exportAsCSV } from '../../utils/export';

interface NetworkLogsTableProps {
  logs: NetworkLogEntry[];
}

// HTTP Status Code Constants
const HTTP_STATUS = {
  SUCCESS_MIN: 200,
  SUCCESS_MAX: 300,
  REDIRECT_MIN: 300,
  REDIRECT_MAX: 400,
  CLIENT_ERROR_MIN: 400,
  CLIENT_ERROR_MAX: 500,
  SERVER_ERROR_MIN: 500,
} as const;

// HTTP Status Classification
type StatusCategory = 'success' | 'redirect' | 'client-error' | 'server-error' | 'pending';

function getStatusCategory(status?: number): StatusCategory {
  if (!status) {
    return 'pending';
  }
  if (status >= HTTP_STATUS.SUCCESS_MIN && status < HTTP_STATUS.SUCCESS_MAX) {
    return 'success';
  }
  if (status >= HTTP_STATUS.REDIRECT_MIN && status < HTTP_STATUS.REDIRECT_MAX) {
    return 'redirect';
  }
  if (status >= HTTP_STATUS.CLIENT_ERROR_MIN && status < HTTP_STATUS.CLIENT_ERROR_MAX) {
    return 'client-error';
  }
  if (status >= HTTP_STATUS.SERVER_ERROR_MIN) {
    return 'server-error';
  }
  return 'pending';
}

// Helper to get status color
const getStatusColor = (status?: number): string => {
  const category = getStatusCategory(status);

  switch (category) {
    case 'success':
      return 'bg-green-100 text-green-800 border-green-200';
    case 'redirect':
      return 'bg-blue-100 text-blue-800 border-blue-200';
    case 'client-error':
      return 'bg-orange-100 text-orange-800 border-orange-200';
    case 'server-error':
      return 'bg-red-100 text-red-800 border-red-200';
    case 'pending':
    default:
      return 'bg-gray-100 text-gray-800 border-gray-200';
  }
};

// Helper to get status icon
const getStatusIcon = (status?: number) => {
  const className = 'w-4 h-4';
  const category = getStatusCategory(status);

  if (category === 'success' || category === 'redirect') {
    return <CheckCircle className={className} aria-hidden="true" />;
  } else if (category === 'client-error' || category === 'server-error') {
    return <XCircle className={className} aria-hidden="true" />;
  }
  return null;
};

// Helper to format duration
const formatDuration = (duration?: number): string => {
  if (duration === undefined || duration === null) {
    return 'N/A';
  }
  return `${duration}ms`;
};

// Helper to parse URL into domain and path components
const parseUrl = (url: string): { domain: string; path: string } => {
  try {
    const urlObj = new URL(url);
    return {
      domain: urlObj.hostname,
      path: urlObj.pathname + urlObj.search + urlObj.hash,
    };
  } catch {
    // If URL parsing fails, return the whole string as domain
    return { domain: url, path: '' };
  }
};

export function NetworkLogsTable({ logs }: NetworkLogsTableProps) {
  const [filterStatus, setFilterStatus] = useState<'all' | 'success' | 'error' | 'pending'>('all');

  // Filter logs by status
  const filteredLogs = useMemo(() => {
    if (filterStatus === 'all') {
      return logs;
    }

    return logs.filter((log) => {
      const category = getStatusCategory(log.status);

      switch (filterStatus) {
        case 'success':
          return category === 'success';
        case 'error':
          return category === 'client-error' || category === 'server-error';
        case 'pending':
          return category === 'pending';
        default:
          return true;
      }
    });
  }, [logs, filterStatus]);

  // Export handler
  const handleExport = useCallback(
    (format: 'json' | 'csv') => {
      if (format === 'json') {
        exportAsJSON(filteredLogs, 'network-logs');
      } else {
        exportAsCSV(
          filteredLogs,
          ['Timestamp', 'Method', 'URL', 'Status', 'Duration (ms)'],
          (log) => [
            new Date(log.timestamp).toISOString(),
            log.method,
            log.url,
            log.status?.toString() || 'N/A',
            log.duration?.toString() || 'N/A',
          ],
          'network-logs'
        );
      }
    },
    [filteredLogs]
  );

  // Count by status
  const statusCounts = useMemo(
    () =>
      logs.reduce(
        (counts, log) => {
          const category = getStatusCategory(log.status);

          if (category === 'success') {
            counts.success++;
          } else if (category === 'client-error' || category === 'server-error') {
            counts.error++;
          } else if (category === 'pending') {
            counts.pending++;
          }

          return counts;
        },
        { success: 0, error: 0, pending: 0 }
      ),
    [logs]
  );

  return (
    <div className="space-y-4">
      {/* Filters and Export */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <label htmlFor="status-filter" className="text-sm font-medium">
            Filter by Status:
          </label>
          <Select
            value={filterStatus}
            onValueChange={(value) => setFilterStatus(value as typeof filterStatus)}
          >
            <SelectTrigger
              id="status-filter"
              className="w-[180px]"
              aria-label="Filter by request status"
            >
              <SelectValue placeholder="All Requests" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All ({logs.length})</SelectItem>
              <SelectItem value="success">
                <span className="flex items-center gap-2">Success ({statusCounts.success})</span>
              </SelectItem>
              <SelectItem value="error">
                <span className="flex items-center gap-2">Errors ({statusCounts.error})</span>
              </SelectItem>
              <SelectItem value="pending">
                <span className="flex items-center gap-2">Pending ({statusCounts.pending})</span>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleExport('json')}
            aria-label="Export network logs as JSON"
          >
            <Download className="w-4 h-4 mr-2" aria-hidden="true" />
            Export JSON
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleExport('csv')}
            aria-label="Export network logs as CSV"
          >
            <Download className="w-4 h-4 mr-2" aria-hidden="true" />
            Export CSV
          </Button>
        </div>
      </div>

      {/* Table */}
      <div className="border rounded-lg overflow-hidden">
        <div className="max-h-[600px] overflow-y-auto">
          <Table>
            <caption className="sr-only">
              Network log entries with timestamp, method, URL, status, and duration. Showing{' '}
              {filteredLogs.length} of {logs.length} entries.
            </caption>
            <TableHeader className="sticky top-0 bg-gray-50 z-10">
              <TableRow>
                <TableHead className="w-[120px]">Timestamp</TableHead>
                <TableHead className="w-[80px]">Method</TableHead>
                <TableHead className="w-[100px]">Status</TableHead>
                <TableHead>URL</TableHead>
                <TableHead className="w-[100px]">Duration</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredLogs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-gray-500 py-8">
                    No network logs match the selected filter
                  </TableCell>
                </TableRow>
              ) : (
                filteredLogs.map((log, index) => (
                  <TableRow key={`${log.timestamp}-${index}`}>
                    <TableCell className="font-mono text-xs text-gray-600">
                      {formatTimestamp(log.timestamp)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="font-mono text-xs">
                        {log.method}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {log.status ? (
                        <Badge
                          className={getStatusColor(log.status)}
                          role="status"
                          aria-label={`HTTP status: ${log.status}`}
                        >
                          <span className="flex items-center gap-1">
                            {getStatusIcon(log.status)}
                            {log.status}
                          </span>
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-gray-500">
                          <Clock className="w-3 h-3 mr-1" aria-hidden="true" />
                          Pending
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs break-all max-w-md" title={log.url}>
                      {(() => {
                        const { domain, path } = parseUrl(log.url);
                        return (
                          <>
                            <span className="font-semibold">{domain}</span>
                            {path && <span className="text-gray-500">{path}</span>}
                          </>
                        );
                      })()}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-gray-600">
                      {formatDuration(log.duration)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Summary */}
      <div className="text-sm text-gray-600" role="status" aria-live="polite">
        Showing {filteredLogs.length} of {logs.length} network request
        {logs.length !== 1 ? 's' : ''}
      </div>
    </div>
  );
}
