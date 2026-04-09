import { Code } from 'lucide-react';

interface ConsoleLog {
  timestamp: string | number;
  level: string;
  message: string;
}

interface BugReportConsoleLogsProps {
  logs: ConsoleLog[];
}

export function BugReportConsoleLogs({ logs }: BugReportConsoleLogsProps) {
  if (!logs || logs.length === 0) {
    return (
      <div>
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Code className="w-5 h-5" />
          Console Logs
        </h3>
        <div className="flex items-center justify-center h-64 bg-gray-100 rounded-lg">
          <p className="text-gray-500">No console logs captured</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
        <Code className="w-5 h-5" />
        Console Logs
      </h3>
      <div className="bg-gray-900 rounded-lg p-4 font-mono text-sm overflow-x-auto">
        {logs.map((log, idx) => (
          <div
            key={idx}
            className={`py-1 ${
              log.level === 'error'
                ? 'text-red-400'
                : log.level === 'warn'
                  ? 'text-yellow-400'
                  : log.level === 'info'
                    ? 'text-blue-400'
                    : 'text-gray-300'
            }`}
          >
            <span className="text-gray-500">[{new Date(log.timestamp).toLocaleTimeString()}]</span>{' '}
            <span className="text-gray-400">[{log.level.toUpperCase()}]</span> {log.message}
          </div>
        ))}
      </div>
    </div>
  );
}
