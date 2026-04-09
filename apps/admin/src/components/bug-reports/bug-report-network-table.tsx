interface NetworkRequest {
  method: string;
  url: string;
  status: number;
}

interface BugReportNetworkTableProps {
  requests: NetworkRequest[];
}

export function BugReportNetworkTable({ requests }: BugReportNetworkTableProps) {
  if (!requests || requests.length === 0) {
    return null;
  }

  return (
    <div>
      <h3 className="text-lg font-semibold mb-2">Network Requests</h3>
      <div className="bg-gray-50 rounded-lg overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-100">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-700">Method</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-700">URL</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-700">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 bg-white">
            {requests.map((req, idx) => (
              <tr key={idx}>
                <td className="px-4 py-2 text-sm font-mono">{req.method}</td>
                <td className="px-4 py-2 text-sm truncate max-w-md" title={req.url}>
                  {req.url}
                </td>
                <td className="px-4 py-2 text-sm">
                  <span
                    className={`px-2 py-1 rounded text-xs font-medium ${
                      req.status >= 200 && req.status < 300
                        ? 'bg-green-100 text-green-800'
                        : req.status >= 400
                          ? 'bg-red-100 text-red-800'
                          : 'bg-gray-100 text-gray-800'
                    }`}
                  >
                    {req.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
