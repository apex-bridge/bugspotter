import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, Brain, Zap } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Badge } from '../ui/badge';
import { intelligenceService } from '../../services/intelligence-service';
import type { SearchResponse } from '../../types/intelligence';

interface SemanticSearchBarProps {
  projectId: string;
  onResultSelect: (bugId: string) => void;
}

export function SemanticSearchBar({ projectId, onResultSelect }: SemanticSearchBarProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<'fast' | 'smart'>('fast');
  const [isSearching, setIsSearching] = useState(false);
  const [results, setResults] = useState<SearchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSearch = async () => {
    if (!query.trim()) {
      return;
    }
    setIsSearching(true);
    setError(null);
    try {
      const data = await intelligenceService.search(projectId, {
        query: query.trim(),
        mode,
        limit: 10,
      });
      setResults(data);
    } catch (err) {
      console.error('Semantic search failed:', err);
      setError(t('intelligence.search.error'));
    } finally {
      setIsSearching(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !isSearching) {
      handleSearch();
    }
  };

  const handleClear = () => {
    setQuery('');
    setResults(null);
    setError(null);
  };

  return (
    <div className="mb-4">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
            aria-hidden="true"
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('intelligence.search.placeholder')}
            className="pl-9 pr-4"
          />
        </div>

        <button
          type="button"
          onClick={() => setMode(mode === 'fast' ? 'smart' : 'fast')}
          disabled={isSearching}
          className="flex items-center gap-1 px-3 py-2 rounded-md border text-xs font-medium transition-colors hover:bg-purple-50 disabled:opacity-50"
          title={t('intelligence.search.modeLabel')}
        >
          {mode === 'fast' ? (
            <>
              <Zap className="w-3.5 h-3.5 text-amber-500" aria-hidden="true" />
              {t('intelligence.search.modeFast')}
            </>
          ) : (
            <>
              <Brain className="w-3.5 h-3.5 text-purple-500" aria-hidden="true" />
              {t('intelligence.search.modeSmart')}
            </>
          )}
        </button>

        <Button
          size="sm"
          onClick={handleSearch}
          isLoading={isSearching}
          disabled={isSearching || !query.trim()}
        >
          <Search className="w-4 h-4 mr-1" aria-hidden="true" />
          {t('intelligence.search.searchButton')}
        </Button>

        {results && (
          <Button size="sm" variant="ghost" onClick={handleClear}>
            {t('intelligence.search.clear')}
          </Button>
        )}
      </div>

      {error && <p className="text-sm text-red-600 mt-2">{error}</p>}

      {results && (
        <div className="mt-3 border rounded-lg bg-white overflow-hidden">
          <div className="px-3 py-2 bg-purple-50 border-b border-purple-100 flex items-center gap-2">
            <Brain className="w-3.5 h-3.5 text-purple-600" aria-hidden="true" />
            <span className="text-xs font-medium text-purple-700">
              {t('intelligence.search.resultCount', { count: results.results.length })}
            </span>
            {results.cached && (
              <Badge variant="outline" className="text-xs">
                {t('intelligence.search.cached')}
              </Badge>
            )}
          </div>

          {results.results.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-gray-500">
              {t('intelligence.search.noResults')}
            </div>
          ) : (
            <div className="divide-y">
              {results.results.map((r) => (
                <button
                  key={r.bug_id}
                  type="button"
                  onClick={() => onResultSelect(r.bug_id)}
                  className="w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0 mr-3">
                      <p className="text-sm font-medium text-gray-900 truncate">{r.title}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <Badge variant="outline" className="text-xs">
                          {r.status}
                        </Badge>
                        {r.description && (
                          <span className="text-xs text-gray-500 truncate">
                            {r.description.slice(0, 80)}
                          </span>
                        )}
                      </div>
                    </div>
                    <span className="text-sm font-semibold text-purple-700 shrink-0">
                      {Math.round(r.similarity * 100)}%
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
