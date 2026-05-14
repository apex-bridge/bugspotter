/**
 * Linear Client
 *
 * Handles communication with Linear's GraphQL API. Single endpoint
 * (`POST /graphql`), single fixed host (`api.linear.app`), one auth scheme
 * in v1 (personal API key in `Authorization` header — without `Bearer`).
 *
 * Why a hand-rolled client instead of `@linear/sdk`:
 *   - The SDK pulls a heavy GraphQL codegen runtime we don't need for the
 *     ~6 operations we use.
 *   - Mirrors `JiraClient` patterns (DNS pinning, explicit timeouts, no
 *     redirect following) so security review can apply the same checklist.
 *   - Lets us own the retry / 429 handling rather than rely on SDK defaults.
 */

import { request as httpsRequest } from 'https';
import { getLogger } from '../../logger.js';
import { pinHostnameToIp } from '../security/hardened-http.js';
import {
  LINEAR_API_HOST,
  LINEAR_API_URL,
  LINEAR_WEB_HOST,
  type LinearIssueInput,
  type LinearIssue,
  type LinearTeam,
  type LinearProject,
  type LinearUser,
  type LinearViewer,
  type LinearAttachment,
  type LinearFileUpload,
  type LinearGraphQLError,
  type LinearIssueDetail,
  type LinearWorkflowState,
} from './types.js';

const logger = getLogger();

const GRAPHQL_PATH = '/graphql';
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Linear caps `teams` paging at 50 by default; the cursor would let us page
 * further, but the wizard only needs the first page (consistent with the
 * Jira project picker's behaviour).
 */
const TEAMS_PAGE_SIZE = 50;
const USERS_PAGE_SIZE = 20;
const PROJECTS_PAGE_SIZE = 50;

interface GraphQLResponse<T> {
  data?: T;
  errors?: LinearGraphQLError[];
}

interface RequestResult<T> {
  data: T;
  statusCode: number;
}

/**
 * Linear's wire-level error contract is "200 OK with `errors[]` in body"
 * for most failures (validation, missing scope, ...). Only auth/transport
 * issues surface as HTTP 4xx/5xx. We normalize both into a single thrown
 * Error with the most useful message we can reconstruct.
 */
function formatGraphQLError(errors: LinearGraphQLError[]): string {
  return errors
    .map((e) => e.extensions?.userPresentableMessage ?? e.message)
    .filter((m) => m && m.length > 0)
    .join('; ');
}

export class LinearClient {
  private apiKey: string;

  constructor(apiKey: string) {
    if (!apiKey || apiKey.trim().length === 0) {
      throw new Error('Linear API key is required');
    }
    // Reject CRLF / NUL on the raw value, not on the trimmed one — node
    // may also reject these at request time, but catching them at
    // construction time gives a clearer error and rules out any chance
    // of header injection via the Authorization line.
    if (/[\r\n\0]/.test(apiKey)) {
      throw new Error('Linear API key contains illegal control characters');
    }
    this.apiKey = apiKey.trim();
  }

  /**
   * Execute a GraphQL operation against Linear.
   *
   * **No client-level retries.** Mutations (`issueCreate`,
   * `attachmentCreate`, `fileUpload`) aren't idempotent at the transport
   * layer — a post-send timeout or `ECONNRESET` would mean the request
   * may have reached Linear and been processed, and a blind retry would
   * create duplicate issues. The outbox/queue layer above this client
   * retries the whole operation when needed; read queries (`viewer`,
   * `teams`, `searchUsers`) are called from UI flows where manual
   * retry is acceptable. Adding selective retries back requires Linear's
   * `IssueCreateInput.id` for client-side idempotency (planned for the
   * Jira-parity follow-up that introduces per-mutation idempotency
   * keys across both plugins).
   */
  private async graphql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    const { data } = await this.executeRequest<T>(query, variables);
    return data;
  }

  /**
   * Single request attempt — no retries, all failures terminal.
   *
   * Returns the parsed GraphQL data + status. Throws on HTTP errors,
   * GraphQL errors, or JSON parse failures.
   */
  private async executeRequest<T>(
    query: string,
    variables?: Record<string, unknown>
  ): Promise<RequestResult<T>> {
    // DNS rebinding defense — same pattern as `JiraClient`. Linear's
    // hostname is fixed but DNS is still a trust boundary.
    const { lookup } = await pinHostnameToIp(LINEAR_API_HOST);
    const body = JSON.stringify({ query, variables: variables ?? {} });

    return new Promise<RequestResult<T>>((resolve, reject) => {
      const req = httpsRequest(
        {
          hostname: LINEAR_API_HOST,
          port: 443,
          path: GRAPHQL_PATH,
          method: 'POST',
          headers: {
            // Personal API keys: raw header value, no Bearer prefix.
            // OAuth would use `Bearer <token>` — we don't accept those yet.
            Authorization: this.apiKey,
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'Content-Length': Buffer.byteLength(body).toString(),
          },
          lookup,
        },
        (res) => {
          let raw = '';
          res.setEncoding('utf8');
          res.on('data', (chunk: string) => {
            raw += chunk;
          });
          res.on('end', () => {
            const statusCode = res.statusCode ?? 0;

            if (statusCode >= 400) {
              const errorMsg = `Linear API HTTP ${statusCode}: ${raw.slice(0, 500)}`;
              const err = new Error(errorMsg) as Error & { statusCode?: number };
              err.statusCode = statusCode;
              logger.error('Linear API HTTP error', {
                statusCode,
                bodyPreview: raw.slice(0, 200),
              });
              return reject(err);
            }

            // Parse GraphQL response.
            let parsed: GraphQLResponse<T>;
            try {
              parsed = JSON.parse(raw) as GraphQLResponse<T>;
            } catch {
              return reject(new Error('Linear API returned malformed JSON'));
            }

            if (parsed.errors && parsed.errors.length > 0) {
              const msg = formatGraphQLError(parsed.errors);
              logger.error('Linear GraphQL error', {
                errorCount: parsed.errors.length,
                firstError: parsed.errors[0],
              });
              return reject(new Error(`Linear API error: ${msg}`));
            }

            if (parsed.data === undefined) {
              return reject(new Error('Linear API returned no data'));
            }

            resolve({ data: parsed.data, statusCode });
          });
        }
      );

      req.on('error', (error) => {
        reject(new Error(`Linear API network error: ${error.message}`));
      });

      // `req.destroy(err)` fires `'error'` with that err, so the handler
      // above is the single reject point — no double-reject possible.
      req.setTimeout(DEFAULT_TIMEOUT_MS, () => {
        req.destroy(new Error('Linear API request timeout'));
      });

      req.write(body);
      req.end();
    });
  }

  /**
   * Identify the calling user — used by `testConnection` to validate the
   * API key without side effects. Cheaper and more reliable than touching
   * a specific team / project.
   */
  async viewer(): Promise<LinearViewer> {
    const query = `query Viewer {
      viewer {
        id
        name
        email
        organization { id name urlKey }
      }
    }`;
    const result = await this.graphql<{ viewer: LinearViewer }>(query);
    return result.viewer;
  }

  /**
   * List teams visible to the authenticated user.
   *
   * Backs the wizard's first picker step. Linear has no separate "project
   * search" endpoint at the team level — `teams` already returns the small
   * (single-org) set most users care about. We expose `query` as an
   * optional substring filter applied to `name` (Linear's API also lets
   * us filter on `key`, but a unified substring match keeps the UI simple).
   */
  async teams(query?: string, first = TEAMS_PAGE_SIZE): Promise<LinearTeam[]> {
    const trimmed = query?.trim();
    const filter = trimmed ? `filter: { name: { containsIgnoreCase: $q } }` : '';
    const args = `first: $first${filter ? `, ${filter}` : ''}`;
    const params = trimmed ? '$q: String!, $first: Int!' : '$first: Int!';

    const gql = `query Teams(${params}) {
      teams(${args}) {
        nodes { id key name }
      }
    }`;
    const variables: Record<string, unknown> = { first };
    if (trimmed) {
      variables.q = trimmed;
    }

    const result = await this.graphql<{ teams: { nodes: LinearTeam[] } }>(gql, variables);
    return result.teams.nodes;
  }

  /**
   * Fetch a single team by id. Returns `null` when the team isn't visible
   * to this API key (Linear returns `team: null` for non-existent or
   * inaccessible ids — no separate 404).
   *
   * Used by `LinearConfigManager.validate` instead of `teams()` so the
   * check doesn't break for orgs with more than one page (~50) of teams.
   */
  async getTeam(teamId: string): Promise<LinearTeam | null> {
    const gql = `query GetTeam($teamId: String!) {
      team(id: $teamId) { id key name }
    }`;
    const result = await this.graphql<{ team: LinearTeam | null }>(gql, { teamId });
    return result.team;
  }

  /**
   * List Linear Projects within a team. Used for the optional second-step
   * picker in the wizard (Team → Project → save).
   */
  async projectsForTeam(
    teamId: string,
    query?: string,
    first = PROJECTS_PAGE_SIZE
  ): Promise<LinearProject[]> {
    const trimmed = query?.trim();
    const filter = trimmed ? `, filter: { name: { containsIgnoreCase: $q } }` : '';
    const params = trimmed
      ? '$teamId: String!, $first: Int!, $q: String!'
      : '$teamId: String!, $first: Int!';

    const gql = `query TeamProjects(${params}) {
      team(id: $teamId) {
        projects(first: $first${filter}) {
          nodes { id name description state }
        }
      }
    }`;
    const variables: Record<string, unknown> = { teamId, first };
    if (trimmed) {
      variables.q = trimmed;
    }

    const result = await this.graphql<{ team: { projects: { nodes: LinearProject[] } } | null }>(
      gql,
      variables
    );
    return result.team?.projects.nodes ?? [];
  }

  /**
   * User search — backs assignee autocomplete in rule-form UI.
   *
   * Linear filters on `name` / `displayName` / `email` via the `or`
   * combinator. The Jira plugin returns a flat `{accountId, displayName,
   * emailAddress, avatarUrls}` shape; we adapt at the service layer.
   */
  async searchUsers(query: string, first = USERS_PAGE_SIZE): Promise<LinearUser[]> {
    const trimmed = query.trim();
    if (trimmed.length === 0) {
      return [];
    }

    const gql = `query SearchUsers($q: String!, $first: Int!) {
      users(
        first: $first,
        filter: {
          or: [
            { name: { containsIgnoreCase: $q } },
            { displayName: { containsIgnoreCase: $q } },
            { email: { containsIgnoreCase: $q } }
          ]
        }
      ) {
        nodes { id name displayName email avatarUrl active }
      }
    }`;
    const result = await this.graphql<{ users: { nodes: LinearUser[] } }>(gql, {
      q: trimmed,
      first,
    });
    return result.users.nodes;
  }

  /**
   * Create an issue. Returns the canonical web URL Linear assigns — no
   * client-side URL templating, unlike Jira.
   */
  async createIssue(input: LinearIssueInput): Promise<LinearIssue> {
    const gql = `mutation CreateIssue($input: IssueCreateInput!) {
      issueCreate(input: $input) {
        success
        issue { id identifier url title }
      }
    }`;
    const result = await this.graphql<{
      issueCreate: { success: boolean; issue: LinearIssue | null };
    }>(gql, { input });

    if (!result.issueCreate.success || !result.issueCreate.issue) {
      throw new Error('Linear issueCreate returned success=false');
    }
    return result.issueCreate.issue;
  }

  /**
   * Two-step file upload (step 1 of 2).
   *
   * Linear doesn't accept multipart on issue creation — instead we ask for
   * a presigned asset URL, PUT the bytes there with whatever headers
   * Linear returns, and either reference `assetUrl` from an
   * `attachmentCreate` or embed it inline in the issue description.
   *
   * `size` is required by Linear (the API uses it to plan storage and to
   * reject oversize uploads up-front), which is why the service layer has
   * to know the screenshot's byte length before calling this — we can't
   * just stream blind.
   */
  async fileUpload(filename: string, contentType: string, size: number): Promise<LinearFileUpload> {
    const gql = `mutation FileUpload($filename: String!, $contentType: String!, $size: Int!) {
      fileUpload(filename: $filename, contentType: $contentType, size: $size) {
        success
        uploadFile {
          uploadUrl
          assetUrl
          headers { key value }
        }
      }
    }`;
    const result = await this.graphql<{
      fileUpload: {
        success: boolean;
        uploadFile: LinearFileUpload | null;
      };
    }>(gql, { filename, contentType, size });

    if (!result.fileUpload.success || !result.fileUpload.uploadFile) {
      throw new Error('Linear fileUpload returned success=false');
    }
    return result.fileUpload.uploadFile;
  }

  /**
   * PUT the actual bytes to the presigned URL (step 2 of 2).
   *
   * Implemented as a separate method so callers can choose between
   * buffered and streamed uploads. We use the global `fetch` here rather
   * than `https.request` because the upload target is an asset host
   * (S3-style), not Linear itself — DNS pinning is less critical and
   * fetch's streaming body support is simpler. We do NOT follow
   * redirects (`redirect: 'error'`) to keep the upload destination
   * exactly what Linear returned.
   */
  async uploadAssetBytes(
    upload: LinearFileUpload,
    body: Buffer | NodeJS.ReadableStream,
    contentType: string
  ): Promise<void> {
    // The presigned URL comes from a successful `fileUpload` response, so
    // it's already trusted in principle — but a misconfigured Linear
    // response or an MITM during an incident could downgrade us. Reject
    // anything that isn't HTTPS at the call site.
    let parsedUploadUrl: URL;
    try {
      parsedUploadUrl = new URL(upload.uploadUrl);
    } catch {
      throw new Error('Linear asset uploadUrl is not a valid URL');
    }
    if (parsedUploadUrl.protocol !== 'https:') {
      throw new Error(`Linear asset uploadUrl must use https, got ${parsedUploadUrl.protocol}`);
    }

    const headers: Record<string, string> = { 'Content-Type': contentType };
    for (const { key, value } of upload.headers) {
      headers[key] = value;
    }

    // `fetch` accepts Buffer and ReadableStream as body. We use the global
    // fetch (Node 18+); duplex hint is required for streamed bodies.
    // Cast: the global `RequestInit['body']` type doesn't include Node
    // streams in lib.dom.d.ts, but undici (Node's fetch implementation)
    // accepts them at runtime.
    //
    // Timeout: this is the only outbound fetch that doesn't go through
    // `httpsRequest` (which has `req.setTimeout`). A stalled presigned
    // PUT would otherwise hang issue creation indefinitely.
    const init: RequestInit & { duplex?: 'half' } = {
      method: 'PUT',
      headers,
      body: body as unknown as RequestInit['body'],
      redirect: 'error',
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    };
    if (!Buffer.isBuffer(body)) {
      init.duplex = 'half';
    }

    const response = await fetch(parsedUploadUrl, init);
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Linear asset upload failed: HTTP ${response.status} ${text.slice(0, 200)}`);
    }
  }

  /**
   * Create an attachment that references an already-uploaded asset URL
   * (or any external URL). Distinct from file upload — this is the
   * GraphQL record that ties the file to an issue.
   */
  async createAttachment(issueId: string, url: string, title: string): Promise<LinearAttachment> {
    const gql = `mutation AttachmentCreate($issueId: String!, $url: String!, $title: String!) {
      attachmentCreate(input: { issueId: $issueId, url: $url, title: $title }) {
        success
        attachment { id title url }
      }
    }`;
    const result = await this.graphql<{
      attachmentCreate: { success: boolean; attachment: LinearAttachment | null };
    }>(gql, { issueId, url, title });

    if (!result.attachmentCreate.success || !result.attachmentCreate.attachment) {
      throw new Error('Linear attachmentCreate returned success=false');
    }
    return result.attachmentCreate.attachment;
  }

  /**
   * Construct a fallback issue URL when the API hasn't returned one.
   * Used only as a safety net — `issueCreate` already gives us `url`.
   */
  static getIssueUrl(orgUrlKey: string, identifier: string): string {
    return `${LINEAR_WEB_HOST}/${orgUrlKey}/issue/${identifier}`;
  }

  // ==========================================================================
  // Capability methods (TicketIntegrationCapabilities)
  // ==========================================================================
  //
  // Three operations the dedup rule engine needs against an existing Linear
  // issue: add a comment, transition to a canonical status, and read the
  // current status. State resolution (canonical → Linear state UUID) is done
  // in the service layer via `getTeamStates` + ./status-mapper.ts so this
  // class stays a pure GraphQL wrapper.

  /**
   * Append a comment to an existing Linear issue.
   *
   * @param issueId Linear issue UUID (not the human-readable identifier
   *                like "ENG-123"). The capability layer always passes the
   *                stored `external_ticket_id`, which is the UUID.
   * @param body    Markdown-formatted body. Linear supports markdown in
   *                comments natively, so no ADF translation needed.
   */
  async commentCreate(issueId: string, body: string): Promise<void> {
    if (!issueId) {
      throw new Error('commentCreate: issueId is required');
    }
    if (!body || body.trim().length === 0) {
      throw new Error('commentCreate: body cannot be empty');
    }

    const gql = `mutation CommentCreate($input: CommentCreateInput!) {
      commentCreate(input: $input) {
        success
      }
    }`;
    const result = await this.graphql<{ commentCreate: { success: boolean } }>(gql, {
      input: { issueId, body },
    });
    if (!result.commentCreate.success) {
      throw new Error('Linear commentCreate returned success=false');
    }
  }

  /**
   * Fetch an issue's current state and its team id.
   *
   * Used by the capability layer to (a) read canonical status and (b)
   * resolve a target canonical status to a specific state UUID via the
   * team's available states.
   */
  async getIssue(issueId: string): Promise<LinearIssueDetail> {
    if (!issueId) {
      throw new Error('getIssue: issueId is required');
    }
    const gql = `query Issue($id: String!) {
      issue(id: $id) {
        id
        identifier
        state { id name type }
        team { id name }
      }
    }`;
    const result = await this.graphql<{ issue: LinearIssueDetail | null }>(gql, { id: issueId });
    if (!result.issue) {
      throw new Error(`Linear issue not found: ${issueId}`);
    }
    return result.issue;
  }

  /**
   * List all workflow states defined for a Linear team.
   *
   * Each state has a `type` ∈ {triage, backlog, unstarted, started,
   * completed, canceled} — the capability layer maps these to canonical
   * statuses. Callers may cache results per-team (states change rarely).
   */
  async getTeamStates(teamId: string): Promise<LinearWorkflowState[]> {
    if (!teamId) {
      throw new Error('getTeamStates: teamId is required');
    }
    const gql = `query TeamStates($id: String!) {
      team(id: $id) {
        states { nodes { id name type position } }
      }
    }`;
    const result = await this.graphql<{
      team: { states: { nodes: LinearWorkflowState[] } } | null;
    }>(gql, { id: teamId });
    if (!result.team) {
      throw new Error(`Linear team not found: ${teamId}`);
    }
    return result.team.states.nodes;
  }

  /**
   * Move an existing issue to a different workflow state.
   *
   * The `stateId` must come from the issue's team's available states (see
   * `getTeamStates`). Linear silently rejects state IDs from other teams.
   */
  async issueUpdateState(issueId: string, stateId: string): Promise<void> {
    if (!issueId) {
      throw new Error('issueUpdateState: issueId is required');
    }
    if (!stateId) {
      throw new Error('issueUpdateState: stateId is required');
    }
    const gql = `mutation IssueUpdate($id: String!, $input: IssueUpdateInput!) {
      issueUpdate(id: $id, input: $input) {
        success
      }
    }`;
    const result = await this.graphql<{ issueUpdate: { success: boolean } }>(gql, {
      id: issueId,
      input: { stateId },
    });
    if (!result.issueUpdate.success) {
      throw new Error('Linear issueUpdate returned success=false');
    }
  }
}

// Test-only export — see client.test.ts.
export const __test = { formatGraphQLError };

export { LINEAR_API_URL };
