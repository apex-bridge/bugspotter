import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Copy, Check, Key, ExternalLink } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { cn } from '../../lib/utils';

type Language = 'javascript' | 'typescript' | 'react';

interface SdkSnippetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Project the snippet should target. The id is inlined into the snippet. */
  projectId: string | null;
}

const LANGUAGES: { id: Language; label: string }[] = [
  { id: 'javascript', label: 'JavaScript' },
  { id: 'typescript', label: 'TypeScript' },
  { id: 'react', label: 'React' },
];

/**
 * Build the install snippet for a given language.
 *
 * The API key is intentionally a placeholder. Plaintext keys are only
 * returned by the backend at creation time (see api-key-service.ts), so
 * the dialog can't safely re-display the key for an existing tenant.
 * `JSON.stringify` is used for the projectId so a pathological id with
 * quotes/backslashes/newlines doesn't break the generated snippet.
 */
function buildSnippet(language: Language, projectId: string | null): string {
  const apiKeyToken = "'<paste your API key>'";
  const projectIdToken = projectId ? JSON.stringify(projectId) : "'<your-project-id>'";

  switch (language) {
    case 'typescript':
    case 'javascript':
      return `import BugSpotter from '@bugspotter/sdk';

BugSpotter.init({
  apiKey: ${apiKeyToken},
  projectId: ${projectIdToken},
});`;
    case 'react':
      return `import BugSpotter from '@bugspotter/sdk';

// Place once near your app's entry point (e.g. main.tsx, _app.tsx)
BugSpotter.init({
  apiKey: ${apiKeyToken},
  projectId: ${projectIdToken},
});`;
  }
}

export function SdkSnippetDialog({ open, onOpenChange, projectId }: SdkSnippetDialogProps) {
  const { t } = useTranslation();
  const [language, setLanguage] = useState<Language>('javascript');
  const [copied, setCopied] = useState(false);

  const snippet = useMemo(() => buildSnippet(language, projectId), [language, projectId]);

  const handleCopy = useCallback(async () => {
    if (!navigator.clipboard) {
      toast.error(t('common.copyFailed'));
      return;
    }
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      toast.success(t('quickSetup.snippetDialog.copied'));
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t('common.copyFailed'));
    }
  }, [snippet, t]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('quickSetup.snippetDialog.title')}</DialogTitle>
          <DialogDescription>{t('quickSetup.snippetDialog.description')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Language picker */}
          <div
            role="tablist"
            aria-label={t('quickSetup.snippetDialog.languageLabel')}
            className="flex gap-1 border-b border-gray-200"
          >
            {LANGUAGES.map((lang) => (
              <button
                key={lang.id}
                type="button"
                role="tab"
                aria-selected={language === lang.id}
                onClick={() => setLanguage(lang.id)}
                className={cn(
                  'px-3 py-1.5 text-sm font-medium border-b-2 transition-colors',
                  language === lang.id
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                )}
              >
                {lang.label}
              </button>
            ))}
          </div>

          {/* Code block */}
          <div className="relative rounded-md bg-slate-900 text-slate-100">
            <pre
              data-testid="sdk-snippet-code"
              className="overflow-x-auto p-4 text-xs font-mono leading-relaxed whitespace-pre"
            >
              <code>{snippet}</code>
            </pre>
            <button
              type="button"
              onClick={handleCopy}
              className="absolute top-2 right-2 inline-flex items-center gap-1.5 rounded-md bg-slate-800/90 px-2.5 py-1 text-xs font-medium text-slate-100 hover:bg-slate-700/90 focus:outline-none focus:ring-2 focus:ring-blue-500"
              aria-label={t('quickSetup.snippetDialog.copy')}
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5" aria-hidden="true" />
                  {t('common.copied')}
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                  {t('common.copy')}
                </>
              )}
            </button>
          </div>

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
