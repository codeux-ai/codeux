import type {
  IssuePromptContext,
  IssuePromptContextInput,
  LinkedIssueProvider,
  ProjectSummary,
  SprintLinkedIssueInput,
  SprintLinkedIssueRecord,
} from "../contracts/project-management-types.js";
import type { DashboardSettings } from "../contracts/app-types.js";
import { ProjectManagementRepository } from "../repositories/project-management-repository.js";
import { createLogger, type Logger } from "../shared/logging/logger.js";
import { resolveRepositoryHost } from "../infrastructure/git/repository-host-resolver.js";
import { execFile } from "child_process";
import * as jiraApiClient from "./jira-api-client.js";

export interface IssueSearchInput {
  provider?: LinkedIssueProvider;
  repository?: string;
  hostDomain?: string;
  search?: string;
  state?: "open" | "closed" | "all";
  labels?: string[];
  assignee?: string;
  limit?: number;
}

export interface RemoteIssueSummary extends SprintLinkedIssueInput {
  bodyPreview: string;
  updatedAt: string | null;
}

interface IssueServiceDeps {
  projectManagementRepository: ProjectManagementRepository;
  getDashboardSettings: (scope?: { projectId?: string; sprintId?: string }) => DashboardSettings;
  runCommand?: (command: string, args: string[]) => Promise<LocalCommandResult>;
  logger?: Logger;
  jiraApiClient?: typeof jiraApiClient;
}

interface LocalCommandResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

export class SprintIssueService {
  private readonly logger: Logger;

  constructor(private readonly deps: IssueServiceDeps) {
    this.logger = deps.logger ?? createLogger({ bindings: { component: "sprint-issue-service" } });
  }

  async searchJiraIssues(host: string, email: string, apiToken: string, jql: string): Promise<jiraApiClient.JiraIssueSearchResult[]> {
    if (!this.deps.jiraApiClient) {
      throw new Error("Jira API client is not injected.");
    }
    if (!host.trim() || !apiToken.trim()) {
      throw new Error("Jira site URL and API token must be configured in Settings -> Integrations.");
    }
    return this.deps.jiraApiClient.searchIssues(host, email, apiToken, jql);
  }

  replaceLinkedIssues(sprintId: string, projectId: string, issues: SprintLinkedIssueInput[]): SprintLinkedIssueRecord[] {
    return this.deps.projectManagementRepository.replaceSprintLinkedIssues(projectId, sprintId, issues);
  }

  getLinkedIssues(sprintId: string): SprintLinkedIssueRecord[] {
    const sprint = this.deps.projectManagementRepository.getSprint(sprintId);
    if (!sprint) {
      throw new Error(`Sprint not found: ${sprintId}`);
    }
    return this.deps.projectManagementRepository.listSprintLinkedIssues(sprint.projectId, sprintId);
  }

  async searchIssues(projectId: string, input: IssueSearchInput): Promise<RemoteIssueSummary[]> {
    const project = this.requireProject(projectId);
    const target = resolveIssueTarget(project, input);
    const settings = this.deps.getDashboardSettings({ projectId });
    const limit = clampLimit(input.limit);

    if (target.provider === "github") {
      return this.searchGitHubIssues({
        ...target,
        token: settings.git.githubToken,
        search: input.search,
        state: input.state || "open",
        labels: input.labels || [],
        assignee: input.assignee,
        limit,
      });
    }

    return this.searchGitLabIssues({
      ...target,
      token: settings.git.gitlabToken || "",
      search: input.search,
      state: input.state || "open",
      labels: input.labels || [],
      assignee: input.assignee,
      limit,
    });
  }

  async getIssuePromptContexts(projectId: string, issues: IssuePromptContextInput[]): Promise<IssuePromptContext[]> {
    this.requireProject(projectId);
    const settings = this.deps.getDashboardSettings({ projectId });
    const normalized = normalizeIssuePromptContextInputs(issues);

    const contexts: IssuePromptContext[] = [];
    for (const issue of normalized) {
      if (issue.provider === "github") {
        contexts.push(await this.getGitHubIssuePromptContext(issue, settings.git.githubToken || ""));
      } else if (issue.provider === "gitlab") {
        contexts.push(await this.getGitLabIssuePromptContext(issue, settings.git.gitlabToken || ""));
      } else {
        contexts.push(await this.getJiraIssuePromptContext(issue, settings));
      }
    }
    return contexts;
  }

  async closeLinkedIssues(projectId: string, sprintId: string): Promise<{ reportText: string; closed: number; failed: number; skipped: number }> {
    const sprint = this.deps.projectManagementRepository.getSprint(sprintId);
    const resolvedProjectId = sprint ? sprint.projectId : projectId;
    const settings = this.deps.getDashboardSettings({ projectId: resolvedProjectId, sprintId });
    const linkedIssues = this.deps.projectManagementRepository
      .listSprintLinkedIssues(projectId, sprintId)
      .filter((issue) => issue.closeState !== "closed");

    if (linkedIssues.length === 0) {
      return { reportText: "", closed: 0, failed: 0, skipped: 0 };
    }

    const closableIssues = linkedIssues.filter((issue) => (
      issue.provider === "jira"
        ? settings.jira.autoCloseLinkedIssues
        : settings.git.autoCloseLinkedIssues
    ));

    if (closableIssues.length === 0) {
      return {
        reportText: `\n### Linked Issues\n- Auto-close is disabled. ${linkedIssues.length} linked issue${linkedIssues.length === 1 ? "" : "s"} left open.\n`,
        closed: 0,
        failed: 0,
        skipped: linkedIssues.length,
      };
    }

    let closed = 0;
    let failed = 0;
    const skipped = linkedIssues.length - closableIssues.length;
    const lines = ["", "### Linked Issues"];
    if (skipped > 0) {
      lines.push(`- Auto-close is disabled for ${skipped} linked issue${skipped === 1 ? "" : "s"}.`);
    }
    for (const issue of closableIssues) {
      try {
        await this.closeRemoteIssue(issue, settings);
        this.deps.projectManagementRepository.updateSprintLinkedIssueCloseState(issue.id, {
          closeState: "closed",
          closedAt: new Date().toISOString(),
          closeError: null,
          issueState: "closed",
        });
        closed += 1;
        lines.push(`- Closed ${formatIssueReference(issue)}.`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.deps.projectManagementRepository.updateSprintLinkedIssueCloseState(issue.id, {
          closeState: "close_failed",
          closeError: message,
        });
        failed += 1;
        lines.push(`- Failed to close ${formatIssueReference(issue)}: ${message}`);
        this.logger.warn("Failed to close linked issue", {
          projectId,
          sprintId,
          issueId: issue.id,
          provider: issue.provider,
          repository: issue.repository,
          issueNumber: issue.issueNumber,
          error: message,
        });
      }
    }

    return { reportText: `${lines.join("\n")}\n`, closed, failed, skipped };
  }

  private async closeRemoteIssue(issue: SprintLinkedIssueRecord, settings: DashboardSettings): Promise<void> {
    if (issue.provider === "jira") {
      if (!this.deps.jiraApiClient) {
        throw new Error("Jira API client is not injected.");
      }
      const closeTransitionName = settings.jira.closeTransitionName?.trim() || "Done";
      const transitions = await this.deps.jiraApiClient.getTransitions(
        settings.jira.host,
        settings.jira.email,
        settings.jira.apiToken,
        issue.issueKey
      );
      const closeTransition = transitions.find((t: jiraApiClient.JiraTransition) =>
        t.name.toLowerCase() === closeTransitionName.toLowerCase()
      );
      if (!closeTransition) {
        throw new Error(`Transition '${closeTransitionName}' not found for Jira issue ${issue.issueKey}`);
      }
      await this.deps.jiraApiClient.transitionIssue(
        settings.jira.host,
        settings.jira.email,
        settings.jira.apiToken,
        issue.issueKey,
        closeTransition.id
      );
      return;
    }

    if (issue.provider === "github") {
      const token = settings.git.githubToken?.trim();
      if (!token) {
        await this.closeGitHubIssueWithCli(issue);
        return;
      }
      await requestJson(`https://api.github.com/repos/${issue.repository}/issues/${issue.issueNumber}`, {
        method: "PATCH",
        token,
        body: { state: "closed" },
      });
      return;
    }

    const token = settings.git.gitlabToken?.trim();
    if (!token) {
      throw new Error("GitLab token is not configured.");
    }
    const baseUrl = `https://${issue.hostDomain.replace(/\/+$/, "")}/api/v4`;
    await requestJson(`${baseUrl}/projects/${encodeURIComponent(issue.repository)}/issues/${issue.issueNumber}`, {
      method: "PUT",
      token,
      gitlab: true,
      body: { state_event: "close" },
    });
  }

  private async searchGitHubIssues(args: ResolvedIssueTarget & SearchRuntimeOptions): Promise<RemoteIssueSummary[]> {
    const token = args.token?.trim();
    if (!token) {
      return this.searchGitHubIssuesWithCli(args);
    }
    const qualifiers = [
      `repo:${args.repository}`,
      "is:issue",
      args.state === "all" ? "" : `state:${args.state}`,
      ...args.labels.map((label) => `label:${quoteSearchValue(label)}`),
      args.assignee ? `assignee:${quoteSearchValue(args.assignee)}` : "",
      args.search?.trim() || "",
    ].filter(Boolean).join(" ");
    const url = new URL("https://api.github.com/search/issues");
    url.searchParams.set("q", qualifiers);
    url.searchParams.set("per_page", String(args.limit));
    url.searchParams.set("sort", "updated");
    url.searchParams.set("order", "desc");

    const payload = await requestJson<{ items?: GitHubIssue[] }>(url.toString(), { token });
    return (payload.items || [])
      .filter((issue) => !issue.pull_request)
      .map((issue) => ({
        provider: "github",
        hostDomain: args.hostDomain,
        repository: args.repository,
        issueNumber: issue.number,
        issueKey: `#${issue.number}`,
        title: issue.title,
        url: issue.html_url,
        state: issue.state,
        labels: (issue.labels || [])
          .map((label) => typeof label === "string" ? label : label.name)
          .filter((label): label is string => typeof label === "string" && label.trim().length > 0),
        assignees: (issue.assignees || [])
          .map((assignee) => assignee.login)
          .filter((assignee): assignee is string => typeof assignee === "string" && assignee.trim().length > 0),
        bodyPreview: truncatePreview(issue.body || ""),
        updatedAt: issue.updated_at || null,
      }));
  }

  private async searchGitHubIssuesWithCli(args: ResolvedIssueTarget & SearchRuntimeOptions): Promise<RemoteIssueSummary[]> {
    const cliArgs = [
      "issue",
      "list",
      "--repo",
      formatGitHubCliRepo(args.hostDomain, args.repository),
      "--state",
      args.state,
      "--limit",
      String(args.limit),
      "--json",
      "number,title,url,state,body,updatedAt,labels,assignees",
    ];
    for (const label of args.labels) {
      cliArgs.push("--label", label);
    }
    if (args.assignee?.trim()) {
      cliArgs.push("--assignee", args.assignee.trim());
    }
    if (args.search?.trim()) {
      cliArgs.push("--search", args.search.trim());
    }

    const result = await this.runCommand("gh", cliArgs);
    if (!result.ok) {
      throw new Error(`GitHub token is not configured and local gh auth failed: ${truncatePreview(result.stderr || result.stdout || "gh issue list failed")}`);
    }

    const parsed = parseJsonArray<GitHubCliIssue>(result.stdout, "gh issue list");
    return parsed.map((issue) => ({
      provider: "github",
      hostDomain: args.hostDomain,
      repository: args.repository,
      issueNumber: issue.number,
      issueKey: `#${issue.number}`,
      title: issue.title,
      url: issue.url,
      state: String(issue.state || "open").toLowerCase(),
      labels: (issue.labels || [])
        .map((label) => label.name)
        .filter((label): label is string => typeof label === "string" && label.trim().length > 0),
      assignees: (issue.assignees || [])
        .map((assignee) => assignee.login || assignee.name)
        .filter((assignee): assignee is string => typeof assignee === "string" && assignee.trim().length > 0),
      bodyPreview: truncatePreview(issue.body || ""),
      updatedAt: issue.updatedAt || null,
    }));
  }

  private async getGitHubIssuePromptContext(input: IssuePromptContextInput, tokenValue: string): Promise<IssuePromptContext> {
    const token = tokenValue.trim();
    if (!token) {
      return this.getGitHubIssuePromptContextWithCli(input);
    }

    const apiBaseUrl = githubApiBaseUrl(input.hostDomain);
    const issue = await requestJson<GitHubIssueDetail>(
      `${apiBaseUrl}/repos/${input.repository}/issues/${input.issueNumber}`,
      { token },
    );
    const comments = input.includeConversation === false
      ? []
      : await requestJsonPages<GitHubIssueComment>(
        `${apiBaseUrl}/repos/${input.repository}/issues/${input.issueNumber}/comments?per_page=100`,
        { token },
      );

    return buildIssuePromptContext(input, {
      title: issue.title,
      url: issue.html_url,
      state: issue.state,
      body: issue.body || "",
      author: issue.user?.login || null,
      createdAt: issue.created_at || null,
      updatedAt: issue.updated_at || null,
      labels: (issue.labels || [])
        .map((label) => typeof label === "string" ? label : label.name)
        .filter((label): label is string => typeof label === "string" && label.trim().length > 0),
      assignees: (issue.assignees || [])
        .map((assignee) => assignee.login)
        .filter((assignee): assignee is string => typeof assignee === "string" && assignee.trim().length > 0),
      conversationMarkdown: formatConversationMarkdown(comments.map((comment) => ({
        author: comment.user?.login || "unknown",
        body: comment.body || "",
        createdAt: comment.created_at || null,
        updatedAt: comment.updated_at || null,
        url: comment.html_url || null,
      }))),
      includeConversation: input.includeConversation !== false,
    });
  }

  private async getGitHubIssuePromptContextWithCli(input: IssuePromptContextInput): Promise<IssuePromptContext> {
    const jsonFields = input.includeConversation === false
      ? "number,title,url,state,body,createdAt,updatedAt,author,labels,assignees"
      : "number,title,url,state,body,createdAt,updatedAt,author,labels,assignees,comments";
    const cliArgs = [
      "issue",
      "view",
      String(input.issueNumber),
      "--repo",
      formatGitHubCliRepo(input.hostDomain, input.repository),
      "--json",
      jsonFields,
    ];
    if (input.includeConversation !== false) {
      cliArgs.push("--comments");
    }
    const result = await this.runCommand("gh", cliArgs);
    if (!result.ok) {
      throw new Error(`GitHub token is not configured and local gh auth failed: ${truncatePreview(result.stderr || result.stdout || "gh issue view failed")}`);
    }

    const issue = parseJsonObject<GitHubCliIssueDetail>(result.stdout, "gh issue view");
    const comments = input.includeConversation === false ? [] : issue.comments || [];
    return buildIssuePromptContext(input, {
      title: issue.title,
      url: issue.url,
      state: String(issue.state || "open").toLowerCase(),
      body: issue.body || "",
      author: issue.author?.login || null,
      createdAt: issue.createdAt || null,
      updatedAt: issue.updatedAt || null,
      labels: (issue.labels || [])
        .map((label) => label.name)
        .filter((label): label is string => typeof label === "string" && label.trim().length > 0),
      assignees: (issue.assignees || [])
        .map((assignee) => assignee.login || assignee.name)
        .filter((assignee): assignee is string => typeof assignee === "string" && assignee.trim().length > 0),
      conversationMarkdown: formatConversationMarkdown(comments.map((comment) => ({
        author: comment.author?.login || comment.author?.name || "unknown",
        body: comment.body || "",
        createdAt: comment.createdAt || null,
        updatedAt: comment.updatedAt || null,
        url: comment.url || null,
      }))),
      includeConversation: input.includeConversation !== false,
    });
  }

  private async closeGitHubIssueWithCli(issue: SprintLinkedIssueRecord): Promise<void> {
    const result = await this.runCommand("gh", [
      "issue",
      "close",
      String(issue.issueNumber),
      "--repo",
      formatGitHubCliRepo(issue.hostDomain, issue.repository),
    ]);
    if (!result.ok) {
      throw new Error(`GitHub token is not configured and local gh auth failed: ${truncatePreview(result.stderr || result.stdout || "gh issue close failed")}`);
    }
  }

  private async searchGitLabIssues(args: ResolvedIssueTarget & SearchRuntimeOptions): Promise<RemoteIssueSummary[]> {
    const token = args.token?.trim();
    if (!token) {
      throw new Error("GitLab token is not configured.");
    }
    const baseUrl = `https://${args.hostDomain.replace(/\/+$/, "")}/api/v4`;
    const url = new URL(`${baseUrl}/projects/${encodeURIComponent(args.repository)}/issues`);
    url.searchParams.set("per_page", String(args.limit));
    if (args.state !== "all") {
      url.searchParams.set("state", args.state === "closed" ? "closed" : "opened");
    }
    if (args.search?.trim()) {
      url.searchParams.set("search", args.search.trim());
    }
    if (args.labels.length > 0) {
      url.searchParams.set("labels", args.labels.join(","));
    }
    if (args.assignee?.trim()) {
      url.searchParams.set("assignee_username", args.assignee.trim());
    }

    const payload = await requestJson<GitLabIssue[]>(url.toString(), { token, gitlab: true });
    return payload.map((issue) => ({
      provider: "gitlab",
      hostDomain: args.hostDomain,
      repository: args.repository,
      issueNumber: issue.iid,
      issueKey: `#${issue.iid}`,
      title: issue.title,
      url: issue.web_url,
      state: issue.state,
      labels: Array.isArray(issue.labels) ? issue.labels.filter((label): label is string => typeof label === "string") : [],
      assignees: (issue.assignees || [])
        .map((assignee) => assignee.username || assignee.name)
        .filter((assignee): assignee is string => typeof assignee === "string" && assignee.trim().length > 0),
      bodyPreview: truncatePreview(issue.description || ""),
      updatedAt: issue.updated_at || null,
    }));
  }

  private async getGitLabIssuePromptContext(input: IssuePromptContextInput, tokenValue: string): Promise<IssuePromptContext> {
    const token = tokenValue.trim();
    if (!token) {
      throw new Error("GitLab token is not configured.");
    }

    const baseUrl = `https://${input.hostDomain.replace(/\/+$/, "")}/api/v4`;
    const issue = await requestJson<GitLabIssueDetail>(
      `${baseUrl}/projects/${encodeURIComponent(input.repository)}/issues/${input.issueNumber}`,
      { token, gitlab: true },
    );
    const notes = input.includeConversation === false
      ? []
      : await requestJsonPages<GitLabIssueNote>(
        `${baseUrl}/projects/${encodeURIComponent(input.repository)}/issues/${input.issueNumber}/notes?per_page=100&sort=asc&order_by=created_at`,
        { token, gitlab: true },
      );

    return buildIssuePromptContext(input, {
      title: issue.title,
      url: issue.web_url,
      state: issue.state,
      body: issue.description || "",
      author: issue.author?.username || issue.author?.name || null,
      createdAt: issue.created_at || null,
      updatedAt: issue.updated_at || null,
      labels: Array.isArray(issue.labels) ? issue.labels.filter((label): label is string => typeof label === "string") : [],
      assignees: (issue.assignees || [])
        .map((assignee) => assignee.username || assignee.name)
        .filter((assignee): assignee is string => typeof assignee === "string" && assignee.trim().length > 0),
      conversationMarkdown: formatConversationMarkdown(notes
        .filter((note) => note.system !== true)
        .map((note) => ({
          author: note.author?.username || note.author?.name || "unknown",
          body: note.body || "",
          createdAt: note.created_at || null,
          updatedAt: note.updated_at || null,
          url: null,
        }))),
      includeConversation: input.includeConversation !== false,
    });
  }

  private async getJiraIssuePromptContext(input: IssuePromptContextInput, settings: DashboardSettings): Promise<IssuePromptContext> {
    if (!this.deps.jiraApiClient) {
      throw new Error("Jira API client is not injected.");
    }
    if (!settings.jira.host.trim() || !settings.jira.apiToken.trim()) {
      throw new Error("Jira site URL and API token must be configured in Settings -> Integrations.");
    }

    const issue = await this.deps.jiraApiClient.getIssue(
      settings.jira.host,
      settings.jira.email,
      settings.jira.apiToken,
      input.issueKey || input.title,
    );

    return buildIssuePromptContext(input, {
      title: issue.title,
      url: issue.url,
      state: issue.state,
      body: issue.descriptionMarkdown || "",
      author: null,
      createdAt: null,
      updatedAt: null,
      labels: issue.labels,
      assignees: issue.assignees,
      conversationMarkdown: issue.commentsMarkdown || "",
      includeConversation: input.includeConversation !== false,
    });
  }

  private requireProject(projectId: string): ProjectSummary {
    const project = this.deps.projectManagementRepository.getProject(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }
    return project;
  }

  private async runCommand(command: string, args: string[]): Promise<LocalCommandResult> {
    if (this.deps.runCommand) {
      return this.deps.runCommand(command, args);
    }
    return runLocalCommand(command, args);
  }
}

interface ResolvedIssueTarget {
  provider: LinkedIssueProvider;
  hostDomain: string;
  repository: string;
}

interface SearchRuntimeOptions {
  token: string;
  search?: string;
  state: "open" | "closed" | "all";
  labels: string[];
  assignee?: string;
  limit: number;
}

interface GitHubIssue {
  number: number;
  title: string;
  html_url: string;
  state: string;
  body?: string | null;
  updated_at?: string | null;
  pull_request?: unknown;
  labels?: Array<string | { name?: string }>;
  assignees?: Array<{ login?: string }>;
}

interface GitHubIssueDetail extends GitHubIssue {
  user?: { login?: string } | null;
  created_at?: string | null;
}

interface GitHubIssueComment {
  body?: string | null;
  html_url?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  user?: { login?: string } | null;
}

interface GitHubCliIssue {
  number: number;
  title: string;
  url: string;
  state?: string;
  body?: string | null;
  updatedAt?: string | null;
  labels?: Array<{ name?: string }>;
  assignees?: Array<{ login?: string; name?: string }>;
}

interface GitHubCliIssueDetail extends GitHubCliIssue {
  createdAt?: string | null;
  author?: { login?: string; name?: string } | null;
  comments?: Array<{
    body?: string | null;
    url?: string | null;
    createdAt?: string | null;
    updatedAt?: string | null;
    author?: { login?: string; name?: string } | null;
  }>;
}

interface GitLabIssue {
  iid: number;
  title: string;
  web_url: string;
  state: string;
  description?: string | null;
  updated_at?: string | null;
  labels?: unknown[];
  assignees?: Array<{ username?: string; name?: string }>;
}

interface GitLabIssueDetail extends GitLabIssue {
  description?: string | null;
  created_at?: string | null;
  author?: { username?: string; name?: string } | null;
}

interface GitLabIssueNote {
  body?: string | null;
  system?: boolean;
  created_at?: string | null;
  updated_at?: string | null;
  author?: { username?: string; name?: string } | null;
}

interface BuildIssuePromptContextOptions {
  title: string;
  url: string;
  state: string;
  body: string;
  author: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  labels: string[];
  assignees: string[];
  conversationMarkdown: string;
  includeConversation: boolean;
}

function resolveIssueTarget(project: ProjectSummary, input: IssueSearchInput): ResolvedIssueTarget {
  const repo = (input.repository || inferRepository(project)).trim().replace(/^\/+|\/+$/g, "");
  const provider = input.provider || project.gitProvider;
  const hostDomain = (input.hostDomain || project.gitHostDomain || defaultHostForProvider(provider)).trim().toLowerCase();
  if (provider !== "github" && provider !== "gitlab") {
    throw new Error("Select a GitHub or GitLab-backed project before importing issues.");
  }
  if (!repo) {
    throw new Error("Repository is required for issue import.");
  }
  return { provider, hostDomain, repository: repo };
}

function normalizeIssuePromptContextInputs(issues: IssuePromptContextInput[]): IssuePromptContextInput[] {
  const seen = new Set<string>();
  const normalized: IssuePromptContextInput[] = [];
  for (const issue of issues) {
    const hostDomain = issue.hostDomain.trim().toLowerCase();
    const repository = issue.repository.trim().replace(/^\/+|\/+$/g, "");
    const issueNumber = Math.trunc(issue.issueNumber);
    const title = issue.title.trim();
    const url = issue.url.trim();
    if ((issue.provider !== "github" && issue.provider !== "gitlab" && issue.provider !== "jira") || !hostDomain || !repository || !title || !url || !Number.isFinite(issueNumber) || issueNumber < 1) {
      continue;
    }
    const key = `${issue.provider}:${hostDomain}:${repository}:${issueNumber}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    normalized.push({
      ...issue,
      hostDomain,
      repository,
      issueNumber,
      issueKey: issue.issueKey?.trim() || `${issue.provider === "github" ? "#" : issue.provider === "gitlab" ? "!" : ""}${issueNumber}`,
      title,
      url,
      state: issue.state?.trim() || "open",
      labels: Array.from(new Set((issue.labels || []).map((label) => label.trim()).filter(Boolean))).slice(0, 12),
      assignees: Array.from(new Set((issue.assignees || []).map((assignee) => assignee.trim()).filter(Boolean))).slice(0, 12),
      includeConversation: issue.includeConversation !== false,
    });
  }
  return normalized.slice(0, 50);
}

function buildIssuePromptContext(input: IssuePromptContextInput, options: BuildIssuePromptContextOptions): IssuePromptContext {
  return {
    provider: input.provider,
    hostDomain: input.hostDomain,
    repository: input.repository,
    issueNumber: input.issueNumber,
    issueKey: input.issueKey || `${input.provider === "github" ? "#" : "!"}${input.issueNumber}`,
    title: options.title || input.title,
    url: options.url || input.url,
    state: options.state || input.state || "open",
    labels: options.labels.length > 0 ? options.labels : input.labels || [],
    assignees: options.assignees.length > 0 ? options.assignees : input.assignees || [],
    issueBodyMarkdown: normalizeMarkdown(options.body),
    issueConversationMarkdown: options.includeConversation ? options.conversationMarkdown : "",
    includeConversation: options.includeConversation,
    issueAuthor: options.author,
    issueCreatedAt: options.createdAt,
    issueUpdatedAt: options.updatedAt,
  };
}

function inferRepository(project: ProjectSummary): string {
  const metadata = resolveRepositoryHost(project.repoUrl || project.sourceRef || null);
  return metadata.repoTarget || "";
}

function defaultHostForProvider(provider: string): string {
  return provider === "gitlab" ? "gitlab.com" : "github.com";
}

function clampLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit)) {
    return 30;
  }
  return Math.max(1, Math.min(100, Math.trunc(limit as number)));
}

function quoteSearchValue(value: string): string {
  const trimmed = value.trim();
  return /\s/.test(trimmed) ? `"${trimmed.replace(/"/g, "")}"` : trimmed;
}

function formatGitHubCliRepo(hostDomain: string, repository: string): string {
  const normalizedHost = hostDomain.trim().toLowerCase();
  return normalizedHost && normalizedHost !== "github.com"
    ? `${normalizedHost}/${repository}`
    : repository;
}

function githubApiBaseUrl(hostDomain: string): string {
  const normalizedHost = hostDomain.trim().toLowerCase().replace(/\/+$/, "");
  return normalizedHost && normalizedHost !== "github.com"
    ? `https://${normalizedHost}/api/v3`
    : "https://api.github.com";
}

function parseJsonArray<T>(value: string, source: string): T[] {
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed as T[];
    }
  } catch {
    // handled below
  }
  throw new Error(`Unable to parse ${source} JSON output.`);
}

function parseJsonObject<T>(value: string, source: string): T {
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as T;
    }
  } catch {
    // handled below
  }
  throw new Error(`Unable to parse ${source} JSON output.`);
}

function normalizeMarkdown(value: string): string {
  return value.replace(/\r\n/g, "\n").trim();
}

function formatConversationMarkdown(comments: Array<{
  author: string;
  body: string;
  createdAt: string | null;
  updatedAt: string | null;
  url: string | null;
}>): string {
  return comments
    .map((comment, index) => {
      const author = comment.author.trim() || "unknown";
      const meta = [
        `Comment ${index + 1}`,
        `@${author}`,
        comment.createdAt || "",
        comment.updatedAt && comment.updatedAt !== comment.createdAt ? `updated ${comment.updatedAt}` : "",
        comment.url ? `[source](${comment.url})` : "",
      ].filter(Boolean).join(" - ");
      const body = normalizeMarkdown(comment.body) || "_No comment body provided._";
      return `##### ${meta}\n\n${body}`;
    })
    .join("\n\n");
}

function truncatePreview(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > 220 ? `${compact.slice(0, 217)}...` : compact;
}

function formatIssueReference(issue: SprintLinkedIssueRecord): string {
  return `[${issue.repository}${issue.issueKey}](${issue.url})`;
}

async function requestJson<T>(url: string, options: {
  method?: string;
  token: string;
  gitlab?: boolean;
  body?: Record<string, unknown>;
}): Promise<T> {
  const result = await requestJsonWithHeaders<T>(url, options);
  return result.data;
}

async function requestJsonPages<T>(url: string, options: {
  method?: string;
  token: string;
  gitlab?: boolean;
  body?: Record<string, unknown>;
}): Promise<T[]> {
  const items: T[] = [];
  let nextUrl: string | null = url;
  while (nextUrl) {
    const result = await requestJsonWithHeaders<T[]>(nextUrl, options);
    items.push(...result.data);
    nextUrl = parseNextLink(result.linkHeader);
  }
  return items;
}

async function requestJsonWithHeaders<T>(url: string, options: {
  method?: string;
  token: string;
  gitlab?: boolean;
  body?: Record<string, unknown>;
}): Promise<{ data: T; linkHeader: string | null }> {
  const response = await fetch(url, {
    method: options.method || "GET",
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json",
      "User-Agent": "code-ux-dashboard",
      ...(options.gitlab ? { "PRIVATE-TOKEN": options.token } : { "Authorization": `Bearer ${options.token}` }),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`${response.status} ${response.statusText}${text ? `: ${truncatePreview(text)}` : ""}`);
  }
  return {
    data: await response.json() as T,
    linkHeader: response.headers.get("link"),
  };
}

function parseNextLink(linkHeader: string | null): string | null {
  if (!linkHeader) {
    return null;
  }
  for (const part of linkHeader.split(",")) {
    const match = part.match(/<([^>]+)>;\s*rel="next"/);
    if (match?.[1]) {
      return match[1];
    }
  }
  return null;
}

async function runLocalCommand(command: string, args: string[]): Promise<LocalCommandResult> {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: 20_000, maxBuffer: 1024 * 1024 * 4 }, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        stdout: String(stdout || ""),
        stderr: String(stderr || (error instanceof Error ? error.message : "")),
      });
    });
  });
}
