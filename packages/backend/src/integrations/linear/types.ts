/**
 * Linear Integration Types
 * Type definitions for Linear GraphQL API
 */

/**
 * Default share token expiration in hours (30 days)
 * Mirrors the Jira plugin's default so the user-facing semantics stay consistent.
 */
export const SHARE_TOKEN_EXPIRATION_HOURS = 720;

/**
 * Linear's fixed GraphQL endpoint. Linear is SaaS-only and ships a single
 * public API origin, so unlike Jira we don't accept a user-supplied host
 * (and therefore don't need a URL-string SSRF allowlist — only DNS-rebind
 * pinning via `pinHostnameToIp`).
 */
export const LINEAR_API_HOST = 'api.linear.app';
export const LINEAR_API_URL = `https://${LINEAR_API_HOST}/graphql`;

/**
 * Linear's web origin for building issue URLs when the API response is
 * abbreviated. Real `issueCreate` responses already include the canonical
 * `url`; this is only a fallback.
 */
export const LINEAR_WEB_HOST = 'https://linear.app';

/**
 * Template configuration for Linear issue formatting.
 * Mirrors `JiraTemplateConfig` 1:1 so rule UIs can share the underlying
 * settings shape — the rendered output differs only in serialization
 * (Markdown vs ADF).
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

/**
 * Linear configuration for a project (post-decryption, ready for client use).
 *
 * `teamId` is the GraphQL-required UUID; `teamKey` is the human identifier
 * (e.g. "ENG") shown in URLs and pickers. We persist both because Linear
 * `issueCreate` mutations require the UUID, but the wizard, admin UI, and
 * audit logs are far more readable with the key.
 */
export interface LinearConfig {
  apiKey: string;
  teamId: string;
  teamKey: string;
  // Optional Linear Project (epic-level grouping inside a Team). Independent
  // of BugSpotter's `project_id` — confusing terminology, but `projectId`
  // here is what Linear calls it on the wire.
  projectId?: string;
  projectName?: string;
  defaultLabels?: string[];
  enabled: boolean;
  templateConfig?: Partial<LinearTemplateConfig>;
}

/**
 * Linear credentials (sensitive — encrypted at rest).
 *
 * Single field today (personal API key). Kept as an object so a future
 * OAuth path can add `accessToken` / `refreshToken` / `expiresAt` without
 * a schema migration of the encrypted blob.
 */
export interface LinearCredentials {
  apiKey: string;
}

/**
 * Linear configuration as persisted in `project_integrations.config`
 * (non-sensitive). Credentials live in the encrypted blob next to it.
 */
export interface LinearProjectConfig {
  teamId: string;
  teamKey: string;
  projectId?: string;
  projectName?: string;
  defaultLabels?: string[];
  autoCreate: boolean;
  syncStatus: boolean;
  syncComments: boolean;
  templateConfig?: Partial<LinearTemplateConfig>;
}

/**
 * Linear priority. Wire format is the integer; we keep the enum mostly for
 * readability at call sites.
 *   0 = No priority
 *   1 = Urgent
 *   2 = High
 *   3 = Medium (Linear UI label: "Medium")
 *   4 = Low
 */
export type LinearPriority = 0 | 1 | 2 | 3 | 4;

/**
 * Input payload for `issueCreate` mutation.
 * Mirrors Linear's `IssueCreateInput` GraphQL type, narrowed to what we
 * actually send. `[key: string]: unknown` allows field-mapping pass-through.
 */
export interface LinearIssueInput {
  teamId: string;
  title: string;
  description?: string; // Markdown
  priority?: LinearPriority;
  assigneeId?: string;
  labelIds?: string[];
  projectId?: string;
  stateId?: string;
  parentId?: string;
  dueDate?: string; // ISO date
  estimate?: number;
  [key: string]: unknown;
}

/**
 * Issue node returned by `issueCreate.issue { ... }`.
 */
export interface LinearIssue {
  id: string; // Linear UUID
  identifier: string; // "ENG-123" — what humans cite
  url: string; // Canonical web URL, returned by API
  title: string;
}

/**
 * Linear workflow-state type. Returned on `state.type` in GraphQL responses.
 * The capability layer maps these to BugSpotter's CanonicalStatus enum.
 */
export type LinearStateType =
  | 'triage'
  | 'backlog'
  | 'unstarted'
  | 'started'
  | 'completed'
  | 'canceled';

/**
 * A single workflow state within a Linear team. Listed via
 * `team(id).states.nodes`. The capability layer uses `type` (not `name`)
 * for canonical mapping since teams freely rename states.
 */
export interface LinearWorkflowState {
  id: string;
  name: string;
  type: LinearStateType;
  position?: number;
}

/**
 * Issue detail returned by the `issue(id)` query — slimmer than the full
 * Linear `Issue` GraphQL type; only the fields the capability layer needs.
 */
export interface LinearIssueDetail {
  id: string;
  identifier: string;
  state: { id: string; name: string; type: LinearStateType };
  team: { id: string; name: string };
}

/**
 * Team node from the `teams` query.
 */
export interface LinearTeam {
  id: string;
  key: string;
  name: string;
}

/**
 * Project node (Linear-side epic-grouping, not BugSpotter project) from the
 * `team(id).projects` query.
 */
export interface LinearProject {
  id: string;
  name: string;
  description?: string;
  state?: string;
}

/**
 * User node from the `users` query.
 */
export interface LinearUser {
  id: string;
  name: string;
  displayName: string;
  email?: string;
  avatarUrl?: string;
  active: boolean;
}

/**
 * `viewer` query result — used by `testConnection` to verify the API key
 * is valid and identifies a real Linear user.
 */
export interface LinearViewer {
  id: string;
  name: string;
  email: string;
  organization?: {
    id: string;
    name: string;
    urlKey: string;
  };
}

/**
 * Attachment created via `attachmentCreate`. Linear treats attachments as
 * first-class entities referencing an arbitrary URL — for screenshots we
 * upload to Linear's asset storage first via `fileUpload`, then point an
 * attachment at the returned asset URL.
 */
export interface LinearAttachment {
  id: string;
  title: string;
  url: string;
}

/**
 * `fileUpload` mutation result. The client PUTs the file to `uploadUrl`
 * with `headers`, then references `assetUrl` from either an
 * `attachmentCreate` or inline in issue description Markdown.
 */
export interface LinearFileUpload {
  uploadUrl: string;
  assetUrl: string;
  headers: Array<{ key: string; value: string }>;
}

/**
 * Connection test result for `LinearConfigManager.validate`.
 */
export interface LinearConnectionTestResult {
  valid: boolean;
  error?: string;
  details?: {
    viewerEmail: string;
    organizationName?: string;
    teamExists?: boolean;
    // Populated when the supplied teamKey doesn't match the team behind
    // the teamId — the caller can offer to autocorrect.
    canonicalTeamKey?: string;
  };
}

/**
 * Linear integration result returned from `createFromBugReport` to callers
 * who want the raw issue fields (analogue of `JiraIntegrationResult`).
 */
export interface LinearIntegrationResult {
  issueId: string; // Linear UUID
  issueIdentifier: string; // "ENG-123"
  issueUrl: string;
  attachments: LinearAttachment[];
}

/**
 * Shape of GraphQL error entries returned by Linear.
 */
export interface LinearGraphQLError {
  message: string;
  extensions?: {
    code?: string;
    type?: string;
    userPresentableMessage?: string;
  };
  path?: Array<string | number>;
}
