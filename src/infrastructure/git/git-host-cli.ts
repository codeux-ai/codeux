import { CommandResult } from "../../shared/subprocess/command-runner.js";
import { GitProvider } from "./repository-host-resolver.js";
import { CommandRunner } from "./git-status-query-client.js";
import { createHash } from "crypto";

// ─── Shared helpers for API implementations ──────────────────────────────────

const API_TIMEOUT_MS = 30_000;
// GitHub/GitLab status is polled continuously by every active sprint watch loop and the
// dashboard. A longer shared cache keeps the number of network calls low (and well under the
// API rate limit) while staying fresh enough for merge/CI decisions.
const API_GET_CACHE_TTL_MS = 30_000;
// A token's validity hardly ever changes, so the auth probe (`/user`) does not need to ride
// every polling window.
const AUTH_CHECK_CACHE_TTL_MS = 5 * 60_000;
// Logs of completed (failed) CI jobs are immutable, so re-downloading them every polling
// window is pure waste.
const FAILED_LOG_CACHE_TTL_MS = 10 * 60_000;
const API_MIN_INTERVAL_MS = 150;
const API_GET_CACHE_PRUNE_THRESHOLD = 500;
let lastApiRequestAt = 0;
let apiQueue: Promise<void> = Promise.resolve();
const apiGetCache = new Map<string, { timestamp: number; ttlMs: number; promise: Promise<{ ok: boolean; status: number; text: string }> }>();

function apiOk(stdout: string): CommandResult {
  return { ok: true, code: 0, stdout, stderr: "" };
}

function apiFail(stderr: string, code = 1): CommandResult {
  return { ok: false, code, stdout: "", stderr };
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForApiSlot(): Promise<void> {
  const previous = apiQueue;
  let release!: () => void;
  apiQueue = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  const delay = Math.max(0, API_MIN_INTERVAL_MS - (Date.now() - lastApiRequestAt));
  if (delay > 0) {
    await sleep(delay);
  }
  lastApiRequestAt = Date.now();
  release();
}

async function apiFetch(url: string, init: RequestInit): Promise<{ ok: boolean; status: number; text: string }> {
  await waitForApiSlot();
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(API_TIMEOUT_MS) });
  const text = await res.text();
  return { ok: res.ok, status: res.status, text };
}

function pruneExpiredApiCacheEntries(): void {
  if (apiGetCache.size < API_GET_CACHE_PRUNE_THRESHOLD) {
    return;
  }
  const now = Date.now();
  for (const [key, entry] of apiGetCache) {
    if (now - entry.timestamp >= entry.ttlMs) {
      apiGetCache.delete(key);
    }
  }
}

async function cachedApiGet(url: string, init: RequestInit, ttlMs = API_GET_CACHE_TTL_MS): Promise<{ ok: boolean; status: number; text: string }> {
  if (process.env.NODE_ENV === "test") {
    return apiFetch(url, init);
  }
  const auth = init.headers && typeof init.headers === "object" && !Array.isArray(init.headers)
    ? String((init.headers as Record<string, string>).Authorization ?? (init.headers as Record<string, string>)["PRIVATE-TOKEN"] ?? "")
    : "";
  const authHash = auth ? createHash("sha256").update(auth).digest("hex").slice(0, 16) : "";
  const key = `${url}|${authHash}`;
  const cached = apiGetCache.get(key);
  if (cached && Date.now() - cached.timestamp < cached.ttlMs) {
    return cached.promise;
  }
  pruneExpiredApiCacheEntries();
  const promise = apiFetch(url, init);
  apiGetCache.set(key, { timestamp: Date.now(), ttlMs, promise });
  try {
    return await promise;
  } catch (error) {
    apiGetCache.delete(key);
    throw error;
  }
}

/**
 * Cache a POST response (e.g. a GraphQL query) under an explicit key so repeated identical
 * requests from concurrent sprint watch loops collapse into a single network call, exactly like
 * {@link cachedApiGet} does for GETs.
 */
async function cachedApiPost(cacheKey: string, url: string, init: RequestInit): Promise<{ ok: boolean; status: number; text: string }> {
  if (process.env.NODE_ENV === "test") {
    return apiFetch(url, init);
  }
  const cached = apiGetCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < cached.ttlMs) {
    return cached.promise;
  }
  pruneExpiredApiCacheEntries();
  const promise = apiFetch(url, init);
  apiGetCache.set(cacheKey, { timestamp: Date.now(), ttlMs: API_GET_CACHE_TTL_MS, promise });
  try {
    return await promise;
  } catch (error) {
    apiGetCache.delete(cacheKey);
    throw error;
  }
}

/**
 * Maps the GraphQL `statusCheckRollup.contexts` of a PR's head commit to the gh-CLI-compatible
 * `statusCheckRollup` shape (`{ name, status, conclusion }`). CheckRun nodes map directly;
 * legacy commit-status contexts only expose a single `state`, which is normalized so the
 * existing `isCiPending`/`isCiFailure` policies interpret them correctly.
 */
function mapGraphqlStatusCheckRollup(pr: Record<string, any>): Array<{ name: string; status: string; conclusion: string | null }> {
  const commitNodes = pr?.commits?.nodes;
  const rollup = Array.isArray(commitNodes) && commitNodes.length > 0
    ? commitNodes[0]?.commit?.statusCheckRollup
    : null;
  const contexts = rollup?.contexts?.nodes;
  if (!Array.isArray(contexts)) {
    return [];
  }
  const checks: Array<{ name: string; status: string; conclusion: string | null }> = [];
  for (const node of contexts) {
    if (!node || typeof node !== "object") continue;
    const context = node as Record<string, unknown>;
    if (typeof context.context === "string") {
      // StatusContext (legacy commit status): state is EXPECTED | PENDING | SUCCESS | FAILURE | ERROR.
      const state = typeof context.state === "string" ? context.state : "";
      const settled = state === "SUCCESS" || state === "FAILURE" || state === "ERROR";
      checks.push({
        name: context.context,
        status: settled ? "COMPLETED" : "IN_PROGRESS",
        conclusion: settled ? state : null,
      });
      continue;
    }
    checks.push({
      name: typeof context.name === "string" ? context.name : "check",
      status: typeof context.status === "string" ? context.status : "UNKNOWN",
      conclusion: typeof context.conclusion === "string" ? context.conclusion : null,
    });
  }
  return checks;
}

function githubMergeableState(state: string | null | undefined): string {
  switch ((state ?? "").toLowerCase()) {
    case "clean": return "CLEAN";
    case "dirty": return "DIRTY";
    case "blocked": return "BLOCKED";
    case "unstable": return "UNSTABLE";
    case "draft": return "DRAFT";
    case "has_hooks": return "HAS_HOOKS";
    default: return "UNKNOWN";
  }
}

// ─── Interface ────────────────────────────────────────────────────────────────

export interface GitHostCli {
  version(hostToken?: string): Promise<CommandResult>;
  authStatus(hostToken?: string): Promise<CommandResult>;
  prListOpen(hostToken?: string): Promise<CommandResult>;
  prListOpenMatching(baseBranch: string, headBranch: string, hostToken?: string): Promise<CommandResult>;
  prCreate(baseBranch: string, headBranch: string, title: string, body: string, hostToken?: string): Promise<CommandResult>;
  runList(hostToken?: string): Promise<CommandResult>;
  prListMerged(hostToken?: string): Promise<CommandResult>;
  runViewJobs(runId: number, hostToken?: string): Promise<CommandResult>;
  runViewLogFailed(runId: number, jobId: number, hostToken?: string): Promise<CommandResult>;
  prMerge(prNumber: number, hostToken?: string): Promise<CommandResult>;
}

// ─── GitHub CLI (gh binary) ───────────────────────────────────────────────────

export class GithubHostCli implements GitHostCli {
  constructor(private readonly repoPath: string, private readonly runner: CommandRunner) {}

  private async run(args: string[], hostToken?: string): Promise<CommandResult> {
    return this.runner("gh", args, { cwd: this.repoPath, hostToken });
  }

  version(hostToken?: string) { return this.run(["--version"], hostToken); }
  authStatus(hostToken?: string) { return this.run(["auth", "status"], hostToken); }

  prListOpen(hostToken?: string) {
    return this.run([
      "pr", "list", "--state", "open", "--limit", "50", "--json",
      "number,title,url,state,isDraft,headRefName,baseRefName,mergeStateStatus,reviewDecision,updatedAt,comments,statusCheckRollup"
    ], hostToken);
  }

  prListOpenMatching(baseBranch: string, headBranch: string, hostToken?: string) {
    return this.run([
      "pr", "list", "--state", "open", "--base", baseBranch, "--head", headBranch, "--limit", "1", "--json", "number,url"
    ], hostToken);
  }

  prCreate(baseBranch: string, headBranch: string, title: string, body: string, hostToken?: string) {
    return this.run([
      "pr", "create", "--base", baseBranch, "--head", headBranch, "--title", title, "--body", body
    ], hostToken);
  }

  runList(hostToken?: string) {
    return this.run([
      "run", "list", "--limit", "50", "--json",
      "databaseId,name,workflowName,status,conclusion,event,headBranch,url,updatedAt"
    ], hostToken);
  }

  prListMerged(hostToken?: string) {
    return this.run([
      "pr", "list", "--state", "merged", "--limit", "100", "--json",
      "number,title,url,headRefName,baseRefName,mergedAt,mergedBy"
    ], hostToken);
  }

  runViewJobs(runId: number, hostToken?: string) {
    return this.run(["run", "view", String(runId), "--json", "jobs"], hostToken);
  }

  runViewLogFailed(runId: number, jobId: number, hostToken?: string) {
    return this.run(["run", "view", String(runId), "--job", String(jobId), "--log-failed"], hostToken);
  }

  prMerge(prNumber: number, hostToken?: string) {
    return this.run(["pr", "merge", String(prNumber), "--merge", "--delete-branch"], hostToken);
  }
}

// ─── GitHub REST API (no gh binary needed) ────────────────────────────────────

export class GithubApiHostCli implements GitHostCli {
  private readonly base = "https://api.github.com";

  constructor(
    private readonly owner: string,
    private readonly repo: string,
  ) {}

  private ghHeaders(token: string): Record<string, string> {
    return {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };
  }

  private async get(path: string, token?: string, ttlMs?: number): Promise<{ ok: boolean; status: number; text: string } | null> {
    if (!token) return null;
    try {
      return await cachedApiGet(`${this.base}${path}`, { headers: this.ghHeaders(token) }, ttlMs);
    } catch {
      return null;
    }
  }

  private async post(path: string, body: unknown, token?: string): Promise<{ ok: boolean; status: number; text: string } | null> {
    if (!token) return null;
    try {
      return await apiFetch(`${this.base}${path}`, {
        method: "POST",
        headers: { ...this.ghHeaders(token), "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch {
      return null;
    }
  }

  private async put(path: string, body: unknown, token?: string): Promise<{ ok: boolean; status: number; text: string } | null> {
    if (!token) return null;
    try {
      return await apiFetch(`${this.base}${path}`, {
        method: "PUT",
        headers: { ...this.ghHeaders(token), "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch {
      return null;
    }
  }

  private async del(path: string, token?: string): Promise<void> {
    if (!token) return;
    try {
      await apiFetch(`${this.base}${path}`, { method: "DELETE", headers: this.ghHeaders(token) });
    } catch {
      // best-effort
    }
  }

  private noToken(): CommandResult {
    return apiFail("GitHub API token required for API mode.");
  }

  private apiError(res: { ok: boolean; status: number; text: string } | null, fallback: string): CommandResult {
    if (!res) return apiFail(fallback);
    let message = `HTTP ${res.status}`;
    try {
      const err = JSON.parse(res.text) as Record<string, unknown>;
      message = String(err.message ?? res.text);
      // 422 responses carry the actionable cause (e.g. "Field base is invalid", "No commits
      // between x and y", "A pull request already exists") inside `errors`, not `message`.
      if (Array.isArray(err.errors)) {
        const details = err.errors
          .map((entry) => {
            if (!entry || typeof entry !== "object") return null;
            const detail = entry as Record<string, unknown>;
            if (typeof detail.message === "string" && detail.message.trim()) return detail.message;
            const field = typeof detail.field === "string" ? detail.field : null;
            const code = typeof detail.code === "string" ? detail.code : null;
            return field || code ? [field, code].filter(Boolean).join(" ") : null;
          })
          .filter((entry): entry is string => Boolean(entry));
        if (details.length > 0) {
          message = `${message}: ${details.join("; ")}`;
        }
      }
    } catch { /* use status */ }
    return apiFail(message, res.status);
  }

  async version(hostToken?: string): Promise<CommandResult> {
    if (!hostToken) return this.noToken();
    const res = await this.get("/user", hostToken, AUTH_CHECK_CACHE_TTL_MS);
    if (!res?.ok) return this.apiError(res, "GitHub API request failed.");
    return apiOk("github-api-host-cli/1.0");
  }

  async authStatus(hostToken?: string): Promise<CommandResult> {
    return this.version(hostToken);
  }

  async prListOpen(hostToken?: string): Promise<CommandResult> {
    if (!hostToken) return this.noToken();
    const graph = await this.fetchPullRequestsGraphql(hostToken);
    if (graph) {
      return apiOk(JSON.stringify(graph.open));
    }
    // Fallback: REST list (no per-PR enrichment). mergeStateStatus is unavailable from the list
    // endpoint, but this only runs if GraphQL is unreachable and avoids the N+1 call explosion.
    const res = await this.get(`/repos/${this.owner}/${this.repo}/pulls?state=open&per_page=50`, hostToken);
    if (!res?.ok) return this.apiError(res, "GitHub API request failed.");
    try {
      const rawPrs = JSON.parse(res.text) as Record<string, unknown>[];
      const mapped = rawPrs.map((pr) => {
        const head = pr.head as Record<string, unknown> | undefined;
        const base = pr.base as Record<string, unknown> | undefined;
        return {
          number: pr.number,
          title: pr.title ?? "Untitled PR",
          url: pr.html_url ?? "",
          state: typeof pr.state === "string" ? pr.state.toUpperCase() : "OPEN",
          isDraft: pr.draft === true,
          headRefName: typeof head?.ref === "string" ? head.ref : null,
          baseRefName: typeof base?.ref === "string" ? base.ref : null,
          mergeStateStatus: githubMergeableState(typeof pr.mergeable_state === "string" ? pr.mergeable_state : null),
          reviewDecision: null,
          updatedAt: pr.updated_at ?? null,
          comments: ((pr.comments as number | undefined) ?? 0) + ((pr.review_comments as number | undefined) ?? 0),
          statusCheckRollup: [],
        };
      });
      return apiOk(JSON.stringify(mapped));
    } catch {
      return apiFail("Failed to parse GitHub PR list response.");
    }
  }

  /**
   * Fetch open AND recently-merged PRs (with computed `mergeStateStatus`) in a single GraphQL
   * call. GitHub computes mergeability for GraphQL list queries — unlike the REST list endpoint,
   * which omits it and would otherwise force one extra REST call per PR. The result is cached so
   * `prListOpen` and `prListMerged` share one network round-trip per polling window.
   */
  private async fetchPullRequestsGraphql(token: string): Promise<{ open: unknown[]; merged: unknown[] } | null> {
    const query = `query($owner:String!,$repo:String!){repository(owner:$owner,name:$repo){`
      + `open:pullRequests(states:OPEN,first:50,orderBy:{field:UPDATED_AT,direction:DESC}){nodes{number title url isDraft headRefName baseRefName mergeStateStatus reviewDecision updatedAt comments{totalCount} `
      + `commits(last:1){nodes{commit{statusCheckRollup{state contexts(first:100){nodes{__typename ... on CheckRun{name status conclusion} ... on StatusContext{context state}}}}}}}`
      + `}}`
      + `merged:pullRequests(states:MERGED,first:50,orderBy:{field:UPDATED_AT,direction:DESC}){nodes{number title url headRefName baseRefName mergedAt mergedBy{login}}}`
      + `}}`;
    const res = await this.graphql(query, { owner: this.owner, repo: this.repo }, token);
    if (!res?.ok) {
      return null;
    }
    try {
      const data = JSON.parse(res.text) as { data?: { repository?: { open?: { nodes?: unknown[] }; merged?: { nodes?: unknown[] } } }; errors?: unknown };
      const repo = data?.data?.repository;
      if (!repo || data.errors) {
        return null;
      }
      const openNodes = Array.isArray(repo.open?.nodes) ? repo.open!.nodes : [];
      const mergedNodes = Array.isArray(repo.merged?.nodes) ? repo.merged!.nodes : [];
      return {
        open: openNodes.map((node) => {
          const pr = node as Record<string, any>;
          return {
            number: pr.number,
            title: pr.title ?? "Untitled PR",
            url: pr.url ?? "",
            state: "OPEN",
            isDraft: pr.isDraft === true,
            headRefName: typeof pr.headRefName === "string" ? pr.headRefName : null,
            baseRefName: typeof pr.baseRefName === "string" ? pr.baseRefName : null,
            mergeStateStatus: githubMergeableState(typeof pr.mergeStateStatus === "string" ? pr.mergeStateStatus : null),
            reviewDecision: typeof pr.reviewDecision === "string" ? pr.reviewDecision : null,
            updatedAt: pr.updatedAt ?? null,
            comments: typeof pr.comments?.totalCount === "number" ? pr.comments.totalCount : 0,
            statusCheckRollup: mapGraphqlStatusCheckRollup(pr),
          };
        }),
        merged: mergedNodes.map((node) => {
          const pr = node as Record<string, any>;
          return {
            number: pr.number,
            title: pr.title ?? "Merged PR",
            url: pr.url ?? "",
            headRefName: typeof pr.headRefName === "string" ? pr.headRefName : null,
            baseRefName: typeof pr.baseRefName === "string" ? pr.baseRefName : null,
            mergedAt: pr.mergedAt ?? null,
            mergedBy: pr.mergedBy ? { login: pr.mergedBy.login ?? null } : null,
          };
        }),
      };
    } catch {
      return null;
    }
  }

  private async graphql(query: string, variables: Record<string, unknown>, token: string): Promise<{ ok: boolean; status: number; text: string } | null> {
    if (!token) {
      return null;
    }
    const body = JSON.stringify({ query, variables });
    const authHash = createHash("sha256").update(token).digest("hex").slice(0, 16);
    const cacheKey = `graphql|${authHash}|${createHash("sha256").update(body).digest("hex").slice(0, 24)}`;
    try {
      return await cachedApiPost(cacheKey, `${this.base}/graphql`, {
        method: "POST",
        headers: { ...this.ghHeaders(token), "Content-Type": "application/json" },
        body,
      });
    } catch {
      return null;
    }
  }

  async prListOpenMatching(baseBranch: string, headBranch: string, hostToken?: string): Promise<CommandResult> {
    if (!hostToken) return this.noToken();
    const head = encodeURIComponent(`${this.owner}:${headBranch}`);
    const base = encodeURIComponent(baseBranch);
    const res = await this.get(
      `/repos/${this.owner}/${this.repo}/pulls?state=open&base=${base}&head=${head}&per_page=1`,
      hostToken,
    );
    if (!res?.ok) return this.apiError(res, "GitHub API request failed.");
    try {
      const prs = JSON.parse(res.text) as Record<string, unknown>[];
      return apiOk(JSON.stringify(prs.map((pr) => ({ number: pr.number, url: pr.html_url }))));
    } catch {
      return apiFail("Failed to parse GitHub PR matching response.");
    }
  }

  async prCreate(baseBranch: string, headBranch: string, title: string, body: string, hostToken?: string): Promise<CommandResult> {
    if (!hostToken) return this.noToken();
    const res = await this.post(
      `/repos/${this.owner}/${this.repo}/pulls`,
      { title, body, head: headBranch, base: baseBranch },
      hostToken,
    );
    if (!res?.ok) return this.apiError(res, "GitHub API request failed.");
    try {
      const pr = JSON.parse(res.text) as Record<string, unknown>;
      return apiOk(String(pr.html_url ?? ""));
    } catch {
      return apiFail("Failed to parse GitHub PR create response.");
    }
  }

  async runList(hostToken?: string): Promise<CommandResult> {
    if (!hostToken) return this.noToken();
    const res = await this.get(`/repos/${this.owner}/${this.repo}/actions/runs?per_page=50`, hostToken);
    if (!res?.ok) return this.apiError(res, "GitHub API request failed.");
    try {
      const data = JSON.parse(res.text) as Record<string, unknown>;
      const runs = Array.isArray(data.workflow_runs) ? data.workflow_runs as Record<string, unknown>[] : [];
      const mapped = runs.map((run) => ({
        databaseId: run.id,
        name: run.name ?? "workflow",
        workflowName: run.name ?? null,
        status: run.status ?? "UNKNOWN",
        conclusion: run.conclusion ?? null,
        event: run.event ?? null,
        headBranch: run.head_branch ?? null,
        url: run.html_url ?? "",
        updatedAt: run.updated_at ?? null,
      }));
      return apiOk(JSON.stringify(mapped));
    } catch {
      return apiFail("Failed to parse GitHub Actions runs response.");
    }
  }

  async prListMerged(hostToken?: string): Promise<CommandResult> {
    if (!hostToken) return this.noToken();
    const graph = await this.fetchPullRequestsGraphql(hostToken);
    if (graph) {
      return apiOk(JSON.stringify(graph.merged));
    }
    // Fallback: REST list when GraphQL is unreachable.
    const res = await this.get(`/repos/${this.owner}/${this.repo}/pulls?state=closed&per_page=100`, hostToken);
    if (!res?.ok) return this.apiError(res, "GitHub API request failed.");
    try {
      const prs = JSON.parse(res.text) as Record<string, unknown>[];
      const mapped = prs
        .filter((pr) => pr.merged_at != null)
        .map((pr) => {
          const head = pr.head as Record<string, unknown> | undefined;
          const base = pr.base as Record<string, unknown> | undefined;
          const mergedBy = pr.merged_by as Record<string, unknown> | undefined;
          return {
            number: pr.number,
            title: pr.title ?? "Merged PR",
            url: pr.html_url ?? "",
            headRefName: typeof head?.ref === "string" ? head.ref : null,
            baseRefName: typeof base?.ref === "string" ? base.ref : null,
            mergedAt: pr.merged_at ?? null,
            mergedBy: mergedBy ? { login: mergedBy.login ?? null } : null,
          };
        });
      return apiOk(JSON.stringify(mapped));
    } catch {
      return apiFail("Failed to parse GitHub merged PRs response.");
    }
  }

  async runViewJobs(runId: number, hostToken?: string): Promise<CommandResult> {
    if (!hostToken) return this.noToken();
    const res = await this.get(`/repos/${this.owner}/${this.repo}/actions/runs/${runId}/jobs`, hostToken);
    if (!res?.ok) return this.apiError(res, "GitHub API request failed.");
    try {
      const data = JSON.parse(res.text) as Record<string, unknown>;
      const jobs = Array.isArray(data.jobs) ? data.jobs as Record<string, unknown>[] : [];
      const mapped = jobs.map((job) => ({
        id: job.id,
        databaseId: job.id,
        name: job.name ?? "job",
        status: job.status ?? "UNKNOWN",
        conclusion: job.conclusion ?? null,
        steps: Array.isArray(job.steps) ? job.steps : [],
      }));
      return apiOk(JSON.stringify({ jobs: mapped }));
    } catch {
      return apiFail("Failed to parse GitHub Actions jobs response.");
    }
  }

  async runViewLogFailed(_runId: number, jobId: number, hostToken?: string): Promise<CommandResult> {
    if (!hostToken) return this.noToken();
    const res = await this.get(`/repos/${this.owner}/${this.repo}/actions/jobs/${jobId}/logs`, hostToken, FAILED_LOG_CACHE_TTL_MS);
    if (!res?.ok) return this.apiError(res, "GitHub API request failed.");
    return apiOk(res.text);
  }

  async prMerge(prNumber: number, hostToken?: string): Promise<CommandResult> {
    if (!hostToken) return this.noToken();

    // Fetch head branch for deletion after merge
    let headBranch: string | null = null;
    const prRes = await this.get(`/repos/${this.owner}/${this.repo}/pulls/${prNumber}`, hostToken);
    if (prRes?.ok) {
      try {
        const pr = JSON.parse(prRes.text) as Record<string, unknown>;
        const head = pr.head as Record<string, unknown> | undefined;
        if (typeof head?.ref === "string") headBranch = head.ref;
      } catch { /* proceed without branch delete */ }
    }

    const mergeRes = await this.put(
      `/repos/${this.owner}/${this.repo}/pulls/${prNumber}/merge`,
      { merge_method: "merge" },
      hostToken,
    );
    if (!mergeRes?.ok) return this.apiError(mergeRes, "GitHub API request failed.");

    // Best-effort branch deletion
    if (headBranch) {
      await this.del(
        `/repos/${this.owner}/${this.repo}/git/refs/heads/${encodeURIComponent(headBranch)}`,
        hostToken,
      );
    }

    return apiOk("Pull request successfully merged.");
  }
}

// ─── GitLab CLI (glab binary) ─────────────────────────────────────────────────

export class GitlabHostCli implements GitHostCli {
  constructor(
    private readonly repoPath: string,
    private readonly runner: CommandRunner,
    private readonly hostDomain: string | null,
    private readonly repoTarget: string | null
  ) {}

  private async run(args: string[], hostToken?: string): Promise<CommandResult> {
    const extraArgs = [];
    if (this.hostDomain) extraArgs.push("--hostname", this.hostDomain);
    if (this.repoTarget) extraArgs.push("-R", this.repoTarget);
    return this.runner("glab", [...args, ...extraArgs], { cwd: this.repoPath, hostToken });
  }

  version(hostToken?: string) { return this.run(["--version"], hostToken); }
  authStatus(hostToken?: string) { return this.run(["auth", "status"], hostToken); }

  async prListOpen(hostToken?: string): Promise<CommandResult> {
    const res = await this.run(["mr", "list", "--state", "opened", "--per-page", "50", "--output", "json"], hostToken);
    if (!res.ok) return res;

    try {
      const parsed = JSON.parse(res.stdout);
      const mapped = parsed.map((item: any) => ({
        number: item.iid,
        title: item.title,
        url: item.web_url,
        state: "OPEN",
        isDraft: item.draft,
        headRefName: item.source_branch,
        baseRefName: item.target_branch,
        mergeStateStatus: item.has_conflicts ? "DIRTY" : (item.detailed_merge_status === "mergeable" ? "CLEAN" : "UNKNOWN"),
        reviewDecision: null,
        updatedAt: item.updated_at,
        comments: item.user_notes_count,
        statusCheckRollup: []
      }));
      return { ...res, stdout: JSON.stringify(mapped) };
    } catch {
      return res;
    }
  }

  async prListOpenMatching(baseBranch: string, headBranch: string, hostToken?: string): Promise<CommandResult> {
    const res = await this.run(["mr", "list", "--state", "opened", "--target-branch", baseBranch, "--source-branch", headBranch, "--per-page", "1", "--output", "json"], hostToken);
    if (!res.ok) return res;

    try {
      const parsed = JSON.parse(res.stdout);
      const mapped = parsed.map((item: any) => ({
        number: item.iid,
        url: item.web_url
      }));
      return { ...res, stdout: JSON.stringify(mapped) };
    } catch {
      return res;
    }
  }

  async prCreate(baseBranch: string, headBranch: string, title: string, body: string, hostToken?: string): Promise<CommandResult> {
    return this.run([
      "mr", "create", "--target-branch", baseBranch, "--source-branch", headBranch, "--title", title, "--description", body, "--yes"
    ], hostToken);
  }

  async runList(hostToken?: string): Promise<CommandResult> {
    const res = await this.run(["ci", "list", "--per-page", "50", "--output", "json"], hostToken);
    if (!res.ok) return res;

    try {
      const parsed = JSON.parse(res.stdout);
      const mapped = parsed.map((item: any) => ({
        databaseId: item.id,
        name: item.name || "pipeline",
        workflowName: null,
        status: ["running", "pending"].includes(item.status) ? "in_progress" : "completed",
        conclusion: item.status === "success" ? "success" : item.status === "failed" ? "failure" : "neutral",
        event: item.source,
        headBranch: item.ref,
        url: item.web_url,
        updatedAt: item.updated_at
      }));
      return { ...res, stdout: JSON.stringify(mapped) };
    } catch {
      return res;
    }
  }

  async prListMerged(hostToken?: string): Promise<CommandResult> {
    const res = await this.run(["mr", "list", "--state", "merged", "--per-page", "100", "--output", "json"], hostToken);
    if (!res.ok) return res;

    try {
      const parsed = JSON.parse(res.stdout);
      const mapped = parsed.map((item: any) => ({
        number: item.iid,
        title: item.title,
        url: item.web_url,
        headRefName: item.source_branch,
        baseRefName: item.target_branch,
        mergedAt: item.merged_at,
        mergedBy: { login: item.merged_by?.username }
      }));
      return { ...res, stdout: JSON.stringify(mapped) };
    } catch {
      return res;
    }
  }

  async runViewJobs(runId: number, hostToken?: string): Promise<CommandResult> {
    const res = await this.run(["ci", "status", "--pipeline", String(runId), "--output", "json"], hostToken);
    if (!res.ok) return res;

    try {
      const parsed = JSON.parse(res.stdout);
      const jobs = parsed.jobs || [];
      const mappedJobs = jobs.map((j: any) => ({
        id: j.id,
        databaseId: j.id,
        name: j.name,
        status: ["running", "pending"].includes(j.status) ? "in_progress" : "completed",
        conclusion: j.status === "success" ? "success" : j.status === "failed" ? "failure" : "neutral"
      }));
      return { ...res, stdout: JSON.stringify({ jobs: mappedJobs }) };
    } catch {
      return res;
    }
  }

  runViewLogFailed(runId: number, jobId: number, hostToken?: string): Promise<CommandResult> {
    return this.run(["ci", "trace", String(jobId)], hostToken); // glab uses trace <jobId>
  }

  prMerge(prNumber: number, hostToken?: string): Promise<CommandResult> {
    return this.run(["mr", "merge", String(prNumber), "--squash", "--delete-source-branch", "--yes"], hostToken);
  }
}

// ─── GitLab REST API (no glab binary needed) ──────────────────────────────────

export class GitlabApiHostCli implements GitHostCli {
  private readonly base: string;
  private readonly encodedProject: string;

  constructor(hostDomain: string | null, repoTarget: string) {
    this.base = `https://${hostDomain ?? "gitlab.com"}/api/v4`;
    this.encodedProject = encodeURIComponent(repoTarget);
  }

  private glHeaders(token: string): Record<string, string> {
    return { "PRIVATE-TOKEN": token };
  }

  private async request(
    method: string,
    path: string,
    token?: string,
    body?: unknown,
    ttlMs?: number,
  ): Promise<{ ok: boolean; status: number; text: string } | null> {
    if (!token) return null;
    try {
      const headers: Record<string, string> = {
        ...this.glHeaders(token),
        ...(body ? { "Content-Type": "application/json" } : {}),
      };
      const request = {
        method,
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      };
      return method === "GET"
        ? await cachedApiGet(`${this.base}${path}`, request, ttlMs)
        : await apiFetch(`${this.base}${path}`, request);
    } catch {
      return null;
    }
  }

  private get(path: string, token?: string, ttlMs?: number) { return this.request("GET", path, token, undefined, ttlMs); }
  private post(path: string, body: unknown, token?: string) { return this.request("POST", path, token, body); }
  private put(path: string, body: unknown, token?: string) { return this.request("PUT", path, token, body); }

  private noToken(): CommandResult {
    return apiFail("GitLab API token required for API mode.");
  }

  private apiError(res: { ok: boolean; status: number; text: string } | null, fallback: string): CommandResult {
    if (!res) return apiFail(fallback);
    let message = `HTTP ${res.status}`;
    try {
      const err = JSON.parse(res.text) as Record<string, unknown>;
      const raw = Array.isArray(err.message)
        ? (err.message as string[]).join(", ")
        : String(err.message ?? res.text);
      message = raw;
    } catch { /* use status */ }
    return apiFail(message, res.status);
  }

  async version(hostToken?: string): Promise<CommandResult> {
    if (!hostToken) return this.noToken();
    const res = await this.get("/user", hostToken, AUTH_CHECK_CACHE_TTL_MS);
    if (!res?.ok) return this.apiError(res, "GitLab API request failed.");
    return apiOk("gitlab-api-host-cli/1.0");
  }

  async authStatus(hostToken?: string): Promise<CommandResult> {
    return this.version(hostToken);
  }

  async prListOpen(hostToken?: string): Promise<CommandResult> {
    if (!hostToken) return this.noToken();
    const res = await this.get(`/projects/${this.encodedProject}/merge_requests?state=opened&per_page=50`, hostToken);
    if (!res?.ok) return this.apiError(res, "GitLab API request failed.");
    try {
      const mrs = JSON.parse(res.text) as Record<string, unknown>[];
      const mapped = mrs.map((item) => ({
        number: item.iid,
        title: item.title ?? "Untitled MR",
        url: item.web_url ?? "",
        state: "OPEN",
        isDraft: item.draft === true || item.work_in_progress === true,
        headRefName: item.source_branch ?? null,
        baseRefName: item.target_branch ?? null,
        mergeStateStatus: item.has_conflicts === true
          ? "DIRTY"
          : item.detailed_merge_status === "mergeable"
            ? "CLEAN"
            : "UNKNOWN",
        reviewDecision: null,
        updatedAt: item.updated_at ?? null,
        comments: typeof item.user_notes_count === "number" ? item.user_notes_count : 0,
        statusCheckRollup: [],
      }));
      return apiOk(JSON.stringify(mapped));
    } catch {
      return apiFail("Failed to parse GitLab MR list response.");
    }
  }

  async prListOpenMatching(baseBranch: string, headBranch: string, hostToken?: string): Promise<CommandResult> {
    if (!hostToken) return this.noToken();
    const res = await this.get(
      `/projects/${this.encodedProject}/merge_requests?state=opened&source_branch=${encodeURIComponent(headBranch)}&target_branch=${encodeURIComponent(baseBranch)}&per_page=1`,
      hostToken,
    );
    if (!res?.ok) return this.apiError(res, "GitLab API request failed.");
    try {
      const mrs = JSON.parse(res.text) as Record<string, unknown>[];
      return apiOk(JSON.stringify(mrs.map((item) => ({ number: item.iid, url: item.web_url }))));
    } catch {
      return apiFail("Failed to parse GitLab MR matching response.");
    }
  }

  async prCreate(baseBranch: string, headBranch: string, title: string, body: string, hostToken?: string): Promise<CommandResult> {
    if (!hostToken) return this.noToken();
    const res = await this.post(
      `/projects/${this.encodedProject}/merge_requests`,
      { source_branch: headBranch, target_branch: baseBranch, title, description: body },
      hostToken,
    );
    if (!res?.ok) return this.apiError(res, "GitLab API request failed.");
    try {
      const mr = JSON.parse(res.text) as Record<string, unknown>;
      return apiOk(String(mr.web_url ?? ""));
    } catch {
      return apiFail("Failed to parse GitLab MR create response.");
    }
  }

  async runList(hostToken?: string): Promise<CommandResult> {
    if (!hostToken) return this.noToken();
    const res = await this.get(`/projects/${this.encodedProject}/pipelines?per_page=50`, hostToken);
    if (!res?.ok) return this.apiError(res, "GitLab API request failed.");
    try {
      const pipelines = JSON.parse(res.text) as Record<string, unknown>[];
      const mapped = pipelines.map((item) => {
        const status = typeof item.status === "string" ? item.status : "";
        return {
          databaseId: item.id,
          name: typeof item.name === "string" ? item.name : "pipeline",
          workflowName: null,
          status: ["running", "pending"].includes(status) ? "in_progress" : "completed",
          conclusion: status === "success" ? "success" : status === "failed" ? "failure" : "neutral",
          event: item.source ?? null,
          headBranch: item.ref ?? null,
          url: item.web_url ?? "",
          updatedAt: item.updated_at ?? null,
        };
      });
      return apiOk(JSON.stringify(mapped));
    } catch {
      return apiFail("Failed to parse GitLab pipeline list response.");
    }
  }

  async prListMerged(hostToken?: string): Promise<CommandResult> {
    if (!hostToken) return this.noToken();
    const res = await this.get(`/projects/${this.encodedProject}/merge_requests?state=merged&per_page=100`, hostToken);
    if (!res?.ok) return this.apiError(res, "GitLab API request failed.");
    try {
      const mrs = JSON.parse(res.text) as Record<string, unknown>[];
      const mapped = mrs.map((item) => {
        const mergedBy = item.merged_by as Record<string, unknown> | undefined;
        return {
          number: item.iid,
          title: item.title ?? "Merged MR",
          url: item.web_url ?? "",
          headRefName: item.source_branch ?? null,
          baseRefName: item.target_branch ?? null,
          mergedAt: item.merged_at ?? null,
          mergedBy: mergedBy ? { login: mergedBy.username ?? null } : null,
        };
      });
      return apiOk(JSON.stringify(mapped));
    } catch {
      return apiFail("Failed to parse GitLab merged MRs response.");
    }
  }

  async runViewJobs(runId: number, hostToken?: string): Promise<CommandResult> {
    if (!hostToken) return this.noToken();
    const res = await this.get(`/projects/${this.encodedProject}/pipelines/${runId}/jobs`, hostToken);
    if (!res?.ok) return this.apiError(res, "GitLab API request failed.");
    try {
      const jobs = JSON.parse(res.text) as Record<string, unknown>[];
      const mapped = jobs.map((job) => {
        const status = typeof job.status === "string" ? job.status : "";
        return {
          id: job.id,
          databaseId: job.id,
          name: job.name ?? "job",
          status: ["running", "pending"].includes(status) ? "in_progress" : "completed",
          conclusion: status === "success" ? "success" : status === "failed" ? "failure" : "neutral",
          steps: [],
        };
      });
      return apiOk(JSON.stringify({ jobs: mapped }));
    } catch {
      return apiFail("Failed to parse GitLab pipeline jobs response.");
    }
  }

  async runViewLogFailed(_runId: number, jobId: number, hostToken?: string): Promise<CommandResult> {
    if (!hostToken) return this.noToken();
    const res = await this.get(`/projects/${this.encodedProject}/jobs/${jobId}/trace`, hostToken, FAILED_LOG_CACHE_TTL_MS);
    if (!res?.ok) return this.apiError(res, "GitLab API request failed.");
    return apiOk(res.text);
  }

  async prMerge(prNumber: number, hostToken?: string): Promise<CommandResult> {
    if (!hostToken) return this.noToken();
    const res = await this.put(
      `/projects/${this.encodedProject}/merge_requests/${prNumber}/merge`,
      { should_remove_source_branch: true, squash: true },
      hostToken,
    );
    if (!res?.ok) return this.apiError(res, "GitLab API request failed.");
    return apiOk("Merge request successfully merged.");
  }
}

// ─── Local (no-op) ────────────────────────────────────────────────────────────

export class LocalHostCli implements GitHostCli {
  private failed(): Promise<CommandResult> {
    return Promise.resolve({ stdout: "", stderr: "Host CLI unavailable for local provider", code: 1, ok: false });
  }
  version() { return this.failed(); }
  authStatus() { return this.failed(); }
  prListOpen() { return this.failed(); }
  prListOpenMatching() { return this.failed(); }
  prCreate() { return this.failed(); }
  runList() { return this.failed(); }
  prListMerged() { return this.failed(); }
  runViewJobs() { return this.failed(); }
  runViewLogFailed() { return this.failed(); }
  prMerge() { return this.failed(); }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createGitHostCli(
  provider: GitProvider,
  runner: CommandRunner,
  repoPath: string,
  hostDomain: string | null = null,
  repoTarget: string | null = null,
  preferApi = false,
): GitHostCli {
  switch (provider) {
    case "github": {
      if (preferApi && repoTarget) {
        const slashIdx = repoTarget.indexOf("/");
        if (slashIdx > 0) {
          return new GithubApiHostCli(repoTarget.slice(0, slashIdx), repoTarget.slice(slashIdx + 1));
        }
      }
      return new GithubHostCli(repoPath, runner);
    }
    case "gitlab": {
      if (preferApi && repoTarget) {
        return new GitlabApiHostCli(hostDomain, repoTarget);
      }
      return new GitlabHostCli(repoPath, runner, hostDomain, repoTarget);
    }
    default:
      return new LocalHostCli();
  }
}
