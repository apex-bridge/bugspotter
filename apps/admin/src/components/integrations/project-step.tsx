import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { isJiraConfig } from '../../utils/type-guards';
import type { JiraConfig } from '../../types';
import { projectIntegrationService } from '../../services/project-integration-service';
import { handleApiError } from '../../lib/api-client';

interface ProjectStepProps {
  localConfig: Record<string, unknown>;
  setLocalConfig: React.Dispatch<React.SetStateAction<Record<string, unknown>>>;
  onBack: () => void;
  onNext: () => void;
  /**
   * Integration platform (e.g. "jira"). Used to hit the
   * `/integrations/:platform/projects` endpoint. Defaults to "jira"
   * since that's the only platform with `listProjects` today.
   */
  platform?: string;
}

export interface ProjectSearchConfig {
  instanceUrl: string;
  email: string;
  apiToken: string;
}

/**
 * Extract the flat-config shape the backend's
 * `POST /integrations/:platform/projects` route expects.
 *
 * `localConfig` is shared across wizard steps and has credentials
 * nested under `authentication`. The projects endpoint wants them
 * flat on the body, same as the `/test` endpoint. Returns `null`
 * when anything required is missing so the caller can fall back to
 * manual entry rather than fire a doomed request.
 */
export function buildProjectSearchConfig(config: JiraConfig): ProjectSearchConfig | null {
  // Picker only works with Basic Auth today — the backend JiraClient
  // speaks Basic only. Switching to oauth2/pat in ConnectionStep
  // preserves the old email/apiToken fields, so we'd otherwise keep
  // firing the picker with stale Basic creds while the user thinks
  // they're using a different auth mechanism. `isJiraConfig` already
  // requires `authentication.type` to be set, so we can check it
  // strictly here.
  if (config.authentication?.type !== 'basic') {
    return null;
  }

  const instanceUrl = config.instanceUrl?.trim();
  const email = config.authentication?.email?.trim();
  const apiToken = config.authentication?.apiToken?.trim();

  if (!instanceUrl || !email || !apiToken) {
    return null;
  }

  return { instanceUrl, email, apiToken };
}

/**
 * Reusable project configuration step.
 *
 * Shows a searchable project picker when connection credentials are
 * complete, falling back to a manual text input otherwise (so users
 * who skip straight to step 2 without testing the connection can
 * still type a project key themselves).
 */
export function ProjectStep({
  localConfig,
  setLocalConfig,
  onBack,
  onNext,
  platform = 'jira',
}: ProjectStepProps) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  // Tracks the currently-highlighted option so arrow keys on the
  // search input can move a single focus ring through the list
  // instead of leaving 50 tab stops in the page. Index into
  // filteredProjects; -1 means "nothing highlighted".
  const [highlightedIndex, setHighlightedIndex] = useState(-1);

  // All hooks run unconditionally — the invalid-shape branch renders
  // a fallback view below using values derived from these hooks.
  const config = isJiraConfig(localConfig) ? (localConfig as JiraConfig) : null;
  const searchConfig = config ? buildProjectSearchConfig(config) : null;

  // NEVER put the apiToken in the queryKey: react-query persists keys
  // in its in-memory cache and surfaces them via devtools. Key on
  // non-secret identity (platform + instanceUrl + email) so the cache
  // still invalidates on creds change; the secret travels in the
  // request body only.
  const projectsQuery = useQuery({
    queryKey: [
      'integration-projects',
      platform,
      searchConfig?.instanceUrl ?? null,
      searchConfig?.email ?? null,
    ],
    queryFn: async () => {
      if (!searchConfig) {
        return [];
      }
      return projectIntegrationService.searchProjects(
        platform,
        // Narrow typed config to the service's generic Record<> body
        // shape. TS doesn't auto-widen named interfaces without an
        // index signature, but the runtime shape is identical.
        searchConfig as unknown as Record<string, unknown>,
        { maxResults: 50 }
      );
    },
    enabled: searchConfig !== null,
    // Force a fresh fetch every time ProjectStep mounts. The queryKey
    // omits the apiToken (to avoid leaking it into the cache), so a
    // user changing ONLY their token — same instanceUrl + email —
    // would otherwise see the previous token's project list served
    // from cache. `staleTime: 0` + `refetchOnMount: 'always'` forces
    // a fresh request; `gcTime: 0` purges the entry on unmount so
    // the old token's data can't flash briefly before the refetch
    // resolves on the next mount.
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: 'always',
    retry: false,
  });

  // `useQuery` v5 dropped onError; surface via effect instead. A toast
  // is fine here — the UI also falls back to manual entry when the
  // fetch fails.
  useEffect(() => {
    if (projectsQuery.isError) {
      toast.error(
        `${t('integrationConfig.failedToLoadProjects')}: ${handleApiError(projectsQuery.error)}`
      );
    }
  }, [projectsQuery.isError, projectsQuery.error, t]);

  const projects = projectsQuery.data ?? [];

  // Client-side filter over the ≤ 50 projects the server returned.
  // The wizard deals with small Jira tenants; for bigger ones the
  // user can still type a key manually via the fallback input.
  const filteredProjects = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) {
      return projects;
    }
    return projects.filter(
      (p) => p.key.toLowerCase().includes(term) || p.name.toLowerCase().includes(term)
    );
  }, [projects, search]);

  // Unified option list for the listbox. The synthetic
  // "Use typed as project key" escape hatch participates in the
  // same arrow-key/aria-activedescendant cycle as the real project
  // options — otherwise the keyboard-navigable set silently excludes
  // it and the user can only reach it via Enter-without-highlight.
  type ListOption =
    | { kind: 'project'; id: string; key: string; name: string }
    | { kind: 'manual'; id: string; key: string };

  const options: ListOption[] = useMemo(() => {
    const list: ListOption[] = filteredProjects.map((p) => ({
      kind: 'project',
      id: `project-option-${p.key}`,
      key: p.key,
      name: p.name,
    }));
    const typed = search.trim();
    if (
      typed.length > 0 &&
      !filteredProjects.some((p) => p.key.toLowerCase() === typed.toLowerCase())
    ) {
      list.push({ kind: 'manual', id: 'project-option-manual', key: typed });
    }
    return list;
  }, [filteredProjects, search]);

  if (!config) {
    return (
      <div className="border p-4 rounded text-sm text-red-600">
        Invalid configuration structure. Please ensure all required fields are present.
      </div>
    );
  }

  const pickerAvailable = searchConfig !== null && !projectsQuery.isError;

  const selectProject = (key: string) => {
    setLocalConfig((prev) => ({ ...prev, projectKey: key }));
    setSearch('');
    setHighlightedIndex(-1);
  };

  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    // Arrow keys only make sense when there are options to cycle.
    // Enter/Escape stay live on empty lists so the user isn't
    // trapped — though with the synthetic manual-entry option in
    // `options`, empty-options is rare (non-empty search adds one).
    if (event.key === 'ArrowDown' && options.length > 0) {
      event.preventDefault();
      setHighlightedIndex((prev) => (prev + 1) % options.length);
    } else if (event.key === 'ArrowUp' && options.length > 0) {
      event.preventDefault();
      setHighlightedIndex((prev) => (prev <= 0 ? options.length - 1 : prev - 1));
    } else if (event.key === 'Enter') {
      // Guard against a stale index — options can shrink between the
      // keydown and this read (query result arrives, filter narrows).
      const highlighted = highlightedIndex >= 0 ? options[highlightedIndex] : undefined;
      if (highlighted) {
        event.preventDefault();
        selectProject(highlighted.key);
        return;
      }
      // No highlight — commit the typed search as a manual project
      // key so the picker never traps the user.
      const typed = search.trim();
      if (typed.length > 0) {
        event.preventDefault();
        selectProject(typed);
      }
    } else if (event.key === 'Escape') {
      setHighlightedIndex(-1);
    }
  };

  return (
    <div className="border p-4 rounded" data-testid="project-step">
      <label
        htmlFor={pickerAvailable ? 'project-search' : 'project-key'}
        className="block text-sm font-medium"
      >
        {t('integrationConfig.projectKey')}
      </label>

      {pickerAvailable ? (
        <div className="mt-1">
          <input
            id="project-search"
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setHighlightedIndex(-1);
            }}
            onKeyDown={handleSearchKeyDown}
            className="w-full border p-2 rounded"
            placeholder={t('integrationConfig.searchProjectsPlaceholder')}
            data-testid="project-search-input"
            aria-label={t('integrationConfig.searchProjects')}
            aria-busy={projectsQuery.isLoading}
            aria-controls="project-list"
            aria-activedescendant={
              highlightedIndex >= 0 && options[highlightedIndex]
                ? options[highlightedIndex].id
                : undefined
            }
            role="combobox"
            // Listbox is always visible while the picker is shown;
            // `aria-expanded` must reflect visibility, not the number
            // of options inside it.
            aria-expanded={true}
            aria-autocomplete="list"
          />

          <div
            id="project-list"
            className="mt-2 border rounded max-h-64 overflow-y-auto text-sm"
            role="listbox"
            aria-label={t('integrationConfig.selectProject')}
            data-testid="project-list"
          >
            {projectsQuery.isLoading && (
              <div className="p-2 text-gray-500">{t('integrationConfig.loadingProjects')}</div>
            )}

            {!projectsQuery.isLoading && options.length === 0 && (
              <div className="p-2 text-gray-500">{t('integrationConfig.noProjectsFound')}</div>
            )}

            {options.map((opt, i) => {
              const selected = config.projectKey === opt.key;
              const highlighted = highlightedIndex === i;
              // Keyboard users navigate via arrow keys on the search
              // input, so 50 buttons don't become 50 tab stops between
              // the picker and Next. Mouse/touch clicks still work.
              const commonProps = {
                id: opt.id,
                type: 'button' as const,
                role: 'option' as const,
                'aria-selected': selected,
                tabIndex: -1,
                onClick: () => selectProject(opt.key),
                onMouseEnter: () => setHighlightedIndex(i),
              };

              if (opt.kind === 'manual') {
                return (
                  <button
                    {...commonProps}
                    key={opt.id}
                    className={`w-full text-left px-2 py-1 border-t bg-gray-50 hover:bg-gray-100 text-gray-700 ${
                      highlighted ? 'ring-2 ring-blue-400' : ''
                    }`}
                    data-testid="project-manual-entry-option"
                  >
                    {t('integrationConfig.useTypedProjectKey', { key: opt.key })}
                  </button>
                );
              }
              return (
                <button
                  {...commonProps}
                  key={opt.id}
                  className={`w-full text-left px-2 py-1 flex justify-between hover:bg-gray-50 ${
                    selected ? 'bg-blue-50' : ''
                  } ${highlighted ? 'ring-2 ring-blue-400 bg-gray-50' : ''}`}
                  data-testid={`project-option-${opt.key}`}
                >
                  <span className="font-mono">{opt.key}</span>
                  <span className="text-gray-600 ml-2 truncate">{opt.name}</span>
                </button>
              );
            })}
          </div>

          {config.projectKey && (
            <p
              className="mt-2 text-sm text-gray-700"
              data-testid="project-selected"
              aria-live="polite"
            >
              {t('integrationConfig.selectedProject')}:{' '}
              <span className="font-mono">{config.projectKey}</span>
            </p>
          )}
        </div>
      ) : (
        // Fallback: manual entry. Same input as before, so users who
        // skip straight to step 2 or whose creds aren't complete can
        // still type a key.
        <>
          <input
            id="project-key"
            type="text"
            value={config.projectKey ?? ''}
            onChange={(e) => {
              const value = e.target.value;
              setLocalConfig((prev) => ({ ...prev, projectKey: value }));
            }}
            className="w-full border p-2 rounded mt-1"
            placeholder={t('integrationConfig.projectKeyPlaceholder')}
            data-testid="project-key-input"
          />
          {/* Explain the fallback when it's the auth type — not an
              incomplete form — that's driving it. `JiraClient` today
              only speaks Basic Auth, so the picker endpoint can't
              authenticate OAuth2/PAT users. Telling them up front is
              better than a silent downgrade. */}
          {(config.authentication?.type === 'oauth2' || config.authentication?.type === 'pat') && (
            <p className="mt-2 text-xs text-gray-500" data-testid="project-picker-basic-auth-only">
              {t('integrationConfig.projectPickerBasicAuthOnly')}
            </p>
          )}
        </>
      )}

      <label htmlFor="issue-type" className="block text-sm font-medium mt-3">
        {t('integrationConfig.issueType')}
      </label>
      <input
        id="issue-type"
        type="text"
        value={config.issueType ?? 'Bug'}
        onChange={(e) => {
          const value = e.target.value;
          setLocalConfig((prev) => ({ ...prev, issueType: value }));
        }}
        className="w-full border p-2 rounded mt-1"
        placeholder={t('integrationConfig.issueTypePlaceholder')}
      />

      <div className="mt-3 flex gap-2">
        <button className="px-3 py-1 bg-gray-100 rounded" onClick={onBack}>
          {t('integrationConfig.back')}
        </button>
        <button
          className="px-3 py-1 bg-blue-600 text-white rounded disabled:opacity-50"
          onClick={onNext}
          disabled={!config.projectKey}
          data-testid="project-next-button"
        >
          {t('integrationConfig.nextFieldMapping')}
        </button>
      </div>
    </div>
  );
}
