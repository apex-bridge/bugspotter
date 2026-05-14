/**
 * Linear Integration Service
 *
 * Orchestrates bug-report → Linear issue creation. Structurally parallel
 * to `JiraIntegrationService` so the surrounding routes / worker /
 * outbox plumbing treats both identically.
 *
 * Key behavioural differences from Jira:
 *   - GraphQL transport (single endpoint, fixed host).
 *   - Two-step screenshot upload: `fileUpload` → PUT → `attachmentCreate`.
 *     Each step can fail independently; we tolerate attachment failures
 *     and still report a successful issue (same policy as Jira's mapper).
 *   - `listProjects()` returns Linear *teams* (not Linear projects) —
 *     teams are what issues belong to. Linear projects (epic-grouping)
 *     are exposed via a separate non-contract method.
 *   - No `searchUsers`-style account IDs: we return Linear user UUIDs in
 *     the `accountId` field of the shared contract. The field name is
 *     Jira-flavoured but semantic ("opaque external user id") matches.
 */

import type { BugReportRepository } from '../../db/repositories.js';
import type { ProjectIntegrationRepository } from '../../db/project-integration.repository.js';
import type { DatabaseClient } from '../../db/client.js';
import type { IStorageService } from '../../storage/types.js';
import { TICKET_STATUS, type BugReport, type TicketStatus } from '../../db/types.js';
import type {
  IntegrationService,
  IntegrationResult,
  TicketCreationMetadata,
} from '../base-integration.service.js';
import { getLogger } from '../../logger.js';
import { config as appConfig } from '../../config.js';
import { AppError, ValidationError } from '../../api/middleware/error.js';
import { generateShareToken } from '../../utils/token-generator.js';
import { LinearConfigManager } from './config.js';
import { LinearClient } from './client.js';
import { LinearBugReportMapper } from './mapper.js';
import { linearStateTypeToCanonical, pickStateForCanonicalStatus } from './status-mapper.js';
import type { CanonicalStatus, CapabilityTarget } from '../capabilities.js';
import type {
  LinearConfig,
  LinearAttachment,
  LinearIntegrationResult,
  LinearTeam,
  LinearProject,
  LinearCredentials,
} from './types.js';
import { SHARE_TOKEN_EXPIRATION_HOURS } from './types.js';

const logger = getLogger();

const PLATFORM_NAME = 'linear';
const DEFAULT_TICKET_STATUS: TicketStatus = TICKET_STATUS.OPEN;
const DEFAULT_SCREENSHOT_FILENAME = 'screenshot.png';
const SCREENSHOT_CONTENT_TYPE = 'image/png';
const MS_PER_HOUR = 60 * 60 * 1000;

/**
 * Domains we'll proxy avatars from for the admin UI's user picker.
 * Linear hosts avatars on their own subdomain and on S3-style asset
 * domains; Gravatar appears when users haven't uploaded one.
 */
export const LINEAR_TRUSTED_AVATAR_DOMAINS = [
  '*.linear.app',
  'public.linear.app',
  'uploads.linear.app',
  'secure.gravatar.com',
] as const;

export function buildLinearAllowedAvatarDomains(_config: Record<string, unknown>): string[] {
  // Unlike Jira, Linear's instance host is fixed, so no per-config
  // hostname extraction is needed. The list is static.
  return [...LINEAR_TRUSTED_AVATAR_DOMAINS];
}

/**
 * Raw config shape from frontend admin / wizard forms. Tolerates both
 * the canonical `apiKey` field and an `authentication.token` nested
 * shape (the wizard's ConnectionStep stores credentials under
 * `authentication`).
 */
type RawLinearConfig = Partial<LinearConfig> & {
  authentication?: { type?: string; token?: string };
};

export class LinearIntegrationService implements IntegrationService {
  readonly platform = PLATFORM_NAME;

  private db: DatabaseClient;
  private storage: IStorageService;
  private configManager: LinearConfigManager;

  /**
   * Constructor accepts `bugReportRepo` for symmetry with
   * `JiraIntegrationService` (the plugin factory passes it
   * unconditionally), but we don't store it — Linear's flow operates on
   * the bug-report row already supplied by the worker / route layer.
   */
  constructor(
    _bugReportRepo: BugReportRepository,
    integrationRepo: ProjectIntegrationRepository,
    db: DatabaseClient,
    storage: IStorageService
  ) {
    this.db = db;
    this.storage = storage;
    this.configManager = new LinearConfigManager(integrationRepo);
  }

  // ============================================================================
  // CORE CONTRACT
  // ============================================================================

  async createFromBugReport(
    bugReport: BugReport,
    projectId: string,
    integrationId: string,
    metadata?: TicketCreationMetadata
  ): Promise<IntegrationResult> {
    const result = await this.createInternal(bugReport, projectId, integrationId, metadata);
    return {
      externalId: result.issueIdentifier,
      externalUrl: result.issueUrl,
      platform: PLATFORM_NAME,
      metadata: {
        issueId: result.issueId,
        attachments: result.attachments,
      },
    };
  }

  async testConnection(projectId: string): Promise<boolean> {
    const config = await this.configManager.getConfig(projectId);
    if (!config) {
      return false;
    }
    const result = await LinearConfigManager.validate(config);
    return result.valid;
  }

  async validateConfig(
    config: Record<string, unknown>
  ): Promise<{ valid: boolean; error?: string; details?: Record<string, unknown> }> {
    const normalized = this.normalizeConfig(config);
    const result = await LinearConfigManager.validate(normalized);
    return {
      valid: result.valid,
      error: result.error,
      details: result.details as Record<string, unknown> | undefined,
    };
  }

  // ============================================================================
  // INTERNAL ORCHESTRATION
  // ============================================================================

  /**
   * Create the issue, attach screenshot if present, persist the ticket
   * row. Mirrors `JiraIntegrationService.createTicketFromBugReportInternal`
   * step-for-step.
   */
  private async createInternal(
    bugReport: BugReport,
    projectId: string,
    integrationId: string,
    metadata?: TicketCreationMetadata
  ): Promise<LinearIntegrationResult> {
    logger.info('Creating Linear issue from bug report', {
      bugReportId: bugReport.id,
      projectId,
      integrationId,
      ruleId: metadata?.ruleId,
      createdAutomatically: metadata?.createdAutomatically,
    });

    const config = await this.loadConfig(integrationId, projectId);
    const shareReplayUrl = await this.generateShareTokenIfNeeded(bugReport, config);

    const mapper = new LinearBugReportMapper(config, config.templateConfig);
    const input = mapper.toLinearIssueInput(
      bugReport,
      shareReplayUrl,
      metadata?.fieldMappings,
      metadata?.descriptionTemplate
    );

    const client = new LinearClient(config.apiKey);
    const issue = await client.createIssue(input);

    logger.info('Linear issue created', {
      bugReportId: bugReport.id,
      issueIdentifier: issue.identifier,
      issueUrl: issue.url,
    });

    const attachments = await this.uploadScreenshotIfPresent(client, bugReport, issue.id);

    await this.saveTicketReference(
      bugReport.id,
      issue.identifier,
      issue.url,
      integrationId,
      metadata?.ruleId,
      metadata?.createdAutomatically
    );

    return {
      issueId: issue.id,
      issueIdentifier: issue.identifier,
      issueUrl: issue.url,
      attachments,
    };
  }

  /**
   * Load + verify config for the specified (project, integration) pair.
   * Throws `AppError` shapes matching the Jira service so route error
   * handling stays uniform. The projectId scope rejects foreign
   * integrationIds — see jira/config.ts for the threat model.
   */
  private async loadConfig(integrationId: string, projectId: string): Promise<LinearConfig> {
    const config = await this.configManager.getConfigByIntegrationId(integrationId, projectId);
    if (!config) {
      throw new AppError(
        `Linear not usable for integration ${integrationId} in project ${projectId}`,
        404,
        'NotFound'
      );
    }
    if (!config.enabled) {
      throw new AppError(
        `Linear integration disabled: ${integrationId}`,
        403,
        'IntegrationDisabled'
      );
    }
    return config;
  }

  /**
   * Generate / reuse a share token for the replay link, if applicable.
   *
   * Logic is identical to `JiraIntegrationService.generateShareTokenIfNeeded`
   * — same idempotency invariant (re-use existing active tokens), same
   * graceful degradation (warn-and-continue if token creation fails).
   * Kept inline rather than extracted because both plugins are the only
   * callers and lifting now would require touching Jira.
   */
  private async generateShareTokenIfNeeded(
    bugReport: BugReport,
    config: LinearConfig
  ): Promise<string | undefined> {
    const includeShareReplay = config.templateConfig?.includeShareReplay ?? true;
    if (!bugReport.replay_key || !includeShareReplay) {
      return undefined;
    }

    try {
      if (!appConfig.frontend.url) {
        throw new AppError(
          'FRONTEND_URL environment variable is required for generating share replay links',
          500,
          'ConfigurationError'
        );
      }

      const existingTokens = await this.db.shareTokens.findByBugReportId(bugReport.id, true);
      if (existingTokens.length > 0) {
        const existingToken = existingTokens.reduce((latest, current) =>
          current.expires_at > latest.expires_at ? current : latest
        );
        return `${appConfig.frontend.url}/shared/${existingToken.token}`;
      }

      const token = generateShareToken();
      const expirationHours =
        config.templateConfig?.shareReplayExpiration ?? SHARE_TOKEN_EXPIRATION_HOURS;
      const expiresAt = new Date(Date.now() + expirationHours * MS_PER_HOUR);

      const shareToken = await this.db.shareTokens.create({
        bug_report_id: bugReport.id,
        token,
        created_by: null,
        expires_at: expiresAt,
        password_hash: null,
      });

      return `${appConfig.frontend.url}/shared/${shareToken.token}`;
    } catch (error) {
      logger.warn('Failed to generate share token for Linear replay', {
        bugReportId: bugReport.id,
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }

  /**
   * Two-phase screenshot upload. Failures here are downgraded to warnings
   * — the issue itself is already created, and missing an attachment is
   * a softer failure than failing the whole bug report.
   */
  private async uploadScreenshotIfPresent(
    client: LinearClient,
    bugReport: BugReport,
    issueId: string
  ): Promise<LinearAttachment[]> {
    if (!bugReport.screenshot_key) {
      return [];
    }

    try {
      // Linear's fileUpload requires the byte size upfront, so we have to
      // headObject before streaming. For local storage this is cheap; for
      // S3 it's one extra HEAD request.
      const head = await this.storage.headObject(bugReport.screenshot_key);
      if (!head) {
        logger.warn('Screenshot key references missing object', {
          bugReportId: bugReport.id,
          screenshotKey: bugReport.screenshot_key,
        });
        return [];
      }

      const filename = bugReport.screenshot_key.split('/').pop() || DEFAULT_SCREENSHOT_FILENAME;
      const contentType = head.contentType ?? SCREENSHOT_CONTENT_TYPE;

      // Step 1 — ask Linear for a presigned upload URL.
      const upload = await client.fileUpload(filename, contentType, head.size);

      // Step 2 — PUT bytes to the presigned URL.
      // Destroy the storage stream in `finally` to avoid leaking file
      // descriptors (local storage) or http connections (S3) when the
      // PUT fails partway through. On the happy path the stream is
      // already at EOF and destroy() is a no-op.
      const stream = await this.storage.getObject(bugReport.screenshot_key);
      try {
        await client.uploadAssetBytes(upload, stream, contentType);
      } finally {
        if (
          typeof (stream as NodeJS.ReadableStream & { destroy?: () => void }).destroy === 'function'
        ) {
          (stream as NodeJS.ReadableStream & { destroy: () => void }).destroy();
        }
      }

      // Step 3 — record the attachment against the issue.
      const attachment = await client.createAttachment(issueId, upload.assetUrl, filename);

      logger.info('Screenshot attached to Linear issue', {
        bugReportId: bugReport.id,
        issueId,
        filename,
        attachmentId: attachment.id,
      });
      return [attachment];
    } catch (error) {
      logger.warn('Failed to attach screenshot to Linear issue', {
        bugReportId: bugReport.id,
        issueId,
        screenshotKey: bugReport.screenshot_key,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Atomic write to both `tickets` (queryable) and `bug_reports.external_*`
   * (denormalized fast path). Same pattern as Jira's service.
   */
  private async saveTicketReference(
    bugReportId: string,
    externalId: string,
    externalUrl: string,
    integrationId?: string,
    ruleId?: string,
    createdAutomatically?: boolean
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.tickets.createTicket(bugReportId, externalId, PLATFORM_NAME, DEFAULT_TICKET_STATUS, {
        integrationId,
        ruleId,
        createdAutomatically,
        externalUrl,
      });
      await tx.bugReports.updateExternalIntegration(bugReportId, externalId, externalUrl);
    });
  }

  // ============================================================================
  // CONFIG NORMALIZATION (route entry points)
  // ============================================================================

  /**
   * Coerce a wire-shape config (from admin UI or wizard) into a
   * `LinearConfig`. Tolerates both `apiKey` and the wizard's nested
   * `authentication.token` placement so the same payload can be sent to
   * `/test`, `/projects`, and persistence routes without reshaping at
   * each call site.
   *
   * `enabled` defaults to `true`; the route layer is responsible for
   * overriding when the caller explicitly disables.
   */
  private normalizeConfig(config: Record<string, unknown>): LinearConfig {
    const raw = config as RawLinearConfig;
    const apiKey =
      typeof raw.apiKey === 'string' && raw.apiKey.trim().length > 0
        ? raw.apiKey.trim()
        : typeof raw.authentication?.token === 'string'
          ? raw.authentication.token.trim()
          : '';

    return {
      apiKey,
      teamId: typeof raw.teamId === 'string' ? raw.teamId.trim() : '',
      teamKey: typeof raw.teamKey === 'string' ? raw.teamKey.trim() : '',
      projectId: typeof raw.projectId === 'string' ? raw.projectId.trim() : undefined,
      projectName: typeof raw.projectName === 'string' ? raw.projectName.trim() : undefined,
      defaultLabels: Array.isArray(raw.defaultLabels)
        ? raw.defaultLabels.filter((l): l is string => typeof l === 'string')
        : undefined,
      // Strict boolean check — `raw.enabled ?? true` would let a
      // stringly-typed `"false"` pass through as truthy, silently
      // re-enabling an integration the caller explicitly disabled.
      enabled: typeof raw.enabled === 'boolean' ? raw.enabled : true,
      templateConfig: raw.templateConfig,
    };
  }

  /**
   * Validate credentials supplied by the caller (no DB read) and produce
   * a runtime `LinearConfig` for `searchUsers` / `listProjects`. Throws
   * `ValidationError` with a combined diagnostic — mirrors
   * `JiraIntegrationService.validateAndNormalizeCredentials`.
   */
  private validateAndNormalizeCredentials(config: Record<string, unknown>): {
    apiKey: string;
    teamId?: string;
    teamKey?: string;
  } {
    const normalized = this.normalizeConfig(config);
    if (!normalized.apiKey) {
      throw new ValidationError('Linear configuration incomplete: missing apiKey');
    }
    return {
      apiKey: normalized.apiKey,
      teamId: normalized.teamId || undefined,
      teamKey: normalized.teamKey || undefined,
    };
  }

  // ============================================================================
  // OPTIONAL CONTRACT METHODS
  // ============================================================================

  /**
   * Return Linear teams in the contract's `{id, key, name}` shape so the
   * generic wizard project picker can render them without branching on
   * platform.
   */
  async listProjects(
    config: Record<string, unknown>,
    query?: string,
    maxResults?: number
  ): Promise<{ id: string; key: string; name: string }[]> {
    const { apiKey } = this.validateAndNormalizeCredentials(config);

    const requested =
      typeof maxResults === 'number' && Number.isFinite(maxResults)
        ? Math.max(1, Math.min(Math.floor(maxResults), 50))
        : 50;

    const client = new LinearClient(apiKey);
    const teams: LinearTeam[] = await client.teams(query, requested);
    return teams.map((t) => ({ id: t.id, key: t.key, name: t.name }));
  }

  /**
   * List Linear-side projects (epic-grouping) inside a given team.
   *
   * NOT part of the `IntegrationService` contract — this is Linear-specific
   * and surfaced through a dedicated route (or wired into a future contract
   * extension). Today the admin UI calls it directly via the plugin handle.
   */
  async listLinearProjectsForTeam(
    config: Record<string, unknown>,
    teamId: string,
    query?: string,
    maxResults = 50
  ): Promise<LinearProject[]> {
    if (!teamId || teamId.trim().length === 0) {
      throw new ValidationError('teamId is required');
    }
    const { apiKey } = this.validateAndNormalizeCredentials(config);
    const client = new LinearClient(apiKey);
    return client.projectsForTeam(teamId.trim(), query, maxResults);
  }

  /**
   * Search Linear users for assignee autocomplete. Returns the shared
   * cross-platform shape — `accountId` carries Linear's user UUID.
   */
  async searchUsers(
    config: Record<string, unknown>,
    query: string,
    maxResults?: number
  ): Promise<
    Array<{
      accountId: string;
      displayName: string;
      emailAddress?: string;
      avatarUrls?: Record<string, string>;
    }>
  > {
    if (!query || query.trim().length === 0) {
      return [];
    }
    const { apiKey } = this.validateAndNormalizeCredentials(config);
    const client = new LinearClient(apiKey);
    const users = await client.searchUsers(query, maxResults ?? 20);

    return users.map((u) => ({
      accountId: u.id,
      displayName: u.displayName || u.name,
      emailAddress: u.email,
      // Linear returns a single avatar URL, not a size-keyed map. We expose
      // it under all the standard size keys the shared UI components
      // already expect, rather than touching the contract.
      ...(u.avatarUrl
        ? {
            avatarUrls: {
              '16x16': u.avatarUrl,
              '24x24': u.avatarUrl,
              '32x32': u.avatarUrl,
              '48x48': u.avatarUrl,
            },
          }
        : {}),
    }));
  }

  getAllowedAvatarDomains(config: Record<string, unknown>): string[] {
    return buildLinearAllowedAvatarDomains(config);
  }

  // ============================================================================
  // DIRECT CONFIG OPERATIONS (used by tests and admin flows)
  // ============================================================================

  async saveConfiguration(projectId: string, config: LinearConfig): Promise<void> {
    await this.configManager.saveToDatabase(projectId, config);
  }

  async getConfiguration(projectId: string): Promise<LinearConfig | null> {
    return this.configManager.getConfig(projectId);
  }

  async deleteConfiguration(projectId: string): Promise<void> {
    await this.configManager.deleteFromDatabase(projectId);
  }

  async setEnabled(projectId: string, enabled: boolean): Promise<void> {
    await this.configManager.setEnabled(projectId, enabled);
  }

  // ==========================================================================
  // Capability methods (TicketIntegrationCapabilities)
  // ==========================================================================
  //
  // Used by the dedup rule engine to act on an already-created Linear issue.
  // Each loads the project's stored config, builds a one-shot LinearClient,
  // and delegates the GraphQL work. Canonical-status mapping lives in
  // ./status-mapper.ts so it's unit-testable without the network.

  /**
   * Resolve the LinearClient for a (project, integration) pair.
   *
   * Cross-tenant guard: `getConfigByIntegrationId(integrationId,
   * projectId)` returns null when the integration belongs to a different
   * project, preventing a foreign integrationId smuggled by a stale
   * outbox row or compromised event from working under another tenant's
   * credentials. See jira/service.ts for the full rationale.
   */
  private async resolveClient(integrationId: string, projectId: string): Promise<LinearClient> {
    const config = await this.configManager.getConfigByIntegrationId(integrationId, projectId);
    // `getConfigByIntegrationId` already returns null for disabled rows,
    // so `!config` covers the disabled case. Keeping the explicit
    // `!config.enabled` check anyway for symmetry with the legacy
    // `loadConfig` and to make the intent obvious to future readers.
    if (!config || !config.enabled) {
      throw new Error(
        `Linear integration ${integrationId} not usable for project ${projectId} ` +
          `(missing, disabled, wrong project, or wrong platform)`
      );
    }
    return new LinearClient(config.apiKey);
  }

  /**
   * Append a comment to an existing Linear issue.
   *
   * `target.externalId` is the human-readable Linear identifier (e.g.
   * "ENG-123") — that's what `createFromBugReport` stores. Linear's
   * mutations (`commentCreate`, `issueUpdate`) need the issue UUID, so
   * we resolve via `client.getIssue(...)` first; the `issue(id: String!)`
   * query accepts either the UUID or the identifier and returns the
   * full row with both. One extra GraphQL hop per call — acceptable for
   * the rule-engine cadence.
   */
  async addComment(target: CapabilityTarget, body: string): Promise<void> {
    const client = await this.resolveClient(target.integrationId, target.projectId);
    const issue = await client.getIssue(target.externalId);
    await client.commentCreate(issue.id, body);
  }

  /**
   * Move a Linear issue to the canonical status `targetStatus`.
   *
   * Three GraphQL calls: fetch the issue (resolves identifier → UUID
   * and discovers the team), list the team's workflow states, pick one
   * whose `type` maps to `targetStatus`, and `issueUpdate` to that
   * state's UUID. We do not cache `getTeamStates` — state customization
   * is rare and caching adds a per-tenant invalidation problem we don't
   * need yet.
   *
   * Throws when no state of the right type exists (heavily customized
   * workflow without e.g. a `started` state); caller is expected to
   * catch and skip the rule action.
   */
  async transition(target: CapabilityTarget, targetStatus: CanonicalStatus): Promise<void> {
    const client = await this.resolveClient(target.integrationId, target.projectId);

    const issue = await client.getIssue(target.externalId);
    const states = await client.getTeamStates(issue.team.id);
    const picked = pickStateForCanonicalStatus(states, targetStatus);
    if (!picked) {
      throw new Error(
        `No Linear state for canonical status '${targetStatus}' in team ${issue.team.name} (${issue.team.id})`
      );
    }

    // `issueUpdateState` needs the UUID (`issue.id`), NOT the
    // human-readable identifier we received in `target.externalId`.
    await client.issueUpdateState(issue.id, picked.id);
    logger.info('Linear issue transitioned via capability', {
      issueId: issue.id,
      identifier: issue.identifier,
      target: targetStatus,
      stateId: picked.id,
      stateName: picked.name,
      stateType: picked.type,
    });
  }

  /**
   * Read the canonical status of an existing Linear issue.
   *
   * The `issue(id)` GraphQL query accepts either the UUID or the
   * human-readable identifier as the `id` argument, so we can pass
   * `target.externalId` through directly — no separate UUID resolution
   * needed for a status read.
   */
  async getStatus(target: CapabilityTarget): Promise<CanonicalStatus> {
    const client = await this.resolveClient(target.integrationId, target.projectId);
    const issue = await client.getIssue(target.externalId);
    return linearStateTypeToCanonical(issue.state.type);
  }
}

// Re-exported so tests can construct fake credentials without poking
// through internals.
export type { LinearCredentials };
