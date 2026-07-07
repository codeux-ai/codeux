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
import * as notionApiClient from "./notion-api-client.js";
import * as asanaApiClient from "./asana-api-client.js";
import * as linearApiClient from "./linear-api-client.js";
import * as miroApiClient from "./miro-api-client.js";
import * as lucidApiClient from "./lucid-api-client.js";
import * as figmaApiClient from "./figma-api-client.js";
import * as muralApiClient from "./mural-api-client.js";

export interface IssueSearchInput {
  provider?: LinkedIssueProvider;
  repository?: string;
  hostDomain?: string;
  workspaceId?: string;
  projectId?: string;
  providerProjectId?: string;
  teamId?: string;
  teamKey?: string;
  databaseId?: string;
  boardId?: string;
  documentId?: string;
  fileKey?: string;
  muralId?: string;
  itemTypes?: string[];
  projectKey?: string;
  search?: string;
  state?: RepositoryIssueSearchInput["state"] | string;
  status?: JiraIssueSearchInput["status"] | string;
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
  externalIds?: string[];
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
  notionApiClient?: typeof notionApiClient;
  asanaApiClient?: typeof asanaApiClient;
  linearApiClient?: typeof linearApiClient;
  miroApiClient?: typeof miroApiClient;
  lucidApiClient?: typeof lucidApiClient;
  figmaApiClient?: typeof figmaApiClient;
  muralApiClient?: typeof muralApiClient;
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

    if (provider === "notion") {
      return this.searchNotionSources(searchInput, settings, limit);
    }

    if (provider === "asana") {
      return this.searchAsanaTasks(searchInput, settings, limit);
    }

    if (provider === "linear") {
      return this.searchLinearIssues(searchInput, settings, limit);
    }

    if (provider === "miro") {
      return this.searchMiroSources(searchInput, settings, limit);
    }

    if (provider === "lucid") {
      return this.searchLucidDocuments(searchInput, settings, limit);
    }

    if (provider === "figma") {
      return this.searchFigmaFiles(searchInput, settings, limit);
    }

    if (provider === "mural") {
      return this.searchMuralSources(searchInput, settings, limit);
    }

    const target = resolveIssueTarget(project, searchInput, provider);
    if (target.provider === "github") {
      return this.searchGitHubIssues({
        ...target,
        token: settings.git.githubToken,
        search: searchInput.search,
        state: normalizeRepositoryIssueStateValue(searchInput.state) || "open",
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
      state: normalizeRepositoryIssueStateValue(searchInput.state) || "open",
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
      } else if (issue.provider === "notion") {
        contexts.push(await this.getNotionPromptContext(issue, settings));
      } else if (issue.provider === "asana") {
        contexts.push(await this.getAsanaPromptContext(issue, settings));
      } else if (issue.provider === "linear") {
        contexts.push(await this.getLinearPromptContext(issue, settings));
      } else if (issue.provider === "miro") {
        contexts.push(await this.getMiroPromptContext(issue, settings));
      } else if (issue.provider === "lucid") {
        contexts.push(await this.getLucidPromptContext(issue, settings));
      } else if (issue.provider === "figma") {
        contexts.push(await this.getFigmaPromptContext(issue, settings));
      } else if (issue.provider === "mural") {
        contexts.push(await this.getMuralPromptContext(issue, settings));
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
      status: normalizeJiraIssueStatusValue(input.status),
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

  private async searchNotionSources(
    input: IssueSearchInput,
    settings: DashboardSettings,
    limit: number,
  ): Promise<RepositoryIssueSearchResult[]> {
    const token = settings.notion.apiToken.trim();
    if (!token) {
      throw new Error("Notion API token must be configured in Settings -> Integrations.");
    }
    const client = this.deps.notionApiClient ?? notionApiClient;
    const externalIds = input.externalIds || [];
    const items = externalIds.length > 0
      ? await client.getObjects(token, externalIds, limit)
      : await client.searchObjects(token, {
        search: input.search,
        databaseId: input.databaseId || settings.notion.databaseId || undefined,
        limit: effectiveImporterLimit(limit, settings.notion.defaultSearchLimit),
      });
    return items.map((item) => normalizeNotionItem(item));
  }

  private async searchAsanaTasks(
    input: IssueSearchInput,
    settings: DashboardSettings,
    limit: number,
  ): Promise<RepositoryIssueSearchResult[]> {
    const token = settings.asana.apiToken.trim();
    if (!token) {
      throw new Error("Asana API token must be configured in Settings -> Integrations.");
    }
    const workspaceId = input.workspaceId || settings.asana.workspaceId || undefined;
    const providerProjectId = input.providerProjectId || settings.asana.projectId || undefined;
    if (!workspaceId && !providerProjectId && !(input.externalIds && input.externalIds.length > 0)) {
      throw new Error("Asana workspace ID or project ID must be configured in Settings -> Integrations.");
    }
    const client = this.deps.asanaApiClient ?? asanaApiClient;
    const items = await client.searchTasks(token, {
      workspaceId,
      projectId: providerProjectId,
      search: input.search,
      status: input.status,
      labels: input.labels || [],
      assignee: input.assignee,
      externalIds: input.externalIds,
      includeConversation: input.includeConversation === true,
      limit: effectiveImporterLimit(limit, settings.asana.defaultSearchLimit),
    });
    return items.map((item) => normalizeAsanaTask(item));
  }

  private async searchLinearIssues(
    input: IssueSearchInput,
    settings: DashboardSettings,
    limit: number,
  ): Promise<RepositoryIssueSearchResult[]> {
    const token = settings.linear.apiToken.trim();
    if (!token) {
      throw new Error("Linear API token must be configured in Settings -> Integrations.");
    }
    const client = this.deps.linearApiClient ?? linearApiClient;
    const items = input.externalIds && input.externalIds.length > 0
      ? await client.getIssues(token, input.externalIds, {
        includeConversation: input.includeConversation !== false,
        limit: effectiveImporterLimit(limit, settings.linear.defaultSearchLimit),
      })
      : await client.searchIssues(token, {
        search: input.search,
        status: input.status,
        state: input.state,
        labels: input.labels || [],
        assignee: input.assignee,
        teamId: input.teamId || settings.linear.teamId || undefined,
        teamKey: input.teamKey || settings.linear.teamKey || undefined,
        projectId: input.providerProjectId || settings.linear.projectId || undefined,
        includeConversation: input.includeConversation === true,
        limit: effectiveImporterLimit(limit, settings.linear.defaultSearchLimit),
      });
    return items.map((item) => normalizeLinearIssue(item));
  }

  private async searchMiroSources(
    input: IssueSearchInput,
    settings: DashboardSettings,
    limit: number,
  ): Promise<RepositoryIssueSearchResult[]> {
    const token = settings.miro.apiToken.trim();
    if (!token) {
      throw new Error("Miro API token must be configured in Settings -> Integrations.");
    }
    const boardId = input.boardId || settings.miro.boardId || undefined;
    if (!boardId && !input.search) {
      throw new Error("Miro board ID or search query must be configured in Settings -> Integrations.");
    }
    const client = this.deps.miroApiClient ?? miroApiClient;
    const items = await client.searchBoards(token, {
      boardId,
      search: input.search,
      itemTypes: input.itemTypes || [],
      externalIds: input.externalIds,
      limit: effectiveImporterLimit(limit, settings.miro.defaultSearchLimit),
      baseUrl: settings.miro.baseUrl || undefined,
    });
    return items.map((item) => normalizeMiroItem(item));
  }

  private async searchLucidDocuments(
    input: IssueSearchInput,
    settings: DashboardSettings,
    limit: number,
  ): Promise<RepositoryIssueSearchResult[]> {
    const token = settings.lucid.apiToken.trim();
    if (!token) {
      throw new Error("Lucid API token must be configured in Settings -> Integrations.");
    }
    const documentId = input.documentId || settings.lucid.documentId || undefined;
    if (!documentId && !input.search && !(input.externalIds && input.externalIds.length > 0)) {
      throw new Error("Lucid document ID or search query must be configured in Settings -> Integrations.");
    }
    const client = this.deps.lucidApiClient ?? lucidApiClient;
    const items = await client.searchDocuments(token, {
      documentId,
      search: input.search,
      externalIds: input.externalIds,
      limit: effectiveImporterLimit(limit, settings.lucid.defaultSearchLimit),
      baseUrl: settings.lucid.baseUrl || undefined,
    });
    return items.map((item) => normalizeLucidDocument(item));
  }

  private async searchFigmaFiles(
    input: IssueSearchInput,
    settings: DashboardSettings,
    limit: number,
  ): Promise<RepositoryIssueSearchResult[]> {
    const token = settings.figma.apiToken.trim();
    if (!token) {
      throw new Error("Figma API token must be configured in Settings -> Integrations.");
    }
    const fileKey = input.fileKey || settings.figma.fileKey || undefined;
    if (!fileKey && !(input.externalIds && input.externalIds.length > 0)) {
      throw new Error("Figma file key must be configured in Settings -> Integrations.");
    }
    const client = this.deps.figmaApiClient ?? figmaApiClient;
    const items = await client.getFiles(token, {
      fileKey,
      externalIds: input.externalIds,
      includeConversation: input.includeConversation === true,
      limit: effectiveImporterLimit(limit, settings.figma.defaultSearchLimit),
      baseUrl: settings.figma.baseUrl || undefined,
    });
    return items.map((item) => normalizeFigmaFile(item));
  }

  private async searchMuralSources(
    input: IssueSearchInput,
    settings: DashboardSettings,
    limit: number,
  ): Promise<RepositoryIssueSearchResult[]> {
    const token = settings.mural.apiToken.trim();
    if (!token) {
      throw new Error("Mural API token must be configured in Settings -> Integrations.");
    }
    const workspaceId = input.workspaceId || settings.mural.workspaceId || undefined;
    const muralId = input.muralId || settings.mural.boardId || undefined;
    if (!workspaceId && !muralId && !(input.externalIds && input.externalIds.length > 0)) {
      throw new Error("Mural workspace ID or mural ID must be configured in Settings -> Integrations.");
    }
    const client = this.deps.muralApiClient ?? muralApiClient;
    const items = await client.searchMurals(token, {
      workspaceId,
      muralId,
      search: input.search,
      externalIds: input.externalIds,
      limit: effectiveImporterLimit(limit, settings.mural.defaultSearchLimit),
      baseUrl: settings.mural.baseUrl || undefined,
    });
    return items.map((item) => normalizeMuralItem(item));
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

  private async getNotionPromptContext(input: IssuePromptContextInput, settings: DashboardSettings): Promise<IssuePromptContext> {
    const token = settings.notion.apiToken.trim();
    if (!token) {
      throw new Error("Notion API token must be configured in Settings -> Integrations.");
    }
    const externalId = requireExternalPromptId(input, "Notion");
    const client = this.deps.notionApiClient ?? notionApiClient;
    const item = (await client.getObjects(token, [externalId], 1))[0];
    if (!item) {
      throw new Error(`Notion source not found: ${externalId}`);
    }
    return buildIssuePromptContext(input, {
      title: item.title,
      url: item.url,
      state: item.archived ? "archived" : "open",
      body: item.bodyMarkdown,
      author: null,
      createdAt: item.createdTime,
      updatedAt: item.lastEditedTime,
      labels: [item.object],
      assignees: [],
      conversationMarkdown: "",
      includeConversation: false,
    });
  }

  private async getAsanaPromptContext(input: IssuePromptContextInput, settings: DashboardSettings): Promise<IssuePromptContext> {
    const token = settings.asana.apiToken.trim();
    if (!token) {
      throw new Error("Asana API token must be configured in Settings -> Integrations.");
    }
    const externalId = requireExternalPromptId(input, "Asana");
    const client = this.deps.asanaApiClient ?? asanaApiClient;
    const item = (await client.getTasks(token, [externalId], {
      includeConversation: input.includeConversation !== false,
      limit: 1,
    }))[0];
    if (!item) {
      throw new Error(`Asana task not found: ${externalId}`);
    }
    return buildIssuePromptContext(input, {
      title: item.title,
      url: item.url,
      state: item.state,
      body: item.bodyMarkdown,
      author: item.issueAuthor,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      labels: item.labels,
      assignees: item.assignees,
      conversationMarkdown: item.conversationMarkdown,
      includeConversation: input.includeConversation !== false,
    });
  }

  private async getLinearPromptContext(input: IssuePromptContextInput, settings: DashboardSettings): Promise<IssuePromptContext> {
    const token = settings.linear.apiToken.trim();
    if (!token) {
      throw new Error("Linear API token must be configured in Settings -> Integrations.");
    }
    const externalId = requireExternalPromptId(input, "Linear");
    const client = this.deps.linearApiClient ?? linearApiClient;
    const item = (await client.getIssues(token, [externalId], {
      includeConversation: input.includeConversation !== false,
      limit: 1,
    }))[0];
    if (!item) {
      throw new Error(`Linear issue not found: ${externalId}`);
    }
    return buildIssuePromptContext(input, {
      title: item.title,
      url: item.url,
      state: item.state,
      body: item.bodyMarkdown,
      author: item.issueAuthor,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      labels: item.labels,
      assignees: item.assignees,
      conversationMarkdown: item.conversationMarkdown,
      includeConversation: input.includeConversation !== false,
    });
  }

  private async getMiroPromptContext(input: IssuePromptContextInput, settings: DashboardSettings): Promise<IssuePromptContext> {
    const token = settings.miro.apiToken.trim();
    if (!token) {
      throw new Error("Miro API token must be configured in Settings -> Integrations.");
    }
    const boardId = input.repository || settings.miro.boardId;
    if (!boardId.trim()) {
      throw new Error("Miro board ID is required for prompt context.");
    }
    const externalId = requireExternalPromptId(input, "Miro");
    const client = this.deps.miroApiClient ?? miroApiClient;
    const items = await client.getBoardItems(token, boardId, {
      externalIds: input.sourceKind === "board" ? [] : [externalId],
      limit: input.sourceKind === "board" ? 50 : 1,
      baseUrl: settings.miro.baseUrl || undefined,
    });
    const item = input.sourceKind === "board"
      ? items.find((candidate) => candidate.id === boardId) || items[0]
      : items[0];
    if (!item) {
      throw new Error(`Miro source not found: ${externalId}`);
    }
    const boardBody = input.sourceKind === "board"
      ? formatCanvasItemListMarkdown(items.filter((candidate) => candidate.id !== boardId))
      : item.bodyMarkdown;
    return buildIssuePromptContext(input, {
      title: item.title,
      url: item.url,
      state: "open",
      body: boardBody,
      author: null,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      labels: [item.type],
      assignees: [],
      conversationMarkdown: "",
      includeConversation: false,
    });
  }

  private async getLucidPromptContext(input: IssuePromptContextInput, settings: DashboardSettings): Promise<IssuePromptContext> {
    const token = settings.lucid.apiToken.trim();
    if (!token) {
      throw new Error("Lucid API token must be configured in Settings -> Integrations.");
    }
    const externalId = requireExternalPromptId(input, "Lucid");
    const client = this.deps.lucidApiClient ?? lucidApiClient;
    const item = (await client.getDocuments(token, [externalId], {
      limit: 1,
      baseUrl: settings.lucid.baseUrl || undefined,
    }))[0];
    if (!item) {
      throw new Error(`Lucid document not found: ${externalId}`);
    }
    return buildIssuePromptContext(input, {
      title: item.title,
      url: item.url,
      state: "open",
      body: item.bodyMarkdown,
      author: null,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      labels: ["document"],
      assignees: [],
      conversationMarkdown: "",
      includeConversation: false,
    });
  }

  private async getFigmaPromptContext(input: IssuePromptContextInput, settings: DashboardSettings): Promise<IssuePromptContext> {
    const token = settings.figma.apiToken.trim();
    if (!token) {
      throw new Error("Figma API token must be configured in Settings -> Integrations.");
    }
    const externalId = requireExternalPromptId(input, "Figma");
    const client = this.deps.figmaApiClient ?? figmaApiClient;
    const item = await client.getFile(token, externalId, {
      includeConversation: input.includeConversation !== false,
      limit: 1,
      baseUrl: settings.figma.baseUrl || undefined,
    });
    return buildIssuePromptContext(input, {
      title: item.title,
      url: item.url,
      state: "open",
      body: item.bodyMarkdown,
      author: null,
      createdAt: null,
      updatedAt: item.updatedAt,
      labels: ["file"],
      assignees: [],
      conversationMarkdown: item.conversationMarkdown,
      includeConversation: input.includeConversation !== false,
    });
  }

  private async getMuralPromptContext(input: IssuePromptContextInput, settings: DashboardSettings): Promise<IssuePromptContext> {
    const token = settings.mural.apiToken.trim();
    if (!token) {
      throw new Error("Mural API token must be configured in Settings -> Integrations.");
    }
    const externalId = requireExternalPromptId(input, "Mural");
    const client = this.deps.muralApiClient ?? muralApiClient;
    const item = (await client.getMurals(token, [externalId], {
      workspaceId: input.repository !== "murals" ? input.repository : settings.mural.workspaceId || undefined,
      limit: 1,
      baseUrl: settings.mural.baseUrl || undefined,
    }))[0];
    if (!item) {
      throw new Error(`Mural source not found: ${externalId}`);
    }
    return buildIssuePromptContext(input, {
      title: item.title,
      url: item.url,
      state: "open",
      body: item.bodyMarkdown,
      author: null,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      labels: ["mural", "beta-limited"],
      assignees: [],
      conversationMarkdown: "",
      includeConversation: false,
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
  if (provider === "local" || !isIssueImportProvider(provider)) {
    throw new Error("Select a GitHub, GitLab, Jira, Notion, Asana, Linear, Miro, Lucid, Figma, or Mural provider before importing issues.");
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
  if (repositoryProvider) {
    const target = tryResolveRepositoryIssueTarget(project, input, repositoryProvider);
    if (target) {
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
    }
  }

  const externalProvider = isExternalIssueImportProvider(preferredProvider) ? preferredProvider : undefined;
  if (externalProvider) {
    const externalIds = collectExternalIds(input, externalProvider);
    for (const externalId of externalIds) {
      const sourceKind = resolveExplicitSourceKind(externalProvider, input, externalId);
      contexts.push({
        provider: externalProvider,
        sourceProvider: externalProvider,
        sourceKind,
        externalId,
        hostDomain: defaultHostForExternalProvider(externalProvider),
        repository: defaultRepositoryForExternalProvider(externalProvider, input, settings),
        issueNumber: null,
        issueKey: displayKeyForExternalProvider(externalProvider, externalId, sourceKind),
        title: displayKeyForExternalProvider(externalProvider, externalId, sourceKind),
        url: defaultExternalUrl(externalProvider, externalId),
        includeConversation: input.includeConversation !== false,
      });
    }
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

function collectExternalIds(input: IssueSearchInput, provider: LinkedIssueProvider): string[] {
  const values = [...(input.externalIds || [])];
  if (provider === "notion" && input.databaseId) {
    values.push(input.databaseId);
  }
  if (provider === "miro" && input.boardId) {
    values.push(input.boardId);
  }
  if (provider === "lucid" && input.documentId) {
    values.push(input.documentId);
  }
  if (provider === "figma" && input.fileKey) {
    values.push(input.fileKey);
  }
  if (provider === "mural" && input.muralId) {
    values.push(input.muralId);
  }
  return uniqueStrings(values);
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

function normalizeNotionItem(item: notionApiClient.NotionItem): RepositoryIssueSearchResult {
  const sourceKind = item.object === "database" ? "database" : "page";
  return {
    provider: "notion",
    sourceProvider: "notion",
    sourceKind,
    externalId: item.id,
    hostDomain: "notion.so",
    repository: sourceKind,
    issueNumber: null,
    issueKey: displayKeyForExternalProvider("notion", item.id, item.object),
    title: item.title,
    url: item.url,
    state: item.archived ? "archived" : "open",
    labels: [item.object],
    assignees: [],
    bodyPreview: truncatePreview(item.bodyMarkdown),
    issueBodyMarkdown: item.bodyMarkdown,
    createdAt: item.createdTime,
    updatedAt: item.lastEditedTime,
    issueAuthor: null,
    issueReporter: null,
    issueMilestone: null,
    issueType: item.object,
    issuePriority: null,
    issueCommentCount: null,
    metadata: item.metadata,
  };
}

function normalizeAsanaTask(item: asanaApiClient.AsanaTaskItem): RepositoryIssueSearchResult {
  return {
    provider: "asana",
    sourceProvider: "asana",
    sourceKind: "task",
    externalId: item.gid,
    hostDomain: "app.asana.com",
    repository: "tasks",
    issueNumber: null,
    issueKey: displayKeyForExternalProvider("asana", item.gid),
    title: item.title,
    url: item.url,
    state: item.state,
    labels: item.labels,
    assignees: item.assignees,
    bodyPreview: truncatePreview(item.bodyMarkdown),
    issueBodyMarkdown: item.bodyMarkdown,
    issueConversationMarkdown: item.conversationMarkdown,
    includeConversation: item.conversationMarkdown.trim().length > 0,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    issueAuthor: item.issueAuthor,
    issueReporter: item.issueAuthor,
    issueMilestone: null,
    issueType: "Task",
    issuePriority: null,
    issueCommentCount: item.conversationMarkdown ? item.conversationMarkdown.split("##### Comment ").length - 1 : 0,
    metadata: item.metadata,
  };
}

function normalizeLinearIssue(item: linearApiClient.LinearIssueItem): RepositoryIssueSearchResult {
  return {
    provider: "linear",
    sourceProvider: "linear",
    sourceKind: "issue",
    externalId: item.id,
    hostDomain: "linear.app",
    repository: item.teamKey || "issues",
    projectKey: item.teamKey || undefined,
    issueNumber: null,
    issueKey: item.identifier,
    title: item.title,
    url: item.url,
    state: item.state,
    labels: item.labels,
    assignees: item.assignees,
    bodyPreview: truncatePreview(item.bodyMarkdown),
    issueBodyMarkdown: item.bodyMarkdown,
    issueConversationMarkdown: item.conversationMarkdown,
    includeConversation: item.conversationMarkdown.trim().length > 0,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    issueAuthor: item.issueAuthor,
    issueReporter: item.issueAuthor,
    issueMilestone: item.projectName,
    issueType: "Issue",
    issuePriority: null,
    issueCommentCount: item.conversationMarkdown ? item.conversationMarkdown.split("##### Comment ").length - 1 : 0,
    metadata: item.metadata,
  };
}

function normalizeMiroItem(item: miroApiClient.MiroCanvasItem): RepositoryIssueSearchResult {
  const sourceKind = item.type === "board" ? "board" : "canvas";
  return {
    provider: "miro",
    sourceProvider: "miro",
    sourceKind,
    externalId: item.id,
    hostDomain: "miro.com",
    repository: item.boardId,
    issueNumber: null,
    issueKey: displayKeyForExternalProvider("miro", item.id, sourceKind),
    title: item.title,
    url: item.url,
    state: "open",
    labels: [item.type],
    assignees: [],
    bodyPreview: truncatePreview(item.bodyMarkdown),
    issueBodyMarkdown: item.bodyMarkdown,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    issueAuthor: null,
    issueReporter: null,
    issueMilestone: null,
    issueType: item.type,
    issuePriority: null,
    issueCommentCount: null,
    metadata: item.metadata,
  };
}

function normalizeLucidDocument(item: lucidApiClient.LucidDocumentItem): RepositoryIssueSearchResult {
  return {
    provider: "lucid",
    sourceProvider: "lucid",
    sourceKind: "document",
    externalId: item.id,
    hostDomain: "lucid.app",
    repository: "documents",
    issueNumber: null,
    issueKey: displayKeyForExternalProvider("lucid", item.id),
    title: item.title,
    url: item.url,
    state: "open",
    labels: ["document"],
    assignees: [],
    bodyPreview: truncatePreview(item.bodyMarkdown),
    issueBodyMarkdown: item.bodyMarkdown,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    issueAuthor: null,
    issueReporter: null,
    issueMilestone: null,
    issueType: "Document",
    issuePriority: null,
    issueCommentCount: null,
    metadata: item.metadata,
  };
}

function normalizeFigmaFile(item: figmaApiClient.FigmaFileItem): RepositoryIssueSearchResult {
  return {
    provider: "figma",
    sourceProvider: "figma",
    sourceKind: "file",
    externalId: item.key,
    hostDomain: "figma.com",
    repository: "files",
    issueNumber: null,
    issueKey: displayKeyForExternalProvider("figma", item.key),
    title: item.title,
    url: item.url,
    state: "open",
    labels: ["file"],
    assignees: [],
    bodyPreview: truncatePreview(item.bodyMarkdown),
    issueBodyMarkdown: item.bodyMarkdown,
    issueConversationMarkdown: item.conversationMarkdown,
    includeConversation: item.conversationMarkdown.trim().length > 0,
    createdAt: null,
    updatedAt: item.updatedAt,
    issueAuthor: null,
    issueReporter: null,
    issueMilestone: null,
    issueType: "File",
    issuePriority: null,
    issueCommentCount: item.conversationMarkdown ? item.conversationMarkdown.split("##### Comment ").length - 1 : 0,
    metadata: item.metadata,
  };
}

function normalizeMuralItem(item: muralApiClient.MuralItem): RepositoryIssueSearchResult {
  return {
    provider: "mural",
    sourceProvider: "mural",
    sourceKind: "canvas",
    externalId: item.id,
    hostDomain: "app.mural.co",
    repository: item.workspaceId || "murals",
    issueNumber: null,
    issueKey: displayKeyForExternalProvider("mural", item.id),
    title: item.title,
    url: item.url,
    state: "open",
    labels: ["mural", "beta-limited"],
    assignees: [],
    bodyPreview: truncatePreview(item.bodyMarkdown),
    issueBodyMarkdown: item.bodyMarkdown,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    issueAuthor: null,
    issueReporter: null,
    issueMilestone: null,
    issueType: "Mural",
    issuePriority: null,
    issueCommentCount: null,
    metadata: item.metadata,
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
    workspaceId: normalizeOptionalString(input.workspaceId),
    projectId: normalizeOptionalString(input.projectId),
    providerProjectId: normalizeOptionalString(input.providerProjectId || input.projectId),
    teamId: normalizeOptionalString(input.teamId),
    teamKey: normalizeOptionalString(input.teamKey),
    databaseId: normalizeOptionalString(input.databaseId),
    boardId: normalizeOptionalString(input.boardId),
    documentId: normalizeOptionalString(input.documentId),
    fileKey: normalizeOptionalString(input.fileKey),
    muralId: normalizeOptionalString(input.muralId),
    itemTypes: normalizeStringList(input.itemTypes),
    projectKey: normalizeOptionalString(input.projectKey),
    search: normalizeOptionalString(input.search),
    state: normalizeIssueStateValue(input.state),
    status: normalizeIssueStatusValue(input.status),
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
    externalIds: normalizeStringList(input.externalIds),
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
  return value && isIssueImportProvider(value) ? value : undefined;
}

function normalizeIssueStateValue(value: IssueSearchInput["state"]): IssueSearchInput["state"] {
  const trimmed = normalizeOptionalString(value);
  return trimmed;
}

function normalizeRepositoryIssueStateValue(value: IssueSearchInput["state"]): RepositoryIssueSearchInput["state"] {
  return value === "open" || value === "closed" || value === "all" ? value : undefined;
}

function normalizeIssueStatusValue(value: IssueSearchInput["status"]): IssueSearchInput["status"] {
  return normalizeOptionalString(value);
}

function normalizeJiraIssueStatusValue(value: IssueSearchInput["status"]): JiraIssueSearchInput["status"] {
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
    const issueNumber = typeof issue.issueNumber === "number" ? Math.trunc(issue.issueNumber) : null;
    const externalId = issue.externalId?.trim() || null;
    const title = issue.title.trim();
    const url = issue.url.trim();
    if (!isIssueImportProvider(issue.provider) || !hostDomain || !repository || !title || !url) {
      continue;
    }
    const isNumericProvider = issue.provider === "github" || issue.provider === "gitlab" || issue.provider === "jira";
    if (isNumericProvider && (!Number.isFinite(issueNumber) || issueNumber === null || issueNumber < 1)) {
      continue;
    }
    if (!isNumericProvider && !externalId) {
      continue;
    }
    const keyValue = isNumericProvider ? `number:${issueNumber}` : `external:${externalId}`;
    const key = `${issue.provider}:${hostDomain}:${repository}:${keyValue}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    normalized.push({
      ...issue,
      hostDomain,
      repository,
      sourceProvider: issue.sourceProvider || issue.provider,
      sourceKind: issue.sourceKind || defaultSourceKindForProvider(issue.provider),
      externalId: externalId ?? undefined,
      issueNumber: issueNumber ?? undefined,
      issueKey: issue.issueKey?.trim() || (isNumericProvider ? `${issue.provider === "github" ? "#" : issue.provider === "gitlab" ? "!" : ""}${issueNumber}` : displayKeyForExternalProvider(issue.provider, externalId || title)),
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
    sourceProvider: input.sourceProvider || input.provider,
    sourceKind: input.sourceKind || defaultSourceKindForProvider(input.provider),
    externalId: input.externalId,
    hostDomain: input.hostDomain,
    projectKey: input.projectKey,
    repository: input.repository,
    issueNumber: input.issueNumber,
    issueKey: input.issueKey || (typeof input.issueNumber === "number" ? `${input.provider === "github" ? "#" : input.provider === "gitlab" ? "!" : ""}${input.issueNumber}` : displayKeyForExternalProvider(input.provider, input.externalId || input.title)),
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

function isIssueImportProvider(provider: LinkedIssueProvider | undefined): provider is LinkedIssueProvider {
  return provider === "github"
    || provider === "gitlab"
    || provider === "jira"
    || provider === "notion"
    || provider === "asana"
    || provider === "linear"
    || provider === "miro"
    || provider === "lucid"
    || provider === "figma"
    || provider === "mural";
}

function isExternalIssueImportProvider(provider: LinkedIssueProvider | undefined): provider is Exclude<LinkedIssueProvider, "github" | "gitlab" | "jira"> {
  return provider === "notion"
    || provider === "asana"
    || provider === "linear"
    || provider === "miro"
    || provider === "lucid"
    || provider === "figma"
    || provider === "mural";
}

function defaultSourceKindForProvider(provider: LinkedIssueProvider): NonNullable<SprintLinkedIssueInput["sourceKind"]> {
  if (provider === "asana") return "task";
  if (provider === "notion") return "page";
  if (provider === "miro") return "board";
  if (provider === "lucid") return "document";
  if (provider === "figma") return "file";
  if (provider === "mural") return "canvas";
  return "issue";
}

function defaultHostForExternalProvider(provider: Exclude<LinkedIssueProvider, "github" | "gitlab" | "jira">): string {
  if (provider === "notion") return "notion.so";
  if (provider === "asana") return "app.asana.com";
  if (provider === "linear") return "linear.app";
  if (provider === "miro") return "miro.com";
  if (provider === "lucid") return "lucid.app";
  if (provider === "figma") return "figma.com";
  return "app.mural.co";
}

function defaultRepositoryForExternalProvider(
  provider: Exclude<LinkedIssueProvider, "github" | "gitlab" | "jira">,
  input: IssueSearchInput,
  settings: DashboardSettings,
): string {
  if (provider === "notion") return input.databaseId || settings.notion.databaseId || "workspace";
  if (provider === "asana") return input.providerProjectId || input.projectId || settings.asana.projectId || input.workspaceId || settings.asana.workspaceId || "tasks";
  if (provider === "linear") return input.teamKey || settings.linear.teamKey || input.teamId || settings.linear.teamId || "issues";
  if (provider === "miro") return input.boardId || settings.miro.boardId || "boards";
  if (provider === "lucid") return "documents";
  if (provider === "figma") return "files";
  return input.workspaceId || settings.mural.workspaceId || "murals";
}

function displayKeyForExternalProvider(provider: LinkedIssueProvider, externalId: string, sourceKind?: string): string {
  if (provider === "notion") {
    return `${sourceKind === "database" ? "database" : "page"}:${shortExternalId(externalId)}`;
  }
  if (provider === "asana") {
    return `task:${shortExternalId(externalId)}`;
  }
  if (provider === "linear") {
    return externalId.includes("-") && /^[A-Z]+-\d+$/i.test(externalId) ? externalId.toUpperCase() : `issue:${shortExternalId(externalId)}`;
  }
  if (provider === "miro") {
    return `${sourceKind === "board" ? "board" : "item"}:${shortExternalId(externalId)}`;
  }
  if (provider === "lucid") {
    return `document:${shortExternalId(externalId)}`;
  }
  if (provider === "figma") {
    return `file:${shortExternalId(externalId)}`;
  }
  if (provider === "mural") {
    return `mural:${shortExternalId(externalId)}`;
  }
  return externalId;
}

function defaultExternalUrl(provider: Exclude<LinkedIssueProvider, "github" | "gitlab" | "jira">, externalId: string): string {
  if (provider === "notion") return `https://www.notion.so/${externalId.replace(/-/g, "")}`;
  if (provider === "asana") return `https://app.asana.com/0/0/${externalId}`;
  if (provider === "linear") return `https://linear.app/issue/${externalId}`;
  if (provider === "miro") return `https://miro.com/app/board/${externalId}/`;
  if (provider === "lucid") return `https://lucid.app/documents#/documents/${externalId}`;
  if (provider === "figma") return `https://www.figma.com/file/${externalId}`;
  return `https://app.mural.co/mural/${externalId}`;
}

function resolveExplicitSourceKind(
  provider: Exclude<LinkedIssueProvider, "github" | "gitlab" | "jira">,
  input: IssueSearchInput,
  externalId: string,
): NonNullable<SprintLinkedIssueInput["sourceKind"]> {
  if (provider === "notion" && input.databaseId === externalId) return "database";
  if (provider === "miro" && input.boardId === externalId) return "board";
  if (provider === "mural") return "canvas";
  return defaultSourceKindForProvider(provider);
}

function shortExternalId(externalId: string): string {
  return externalId.length > 12 ? externalId.slice(0, 12) : externalId;
}

function effectiveImporterLimit(requestLimit: number, defaultLimit: number): number {
  if (Number.isFinite(requestLimit)) {
    return requestLimit;
  }
  return Math.max(1, Math.min(100, Math.trunc(defaultLimit)));
}

function requireExternalPromptId(input: IssuePromptContextInput, providerName: string): string {
  const externalId = input.externalId?.trim();
  if (!externalId) {
    throw new Error(`${providerName} externalId is required for prompt context.`);
  }
  return externalId;
}

function formatCanvasItemListMarkdown(items: miroApiClient.MiroCanvasItem[]): string {
  return items
    .filter((item) => item.title.trim() || item.bodyMarkdown.trim())
    .slice(0, 50)
    .map((item) => {
      const body = item.bodyMarkdown.trim();
      return `- ${item.title || item.id}${item.type ? ` (${item.type})` : ""}${body ? `: ${body}` : ""}`;
    })
    .join("\n")
    .trim();
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
