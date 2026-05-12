/**
 * Linear Team Picker
 *
 * Loads teams via `POST /api/v1/integrations/linear/projects` (the
 * generic platform endpoint — Linear's `listProjects` implementation
 * returns Teams in the contract's `{id, key, name}` shape). Behaviour
 * mirrors `ProjectStep`'s picker: searchable list with keyboard nav,
 * fall-through to manual entry when creds aren't set yet.
 *
 * Why not reuse `ProjectStep`: it's typed against `JiraConfig` and
 * checks `authentication.type === 'basic'`. Linear has neither.
 * Duplicating the picker rather than refactoring `ProjectStep` is the
 * deliberate trade-off chosen in PR 2 (see auto-memory note
 * `project_admin_ui_platform_configurator`).
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { projectIntegrationService } from '../../../services/project-integration-service';
import { handleApiError } from '../../../lib/api-client';
import type { LinearConfig } from '../types';

interface LinearTeamPickerProps {
  config: LinearConfig;
  onSelect: (team: { id: string; key: string }) => void;
}

/**
 * Non-cryptographic FNV-1a 32-bit hash. Used to derive a stable cache
 * marker from an apiKey without putting the raw token in the queryKey
 * (devtools / cache persistence concern). Two distinct keys always
 * produce distinct hex strings for our purposes — collision risk on
 * 32 bits is irrelevant at the per-component cache scale.
 */
function hashApiKey(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

export function LinearTeamPicker({ config, onSelect }: LinearTeamPickerProps) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(-1);

  const apiKey = config.apiKey?.trim() ?? '';

  // Hashed apiKey in the cache key — distinguishes between different
  // tokens (e.g. user fixing a typo) so a stale cached teams list for
  // the previous key isn't served to the new key, while keeping the
  // raw token out of react-query's in-memory cache and devtools.
  // Empty string when there's no key so the query doesn't run.
  const apiKeyHash = apiKey.length > 0 ? hashApiKey(apiKey) : '';

  // Only fire the request when we have an apiKey — the backend
  // rejects a config without one with 400, no point making the call.
  const teamsQuery = useQuery({
    queryKey: ['linear-teams', apiKeyHash],
    queryFn: async () => {
      return projectIntegrationService.searchProjects(
        'linear',
        { apiKey } as unknown as Record<string, unknown>,
        { maxResults: 50 }
      );
    },
    enabled: apiKey.length > 0,
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: 'always',
    retry: false,
  });

  useEffect(() => {
    if (teamsQuery.isError) {
      toast.error(`${t('linearConfig.failedToLoadTeams')}: ${handleApiError(teamsQuery.error)}`);
    }
  }, [teamsQuery.isError, teamsQuery.error, t]);

  const teams = teamsQuery.data ?? [];

  const filteredTeams = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) {
      return teams;
    }
    return teams.filter(
      (team) => team.key.toLowerCase().includes(term) || team.name.toLowerCase().includes(term)
    );
  }, [teams, search]);

  useEffect(() => {
    if (highlightedIndex >= filteredTeams.length) {
      setHighlightedIndex(-1);
    }
  }, [filteredTeams.length, highlightedIndex]);

  const selectTeam = (id: string, key: string) => {
    onSelect({ id, key });
    setSearch('');
    setHighlightedIndex(-1);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' && filteredTeams.length > 0) {
      event.preventDefault();
      setHighlightedIndex((prev) => (prev + 1) % filteredTeams.length);
    } else if (event.key === 'ArrowUp' && filteredTeams.length > 0) {
      event.preventDefault();
      setHighlightedIndex((prev) => (prev <= 0 ? filteredTeams.length - 1 : prev - 1));
    } else if (event.key === 'Enter') {
      const highlighted = highlightedIndex >= 0 ? filteredTeams[highlightedIndex] : undefined;
      if (highlighted) {
        event.preventDefault();
        selectTeam(highlighted.id, highlighted.key);
      }
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setSearch('');
      setHighlightedIndex(-1);
    }
  };

  if (apiKey.length === 0) {
    return (
      <p className="text-sm text-gray-500" data-testid="linear-team-picker-awaiting-creds">
        {t('linearConfig.teamPickerAwaitingApiKey')}
      </p>
    );
  }

  return (
    <div data-testid="linear-team-picker">
      <input
        id="linear-team-search"
        type="text"
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setHighlightedIndex(-1);
        }}
        onKeyDown={handleKeyDown}
        className="w-full border p-2 rounded"
        placeholder={t('linearConfig.searchTeamsPlaceholder')}
        data-testid="linear-team-search-input"
        aria-busy={teamsQuery.isLoading}
        aria-controls="linear-team-list"
        aria-activedescendant={
          highlightedIndex >= 0 && filteredTeams[highlightedIndex]
            ? `linear-team-option-${filteredTeams[highlightedIndex].key}`
            : undefined
        }
        role="combobox"
        aria-expanded={true}
        aria-autocomplete="list"
      />

      <div
        id="linear-team-list"
        className="mt-2 border rounded max-h-64 overflow-y-auto text-sm"
        role="listbox"
        aria-label={t('linearConfig.selectTeam')}
        data-testid="linear-team-list"
      >
        {teamsQuery.isLoading && (
          <div className="p-2 text-gray-500">{t('linearConfig.loadingTeams')}</div>
        )}

        {!teamsQuery.isLoading && filteredTeams.length === 0 && (
          <div className="p-2 text-gray-500">{t('linearConfig.noTeamsFound')}</div>
        )}

        {filteredTeams.map((team, i) => {
          const selected = config.teamId === team.id;
          const highlighted = highlightedIndex === i;
          return (
            <button
              key={team.id}
              id={`linear-team-option-${team.key}`}
              type="button"
              role="option"
              aria-selected={selected}
              tabIndex={-1}
              onClick={() => selectTeam(team.id, team.key)}
              onMouseEnter={() => setHighlightedIndex(i)}
              className={`w-full text-left px-2 py-1 flex justify-between hover:bg-gray-50 ${
                highlighted ? 'ring-2 ring-blue-400 bg-gray-50' : selected ? 'bg-blue-50' : ''
              }`}
              data-testid={`linear-team-option-${team.key}`}
            >
              <span className="font-mono">{team.key}</span>
              <span className="text-gray-600 ml-2 truncate">{team.name}</span>
            </button>
          );
        })}
      </div>

      {config.teamKey && (
        <p
          className="mt-2 text-sm text-gray-700"
          data-testid="linear-team-selected"
          aria-live="polite"
        >
          {t('linearConfig.selectedTeam')}: <span className="font-mono">{config.teamKey}</span>
        </p>
      )}
    </div>
  );
}
