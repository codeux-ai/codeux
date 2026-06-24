import axios from "axios";
import type { AxiosInstance } from "axios";
import type { JulesActivity, JulesSession, JulesSource } from "../contracts/app-types.js";
import type { JulesClient } from "../domain/jules/jules-client.js";

export class JulesNotFoundError extends Error {
  readonly status = 404;
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "JulesNotFoundError";
    this.cause = cause;
  }
}

export function isNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  if (error instanceof Error && error.name === "JulesNotFoundError") {
    return true;
  }
  if (axios.isAxiosError && axios.isAxiosError(error)) {
    return error.response?.status === 404;
  }
  const err = error as { status?: number; response?: { status?: number }; message?: string };
  if (err.status === 404 || err.response?.status === 404) {
    return true;
  }
  if (typeof err.message === "string" && err.message.includes("status code 404")) {
    return true;
  }
  return false;
}

export interface JulesApiClientOptions {
  apiKey?: string | null;
  baseUrl: string;
  /**
   * Minimum spacing between outgoing request starts, in milliseconds. Acts as a
   * client-side rate limiter so that fan-out from many callers (session sync,
   * the dashboard activity cache, clarification replies, …) cannot stampede the
   * Jules API into 429s. Defaults to 250ms (~4 req/s).
   */
  minRequestIntervalMs?: number;
  /**
   * Per-request timeout in milliseconds. Bounds how long a single call may hang
   * before it is aborted and retried, instead of relying on the OS-level TCP
   * timeout (which can leave a `sendMessage` stuck for over a minute and surface
   * as an opaque `ETIMEDOUT`). Defaults to 30s.
   */
  requestTimeoutMs?: number;
  /**
   * Maximum automatic retries for transient transport failures (network resets,
   * timeouts, DNS hiccups) and 429s. Defaults to 4.
   */
  maxTransientRetries?: number;
  /**
   * Time-to-live for the shared session snapshot returned by
   * {@link JulesApiClient.getCachedSessions}. Across many concurrent sprint
   * watch loops this collapses N `listSessions` calls per cycle into a single
   * shared fetch. Defaults to 12s (just above the 10s watch-loop interval so
   * concurrent loops share one fetch while state stays near-real-time).
   */
  sessionsCacheTtlMs?: number;
  /**
   * Upper bound on how many sessions the shared snapshot paginates through per
   * refresh. Active sessions are always the most recent, so this caps work on
   * accounts with thousands of historical sessions. Defaults to 300.
   */
  maxSnapshotSessions?: number;
  /** Injectable clock for deterministic tests. Defaults to `Date.now`. */
  now?: () => number;
}

export interface JulesPageRequest {
  page_size?: number;
  page_token?: string;
}

export interface JulesListSourcesRequest extends JulesPageRequest {
  filter?: string;
}

export interface JulesListSourcesResponse {
  sources?: JulesSource[];
  nextPageToken?: string;
}

export interface JulesListSessionsRequest extends JulesPageRequest {}

export interface JulesListSessionsResponse {
  sessions?: JulesSession[];
  nextPageToken?: string;
}

export interface JulesListActivitiesRequest extends JulesPageRequest {
  session_id: string;
}

export interface JulesListActivitiesResponse {
  activities?: JulesActivity[];
  nextPageToken?: string;
}

export interface JulesSourceContext {
  source: string;
  githubRepoContext?: {
    startingBranch?: string;
  };
}

export interface JulesCreateSessionRequest {
  prompt: string;
  sourceContext: JulesSourceContext;
  title?: string;
  requirePlanApproval?: boolean;
  automationMode?: string;
}

export interface JulesSessionActionResponse {
  id?: string;
  name?: string;
  state?: string;
  title?: string;
  createTime?: string;
  updateTime?: string;
  done?: boolean;
  message?: string;
  [key: string]: unknown;
}

interface JulesPageQuery {
  pageSize?: number;
  pageToken?: string;
}

interface JulesListSourcesQuery extends JulesPageQuery {
  filter?: string;
}

const TRANSIENT_NETWORK_CODES = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "ECONNABORTED",
  "EAI_AGAIN",
  "ENOTFOUND",
  "EPIPE",
  "ECONNREFUSED",
  "ERR_NETWORK",
  "ERR_CANCELED",
]);

const isTransientNetworkError = (error: unknown): boolean => {
  if (!error || typeof error !== "object") {
    return false;
  }
  // A request that never produced a response (DNS/connect/reset/timeout). Node
  // may also surface these as an AggregateError (happy-eyeballs) whose own code
  // is unset, so fall back to scanning the message.
  const err = error as { response?: unknown; code?: string; name?: string; message?: string };
  if (err.response) {
    return false;
  }
  if (err.code && TRANSIENT_NETWORK_CODES.has(err.code)) {
    return true;
  }
  if (err.name === "AggregateError") {
    return true;
  }
  const message = (err.message || "").toLowerCase();
  return message.includes("timeout")
    || message.includes("etimedout")
    || message.includes("econnreset")
    || message.includes("socket hang up")
    || message.includes("network error");
};

export class JulesApiClient implements JulesClient {
  private readonly axiosInstance: AxiosInstance;
  private apiKey: string | null;
  private readonly minRequestIntervalMs: number;
  private readonly maxTransientRetries: number;
  private readonly sessionsCacheTtlMs: number;
  private readonly maxSnapshotSessions: number;
  private readonly now: () => number;
  private nextRequestSlot = 0;
  private sessionSnapshot: { at: number; sessions: JulesSession[] } | null = null;
  private sessionSnapshotInFlight: Promise<JulesSession[]> | null = null;

  constructor(options: JulesApiClientOptions) {
    this.apiKey = this.normalizeApiKey(options.apiKey);
    this.minRequestIntervalMs = Math.max(0, options.minRequestIntervalMs ?? 250);
    this.maxTransientRetries = Math.max(0, options.maxTransientRetries ?? 4);
    this.sessionsCacheTtlMs = Math.max(0, options.sessionsCacheTtlMs ?? 12_000);
    this.maxSnapshotSessions = Math.max(1, options.maxSnapshotSessions ?? 300);
    this.now = options.now ?? Date.now;
    this.axiosInstance = axios.create({
      baseURL: options.baseUrl,
      timeout: Math.max(0, options.requestTimeoutMs ?? 30_000),
      headers: {
        "Content-Type": "application/json",
      },
    });

    this.axiosInstance.interceptors.request.use(async (config) => {
      const headers = config.headers ?? {};
      if (this.apiKey) {
        headers["X-Goog-Api-Key"] = this.apiKey;
      } else {
        delete headers["X-Goog-Api-Key"];
      }
      config.headers = headers;
      await this.acquireRequestSlot();
      return config;
    });

    const retryCounts = new WeakMap<object, number>();

    this.axiosInstance.interceptors.response.use(
      (response) => response,
      async (error) => {
        const config = error.config;
        if (!config) {
          return Promise.reject(error);
        }

        const is429 = Boolean(error.response && error.response.status === 429);
        const isTransient = !error.response && isTransientNetworkError(error);

        if (is429 || isTransient) {
          const retryCount = retryCounts.get(config) || 0;

          if (retryCount < this.maxTransientRetries) {
            const nextCount = retryCount + 1;
            retryCounts.set(config, nextCount);

            // Honor a server-provided Retry-After when present; otherwise fall
            // back to exponential backoff (1s, 2s, 4s, 8s, …) with jitter.
            const retryAfterMs = is429 ? this.parseRetryAfterMs(error.response.headers?.["retry-after"]) : null;
            const backoffMs = Math.pow(2, nextCount - 1) * 1000 + Math.random() * 500;
            const delay = Math.min(Math.max(retryAfterMs ?? backoffMs, backoffMs), 30000);

            const reason = is429 ? "returned 429" : `hit a transient network error (${error.code || error.name || "unknown"})`;
            console.warn(`Jules API ${reason}. Retrying request to ${config.url} (Attempt ${nextCount}/${this.maxTransientRetries}) after ${Math.round(delay)}ms...`);

            // Push the global request schedule out so concurrent in-flight
            // requests also back off, instead of all hammering at once.
            this.deferRequestSlot(delay);
            await new Promise((resolve) => setTimeout(resolve, delay));

            return this.axiosInstance(config);
          }
        }

        return Promise.reject(error);
      }
    );

  }

  /**
   * Serializes request start times so that no two requests begin closer than
   * `minRequestIntervalMs` apart, bounding the outgoing request rate across all
   * callers without blocking concurrency once a request has started.
   */
  private async acquireRequestSlot(): Promise<void> {
    if (this.minRequestIntervalMs <= 0) {
      return;
    }
    const now = Date.now();
    const slot = Math.max(now, this.nextRequestSlot);
    this.nextRequestSlot = slot + this.minRequestIntervalMs;
    const wait = slot - now;
    if (wait > 0) {
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }

  /** Pushes the global request schedule out by at least `delayMs` after a 429. */
  private deferRequestSlot(delayMs: number): void {
    this.nextRequestSlot = Math.max(this.nextRequestSlot, Date.now() + delayMs);
  }

  private parseRetryAfterMs(headerValue: unknown): number | null {
    if (typeof headerValue !== "string" || headerValue.trim().length === 0) {
      return null;
    }
    const trimmed = headerValue.trim();
    const seconds = Number(trimmed);
    if (Number.isFinite(seconds)) {
      return Math.max(0, seconds * 1000);
    }
    const dateMs = Date.parse(trimmed);
    if (Number.isFinite(dateMs)) {
      return Math.max(0, dateMs - Date.now());
    }
    return null;
  }

  setApiKey(apiKey?: string | null): void {
    this.apiKey = this.normalizeApiKey(apiKey);
  }

  hasApiKey(): boolean {
    return this.apiKey !== null;
  }

  private ensureApiKey(): void {
    if (!this.hasApiKey()) {
      throw new Error("Jules API key is not configured.");
    }
  }

  private normalizeApiKey(apiKey?: string | null): string | null {
    if (typeof apiKey !== "string") {
      return null;
    }
    const trimmed = apiKey.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  normalizeName(type: string, id: string): string {
    if (id.startsWith(`${type}/`)) return id;
    return `${type}/${id}`;
  }

  private toSessionId(sessionNameOrId: string): string {
    return sessionNameOrId.replace(/^sessions\//, "");
  }

  private toSessionName(sessionNameOrId: string): string {
    return this.normalizeName("sessions", this.toSessionId(sessionNameOrId));
  }

  private toPageQuery(args: JulesPageRequest): JulesPageQuery {
    return {
      pageSize: args.page_size,
      pageToken: args.page_token,
    };
  }

  extractSessionId(session: Partial<JulesSession>): string | undefined {
    if (typeof session.id === "string" && session.id.length > 0) {
      return this.toSessionId(session.id);
    }
    if (typeof session.name === "string" && session.name.length > 0) {
      return this.toSessionId(session.name);
    }
    return undefined;
  }

  resolveSessionName(session: Partial<JulesSession>): string | undefined {
    if (typeof session.name === "string" && session.name.length > 0) {
      return this.toSessionName(session.name);
    }
    if (typeof session.id === "string" && session.id.length > 0) {
      return this.toSessionName(session.id);
    }
    return undefined;
  }

  async getSource(sourceId: string): Promise<JulesSource> {
    this.ensureApiKey();
    const response = await this.axiosInstance.get<JulesSource>(`/${this.normalizeName("sources", sourceId)}`);
    return response.data;
  }

  async listSources(args: JulesListSourcesRequest): Promise<JulesListSourcesResponse> {
    this.ensureApiKey();
    const params: JulesListSourcesQuery = { filter: args.filter, ...this.toPageQuery(args) };
    const response = await this.axiosInstance.get<JulesListSourcesResponse>("/sources", { params });
    return response.data;
  }

  async listAllSources(filter?: string): Promise<JulesSource[]> {
    this.ensureApiKey();
    let allSources: JulesSource[] = [];
    let pageToken: string | undefined = undefined;

    do {
      const params: JulesListSourcesQuery = { filter, pageToken };
      const response = await this.axiosInstance.get<JulesListSourcesResponse>("/sources", { params });
      allSources = allSources.concat(response.data.sources || []);
      pageToken = response.data.nextPageToken;
    } while (pageToken);

    return allSources;
  }

  async createSession(data: JulesCreateSessionRequest): Promise<JulesSession> {
    this.ensureApiKey();
    const response = await this.axiosInstance.post<JulesSession>("/sessions", data);
    this.invalidateSessionsCache();
    return response.data;
  }

  async getSession(sessionId: string): Promise<JulesSession> {
    this.ensureApiKey();
    const name = this.toSessionName(sessionId);
    try {
      const response = await this.axiosInstance.get<JulesSession>(`/${name}`);
      return response.data;
    } catch (error) {
      if (isNotFoundError(error)) {
        throw new JulesNotFoundError(`Jules session not found: ${sessionId}`, error);
      }
      throw error;
    }
  }

  async listSessions(args: JulesListSessionsRequest = {}): Promise<JulesListSessionsResponse> {
    this.ensureApiKey();
    const params: JulesPageQuery = this.toPageQuery(args);
    const response = await this.axiosInstance.get<JulesListSessionsResponse>("/sessions", { params });
    return response.data;
  }

  /**
   * Returns a shared, short-lived snapshot of every session on the account
   * (most-recent first, up to `maxSnapshotSessions`).
   *
   * Each sprint's watch loop needs the full session list every cycle to map
   * remote state back onto its tasks. Fetching that per sprint per cycle
   * (×N sprints, every 10s) is what drives the account into 429s and timeouts.
   * This coalesces all concurrent callers onto a single in-flight fetch and
   * caches the result for `sessionsCacheTtlMs`, so the whole orchestrator makes
   * at most one `listSessions` pagination per TTL window regardless of how many
   * sprints are running. On a transient failure it serves the last good
   * snapshot rather than disrupting every sprint's sync.
   */
  async getCachedSessions(): Promise<JulesSession[]> {
    const fresh = this.sessionSnapshot && (this.now() - this.sessionSnapshot.at) < this.sessionsCacheTtlMs;
    if (fresh) {
      return this.sessionSnapshot!.sessions;
    }
    if (this.sessionSnapshotInFlight) {
      return this.sessionSnapshotInFlight;
    }
    this.sessionSnapshotInFlight = this.refreshSessionSnapshot()
      .finally(() => { this.sessionSnapshotInFlight = null; });
    return this.sessionSnapshotInFlight;
  }

  /** Drops the cached session snapshot so the next read re-fetches fresh state. */
  invalidateSessionsCache(): void {
    this.sessionSnapshot = null;
  }

  private async refreshSessionSnapshot(): Promise<JulesSession[]> {
    try {
      const all: JulesSession[] = [];
      let pageToken: string | undefined = undefined;
      do {
        const response: JulesListSessionsResponse = await this.listSessions({ page_size: 100, page_token: pageToken });
        const sessions = response.sessions || [];
        all.push(...sessions);
        pageToken = sessions.length > 0 ? response.nextPageToken : undefined;
      } while (pageToken && all.length < this.maxSnapshotSessions);
      this.sessionSnapshot = { at: this.now(), sessions: all };
      return all;
    } catch (error) {
      if (this.sessionSnapshot) {
        // Serve stale rather than failing every sprint's sync on a blip; the
        // timestamp is left untouched so the next call retries promptly.
        return this.sessionSnapshot.sessions;
      }
      throw error;
    }
  }

  async approveSessionPlan(sessionId: string): Promise<JulesSessionActionResponse> {
    this.ensureApiKey();
    const name = this.toSessionName(sessionId);
    const response = await this.axiosInstance.post<JulesSessionActionResponse>(`/${name}:approvePlan`);
    this.invalidateSessionsCache();
    return response.data;
  }

  async sendSessionMessage(sessionId: string, prompt: string): Promise<JulesSessionActionResponse> {
    this.ensureApiKey();
    const name = this.toSessionName(sessionId);
    const response = await this.axiosInstance.post<JulesSessionActionResponse>(`/${name}:sendMessage`, { prompt });
    this.invalidateSessionsCache();
    return response.data;
  }

  async getActivity(sessionId: string, activityId: string): Promise<JulesActivity> {
    this.ensureApiKey();
    const sessionName = this.toSessionName(sessionId);
    const activityName = this.normalizeName("activities", activityId);
    try {
      const response = await this.axiosInstance.get<JulesActivity>(`/${sessionName}/${activityName}`);
      return response.data;
    } catch (error) {
      if (isNotFoundError(error)) {
        throw new JulesNotFoundError(`Jules activity not found: ${sessionId}/${activityId}`, error);
      }
      throw error;
    }
  }

  async listActivities(args: JulesListActivitiesRequest): Promise<JulesListActivitiesResponse> {
    this.ensureApiKey();
    const sessionName = this.toSessionName(args.session_id);
    const params: JulesPageQuery = this.toPageQuery(args);
    const response = await this.axiosInstance.get<JulesListActivitiesResponse>(`/${sessionName}/activities`, { params });
    return response.data;
  }

  async getFullConversation(sessionId: string): Promise<JulesActivity[]> {
    return this.listAllActivities(sessionId);
  }

  async listAllActivities(sessionId: string): Promise<JulesActivity[]> {
    this.ensureApiKey();
    const sessionName = this.toSessionName(sessionId);
    let allActivities: JulesActivity[] = [];
    let pageToken: string | undefined = undefined;

    try {
      do {
        const params: JulesPageQuery = { pageToken };
        const response = await this.axiosInstance.get<JulesListActivitiesResponse>(`/${sessionName}/activities`, { params });
        allActivities = allActivities.concat(response.data.activities || []);
        pageToken = response.data.nextPageToken;
      } while (pageToken);
    } catch (error) {
      if (isNotFoundError(error)) {
        throw new JulesNotFoundError(`Jules activities not found for session: ${sessionId}`, error);
      }
      throw error;
    }

    return allActivities;
  }

  async fetchRecentActivities(sessionName: string, pageSize: number): Promise<JulesActivity[]> {
    this.ensureApiKey();
    if (pageSize <= 0) {
      return [];
    }
    const normalizedSessionName = this.toSessionName(sessionName);
    let pageToken: string | undefined = undefined;
    let recentActivities: JulesActivity[] = [];

    do {
      const response: { data: JulesListActivitiesResponse } = await this.axiosInstance.get<JulesListActivitiesResponse>(`/${normalizedSessionName}/activities`, {
        params: { pageSize, pageToken },
      });
      const activities = response.data.activities || [];
      if (activities.length > 0) {
        recentActivities = recentActivities.concat(activities).slice(-pageSize);
      }
      pageToken = response.data.nextPageToken;
    } while (pageToken);

    const hydratedActivities = await Promise.all(
      recentActivities.map(async (activity) => {
        const activityId = this.extractActivityId(activity);
        if (!activityId) {
          return activity;
        }
        try {
          return await this.getActivity(normalizedSessionName, activityId);
        } catch {
          return activity;
        }
      })
    );

    return hydratedActivities.slice().sort((a, b) => {
      const left = new Date(a.createTime || 0).getTime();
      const right = new Date(b.createTime || 0).getTime();
      return left - right;
    });
  }

  /**
   * Like {@link fetchRecentActivities} but without the per-activity hydration
   * round-trips. The list response already includes message/progress fields,
   * so callers that only need text (e.g. reading the latest clarification) can
   * avoid issuing one extra request per activity. Returns the most recent
   * `pageSize` activities sorted ascending by createTime.
   */
  async fetchRecentActivitiesLite(sessionName: string, pageSize: number): Promise<JulesActivity[]> {
    this.ensureApiKey();
    if (pageSize <= 0) {
      return [];
    }
    const normalizedSessionName = this.toSessionName(sessionName);
    let pageToken: string | undefined = undefined;
    let recentActivities: JulesActivity[] = [];

    do {
      const response: { data: JulesListActivitiesResponse } = await this.axiosInstance.get<JulesListActivitiesResponse>(`/${normalizedSessionName}/activities`, {
        params: { pageSize, pageToken },
      });
      const activities = response.data.activities || [];
      if (activities.length > 0) {
        recentActivities = recentActivities.concat(activities).slice(-pageSize);
      }
      pageToken = response.data.nextPageToken;
    } while (pageToken);

    return recentActivities.slice().sort((a, b) => {
      const left = new Date(a.createTime || 0).getTime();
      const right = new Date(b.createTime || 0).getTime();
      return left - right;
    });
  }

  private extractActivityId(activity: Pick<JulesActivity, "id" | "name">): string | null {
    const rawId = typeof activity.id === "string" && activity.id.trim().length > 0
      ? activity.id.trim()
      : typeof activity.name === "string" && activity.name.trim().length > 0
        ? activity.name.trim().split("/").pop() || ""
        : "";

    if (!rawId) {
      return null;
    }

    return rawId.split("/").pop() || null;
  }
}
