import React, { useMemo, useState } from 'react';
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
export function buildProjectSearchConfig(config: JiraConfig): Record<string, unknown> | null {
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
      return projectIntegrationService.searchProjects(platform, searchConfig, { maxResults: 50 });
    },
    enabled: searchConfig !== null,
    staleTime: 5 * 60 * 1000, // 5 min — creds don't change mid-session
    retry: false,
  });

  // `useQuery` v5 dropped onError; surface via effect instead. A toast
  // is fine here — the UI also falls back to manual entry when the
  // fetch fails.
  React.useEffect(() => {
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

  if (!config) {
    return (
      <div className="border p-4 rounded text-sm text-red-600">
        Invalid configuration structure. Please ensure all required fields are present.
      </div>
    );
  }

  const pickerAvailable = searchConfig !== null && !projectsQuery.isError;

  const selectProject = (key: string) => {
    setLocalConfig({ ...localConfig, projectKey: key });
    setSearch('');
    setHighlightedIndex(-1);
  };

  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (filteredProjects.length === 0) {
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlightedIndex((prev) => (prev + 1) % filteredProjects.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlightedIndex((prev) => (prev <= 0 ? filteredProjects.length - 1 : prev - 1));
    } else if (event.key === 'Enter' && highlightedIndex >= 0) {
      event.preventDefault();
      selectProject(filteredProjects[highlightedIndex].key);
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
              highlightedIndex >= 0 && filteredProjects[highlightedIndex]
                ? `project-option-${filteredProjects[highlightedIndex].key}`
                : undefined
            }
            role="combobox"
            aria-expanded={filteredProjects.length > 0}
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

            {!projectsQuery.isLoading && filteredProjects.length === 0 && (
              <div className="p-2 text-gray-500">{t('integrationConfig.noProjectsFound')}</div>
            )}

            {filteredProjects.map((p, i) => {
              const selected = config.projectKey === p.key;
              const highlighted = highlightedIndex === i;
              return (
                <button
                  key={p.id}
                  id={`project-option-${p.key}`}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  // Skip in Tab order — keyboard users navigate the list
                  // via arrow keys on the search input, so 50 buttons
                  // don't become 50 tab stops between picker and Next.
                  // Mouse/touch clicks still work.
                  tabIndex={-1}
                  onClick={() => selectProject(p.key)}
                  onMouseEnter={() => setHighlightedIndex(i)}
                  className={`w-full text-left px-2 py-1 flex justify-between hover:bg-gray-50 ${
                    selected ? 'bg-blue-50' : ''
                  } ${highlighted ? 'ring-2 ring-blue-400 bg-gray-50' : ''}`}
                  data-testid={`project-option-${p.key}`}
                >
                  <span className="font-mono">{p.key}</span>
                  <span className="text-gray-600 ml-2 truncate">{p.name}</span>
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
            onChange={(e) => setLocalConfig({ ...localConfig, projectKey: e.target.value })}
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
        onChange={(e) => setLocalConfig({ ...localConfig, issueType: e.target.value })}
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
