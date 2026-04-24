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

  // All hooks run unconditionally — the invalid-shape branch renders
  // a fallback view below using values derived from these hooks.
  const config = isJiraConfig(localConfig) ? (localConfig as JiraConfig) : null;
  const searchConfig = config ? buildProjectSearchConfig(config) : null;

  const projectsQuery = useQuery({
    queryKey: ['integration-projects', platform, searchConfig],
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
  };

  return (
    <div className="border p-4 rounded" data-testid="project-step">
      <label htmlFor="project-key" className="block text-sm font-medium">
        {t('integrationConfig.projectKey')}
      </label>

      {pickerAvailable ? (
        <div className="mt-1">
          <input
            id="project-search"
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full border p-2 rounded"
            placeholder={t('integrationConfig.searchProjectsPlaceholder')}
            data-testid="project-search-input"
            aria-label={t('integrationConfig.searchProjects')}
            aria-busy={projectsQuery.isLoading}
          />

          <div
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

            {filteredProjects.map((p) => {
              const selected = config.projectKey === p.key;
              return (
                <button
                  key={p.id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => selectProject(p.key)}
                  className={`w-full text-left px-2 py-1 flex justify-between hover:bg-gray-50 ${
                    selected ? 'bg-blue-50' : ''
                  }`}
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
        <input
          id="project-key"
          type="text"
          value={config.projectKey ?? ''}
          onChange={(e) => setLocalConfig({ ...localConfig, projectKey: e.target.value })}
          className="w-full border p-2 rounded mt-1"
          placeholder={t('integrationConfig.projectKeyPlaceholder')}
          data-testid="project-key-input"
        />
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
