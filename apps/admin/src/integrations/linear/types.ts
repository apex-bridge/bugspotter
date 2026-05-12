/**
 * Linear admin-UI config types.
 *
 * Distinct from the backend's `LinearConfig` in
 * `packages/backend/src/integrations/linear/types.ts`: the admin UI
 * stores credentials separately from non-sensitive config (matches the
 * persistence layer's split into `config` and `encrypted_credentials`),
 * while the backend type holds them flat for in-memory use.
 *
 * Module-shape note: this module deliberately exports the same surface
 * a future `PlatformConfigurator` interface will require — see
 * `project_admin_ui_platform_configurator` in auto-memory. Don't rename
 * `defaultLinearConfig`, `validateLinearConfig`, `LinearWizard`,
 * `LinearProjectFields`, or `LinearFieldMapper` without updating the
 * planned refactor target.
 */

export interface LinearConfig {
  // Non-sensitive — lives in `project_integrations.config` JSONB.
  teamId?: string;
  teamKey?: string;
  // Optional Linear-side Project (epic-grouping inside the Team). NOT
  // BugSpotter's project_id — confusing terminology but matches the
  // backend's wire shape.
  projectId?: string;
  projectName?: string;
  defaultLabels?: string[];
  templateConfig?: LinearTemplateConfig;

  // Sensitive — stored in `encrypted_credentials` on the backend, but
  // co-located here so wizard / form components can pass a single
  // localConfig object around. The per-project-config page splits this
  // out into a separate `credentials` map on save.
  apiKey?: string;
}

/**
 * Same shape as backend `LinearTemplateConfig`. Duplicated to avoid an
 * admin → backend type dependency.
 */
export interface LinearTemplateConfig {
  includeConsoleLogs?: boolean;
  consoleLogLimit?: number;
  includeNetworkLogs?: boolean;
  networkLogFilter?: 'all' | 'failures';
  networkLogLimit?: number;
  includeShareReplay?: boolean;
  shareReplayExpiration?: number;
  shareReplayPassword?: string | null;
}
