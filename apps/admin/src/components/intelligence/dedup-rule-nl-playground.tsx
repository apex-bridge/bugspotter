/**
 * Dedup Rule NL Playground — focus-group POC.
 *
 * A textarea + "Parse" button that sends a natural-language rule description
 * to the intelligence service and renders the structured draft (or errors /
 * clarifications) the LLM returns. Intentionally minimal: no save, no edit,
 * no rule list. Lets us validate the NL UX before committing to the full
 * rule-engine surface.
 */

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Sparkles, AlertTriangle, HelpCircle } from 'lucide-react';
import { intelligenceService } from '../../services/intelligence-service';
import { handleApiError } from '../../lib/api-client';
import { SettingsSection } from '../settings/settings-section';
import { Button } from '../ui/button';
import { Label } from '../ui/label';
import type { ParseNLRuleResult } from '../../types/dedup-rule';

interface Props {
  orgId: string;
}

const EXAMPLE_PROMPTS = [
  'when a closed bug gets 3 hits in 24h, reopen it and add a comment',
  'send the reporter an email when their bug is grouped with an existing one',
  'every monday morning email me the top bugs of the week',
];

export function DedupRuleNLPlayground({ orgId }: Props) {
  const { t } = useTranslation();
  const [nl, setNl] = useState('');
  const [apiError, setApiError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (input: string) => intelligenceService.parseNLRule(orgId, { nl: input.trim() }),
    onError: (error) => {
      setApiError(handleApiError(error));
    },
    onSuccess: () => {
      setApiError(null);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (nl.trim().length < 5) {
      return;
    }
    setApiError(null);
    mutation.mutate(nl);
  };

  const result: ParseNLRuleResult | undefined = mutation.data;

  return (
    <SettingsSection
      title={t('intelligence.nlPlayground.title')}
      description={t('intelligence.nlPlayground.description')}
    >
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <Label htmlFor="nl-input">{t('intelligence.nlPlayground.inputLabel')}</Label>
          <textarea
            id="nl-input"
            value={nl}
            onChange={(e) => setNl(e.target.value)}
            placeholder={t('intelligence.nlPlayground.placeholder')}
            rows={3}
            maxLength={2000}
            className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-sans
                       focus:outline-none focus:ring-2 focus:ring-primary resize-y"
          />
          <div className="mt-1 flex items-center justify-between text-xs text-gray-500">
            <span>{nl.length} / 2000</span>
            <span>{t('intelligence.nlPlayground.minHint')}</span>
          </div>
        </div>

        {/* Example prompts */}
        <div className="flex flex-wrap gap-2">
          <span className="text-xs text-gray-500 self-center">
            {t('intelligence.nlPlayground.tryLabel')}:
          </span>
          {EXAMPLE_PROMPTS.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => setNl(ex)}
              className="text-xs px-2 py-1 rounded border border-gray-300 bg-white
                         hover:bg-gray-50 text-gray-700"
            >
              {ex.length > 60 ? ex.slice(0, 57) + '…' : ex}
            </button>
          ))}
        </div>

        <Button type="submit" size="sm" disabled={mutation.isPending || nl.trim().length < 5}>
          <Sparkles className="mr-1.5 h-4 w-4" aria-hidden="true" />
          {mutation.isPending
            ? t('intelligence.nlPlayground.parsing')
            : t('intelligence.nlPlayground.parseButton')}
        </Button>
      </form>

      {apiError && (
        <div className="mt-4 flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded">
          <AlertTriangle className="h-4 w-4 text-red-500 mt-0.5" aria-hidden="true" />
          <p className="text-sm text-red-700">{apiError}</p>
        </div>
      )}

      {result && <ParseResultDisplay result={result} />}
    </SettingsSection>
  );
}

function ParseResultDisplay({ result }: { result: ParseNLRuleResult }) {
  const { t } = useTranslation();

  return (
    <div className="mt-4 space-y-3">
      {result.errors.length > 0 && (
        <div className="p-3 bg-red-50 border border-red-200 rounded">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="h-4 w-4 text-red-500" aria-hidden="true" />
            <span className="text-sm font-semibold text-red-700">
              {t('intelligence.nlPlayground.errorsLabel')}
            </span>
          </div>
          <ul className="text-sm text-red-700 list-disc list-inside space-y-1">
            {result.errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      {result.clarifications.length > 0 && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded">
          <div className="flex items-center gap-2 mb-2">
            <HelpCircle className="h-4 w-4 text-amber-600" aria-hidden="true" />
            <span className="text-sm font-semibold text-amber-700">
              {t('intelligence.nlPlayground.clarificationsLabel')}
            </span>
          </div>
          <ul className="text-sm text-amber-700 list-disc list-inside space-y-1">
            {result.clarifications.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </div>
      )}

      {result.draft && (
        <div className="border border-gray-300 rounded bg-white">
          <div className="px-3 py-2 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-800">{result.draft.name}</span>
            <span className="text-xs text-gray-500 font-mono">model: {result.model}</span>
          </div>
          <pre className="text-xs p-3 overflow-x-auto font-mono text-gray-800 bg-white whitespace-pre-wrap">
            {JSON.stringify(result.draft, null, 2)}
          </pre>
        </div>
      )}

      {!result.draft && result.errors.length === 0 && result.clarifications.length === 0 && (
        <p className="text-sm text-gray-500 italic">
          {t('intelligence.nlPlayground.emptyResponse')}
        </p>
      )}
    </div>
  );
}
