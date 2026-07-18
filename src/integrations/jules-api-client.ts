import axios from "axios";
import type { AxiosInstance, GenericAbortSignal } from "axios";
import type { JulesActivity, JulesSession, JulesSource } from "../contracts/app-types.js";
import type { JulesClient } from "../domain/jules/jules-client.js";
import {
  JULES_USAGE_ACTIVITY_PAGE_SIZE,
  JulesUsageConversationProjector,
  type JulesUsageConversation,
} from "../domain/jules/jules-activity-projection.js";
import {
  projectJulesActivityForLiveView,
  projectJulesSessionForOrchestration,
} from "../domain/jules/jules-live-projection.js";

export class JulesNotFoundError extends Error {
  readonly status = 404;
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "JulesNotFoundError";
    this.cause = cause;
  }
}

const MAX_JULES_API_ERROR_MESSAGE_CHARS = 2_048;
export const JULES_MAX_API_RESPONSE_BYTES = 64 * 1024 * 1024;
const JULES_MAX_LIVE_ACTIVITY_RESPONSE_BYTES = 16 * 1024 * 1024;
const JULES_RECENT_ACTIVITY_API_PAGE_SIZE = 50;
const JULES_RECENT_ACTIVITY_CACHE_LIMIT = 50;
const JULES_RECENT_ACTIVITY_SESSION_CACHE_LIMIT = 32;
const DEFAULT_RECENT_ACTIVITY_CACHE_TTL_MS = 10_000;
const DEFAULT_EXACT_SESSION_CACHE_TTL_MS = 15_000;
const JULES_SESSION_CAPACITY_PATTERN = /(?:concurren\w*|too many|max(?:imum)?|limit|quota|capacity|resource\s+exhausted).{0,80}(?:active\s+)?sessions?|(?:active\s+)?sessions?.{0,80}(?:concurren\w*|too many|max(?:imum)?|limit|quota|capacity|resource\s+exhausted)/i;
const JULES_CONCURRENT_TASK_STATES = new Set(["QUEUED", "PLANNING", "IN_PROGRESS"]);

/**
 * Jules exposes session state but no dedicated subscription-slot endpoint.
 * Waiting/paused sessions do not represent executing work and can accumulate
 * well beyond a plan's concurrent-task limit, so counting every non-terminal
 * session permanently starves admission on established accounts.
 */
export function isJulesSessionConsumingConcurrentTask(session: Pick<JulesSession, "state">): boolean {
  const state = String(session.state || "STATE_UNSPECIFIED").trim().toUpperCase();
  if (state === "STATE_UNSPECIFIED") {
    // Unknown states are counted conservatively until Jules reports a known one.
    return true;
  }
  return JULES_CONCURRENT_TASK_STATES.has(state);
}

/**
 * An actionable, bounded Jules API failure. Axios' default message only includes
 * the HTTP status, which previously discarded the provider's explanation and
 * made capacity responses indistinguishable from malformed requests.
 */
export class JulesApiRequestError extends Error {
  readonly cause?: unknown;

  constructor(
    message: string,
    public readonly status: number | null,
    public readonly apiStatus: string | null,
    cause?: unknown,
  ) {
    super(message);
    this.name = "JulesApiRequestError";
    this.cause = cause;
  }
}

export function isJulesSessionCapacityError(error: unknown): boolean {
  if (!(error instanceof JulesApiRequestError)) {
    return false;
  }
  return (error.status === 400 || error.status === 409 || error.status === 429)
    && JULES_SESSION_CAPACITY_PATTERN.test(error.message);
}

function boundJulesApiErrorText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const sanitized = value
    .replace(/[\r\n\t]+/g, " ")
    .replace(/(api[_-]?key|x-goog-api-key)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]")
    .replace(/\s+/g, " ")
    .trim();
  if (!sanitized) {
    return null;
  }
  return sanitized.slice(0, MAX_JULES_API_ERROR_MESSAGE_CHARS);
}

function toJulesApiRequestError(error: unknown, operation: string): JulesApiRequestError {
  const candidate = error && typeof error === "object"
    ? error as {
        message?: unknown;
        response?: {
          status?: unknown;
          data?: unknown;
        };
      }
    : null;
  const status = typeof candidate?.response?.status === "number" ? candidate.response.status : null;
  const data = candidate?.response?.data;
  const payload = data && typeof data === "object" ? data as Record<string, unknown> : null;
  const nestedError = payload?.error && typeof payload.error === "object"
    ? payload.error as Record<string, unknown>
    : null;
  const apiStatus = boundJulesApiErrorText(nestedError?.status ?? payload?.status);
  const providerMessage = boundJulesApiErrorText(
    nestedError?.message
      ?? payload?.message
      ?? (typeof data === "string" ? data : null),
  );
  const fallbackMessage = boundJulesApiErrorText(candidate?.message) || "Unknown Jules API error";
  const statusLabel = status === null ? "" : ` (HTTP ${status}${apiStatus ? ` ${apiStatus}` : ""})`;
  return new JulesApiRequestError(
    `Jules API ${operation} failed${statusLabel}: ${providerMessage || fallbackMessage}`,
    status,
    apiStatus,
    error,
  );
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
   * Jules API into 429s. Defaults to 500ms (~2 req/s).
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
   * Maximum automatic retries for idempotent reads after transient transport
   * failures. Quota responses are retried at most once, and mutating requests
   * are never transport-retried because a timed-out create/reply can already
   * have succeeded remotely. Defaults to 2.
   */
  maxTransientRetries?: number;
  /**
   * Time-to-live for the shared session snapshot returned by
   * {@link JulesApiClient.getCachedSessions}. Across many concurrent sprint
   * watch loops this collapses N `listSessions` calls per cycle into a single
   * shared fetch. Defaults to 15s (just above the 10s watch-loop interval so
   * concurrent loops share one fetch while state stays near-real-time).
   */
  sessionsCacheTtlMs?: number;
  /**
   * Maximum age of a session snapshot used to admit a new Jules session.
   * Capacity checks are stricter than watch-loop synchronization and never
   * serve stale data after a failed refresh. Defaults to 10 seconds; local
   * atomic claims account for sessions created inside that window.
   */
  sessionsCapacityCacheTtlMs?: number;
  /**
   * Upper bound on how many sessions the shared snapshot paginates through per
   * refresh. Recorded sessions outside this newest-first page are resolved
   * through the exact-session cache. Defaults to 100, matching one API page.
   */
  maxSnapshotSessions?: number;
  /** TTL for exact session reads used when a durable task is outside the shared snapshot. */
  exactSessionCacheTtlMs?: number;
  /** Minimum interval between incremental activity-page reads for one session. */
  recentActivityCacheTtlMs?: number;
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
]);

const isTransientNetworkError = (error: unknown): boolean => {
  if (!error || typeof error !== "object") {
    return false;
  }
  // A request that never produced a response (DNS/connect/reset/timeout). Node
  // may also surface these as an AggregateError (happy-eyeballs) whose own code
  // is unset, so fall back to scanning the message.
  const err = error as { response?: unknown; code?: string; name?: string; message?: string };
  if (err.code === "ERR_CANCELED" || err.name === "CanceledError" || err.name === "AbortError") {
    return false;
  }
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

interface ExactSessionCacheEntry {
  at: number;
  session: JulesSession;
}

interface RecentActivityCacheEntry {
  activities: JulesActivity[];
  nextPageToken?: string;
  tailPageToken?: string;
  complete: boolean;
  revision: string | null;
  fetchedAt: number;
}

export class JulesApiClient implements JulesClient {
  private readonly axiosInstance: AxiosInstance;
  private apiKey: string | null;
  private readonly minRequestIntervalMs: number;
  private readonly maxTransientRetries: number;
  private readonly sessionsCacheTtlMs: number;
  private readonly sessionsCapacityCacheTtlMs: number;
  private readonly maxSnapshotSessions: number;
  private readonly exactSessionCacheTtlMs: number;
  private readonly recentActivityCacheTtlMs: number;
  private readonly now: () => number;
  private nextRequestSlot = 0;
  private credentialEpoch = 0;
  private sessionCacheEpoch = 0;
  private sessionSnapshot: { at: number; sessions: JulesSession[] } | null = null;
  private sessionSnapshotInFlight: Promise<JulesSession[]> | null = null;
  private sessionCapacitySnapshot: { at: number; sessions: JulesSession[] } | null = null;
  private sessionCapacitySnapshotInFlight: Promise<JulesSession[]> | null = null;
  private readonly exactSessionCache = new Map<string, ExactSessionCacheEntry>();
  private readonly exactSessionInFlight = new Map<string, Promise<JulesSession>>();
  private readonly recentActivityCache = new Map<string, RecentActivityCacheEntry>();
  private readonly recentActivityInFlight = new Map<string, Promise<RecentActivityCacheEntry>>();

  constructor(options: JulesApiClientOptions) {
    this.apiKey = this.normalizeApiKey(options.apiKey);
    this.minRequestIntervalMs = Math.max(0, options.minRequestIntervalMs ?? 500);
    this.maxTransientRetries = Math.max(0, options.maxTransientRetries ?? 2);
    this.sessionsCacheTtlMs = Math.max(0, options.sessionsCacheTtlMs ?? 15_000);
    this.sessionsCapacityCacheTtlMs = Math.max(0, options.sessionsCapacityCacheTtlMs ?? 10_000);
    this.maxSnapshotSessions = Math.max(1, options.maxSnapshotSessions ?? 100);
    this.exactSessionCacheTtlMs = Math.max(0, options.exactSessionCacheTtlMs ?? DEFAULT_EXACT_SESSION_CACHE_TTL_MS);
    this.recentActivityCacheTtlMs = Math.max(0, options.recentActivityCacheTtlMs ?? DEFAULT_RECENT_ACTIVITY_CACHE_TTL_MS);
    this.now = options.now ?? Date.now;
    this.axiosInstance = axios.create({
      baseURL: options.baseUrl,
      timeout: Math.max(0, options.requestTimeoutMs ?? 30_000),
      maxContentLength: JULES_MAX_API_RESPONSE_BYTES,
      maxBodyLength: JULES_MAX_API_RESPONSE_BYTES,
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
      await this.acquireRequestSlot(config.signal);
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
        if (
          config.signal?.aborted
          || error.code === "ERR_CANCELED"
          || error.name === "CanceledError"
          || error.name === "AbortError"
        ) {
          return Promise.reject(error);
        }

        const is429 = Boolean(error.response && error.response.status === 429);
        const isTransient = !error.response && isTransientNetworkError(error);
        const method = String(config.method || "get").toUpperCase();
        const isIdempotentRead = method === "GET" || method === "HEAD" || method === "OPTIONS";

        if (isIdempotentRead && (is429 || isTransient)) {
          const retryCount = retryCounts.get(config) || 0;
          // One server-directed retry is enough for quota responses. Repeating
          // a 429 several times consumes more of the same constrained quota and
          // delays recovery for every caller sharing the global schedule.
          const retryLimit = is429
            ? Math.min(1, this.maxTransientRetries)
            : this.maxTransientRetries;

          if (retryCount < retryLimit) {
            const nextCount = retryCount + 1;
            retryCounts.set(config, nextCount);

            // Honor a server-provided Retry-After when present; otherwise fall
            // back to exponential backoff (1s, 2s, 4s, 8s, …) with jitter.
            const retryAfterMs = is429 ? this.parseRetryAfterMs(error.response.headers?.["retry-after"]) : null;
            const backoffMs = Math.pow(2, nextCount - 1) * 1000 + Math.random() * 500;
            const delay = Math.min(Math.max(retryAfterMs ?? backoffMs, backoffMs), 30000);

            const reason = is429 ? "returned 429" : `hit a transient network error (${error.code || error.name || "unknown"})`;
            console.warn(`Jules API ${reason}. Retrying request to ${config.url} (Attempt ${nextCount}/${retryLimit}) after ${Math.round(delay)}ms...`);

            // Push the global request schedule out so concurrent in-flight
            // requests also back off, instead of all hammering at once.
            this.deferRequestSlot(delay);
            await this.waitForDelay(delay, config.signal);

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
  private async acquireRequestSlot(signal?: GenericAbortSignal): Promise<void> {
    if (this.minRequestIntervalMs <= 0) {
      return;
    }
    const now = Date.now();
    const slot = Math.max(now, this.nextRequestSlot);
    this.nextRequestSlot = slot + this.minRequestIntervalMs;
    const wait = slot - now;
    if (wait > 0) {
      await this.waitForDelay(wait, signal);
    }
  }

  private async waitForDelay(delayMs: number, signal?: GenericAbortSignal): Promise<void> {
    const abortReason = (): Error => {
      const reason = (signal as AbortSignal | undefined)?.reason;
      return reason instanceof Error ? reason : new Error("Jules request aborted");
    };
    if (signal?.aborted) {
      throw abortReason();
    }
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        signal?.removeEventListener?.("abort", onAbort);
        resolve();
      }, delayMs);
      const onAbort = (): void => {
        clearTimeout(timer);
        reject(abortReason());
      };
      signal?.addEventListener?.("abort", onAbort, { once: true });
    });
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
    const normalized = this.normalizeApiKey(apiKey);
    if (normalized === this.apiKey) {
      return;
    }
    this.apiKey = normalized;
    this.credentialEpoch += 1;
    // Cached provider data must never cross a credential/account boundary.
    // Detach old in-flight reads as well; their epoch prevents late responses
    // from repopulating caches after the key changed.
    this.invalidateSessionsCache();
    this.recentActivityCache.clear();
    this.recentActivityInFlight.clear();
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
    try {
      const response = await this.axiosInstance.post<JulesSession>("/sessions", data);
      this.invalidateSessionsCache();
      return response.data;
    } catch (error) {
      // A rejected create can be a subscription-cap race. Force any admission
      // diagnostic that follows to read the provider again instead of reusing
      // the optimistic pre-create snapshot.
      this.invalidateSessionsCache();
      throw toJulesApiRequestError(error, "create session");
    }
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

  /**
   * Returns a coalesced exact-session snapshot for durable tasks that are not
   * present in the shared newest-first account snapshot.
   */
  async getCachedSession(sessionId: string): Promise<JulesSession> {
    const id = this.toSessionId(sessionId);
    const cached = this.exactSessionCache.get(id);
    if (cached && this.now() - cached.at < this.exactSessionCacheTtlMs) {
      return cached.session;
    }
    const inFlight = this.exactSessionInFlight.get(id);
    if (inFlight) {
      return inFlight;
    }
    const cacheEpoch = this.sessionCacheEpoch;
    const pending = this.getSession(id)
      .then((session) => {
        const projected = projectJulesSessionForOrchestration(session);
        if (cacheEpoch === this.sessionCacheEpoch) {
          this.cacheExactSession(projected);
        }
        return projected;
      })
      .finally(() => {
        if (this.exactSessionInFlight.get(id) === pending) {
          this.exactSessionInFlight.delete(id);
        }
      });
    this.exactSessionInFlight.set(id, pending);
    return pending;
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
   * at most one bounded `listSessions` page per TTL window regardless of how many
   * sprints are running. On a transient failure it serves the last good
   * snapshot rather than disrupting every sprint's sync.
   */
  async getCachedSessions(): Promise<JulesSession[]> {
    const fresh = this.sessionSnapshot && (this.now() - this.sessionSnapshot.at) < this.sessionsCacheTtlMs;
    if (fresh) {
      return this.sessionSnapshot!.sessions;
    }
    const freshCapacitySnapshot = this.sessionCapacitySnapshot
      && (this.now() - this.sessionCapacitySnapshot.at) < this.sessionsCacheTtlMs;
    if (freshCapacitySnapshot) {
      return this.sessionCapacitySnapshot!.sessions;
    }
    if (this.sessionSnapshotInFlight) {
      return this.sessionSnapshotInFlight;
    }
    if (this.sessionCapacitySnapshotInFlight) {
      return this.sessionCapacitySnapshotInFlight;
    }
    const pending = this.refreshSessionSnapshot(this.sessionCacheEpoch)
      .finally(() => {
        if (this.sessionSnapshotInFlight === pending) {
          this.sessionSnapshotInFlight = null;
        }
      });
    this.sessionSnapshotInFlight = pending;
    return pending;
  }

  /**
   * Returns a bounded, API-backed preflight snapshot for admission control.
   * The Jules list API has pagination but no state filter or subscription-slot
   * counter, and old waiting sessions can occur deep in account history. A
   * complete history scan before every dispatch would make admission slower as
   * the account ages. Instead concurrent dispatches share one fresh first-page
   * preflight, local claims provide the atomic hard cap, and a provider-side
   * FAILED_PRECONDITION remains an authoritative retryable capacity deferral.
   * Unlike watch-loop synchronization this path never serves stale data after
   * an API error.
   */
  async getSessionsForCapacityCheck(): Promise<JulesSession[]> {
    const fresh = this.sessionCapacitySnapshot
      && (this.now() - this.sessionCapacitySnapshot.at) < this.sessionsCapacityCacheTtlMs;
    if (fresh) {
      return this.sessionCapacitySnapshot!.sessions;
    }
    const freshSharedSnapshot = this.sessionSnapshot
      && (this.now() - this.sessionSnapshot.at) < this.sessionsCapacityCacheTtlMs;
    if (freshSharedSnapshot) {
      return this.sessionSnapshot!.sessions;
    }
    if (this.sessionCapacitySnapshotInFlight) {
      return this.sessionCapacitySnapshotInFlight;
    }
    if (this.sessionSnapshotInFlight) {
      return this.sessionSnapshotInFlight;
    }
    const pending = this.refreshSessionCapacitySnapshot(this.sessionCacheEpoch)
      .finally(() => {
        if (this.sessionCapacitySnapshotInFlight === pending) {
          this.sessionCapacitySnapshotInFlight = null;
        }
      });
    this.sessionCapacitySnapshotInFlight = pending;
    return pending;
  }

  /** Drops the cached session snapshot so the next read re-fetches fresh state. */
  invalidateSessionsCache(): void {
    this.sessionCacheEpoch += 1;
    this.sessionSnapshot = null;
    this.sessionCapacitySnapshot = null;
    this.sessionSnapshotInFlight = null;
    this.sessionCapacitySnapshotInFlight = null;
    this.exactSessionCache.clear();
    this.exactSessionInFlight.clear();
  }

  private async refreshSessionCapacitySnapshot(cacheEpoch: number): Promise<JulesSession[]> {
    const response = await this.listSessions({ page_size: 100 });
    const sessions = (response.sessions || []).map(projectJulesSessionForOrchestration);
    if (cacheEpoch === this.sessionCacheEpoch) {
      this.sessionCapacitySnapshot = { at: this.now(), sessions };
      this.sessionSnapshot = { at: this.now(), sessions };
      for (const session of sessions) {
        this.cacheExactSession(session);
      }
    }
    return sessions;
  }

  private async refreshSessionSnapshot(cacheEpoch: number, allowStaleOnError = true): Promise<JulesSession[]> {
    try {
      const all: JulesSession[] = [];
      let pageToken: string | undefined = undefined;
      do {
        const response: JulesListSessionsResponse = await this.listSessions({ page_size: 100, page_token: pageToken });
        const sessions = (response.sessions || []).map(projectJulesSessionForOrchestration);
        all.push(...sessions);
        pageToken = sessions.length > 0 ? response.nextPageToken : undefined;
      } while (pageToken && all.length < this.maxSnapshotSessions);
      if (cacheEpoch === this.sessionCacheEpoch) {
        this.sessionSnapshot = { at: this.now(), sessions: all };
        this.sessionCapacitySnapshot = { at: this.now(), sessions: all };
        for (const session of all) {
          this.cacheExactSession(session);
        }
      }
      return all;
    } catch (error) {
      if (allowStaleOnError && this.sessionSnapshot) {
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
    this.invalidateRecentActivities(name);
    return response.data;
  }

  async sendSessionMessage(sessionId: string, prompt: string): Promise<JulesSessionActionResponse> {
    this.ensureApiKey();
    const name = this.toSessionName(sessionId);
    const response = await this.axiosInstance.post<JulesSessionActionResponse>(`/${name}:sendMessage`, { prompt });
    this.invalidateSessionsCache();
    this.invalidateRecentActivities(name);
    return response.data;
  }

  private cacheExactSession(session: JulesSession): void {
    const id = this.extractSessionId(session);
    if (!id) {
      return;
    }
    this.exactSessionCache.set(id, { at: this.now(), session });
    if (this.exactSessionCache.size > this.maxSnapshotSessions * 2) {
      const oldestKey = this.exactSessionCache.keys().next().value;
      if (oldestKey) {
        this.exactSessionCache.delete(oldestKey);
      }
    }
  }

  private invalidateRecentActivities(sessionNameOrId: string): void {
    const name = this.toSessionName(sessionNameOrId);
    const cached = this.recentActivityCache.get(name);
    if (cached) {
      cached.revision = null;
      cached.fetchedAt = 0;
    }
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
    return (await this.getUsageConversation(sessionId)).activities;
  }

  async getUsageConversation(sessionId: string): Promise<JulesUsageConversation> {
    this.ensureApiKey();
    const sessionName = this.toSessionName(sessionId);
    const projector = new JulesUsageConversationProjector();
    let pageToken: string | undefined = undefined;

    try {
      do {
        const params: JulesPageQuery = {
          pageSize: JULES_USAGE_ACTIVITY_PAGE_SIZE,
          pageToken,
        };
        const response = await this.axiosInstance.get<JulesListActivitiesResponse>(
          `/${sessionName}/activities`,
          { params },
        );
        const activities = response.data.activities || [];
        projector.addPage(activities);
        // Drop response-owned objects before requesting the next page. The
        // projector retains only its bounded, token-relevant representation.
        activities.length = 0;
        pageToken = response.data.nextPageToken;
      } while (pageToken);
    } catch (error) {
      if (isNotFoundError(error)) {
        throw new JulesNotFoundError(`Jules activities not found for session: ${sessionId}`, error);
      }
      throw error;
    }

    return projector.finish();
  }

  async listAllActivities(sessionId: string): Promise<JulesActivity[]> {
    return (await this.getUsageConversation(sessionId)).activities;
  }

  async fetchRecentActivities(
    sessionName: string,
    pageSize: number,
    signal?: AbortSignal,
  ): Promise<JulesActivity[]> {
    this.ensureApiKey();
    if (pageSize <= 0) {
      return [];
    }
    const normalizedSessionName = this.toSessionName(sessionName);
    const requestedSize = Math.min(JULES_RECENT_ACTIVITY_CACHE_LIMIT, Math.max(1, Math.floor(pageSize)));
    const cached = this.recentActivityCache.get(normalizedSessionName);
    const revision = this.getKnownSessionRevision(normalizedSessionName);
    const cacheFresh = cached && this.now() - cached.fetchedAt < this.recentActivityCacheTtlMs;
    const revisionUnchanged = cached?.complete && revision !== null && cached.revision === revision;
    if (cached && (cacheFresh || revisionUnchanged)) {
      return cached.activities.slice(-requestedSize);
    }

    let inFlight = this.recentActivityInFlight.get(normalizedSessionName);
    if (!inFlight) {
      inFlight = this.fetchNextRecentActivityPage(
        normalizedSessionName,
        revision,
        this.credentialEpoch,
        signal,
      )
        .finally(() => {
          if (this.recentActivityInFlight.get(normalizedSessionName) === inFlight) {
            this.recentActivityInFlight.delete(normalizedSessionName);
          }
        });
      this.recentActivityInFlight.set(normalizedSessionName, inFlight);
    }
    const refreshed = await inFlight;
    return refreshed.activities.slice(-requestedSize);
  }

  private async fetchNextRecentActivityPage(
    sessionName: string,
    revision: string | null,
    credentialEpoch: number,
    signal?: AbortSignal,
  ): Promise<RecentActivityCacheEntry> {
    const previous = this.recentActivityCache.get(sessionName);
    const continuingScan = previous && !previous.complete;
    const pageToken = continuingScan
      ? previous.nextPageToken
      : previous?.tailPageToken;
    const response = await this.axiosInstance.get<JulesListActivitiesResponse>(
      `/${sessionName}/activities`,
      {
        params: {
          pageSize: JULES_RECENT_ACTIVITY_API_PAGE_SIZE,
          pageToken,
        },
        signal,
        maxContentLength: JULES_MAX_LIVE_ACTIVITY_RESPONSE_BYTES,
      },
    );
    const nextPageToken = response.data.nextPageToken || undefined;
    const rawActivities = response.data.activities || [];
    const projectedActivities = rawActivities.map(projectJulesActivityForLiveView);
    rawActivities.length = 0;
    const activities = this.mergeRecentActivities(
      previous?.activities || [],
      projectedActivities,
    );
    const entry: RecentActivityCacheEntry = {
      activities,
      nextPageToken,
      tailPageToken: nextPageToken ? previous?.tailPageToken : pageToken,
      complete: !nextPageToken,
      revision,
      fetchedAt: this.now(),
    };
    if (credentialEpoch === this.credentialEpoch) {
      this.recentActivityCache.set(sessionName, entry);
      if (this.recentActivityCache.size > JULES_RECENT_ACTIVITY_SESSION_CACHE_LIMIT) {
        const oldestKey = this.recentActivityCache.keys().next().value;
        if (oldestKey) {
          this.recentActivityCache.delete(oldestKey);
        }
      }
    }
    return entry;
  }

  private mergeRecentActivities(
    existing: JulesActivity[],
    incoming: JulesActivity[],
  ): JulesActivity[] {
    const byIdentity = new Map<string, JulesActivity>();
    let anonymousIndex = 0;
    for (const activity of [...existing, ...incoming]) {
      const identity = activity.id || activity.name || `${activity.createTime || "unknown"}:${anonymousIndex++}`;
      byIdentity.set(identity, activity);
    }
    return Array.from(byIdentity.values())
      .sort((left, right) => {
        const leftTime = Date.parse(left.createTime || "");
        const rightTime = Date.parse(right.createTime || "");
        if (!Number.isFinite(leftTime) || !Number.isFinite(rightTime)) {
          return 0;
        }
        return leftTime - rightTime;
      })
      .slice(-JULES_RECENT_ACTIVITY_CACHE_LIMIT);
  }

  private getKnownSessionRevision(sessionName: string): string | null {
    const sessionId = this.toSessionId(sessionName);
    const exact = this.exactSessionCache.get(sessionId)?.session;
    const session = exact
      || this.sessionSnapshot?.sessions.find((entry) => this.extractSessionId(entry) === sessionId)
      || this.sessionCapacitySnapshot?.sessions.find((entry) => this.extractSessionId(entry) === sessionId);
    return typeof session?.updateTime === "string" && session.updateTime.trim().length > 0
      ? session.updateTime
      : null;
  }

  /** Compatibility alias for callers that only need the bounded cached list view. */
  async fetchRecentActivitiesLite(
    sessionName: string,
    pageSize: number,
    signal?: AbortSignal,
  ): Promise<JulesActivity[]> {
    return this.fetchRecentActivities(sessionName, pageSize, signal);
  }
}
