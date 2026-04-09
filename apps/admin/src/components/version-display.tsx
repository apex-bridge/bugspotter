import { APP_VERSION, getVersionString } from '@/lib/version';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

export function VersionDisplay() {
  const shortCommit = APP_VERSION.commit.substring(0, 7);
  const buildDate = new Date(APP_VERSION.buildDate).toLocaleDateString('en-CA');

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="text-xs text-muted-foreground cursor-help hover:text-foreground transition-colors">
            {getVersionString()}
          </span>
        </TooltipTrigger>
        <TooltipContent>
          <div className="space-y-1 text-xs">
            <p>
              <strong>Version:</strong> {APP_VERSION.version}
            </p>
            <p>
              <strong>Commit:</strong> {shortCommit}
            </p>
            <p>
              <strong>Built:</strong> {buildDate}
            </p>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
