import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Key, ExternalLink } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { SnippetTabs } from '../ui/snippet-tabs';
import { buildSdkInstallSnippets } from './sdk-install-snippets';

interface SdkSnippetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Use the current page origin as the SDK endpoint. On every supported
 * deployment, the admin host proxies `/api/*` to the backend:
 *   - SaaS prod: `[org].kz.bugspotter.io` (admin nginx → backend) —
 *     and the subdomain is the URL the user already knows from the
 *     dashboard, so it's also the most discoverable endpoint to
 *     hand them.
 *   - Self-hosted: admin and API typically same-origin behind one
 *     reverse proxy.
 *   - Local dev: `vite.config.ts` proxies `/api/*` to `:3000`.
 *
 * Picking the API host directly (e.g. `api.kz.bugspotter.io`) would
 * be technically equivalent on SaaS but contradicts the explicit
 * product decision to surface the tenant subdomain everywhere
 * customer-visible. SSR-safe via the `typeof window` guard.
 */
function currentEndpoint(): string | null {
  return typeof window === 'undefined' ? null : window.location.origin;
}

export function SdkSnippetDialog({ open, onOpenChange }: SdkSnippetDialogProps) {
  const { t } = useTranslation();
  const tabs = useMemo(() => buildSdkInstallSnippets(currentEndpoint()), []);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('quickSetup.snippetDialog.title')}</DialogTitle>
          <DialogDescription>{t('quickSetup.snippetDialog.description')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <SnippetTabs tabs={tabs} ariaLabel={t('quickSetup.snippetDialog.languageLabel')} />

          {/* API key callout */}
          <div className="flex items-start gap-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm">
            <Key className="w-4 h-4 mt-0.5 text-amber-600 flex-shrink-0" aria-hidden="true" />
            <div className="flex-1 text-amber-900">
              <p className="font-medium">{t('quickSetup.snippetDialog.apiKeyTitle')}</p>
              <p className="mt-1 text-amber-800">{t('quickSetup.snippetDialog.apiKeyHelp')}</p>
            </div>
          </div>

          {/* Footer actions */}
          <div className="flex justify-between items-center pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.close')}
            </Button>
            <Link
              to="/api-keys"
              onClick={() => onOpenChange(false)}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-700"
            >
              {t('quickSetup.snippetDialog.manageKeys')}
              <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
            </Link>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
