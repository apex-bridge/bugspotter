import { useState, useMemo, useCallback } from 'react';
import { Download, AlertCircle, AlertTriangle, Info, Terminal } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select-radix';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import type { ConsoleLogEntry } from '../../types/log-types';
import { formatTimestamp } from '../../utils/format';
import { exportAsJSON, exportAsCSV } from '../../utils/export';

interface ConsoleLogsTableProps {
  logs: ConsoleLogEntry[];
}

// Log Level Configuration
type LogLevelConfig = {
  color: string;
  icon: LucideIcon;
  label: string;
};

const LOG_LEVEL_CONFIG: Record<ConsoleLogEntry['level'], LogLevelConfig> = {
  error: {
    color: 'bg-red-100 text-red-800 border-red-200',
    icon: AlertCircle,
    label: 'Errors',
  },
  warn: {
    color: 'bg-yellow-100 text-yellow-800 border-yellow-200',
    icon: AlertTriangle,
    label: 'Warnings',
  },
  info: {
    color: 'bg-blue-100 text-blue-800 border-blue-200',
    icon: Info,
    label: 'Info',
  },
  log: {
    color: 'bg-gray-100 text-gray-800 border-gray-200',
    icon: Terminal,
    label: 'Logs',
  },
};

// Helper to get log level color
const getLogLevelColor = (level: ConsoleLogEntry['level']): string => {
  return LOG_LEVEL_CONFIG[level]?.color ?? LOG_LEVEL_CONFIG.log.color;
};

// Helper to get log level icon
const getLogLevelIcon = (level: ConsoleLogEntry['level']) => {
  const config = LOG_LEVEL_CONFIG[level] ?? LOG_LEVEL_CONFIG.log;
  const Icon = config.icon;
  return <Icon className="w-4 h-4" aria-hidden="true" />;
};

export function ConsoleLogsTable({ logs }: ConsoleLogsTableProps) {
  const [filterLevel, setFilterLevel] = useState<'all' | ConsoleLogEntry['level']>('all');

  // Filter logs by level
  const filteredLogs = useMemo(() => {
    if (filterLevel === 'all') {
      return logs;
    }
    return logs.filter((log) => log.level === filterLevel);
  }, [logs, filterLevel]);

  // Export handler
  const handleExport = useCallback(
    (format: 'json' | 'csv') => {
      if (format === 'json') {
        exportAsJSON(filteredLogs, 'console-logs');
      } else {
        exportAsCSV(
          filteredLogs,
          ['Timestamp', 'Level', 'Message'],
          (log) => [new Date(log.timestamp).toISOString(), log.level, log.message],
          'console-logs'
        );
      }
    },
    [filteredLogs]
  );

  // Count by level
  const levelCounts = useMemo(
    () =>
      logs.reduce(
        (counts, log) => {
          counts[log.level] = (counts[log.level] || 0) + 1;
          return counts;
        },
        {} as Record<ConsoleLogEntry['level'], number>
      ),
    [logs]
  );

  return (
    <div className="space-y-4">
      {/* Filters and Export */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <label htmlFor="level-filter" className="text-sm font-medium">
            Filter by Level:
          </label>
          <Select
            value={filterLevel}
            onValueChange={(value) => setFilterLevel(value as typeof filterLevel)}
          >
            <SelectTrigger id="level-filter" className="w-[180px]" aria-label="Filter by log level">
              <SelectValue placeholder="All Levels" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All ({logs.length})</SelectItem>
              {(
                Object.entries(LOG_LEVEL_CONFIG) as [ConsoleLogEntry['level'], LogLevelConfig][]
              ).map(([level, config]) => (
                <SelectItem key={level} value={level}>
                  <span className="flex items-center gap-2">
                    {config.label} ({levelCounts[level] || 0})
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleExport('json')}
            aria-label="Export console logs as JSON"
          >
            <Download className="w-4 h-4 mr-2" aria-hidden="true" />
            Export JSON
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleExport('csv')}
            aria-label="Export console logs as CSV"
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
              Console log entries with timestamp, level, and message. Showing {filteredLogs.length}{' '}
              of {logs.length} entries.
            </caption>
            <TableHeader className="sticky top-0 bg-gray-50 z-10">
              <TableRow>
                <TableHead className="w-[120px]">Timestamp</TableHead>
                <TableHead className="w-[100px]">Level</TableHead>
                <TableHead>Message</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredLogs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-gray-500 py-8">
                    No console logs match the selected filter
                  </TableCell>
                </TableRow>
              ) : (
                filteredLogs.map((log, index) => (
                  <TableRow key={`${log.timestamp}-${index}`}>
                    <TableCell className="font-mono text-xs text-gray-600">
                      {formatTimestamp(log.timestamp)}
                    </TableCell>
                    <TableCell>
                      <Badge
                        className={getLogLevelColor(log.level)}
                        role="status"
                        aria-label={`Log level: ${log.level}`}
                      >
                        <span className="flex items-center gap-1">
                          {getLogLevelIcon(log.level)}
                          <span className="capitalize">{log.level}</span>
                        </span>
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-sm break-all">{log.message}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Summary */}
      <div className="text-sm text-gray-600" role="status" aria-live="polite">
        Showing {filteredLogs.length} of {logs.length} console log
        {logs.length !== 1 ? 's' : ''}
      </div>
    </div>
  );
}
