import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Key, ExternalLink } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { SnippetTabs } from '../ui/snippet-tabs';
import { buildSdkInstallSnippets } from './sdk-install-snippets';
import { API_BASE_URL } from '../../lib/api-client';

interface SdkSnippetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * The endpoint the SDK needs to point at — the *API* host, not the
 * admin UI host. These can be the same origin on some deployments
 * (admin's nginx proxies `/api/*`), but in cross-origin setups (SaaS
 * prod has admin at `[org].kz.bugspotter.io` and API at
 * `api.kz.bugspotter.io`; local dev runs admin on `:5173` and API on
 * `:3000`) `window.location.origin` is the admin UI host and would
 * misdirect the SDK.
 *
 * `API_BASE_URL` (`lib/api-client.ts:16`) is exactly the value
 * `axios.create({ baseURL })` uses for this admin's own API calls,
 * so the SDK ends up pointed at the same place the admin agrees on.
 *
 * Falls back to `null` when `API_BASE_URL` is empty (local dev with
 * same-origin proxy — there's no absolute URL to hand the SDK in
 * that case, so the snippet shows a placeholder for the user to
 * replace by hand).
 */
function currentEndpoint(): string | null {
  return API_BASE_URL || null;
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
