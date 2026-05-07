import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Copy, Check } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface CodeSnippetProps {
  /** The code to render and copy. */
  code: string;
  /** Optional language hint — currently used for the `aria-label` and a future syntax highlighter. */
  language?: string;
  /** Optional accessible label for the copy button (defaults to `common.copy`). */
  copyLabel?: string;
  /** Toast text shown on successful copy (defaults to `common.copied`). */
  copiedToast?: string;
  /** Extra classes for the outer wrapper. */
  className?: string;
  /** Test hook for the inner `<pre>`. */
  testId?: string;
}

/**
 * Reusable dark-themed code block with a built-in copy-to-clipboard
 * button. The visual primitive for any snippet rendered in the admin
 * UI (SDK install, curl example, CLI command, …). Higher-level
 * containers like `<SnippetTabs>` compose this.
 */
export function CodeSnippet({
  code,
  language,
  copyLabel,
  copiedToast,
  className,
  testId,
}: CodeSnippetProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const revertTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const handleCopy = useCallback(async () => {
    if (!navigator.clipboard) {
      toast.error(t('common.copyFailed'));
      return;
    }
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      toast.success(copiedToast ?? t('common.copied'));
      // Cancel any in-flight revert from a prior click so rapid re-clicks
      // don't flicker the label back to "Copy" mid-second.
      if (revertTimerRef.current) {
        clearTimeout(revertTimerRef.current);
      }
      revertTimerRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t('common.copyFailed'));
    }
  }, [code, copiedToast, t]);

  // Clean up on unmount so we don't setState on a torn-down component
  // (e.g. snippet dialog closed before the 2s revert fires).
  useEffect(() => {
    return () => {
      if (revertTimerRef.current) {
        clearTimeout(revertTimerRef.current);
      }
    };
  }, []);

  return (
    <div className={cn('relative rounded-md bg-slate-900 text-slate-100', className)}>
      <pre
        data-testid={testId}
        data-language={language}
        className="overflow-x-auto p-4 text-xs font-mono leading-relaxed whitespace-pre"
      >
        <code>{code}</code>
      </pre>
      <button
        type="button"
        onClick={handleCopy}
        className="absolute top-2 right-2 inline-flex items-center gap-1.5 rounded-md bg-slate-800/90 px-2.5 py-1 text-xs font-medium text-slate-100 hover:bg-slate-700/90 focus:outline-none focus:ring-2 focus:ring-blue-500"
        aria-label={copyLabel ?? t('common.copy')}
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
  );
}
