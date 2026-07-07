import type {
  IssuePromptContext,
  IssuePromptContextInput,
  LinkedIssueProvider,
  ProjectSummary,
  RepositoryIssueSearchInput,
  RepositoryIssueSearchResult,
  RepositoryIssueSearchSortDirection,
  RepositoryIssueSearchSortField,
  JiraIssueSearchInput,
  JiraIssueSearchResult,
  JiraIssueSearchSortField,
  JiraIssueSearchSortDirection,
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
  projectKey?: string;
  search?: string;
  state?: RepositoryIssueSearchInput["state"];
  status?: JiraIssueSearchInput["status"];
  labels?: string[];
  assignee?: string;
  assigneeText?: string;
  author?: string;
  reporter?: string;
  milestone?: string;
  issueText?: string;
  issueKeys?: string[];
  issueNumbers?: number[];
  issueRefs?: string[];
  includeConversation?: boolean;
  createdAfter?: string;
  createdBefore?: string;
  updatedAfter?: string;
  updatedBefore?: string;
  sortField?: RepositoryIssueSearchInput["sortField"] | JiraIssueSearchSortField;
  sortDirection?: RepositoryIssueSearchInput["sortDirection"] | JiraIssueSearchSortDirection;
  limit?: number;
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

export interface LinkedIssueImportTransitionWarning {
  issueId: string;
  issueKey: string;
  message: string;
}

export interface LinkedIssueImportResult {
  linkedIssues: SprintLinkedIssueRecord[];
  warnings: LinkedIssueImportTransitionWarning[];
}

export class SprintIssueService {
  private readonly logger: Logger;

  constructor(private readonly deps: IssueServiceDeps) {
    this.logger = deps.logger ?? createLogger({ bindings: { component: "sprint-issue-service" } });
  }

  async searchJiraIssues(
    host: string,
    email: string,
    apiToken: string,
    input: string | JiraIssueSearchInput,
    defaultProjectKey = '',
  ): Promise<JiraIssueSearchResult[]> {
    if (!this.deps.jiraApiClient) {
      throw new Error("Jira API client is not injected.");
    }
    if (!host.trim() || !apiToken.trim()) {
      throw new Error("Jira site URL and API token must be configured in Settings -> Integrations.");
    }
    const searchInput = typeof input === "string"
      ? input
      : normalizeJiraIssueSearchInput({ ...input, projectKey: input.projectKey || defaultProjectKey });
    return this.deps.jiraApiClient.searchIssues(host, email, apiToken, searchInput);
  }

  replaceLinkedIssues(sprintId: string, projectId: string, issues: SprintLinkedIssueInput[]): SprintLinkedIssueRecord[] {
    return this.deps.projectManagementRepository.replaceSprintLinkedIssues(projectId, sprintId, issues);
  }

  async importLinkedIssues(sprintId: string, projectId: string, issues: SprintLinkedIssueInput[]): Promise<LinkedIssueImportResult> {
    const linkedIssues = this.replaceLinkedIssues(sprintId, projectId, issues);
    const warnings = await this.transitionLinkedJiraIssuesOnImport(projectId, sprintId, linkedIssues);
    return { linkedIssues, warnings };
  }

  async transitionLinkedJiraIssuesOnImport(
    projectId: string,
    sprintId: string,
    linkedIssues: SprintLinkedIssueRecord[],
  ): Promise<LinkedIssueImportTransitionWarning[]> {
    const jiraIssues = linkedIssues.filter((issue) => issue.provider === "jira");
    if (jiraIssues.length === 0) {
      return [];
    }

    const settings = this.deps.getDashboardSettings({ projectId, sprintId });
    if (!settings.jira.autoTransitionLinkedIssuesOnImport) {
      return [];
    }

    const warnings: LinkedIssueImportTransitionWarning[] = [];
    for (const issue of jiraIssues) {
      try {
        await this.transitionImportedJiraIssue(issue, settings);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        warnings.push({
          issueId: issue.id,
          issueKey: issue.issueKey,
          message,
        });
        this.logger.warn("Failed to transition imported Jira issue", {
          projectId,
          sprintId,
          issueId: issue.id,
          issueKey: issue.issueKey,
          transitionName: settings.jira.importTransitionName?.trim() || "In Work",
          error: message,
        });
      }
    }
    return warnings;
  }

  getLinkedIssues(sprintId: string): SprintLinkedIssueRecord[] {
    const sprint = this.deps.projectManagementRepository.getSprint(sprintId);
    if (!sprint) {
      throw new Error(`Sprint not found: ${sprintId}`);
    }
    return this.deps.projectManagementRepository.listSprintLinkedIssues(sprint.projectId, sprintId);
  }

  async searchIssues(projectId: string, input: IssueSearchInput): Promise<RepositoryIssueSearchResult[]> {
    const project = this.requireProject(projectId);
    const searchInput = normalizeIssueSearchInput(input);
    const provider = resolveIssueProvider(project, searchInput);
    const settings = this.deps.getDashboardSettings({ projectId });
    const limit = clampLimit(searchInput.limit);

    if (provider === "jira") {
      return this.searchJiraIssuesForProject(project, searchInput, settings, limit);
    }

    const target = resolveIssueTarget(project, searchInput, provider);
    if (target.provider === "github") {
      return this.searchGitHubIssues({
        ...target,
        token: settings.git.githubToken,
        search: searchInput.search,
        state: searchInput.state || "open",
        labels: searchInput.labels || [],
        assignee: searchInput.assignee,
        author: searchInput.author,
        reporter: searchInput.reporter,
        milestone: searchInput.milestone,
        issueText: searchInput.issueText,
        createdAfter: searchInput.createdAfter,
        createdBefore: searchInput.createdBefore,
        updatedAfter: searchInput.updatedAfter,
        updatedBefore: searchInput.updatedBefore,
        sortField: normalizeRepositorySearchSortField(searchInput.sortField),
        sortDirection: normalizeRepositorySearchSortDirection(searchInput.sortDirection),
        limit,
      });
    }

    return this.searchGitLabIssues({
      ...target,
      token: settings.git.gitlabToken || "",
      search: searchInput.search,
      state: searchInput.state || "open",
      labels: searchInput.labels || [],
      assignee: searchInput.assignee,
      author: searchInput.author,
      reporter: searchInput.reporter,
      milestone: searchInput.milestone,
      issueText: searchInput.issueText,
      createdAfter: searchInput.createdAfter,
      createdBefore: searchInput.createdBefore,
      updatedAfter: searchInput.updatedAfter,
      updatedBefore: searchInput.updatedBefore,
      sortField: normalizeRepositorySearchSortField(searchInput.sortField),
      sortDirection: normalizeRepositorySearchSortDirection(searchInput.sortDirection),
      limit,
    });
  }

  async getIssuePromptContextsForReferences(projectId: string, input: IssueSearchInput): Promise<IssuePromptContext[]> {
    const project = this.requireProject(projectId);
    const searchInput = normalizeIssueSearchInput(input);
    const provider = resolveIssueProvider(project, searchInput);
    const settings = this.deps.getDashboardSettings({ projectId });
    const hasJiraReferences = shouldResolveJiraReferences(searchInput, provider) && collectJiraIssueKeys(searchInput).length > 0;
    if (hasJiraReferences && (!settings.jira.host.trim() || !settings.jira.apiToken.trim())) {
      throw new Error("Jira site URL and API token must be configured in Settings -> Integrations.");
    }
    const issueInputs = buildExplicitIssuePromptInputs(project, searchInput, provider, settings);
    if (issueInputs.length === 0) {
      return [];
    }
    return this.getIssuePromptContexts(projectId, issueInputs);
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
        throw new Error("GitHub token is not configured.");
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

  private async transitionImportedJiraIssue(issue: SprintLinkedIssueRecord, settings: DashboardSettings): Promise<void> {
    if (!this.deps.jiraApiClient) {
      throw new Error("Jira API client is not injected.");
    }
    if (!settings.jira.host.trim() || !settings.jira.apiToken.trim()) {
      throw new Error("Jira site URL and API token must be configured in Settings -> Integrations.");
    }

    const importTransitionName = settings.jira.importTransitionName?.trim() || "In Work";
    const transitions = await this.deps.jiraApiClient.getTransitions(
      settings.jira.host,
      settings.jira.email,
      settings.jira.apiToken,
      issue.issueKey,
    );
    const importTransition = transitions.find((transition: jiraApiClient.JiraTransition) =>
      transition.name.toLowerCase() === importTransitionName.toLowerCase()
    );
    if (!importTransition) {
      throw new Error(`Transition '${importTransitionName}' not found for Jira issue ${issue.issueKey}`);
    }
    await this.deps.jiraApiClient.transitionIssue(
      settings.jira.host,
      settings.jira.email,
      settings.jira.apiToken,
      issue.issueKey,
      importTransition.id,
    );
  }

  private async searchGitHubIssues(args: ResolvedIssueTarget & SearchRuntimeOptions): Promise<RepositoryIssueSearchResult[]> {
    const token = args.token?.trim();
    if (!token) {
      throw new Error("GitHub token is not configured.");
    }
    const qualifiers = [
      `repo:${args.repository}`,
      "is:issue",
      args.state === "all" ? "" : `state:${args.state}`,
      ...args.labels.map((label) => `label:${quoteSearchValue(label)}`),
      args.assignee ? `assignee:${quoteSearchValue(args.assignee)}` : "",
      args.author ? `author:${quoteSearchValue(args.author)}` : "",
      args.reporter ? `author:${quoteSearchValue(args.reporter)}` : "",
      args.milestone ? `milestone:${quoteSearchValue(args.milestone)}` : "",
      args.createdAfter ? `created:>=${args.createdAfter}` : "",
      args.createdBefore ? `created:<=${args.createdBefore}` : "",
      args.updatedAfter ? `updated:>=${args.updatedAfter}` : "",
      args.updatedBefore ? `updated:<=${args.updatedBefore}` : "",
      args.issueText?.trim() || "",
      args.search?.trim() || "",
    ].filter(Boolean).join(" ");
    const url = new URL(`${githubApiBaseUrl(args.hostDomain)}/search/issues`);
    url.searchParams.set("q", qualifiers);
    url.searchParams.set("per_page", String(args.limit));
    url.searchParams.set("sort", mapGitHubSortField(args.sortField));
    url.searchParams.set("order", args.sortDirection || "desc");

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
        createdAt: issue.created_at || null,
        updatedAt: issue.updated_at || null,
        issueAuthor: issue.user?.login || null,
        issueReporter: issue.user?.login || null,
        issueMilestone: issue.milestone?.title || null,
        issueType: null,
        issuePriority: null,
        issueCommentCount: typeof issue.comments === "number" ? issue.comments : null,
        sourceProvider: "github",
      }));
  }

  private async searchJiraIssuesForProject(
    project: ProjectSummary,
    input: IssueSearchInput,
    settings: DashboardSettings,
    limit: number,
  ): Promise<RepositoryIssueSearchResult[]> {
    if (!this.deps.jiraApiClient) {
      throw new Error("Jira API client is not injected.");
    }
    if (!settings.jira.host.trim() || !settings.jira.apiToken.trim()) {
      throw new Error("Jira site URL and API token must be configured in Settings -> Integrations.");
    }

    const jiraInput: JiraIssueSearchInput = {
      projectKey: input.projectKey || settings.jira.defaultProject,
      search: input.search,
      status: input.status,
      assignee: normalizeJiraAssignee(input.assignee),
      assigneeText: input.assigneeText || input.assignee,
      labels: input.labels || [],
      updatedAfter: input.updatedAfter,
      updatedBefore: input.updatedBefore,
      sortField: normalizeJiraSearchSortField(input.sortField),
      sortDirection: normalizeJiraSearchSortDirection(input.sortDirection),
      limit,
    };
    const explicitIssueKeys = collectJiraIssueKeys(input);
    if (explicitIssueKeys.length === 1 && !jiraInput.search) {
      jiraInput.issueKey = explicitIssueKeys[0];
    }

    const issues = await this.deps.jiraApiClient.searchIssues(
      settings.jira.host,
      settings.jira.email,
      settings.jira.apiToken,
      jiraInput,
      limit,
    );
    const hostDomain = jiraHostDomain(settings.jira.host);
    return issues.map((issue) => normalizeJiraIssueSummary(issue, hostDomain, project));
  }

  private async getGitHubIssuePromptContext(input: IssuePromptContextInput, tokenValue: string): Promise<IssuePromptContext> {
    const token = tokenValue.trim();
    if (!token) {
      throw new Error("GitHub token is not configured.");
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

  private async searchGitLabIssues(args: ResolvedIssueTarget & SearchRuntimeOptions): Promise<RepositoryIssueSearchResult[]> {
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
    if (args.issueText?.trim()) {
      const issueText = args.issueText.trim();
      if (/^#?\d+$/.test(issueText)) {
        url.searchParams.set("iids[]", issueText.replace(/^#/, ""));
      } else if (!args.search?.trim()) {
        url.searchParams.set("search", issueText);
      } else {
        url.searchParams.set("search", `${url.searchParams.get("search") || ""} ${issueText}`.trim());
      }
    }
    if (args.labels.length > 0) {
      url.searchParams.set("labels", args.labels.join(","));
    }
    if (args.assignee?.trim()) {
      url.searchParams.set("assignee_username", args.assignee.trim());
    }
    const author = args.reporter?.trim() || args.author?.trim();
    if (author) {
      url.searchParams.set("author_username", author);
    }
    if (args.milestone?.trim()) {
      url.searchParams.set("milestone", args.milestone.trim());
    }
    if (args.createdAfter?.trim()) {
      url.searchParams.set("created_after", args.createdAfter.trim());
    }
    if (args.createdBefore?.trim()) {
      url.searchParams.set("created_before", args.createdBefore.trim());
    }
    if (args.updatedAfter?.trim()) {
      url.searchParams.set("updated_after", args.updatedAfter.trim());
    }
    if (args.updatedBefore?.trim()) {
      url.searchParams.set("updated_before", args.updatedBefore.trim());
    }
    url.searchParams.set("order_by", mapGitLabSortField(args.sortField));
    url.searchParams.set("sort", args.sortDirection || "desc");

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
      createdAt: issue.created_at || null,
      updatedAt: issue.updated_at || null,
      issueAuthor: issue.author?.username || issue.author?.name || null,
      issueReporter: issue.author?.username || issue.author?.name || null,
      issueMilestone: issue.milestone?.title || issue.milestone?.name || null,
      issueType: issue.issue_type || null,
      issuePriority: issue.priority || null,
      issueCommentCount: typeof issue.user_notes_count === "number"
        ? issue.user_notes_count
        : typeof issue.comments_count === "number"
          ? issue.comments_count
          : null,
      sourceProvider: "gitlab",
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
      author: issue.issueAuthor,
      createdAt: issue.createdAt,
      updatedAt: issue.updatedAt,
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
  provider: "github" | "gitlab";
  hostDomain: string;
  repository: string;
}

interface SearchRuntimeOptions {
  token: string;
  search?: string;
  state: "open" | "closed" | "all";
  labels: string[];
  assignee?: string;
  author?: string;
  reporter?: string;
  milestone?: string;
  issueText?: string;
  createdAfter?: string;
  createdBefore?: string;
  updatedAfter?: string;
  updatedBefore?: string;
  sortField?: RepositoryIssueSearchSortField;
  sortDirection?: RepositoryIssueSearchSortDirection;
  limit: number;
}

interface GitHubIssue {
  number: number;
  title: string;
  html_url: string;
  state: string;
  body?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  pull_request?: unknown;
  labels?: Array<string | { name?: string }>;
  assignees?: Array<{ login?: string }>;
  user?: { login?: string } | null;
  milestone?: { title?: string | null } | null;
  comments?: number;
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

interface GitLabIssue {
  iid: number;
  title: string;
  web_url: string;
  state: string;
  description?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  labels?: unknown[];
  assignees?: Array<{ username?: string; name?: string }>;
  author?: { username?: string; name?: string } | null;
  milestone?: { title?: string | null; name?: string | null } | null;
  issue_type?: string | null;
  priority?: string | null;
  user_notes_count?: number;
  comments_count?: number;
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

function resolveIssueProvider(project: ProjectSummary, input: IssueSearchInput): LinkedIssueProvider {
  const provider = input.provider || project.gitProvider;
  if (provider !== "github" && provider !== "gitlab" && provider !== "jira") {
    throw new Error("Select a GitHub, GitLab, or Jira-backed project before importing issues.");
  }
  return provider;
}

export function resolveIssueTarget(project: ProjectSummary, input: IssueSearchInput, provider: LinkedIssueProvider): ResolvedIssueTarget {
  if (provider !== "github" && provider !== "gitlab") {
    throw new Error("Select a GitHub or GitLab-backed project before importing repository issues.");
  }
  const repo = (input.repository || inferRepository(project)).trim().replace(/^\/+|\/+$/g, "");
  const hostDomain = (input.hostDomain || project.gitHostDomain || defaultHostForProvider(provider)).trim().toLowerCase();
  if (!repo) {
    throw new Error("Repository is required for issue import.");
  }
  return { provider, hostDomain, repository: repo };
}

function buildExplicitIssuePromptInputs(
  project: ProjectSummary,
  input: IssueSearchInput,
  preferredProvider: LinkedIssueProvider,
  settings: DashboardSettings,
): IssuePromptContextInput[] {
  const contexts: IssuePromptContextInput[] = [];
  const jiraHost = jiraHostDomain(settings.jira.host);
  const jiraKeys = shouldResolveJiraReferences(input, preferredProvider) ? collectJiraIssueKeys(input) : [];
  for (const issueKey of jiraKeys) {
    const issueNumber = parseIssueNumberFromJiraKey(issueKey);
    if (!issueNumber || !jiraHost) {
      continue;
    }
    const projectKey = issueKey.slice(0, issueKey.lastIndexOf("-"));
    contexts.push({
      provider: "jira",
      hostDomain: jiraHost,
      repository: projectKey,
      projectKey,
      issueNumber,
      issueKey,
      title: issueKey,
      url: `${normalizeJiraHost(settings.jira.host)}/browse/${issueKey}`,
      includeConversation: input.includeConversation !== false,
    });
  }

  const repositoryProvider = preferredProvider === "gitlab" ? "gitlab" : preferredProvider === "github" ? "github" : undefined;
  if (!repositoryProvider) {
    return contexts;
  }

  const target = tryResolveRepositoryIssueTarget(project, input, repositoryProvider);
  if (!target) {
    return contexts;
  }

  for (const issueNumber of collectRepositoryIssueNumbers(input)) {
    contexts.push({
      provider: target.provider,
      hostDomain: target.hostDomain,
      repository: target.repository,
      issueNumber,
      issueKey: `${target.provider === "github" ? "#" : "!"}${issueNumber}`,
      title: `${target.repository}#${issueNumber}`,
      url: repositoryIssueUrl(target, issueNumber),
      includeConversation: input.includeConversation !== false,
    });
  }

  return contexts;
}

function tryResolveRepositoryIssueTarget(
  project: ProjectSummary,
  input: IssueSearchInput,
  provider: "github" | "gitlab",
): ResolvedIssueTarget | null {
  try {
    return resolveIssueTarget(project, input, provider);
  } catch {
    return null;
  }
}

function collectJiraIssueKeys(input: IssueSearchInput): string[] {
  const candidates = [
    ...(input.issueKeys || []),
    ...(input.issueRefs || []),
    input.issueText || "",
    input.search || "",
  ];
  if (input.projectKey) {
    for (const issueNumber of input.issueNumbers || []) {
      if (Number.isFinite(issueNumber) && issueNumber > 0) {
        candidates.push(`${input.projectKey}-${Math.trunc(issueNumber)}`);
      }
    }
  }
  return uniqueStrings(candidates
    .flatMap((value) => extractJiraIssueKeys(value))
    .map((value) => value.toUpperCase()));
}

function shouldResolveJiraReferences(input: IssueSearchInput, preferredProvider: LinkedIssueProvider): boolean {
  return preferredProvider === "jira" || (input.issueKeys?.length || 0) > 0;
}

function collectRepositoryIssueNumbers(input: IssueSearchInput): number[] {
  const numbers = [
    ...(input.issueNumbers || []),
    ...(input.issueRefs || []).flatMap(extractRepositoryIssueNumbers),
    ...extractRepositoryIssueNumbers(input.issueText || ""),
  ];
  return Array.from(new Set(numbers
    .map((value) => Math.trunc(value))
    .filter((value) => Number.isFinite(value) && value > 0)));
}

function extractJiraIssueKeys(value: string): string[] {
  return Array.from(value.matchAll(/\b([A-Z][A-Z0-9_]+-\d+)\b/gi))
    .map((match) => match[1])
    .filter((match): match is string => Boolean(match));
}

function extractRepositoryIssueNumbers(value: string): number[] {
  const trimmed = value.trim();
  if (!trimmed || extractJiraIssueKeys(trimmed).length > 0) {
    return [];
  }
  const match = trimmed.match(/^(?:#|!)?(\d+)$/);
  return match?.[1] ? [Number(match[1])] : [];
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function normalizeJiraIssueSummary(issue: JiraIssueSearchResult, hostDomain: string, project: ProjectSummary): RepositoryIssueSearchResult {
  const issueNumber = parseIssueNumberFromJiraKey(issue.key) || 1;
  const projectKey = issue.projectKey || issue.key.slice(0, Math.max(0, issue.key.lastIndexOf("-"))) || project.name;
  return {
    provider: "jira",
    hostDomain,
    repository: projectKey,
    projectKey,
    issueNumber,
    issueKey: issue.key,
    title: issue.title,
    url: issue.url,
    state: issue.state,
    labels: issue.labels,
    assignees: issue.assignees,
    bodyPreview: issue.bodyPreview,
    createdAt: issue.createdAt,
    updatedAt: issue.updatedAt,
    issueAuthor: issue.issueAuthor,
    issueReporter: issue.issueReporter,
    issueMilestone: issue.issueMilestone,
    issueType: issue.issueType,
    issuePriority: issue.priority,
    issueCommentCount: issue.issueCommentCount,
    sourceProvider: "jira",
  };
}

function parseIssueNumberFromJiraKey(issueKey: string): number | null {
  const match = issueKey.trim().match(/-(\d+)$/);
  if (!match?.[1]) {
    return null;
  }
  const issueNumber = Number(match[1]);
  return Number.isFinite(issueNumber) && issueNumber > 0 ? issueNumber : null;
}

function normalizeJiraAssignee(value?: string): JiraIssueSearchInput["assignee"] | undefined {
  if (value === "me" || value === "unassigned") {
    return value;
  }
  return undefined;
}

function normalizeIssueSearchInput(input: IssueSearchInput): IssueSearchInput {
  return {
    ...input,
    provider: normalizeIssueProviderValue(input.provider),
    repository: normalizeOptionalString(input.repository),
    hostDomain: normalizeOptionalString(input.hostDomain)?.toLowerCase(),
    projectKey: normalizeOptionalString(input.projectKey),
    search: normalizeOptionalString(input.search),
    state: normalizeRepositoryIssueStateValue(input.state),
    status: normalizeJiraIssueStatusValue(input.status),
    labels: normalizeStringList(input.labels).slice(0, 12),
    assignee: normalizeOptionalString(input.assignee),
    assigneeText: normalizeOptionalString(input.assigneeText),
    author: normalizeOptionalString(input.author),
    reporter: normalizeOptionalString(input.reporter),
    milestone: normalizeOptionalString(input.milestone),
    issueText: normalizeOptionalString(input.issueText),
    issueKeys: normalizeStringList(input.issueKeys),
    issueNumbers: normalizeIssueNumbers(input.issueNumbers),
    issueRefs: normalizeStringList(input.issueRefs),
    createdAfter: normalizeOptionalString(input.createdAfter),
    createdBefore: normalizeOptionalString(input.createdBefore),
    updatedAfter: normalizeOptionalString(input.updatedAfter),
    updatedBefore: normalizeOptionalString(input.updatedBefore),
    sortField: normalizeIssueSearchSortFieldValue(input.sortField),
    sortDirection: normalizeIssueSearchSortDirectionValue(input.sortDirection),
    limit: clampLimit(input.limit),
  };
}

function normalizeJiraIssueSearchInput(input: JiraIssueSearchInput): JiraIssueSearchInput {
  return {
    ...input,
    jql: normalizeOptionalString(input.jql),
    projectKey: normalizeOptionalString(input.projectKey),
    search: normalizeOptionalString(input.search),
    issueKey: normalizeOptionalString(input.issueKey),
    status: normalizeJiraIssueStatusValue(input.status),
    assignee: normalizeJiraAssigneeValue(input.assignee),
    assigneeText: normalizeOptionalString(input.assigneeText),
    reporterText: normalizeOptionalString(input.reporterText),
    issueType: normalizeOptionalString(input.issueType),
    priority: normalizeOptionalString(input.priority),
    labels: normalizeStringList(input.labels).slice(0, 12),
    updatedAfter: normalizeOptionalString(input.updatedAfter),
    updatedBefore: normalizeOptionalString(input.updatedBefore),
    sortField: normalizeJiraSearchSortField(input.sortField),
    sortDirection: normalizeJiraSearchSortDirection(input.sortDirection),
    limit: clampLimit(input.limit ?? input.maxResults),
    maxResults: clampLimit(input.maxResults ?? input.limit),
  };
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeStringList(values: string[] | undefined): string[] {
  return Array.from(new Set((values || []).map((value) => value.trim()).filter(Boolean)));
}

function normalizeIssueNumbers(values: number[] | undefined): number[] {
  return Array.from(new Set((values || [])
    .map((value) => Math.trunc(value))
    .filter((value) => Number.isFinite(value) && value > 0)));
}

function normalizeIssueProviderValue(value: LinkedIssueProvider | undefined): LinkedIssueProvider | undefined {
  return value === "github" || value === "gitlab" || value === "jira" ? value : undefined;
}

function normalizeRepositoryIssueStateValue(value: IssueSearchInput["state"]): IssueSearchInput["state"] {
  return value === "open" || value === "closed" || value === "all" ? value : undefined;
}

function normalizeJiraIssueStatusValue(value: IssueSearchInput["status"]): IssueSearchInput["status"] {
  return value === "open" || value === "in_progress" || value === "done" || value === "all" ? value : undefined;
}

function normalizeJiraAssigneeValue(value: JiraIssueSearchInput["assignee"]): JiraIssueSearchInput["assignee"] {
  return value === "any" || value === "me" || value === "unassigned" ? value : undefined;
}

function normalizeIssueSearchSortFieldValue(value: IssueSearchInput["sortField"]): IssueSearchInput["sortField"] {
  return normalizeRepositorySearchSortField(value) || normalizeJiraSearchSortField(value);
}

function normalizeIssueSearchSortDirectionValue(value: IssueSearchInput["sortDirection"]): IssueSearchInput["sortDirection"] {
  return normalizeRepositorySearchSortDirection(value) || normalizeJiraSearchSortDirection(value);
}

function normalizeJiraSearchSortField(value?: IssueSearchInput["sortField"]): JiraIssueSearchSortField | undefined {
  if (value === "updated" || value === "created" || value === "priority" || value === "status" || value === "assignee" || value === "reporter") {
    return value;
  }
  return undefined;
}

function normalizeJiraSearchSortDirection(value?: IssueSearchInput["sortDirection"]): JiraIssueSearchSortDirection | undefined {
  return value === "asc" ? "asc" : value === "desc" ? "desc" : undefined;
}

function normalizeRepositorySearchSortField(value?: IssueSearchInput["sortField"]): RepositoryIssueSearchSortField | undefined {
  if (value === "updated" || value === "created" || value === "comments") {
    return value;
  }
  return undefined;
}

function normalizeRepositorySearchSortDirection(value?: IssueSearchInput["sortDirection"]): RepositoryIssueSearchSortDirection | undefined {
  return value === "asc" ? "asc" : value === "desc" ? "desc" : undefined;
}

function jiraHostDomain(host: string): string {
  const normalized = normalizeJiraHost(host);
  if (!normalized) {
    return "";
  }
  try {
    return new URL(normalized).host.toLowerCase();
  } catch {
    return normalized.replace(/^https?:\/\//i, "").replace(/\/+$/, "").toLowerCase();
  }
}

function normalizeJiraHost(host: string): string {
  return host.trim().replace(/\/+$/, "");
}

function repositoryIssueUrl(target: ResolvedIssueTarget, issueNumber: number): string {
  const host = target.hostDomain.replace(/\/+$/, "");
  if (target.provider === "gitlab") {
    return `https://${host}/${target.repository}/-/issues/${issueNumber}`;
  }
  return `https://${host}/${target.repository}/issues/${issueNumber}`;
}

export function normalizeIssuePromptContextInputs(issues: IssuePromptContextInput[]): IssuePromptContextInput[] {
  const seen = new Set<string>();
  const normalized: IssuePromptContextInput[] = [];
  for (const issue of issues) {
    const hostDomain = issue.hostDomain.trim().toLowerCase();
    const repository = issue.repository.trim().replace(/^\/+|\/+$/g, "");
    if (typeof issue.issueNumber !== "number") {
      continue;
    }
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
    projectKey: input.projectKey,
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

export function clampLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit)) {
    return 30;
  }
  return Math.max(1, Math.min(100, Math.trunc(limit as number)));
}

function mapGitHubSortField(sortField?: RepositoryIssueSearchInput["sortField"]): "comments" | "created" | "updated" {
  if (sortField === "comments" || sortField === "created" || sortField === "updated") {
    return sortField;
  }
  return "updated";
}

function mapGitLabSortField(sortField?: RepositoryIssueSearchInput["sortField"]): "created_at" | "updated_at" | "popularity" {
  if (sortField === "created") {
    return "created_at";
  }
  if (sortField === "comments") {
    return "popularity";
  }
  return "updated_at";
}

function quoteSearchValue(value: string): string {
  const trimmed = value.trim();
  return /\s/.test(trimmed) ? `"${trimmed.replace(/"/g, "")}"` : trimmed;
}

function githubApiBaseUrl(hostDomain: string): string {
  const normalizedHost = hostDomain.trim().toLowerCase().replace(/\/+$/, "");
  return normalizedHost && normalizedHost !== "github.com"
    ? `https://${normalizedHost}/api/v3`
    : "https://api.github.com";
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
