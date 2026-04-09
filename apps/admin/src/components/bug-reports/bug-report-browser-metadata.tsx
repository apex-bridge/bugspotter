import { Globe } from 'lucide-react';

interface BrowserMetadata {
  userAgent?: string;
  url?: string;
  viewport?: { width: number; height: number };
}

interface BugReportBrowserMetadataProps {
  metadata: BrowserMetadata;
}

export function BugReportBrowserMetadata({ metadata }: BugReportBrowserMetadataProps) {
  return (
    <div>
      <h3 className="text-lg font-semibold mb-2 flex items-center gap-2">
        <Globe className="w-5 h-5" />
        Browser Information
      </h3>
      <div className="bg-gray-50 rounded-lg p-4 space-y-2 text-sm">
        {metadata.userAgent && (
          <div>
            <span className="font-medium">User Agent:</span>{' '}
            <span className="text-gray-700">{metadata.userAgent}</span>
          </div>
        )}
        {metadata.url && (
          <div>
            <span className="font-medium">URL:</span>{' '}
            <a
              href={metadata.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              {metadata.url}
            </a>
          </div>
        )}
        {metadata.viewport && (
          <div>
            <span className="font-medium">Viewport:</span>{' '}
            <span className="text-gray-700">
              {metadata.viewport.width} x {metadata.viewport.height}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
