import type { Express } from "express";
import type { DashboardDependencies } from "./dashboard-server.js";
import { asyncRoute, toErrorResponse, syncRoute } from "./route-utils.js";
import { parseCreateSprintInput, parseTrimmedString, parseUpdateSprintInput, requireTrimmedString, parseSprintImportedTaskInput } from "./request-parsers.js";
import type {
  IssuePromptContextInput,
  JiraIssueSearchInput,
  SprintLinkedIssueInput,
  SprintMarkdownImportInput,
  RepositoryIssueSearchInput,
  JiraIssueSearchAssignee,
  JiraIssueSearchSortDirection,
  JiraIssueSearchSortField,
  JiraIssueSearchStatus,
  RepositoryIssueSearchSortDirection,
  RepositoryIssueSearchSortField,
  RepositoryIssueSearchState,
} from "../contracts/project-management-types.js";
import type { SprintSettingsOverride } from "../contracts/settings-scope-types.js";
import type { IssueSearchInput } from "../services/sprint-issue-service.js";

export function registerSprintRoutes(router: Express, deps: DashboardDependencies): void {
  router.get("/api/projects/:projectId/sprints", syncRoute((req, res) => {
    try {
      res.json(deps.listSprints(requireTrimmedString(req.params.projectId, "projectId")));
    } catch (error) {
      res.status(400).json(toErrorResponse(error, "Failed to list sprints"));
    }
  }));

  router.get("/api/projects/:projectId/sprints/:sprintId/rollback/assessment", asyncRoute(async (req, res) => {
    try {
      res.json(await deps.assessSprintRollback(
        requireTrimmedString(req.params.projectId, "projectId"),
        requireTrimmedString(req.params.sprintId, "sprintId"),
      ));
    } catch (error) {
      res.status(400).json(toErrorResponse(error, "Failed to assess sprint rollback"));
    }
  }));

  router.post("/api/projects/:projectId/sprints/:sprintId/rollback", asyncRoute(async (req, res) => {
    try {
      if (
        req.body?.instructions !== undefined
        && req.body.instructions !== null
        && typeof req.body.instructions !== "string"
      ) {
        throw new Error("Invalid field: instructions must be a string.");
      }
      const instructions = parseTrimmedString(req.body?.instructions);
      res.status(202).json(await deps.createSprintRollback(
        requireTrimmedString(req.params.projectId, "projectId"),
        requireTrimmedString(req.params.sprintId, "sprintId"),
        { instructions },
      ));
    } catch (error) {
      res.status(400).json(toErrorResponse(error, "Failed to create sprint rollback"));
    }
  }));

  router.get("/api/projects/:projectId/jira/search", asyncRoute(async (req, res) => {
    try {
      const projectId = requireTrimmedString(req.params.projectId, "projectId");
      res.json(await deps.searchJiraIssues(projectId, parseJiraIssueSearchQuery(req.query)));
    } catch (error) {
      res.status(400).json(toErrorResponse(error, "Failed to search Jira issues"));
    }
  }));

  router.get("/api/projects/:projectId/jira/statuses", asyncRoute(async (req, res) => {
    try {
      const projectId = requireTrimmedString(req.params.projectId, "projectId");
      res.json(await deps.searchJiraProjectStatuses(
        projectId,
        parseTrimmedQueryString(req.query.projectKey, "projectKey"),
      ));
    } catch (error) {
      res.status(400).json(toErrorResponse(error, "Failed to list Jira statuses"));
    }
  }));

  router.get("/api/sprints/:sprintId/linked-issues", syncRoute((req, res) => {
    try {
      res.json(deps.listSprintLinkedIssues(requireTrimmedString(req.params.sprintId, "sprintId")));
    } catch (error) {
      res.status(400).json(toErrorResponse(error, "Failed to list linked issues"));
    }
  }));

  router.put("/api/sprints/:sprintId/linked-issues", asyncRoute(async (req, res) => {
    try {
      const sprintId = requireTrimmedString(req.params.sprintId, "sprintId");
      const sprint = deps.getSprint(sprintId);
      if (!sprint) {
        res.status(404).json({ error: `Sprint not found: ${sprintId}` });
        return;
      }
      const projectId = requireTrimmedString(req.body.projectId, "projectId");
      if (sprint.projectId !== projectId) {
        res.status(400).json({ error: `Sprint ${sprintId} does not belong to project ${projectId}` });
        return;
      }
      const issues = Array.isArray(req.body.issues) ? req.body.issues as SprintLinkedIssueInput[] : [];
      if (deps.sprintIssueService) {
        res.status(201).json(await deps.sprintIssueService.importLinkedIssues(sprintId, projectId, issues));
        return;
      }
      res.status(201).json({ linkedIssues: deps.replaceSprintLinkedIssues(sprintId, projectId, issues), warnings: [] });
    } catch (error) {
      res.status(400).json(toErrorResponse(error, "Failed to update linked issues"));
    }
  }));

  router.post("/api/projects/:projectId/sprints/:sprintId/imported-tasks", syncRoute((req, res) => {
    if (!deps.createImportedTasks) {
      res.status(501).json({ error: "Imported task creation is not available." });
      return;
    }
    try {
      const projectId = requireTrimmedString(req.params.projectId, "projectId");
      const sprintId = requireTrimmedString(req.params.sprintId, "sprintId");
      const sprint = deps.getSprint(sprintId);
      if (!sprint) {
        res.status(404).json({ error: `Sprint not found: ${sprintId}` });
        return;
      }
      if (sprint.projectId !== projectId) {
        res.status(400).json({ error: `Sprint ${sprintId} does not belong to project ${projectId}` });
        return;
      }
      const importedTasks = Array.isArray(req.body?.tasks)
        ? req.body.tasks.map((task: unknown, index: number) => parseSprintImportedTaskInput(task, index))
        : [];
      res.status(201).json(deps.createImportedTasks(projectId, sprintId, importedTasks));
    } catch (error) {
      res.status(400).json(toErrorResponse(error, "Failed to add imported tasks"));
    }
  }));

  router.get("/api/projects/:projectId/issues", asyncRoute(async (req, res) => {
    if (!deps.sprintIssueService) {
      res.status(501).json({ error: "Issue import service is not available." });
      return;
    }
    try {
      res.json(await deps.sprintIssueService.searchIssues(
        requireTrimmedString(req.params.projectId, "projectId"),
        parseRepositoryIssueSearchQuery(req.query)
      ));
    } catch (error) {
      res.status(400).json(toErrorResponse(error, "Failed to search repository issues"));
    }
  }));

  router.post("/api/projects/:projectId/issues/context", asyncRoute(async (req, res) => {
    if (!deps.sprintIssueService) {
      res.status(501).json({ error: "Issue import service is not available." });
      return;
    }
    try {
      const issues = Array.isArray(req.body?.issues) ? req.body.issues : [];
      res.json(await deps.sprintIssueService.getIssuePromptContexts(
        requireTrimmedString(req.params.projectId, "projectId"),
        issues as IssuePromptContextInput[],
      ));
    } catch (error) {
      res.status(400).json(toErrorResponse(error, "Failed to load repository issue context"));
    }
  }));

  router.post("/api/projects/:projectId/sprints", syncRoute((req, res) => {
    try {
      const payload = parseCreateSprintInput(req.body);
      if (payload.showcasePinned === undefined) {
        payload.showcasePinned = true;
      }
      const projectId = requireTrimmedString(req.params.projectId, "projectId");
      const sprint = deps.createSprint(projectId, payload);
      if (payload.importedTasks?.length) {
        if (!deps.createImportedTasks) {
          res.status(501).json({ error: "Imported task creation is not available." });
          return;
        }
        deps.createImportedTasks(projectId, sprint.id, payload.importedTasks);
        res.status(201).json(deps.getSprint(sprint.id) || sprint);
        return;
      }
      res.status(201).json(sprint);
    } catch (error) {
      res.status(400).json(toErrorResponse(error, "Failed to create sprint"));
    }
  }));

  router.post("/api/projects/:projectId/sprints/import", syncRoute((req, res) => {
    try {
      res.status(201).json(
        deps.importSprintFromMarkdown(requireTrimmedString(req.params.projectId, "projectId"), req.body as SprintMarkdownImportInput)
      );
    } catch (error) {
      res.status(400).json(toErrorResponse(error, "Failed to import sprint markdown"));
    }
  }));

  router.get("/api/projects/:projectId/sprints/:sprintId/export", syncRoute((req, res) => {
    try {
      res.json(deps.exportSprintToMarkdown(requireTrimmedString(req.params.projectId, "projectId"), requireTrimmedString(req.params.sprintId, "sprintId")));
    } catch (error) {
      res.status(400).json(toErrorResponse(error, "Failed to export sprint markdown"));
    }
  }));

  router.patch("/api/sprints/:sprintId", syncRoute((req, res) => {
    try {
      const sprintId = requireTrimmedString(req.params.sprintId, "sprintId");
      const sprint = deps.getSprint(sprintId);
      if (!sprint) {
        res.status(404).json({ error: `Sprint not found: ${sprintId}` });
        return;
      }
      const projectId = parseTrimmedString(req.body?.projectId) || parseTrimmedString(req.query.projectId);
      if (projectId && sprint.projectId !== projectId) {
        res.status(400).json({ error: `Sprint ${sprintId} does not belong to project ${projectId}` });
        return;
      }
      res.json(deps.updateSprint(sprintId, parseUpdateSprintInput(req.body)));
    } catch (error) {
      res.status(400).json(toErrorResponse(error, "Failed to update sprint"));
    }
  }));

  router.post("/api/sprints/:sprintId/complete", asyncRoute(async (req, res) => {
    if (!deps.markSprintCompleted) {
      res.status(501).json({ error: "Manual sprint completion is not available." });
      return;
    }
    try {
      res.json(await deps.markSprintCompleted(requireTrimmedString(req.params.sprintId, "sprintId")));
    } catch (error) {
      res.status(400).json(toErrorResponse(error, "Failed to mark sprint completed"));
    }
  }));

  router.post("/api/sprints/:sprintId/qa-pass", asyncRoute(async (req, res) => {
    if (!deps.markSprintQaPassed) {
      res.status(501).json({ error: "Manual sprint QA pass is not available." });
      return;
    }
    try {
      res.json(await deps.markSprintQaPassed(requireTrimmedString(req.params.sprintId, "sprintId")));
    } catch (error) {
      res.status(400).json(toErrorResponse(error, "Failed to mark sprint QA passed"));
    }
  }));

  router.get("/api/sprints/:sprintId/settings", syncRoute((req, res) => {
    try {
      res.json(deps.getSprintSettings(requireTrimmedString(req.params.sprintId, "sprintId")));
    } catch (error) {
      res.status(400).json(toErrorResponse(error, "Failed to load sprint settings"));
    }
  }));

  router.put("/api/sprints/:sprintId/settings", syncRoute((req, res) => {
    const projectId = parseTrimmedString(req.body?.projectId);
    if (!projectId) {
      res.status(400).json({ error: "projectId is required when saving sprint settings." });
      return;
    }

    try {
      const sprintId = requireTrimmedString(req.params.sprintId, "sprintId");
      const sprint = deps.getSprint(sprintId);
      if (!sprint) {
        res.status(404).json({ error: `Sprint not found: ${sprintId}` });
        return;
      }
      if (sprint.projectId !== projectId) {
        res.status(400).json({ error: `Sprint ${sprintId} does not belong to project ${projectId}` });
        return;
      }
      const payload = { ...(req.body as Record<string, unknown>) };
      delete payload.projectId;
      res.json(deps.saveSprintSettings(projectId, sprintId, payload as SprintSettingsOverride));
    } catch (error) {
      res.status(400).json(toErrorResponse(error, "Failed to save sprint settings"));
    }
  }));

  router.delete("/api/sprints/:sprintId/settings", syncRoute((req, res) => {
    try {
      deps.resetSprintSettings(requireTrimmedString(req.params.sprintId, "sprintId"));
      res.json({ ok: true });
    } catch (error) {
      res.status(400).json(toErrorResponse(error, "Failed to reset sprint settings"));
    }
  }));

  router.get("/api/projects/:projectId/sprints/:sprintId/settings/effective", syncRoute((req, res) => {
    try {
      res.json(deps.getSprintEffectiveSettings(
        requireTrimmedString(req.params.projectId, "projectId"),
        requireTrimmedString(req.params.sprintId, "sprintId"),
      ));
    } catch (error) {
      res.status(400).json(toErrorResponse(error, "Failed to load effective sprint settings"));
    }
  }));

  router.delete("/api/sprints/:sprintId", syncRoute((req, res) => {
    try {
      const sprintId = requireTrimmedString(req.params.sprintId, "sprintId");
      const sprint = deps.getSprint(sprintId);
      if (!sprint) {
        res.status(404).json({ error: `Sprint not found: ${sprintId}` });
        return;
      }
      const projectId = parseTrimmedString(req.body?.projectId) || parseTrimmedString(req.query.projectId);
      if (projectId && sprint.projectId !== projectId) {
        res.status(400).json({ error: `Sprint ${sprintId} does not belong to project ${projectId}` });
        return;
      }
      deps.deleteSprint(sprintId);
      res.json({ ok: true });
    } catch (error) {
      res.status(400).json(toErrorResponse(error, "Failed to delete sprint"));
    }
  }));
}

function parseRepositoryIssueSearchQuery(query: Record<string, unknown>): IssueSearchInput {
  const provider = parseRepositoryProvider(query.provider);
  return {
    provider,
    repository: parseTrimmedQueryString(query.repository, "repository"),
    hostDomain: parseTrimmedQueryString(query.hostDomain, "hostDomain"),
    workspaceId: parseTrimmedQueryString(query.workspaceId, "workspaceId"),
    providerProjectId: parseTrimmedQueryString(query.projectId, "projectId"),
    teamId: parseTrimmedQueryString(query.teamId, "teamId"),
    teamKey: parseTrimmedQueryString(query.teamKey, "teamKey"),
    databaseId: parseTrimmedQueryString(query.databaseId, "databaseId"),
    boardId: parseTrimmedQueryString(query.boardId, "boardId"),
    documentId: parseTrimmedQueryString(query.documentId, "documentId"),
    fileKey: parseTrimmedQueryString(query.fileKey, "fileKey"),
    muralId: parseTrimmedQueryString(query.muralId, "muralId"),
    itemTypes: parseIssueLabels(query.itemTypes),
    projectKey: parseTrimmedQueryString(query.projectKey, "projectKey"),
    search: parseTrimmedQueryString(query.search, "search"),
    state: parseRepositoryIssueState(query.state, provider),
    status: parseImportStatus(query.status, provider),
    statusNames: parseQueryStringList(query.statusNames, "statusNames", 50),
    labels: parseIssueLabels(query.labels),
    assignee: parseTrimmedQueryString(query.assignee, "assignee"),
    author: parseTrimmedQueryString(query.author, "author"),
    reporter: parseTrimmedQueryString(query.reporter, "reporter"),
    milestone: parseTrimmedQueryString(query.milestone, "milestone"),
    issueText: parseTrimmedQueryString(query.issueText, "issueText"),
    externalIds: parseIssueLabels(query.externalIds),
    includeConversation: parseQueryBoolean(query.includeConversation, "includeConversation"),
    createdAfter: parseDateLikeString(query.createdAfter, "createdAfter"),
    createdBefore: parseDateLikeString(query.createdBefore, "createdBefore"),
    updatedAfter: parseDateLikeString(query.updatedAfter, "updatedAfter"),
    updatedBefore: parseDateLikeString(query.updatedBefore, "updatedBefore"),
    sortField: parseRepositorySortField(query.sortField),
    sortDirection: parseRepositorySortDirection(query.sortDirection),
    limit: parseClampedLimit(query.limit, 1, 100, "limit"),
  };
}

function parseJiraIssueSearchQuery(query: Record<string, unknown>): JiraIssueSearchInput {
  return {
    jql: parseTrimmedQueryString(query.jql, "jql"),
    projectKey: parseTrimmedQueryString(query.projectKey, "projectKey"),
    search: parseTrimmedQueryString(query.search, "search"),
    issueKey: parseTrimmedQueryString(query.issueKey, "issueKey"),
    status: parseJiraStatus(query.status),
    inProgressStatusName: parseTrimmedQueryString(query.inProgressStatusName, "inProgressStatusName"),
    statusNames: parseQueryStringList(query.statusNames, "statusNames", 50),
    assignee: parseJiraAssignee(query.assignee),
    assigneeText: parseTrimmedQueryString(query.assigneeText, "assigneeText"),
    reporterText: parseTrimmedQueryString(query.reporterText, "reporterText"),
    issueType: parseTrimmedQueryString(query.issueType, "issueType"),
    priority: parseTrimmedQueryString(query.priority, "priority"),
    labels: parseIssueLabels(query.labels),
    updatedAfter: parseDateLikeString(query.updatedAfter, "updatedAfter"),
    updatedBefore: parseDateLikeString(query.updatedBefore, "updatedBefore"),
    sortField: parseJiraSortField(query.sortField),
    sortDirection: parseJiraSortDirection(query.sortDirection),
    limit: parseClampedLimit(query.limit, 1, 100, "limit"),
    maxResults: parseClampedLimit(query.maxResults, 1, 100, "maxResults"),
  };
}

function parseIssueLabels(value: unknown): string[] {
  return parseQueryStringList(value, "labels", 12);
}

function parseQueryStringList(value: unknown, fieldName: string, maxItems: number): string[] {
  const rawValues = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  return Array.from(new Set(rawValues
    .flatMap((entry) => {
      if (typeof entry !== "string") {
        throw new Error(`Invalid value for ${fieldName}. Must be a comma-separated string.`);
      }
      return entry.split(",");
    })
    .map((label) => label.trim())
    .filter(Boolean))).slice(0, maxItems);
}

function parseTrimmedQueryString(value: unknown, fieldName: string): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`Invalid value for ${fieldName}. Must be a string.`);
  }
  return parseTrimmedString(value);
}

function parseRepositoryProvider(value: unknown): RepositoryIssueSearchInput["provider"] | undefined {
  const trimmed = parseTrimmedQueryString(value, "provider");
  if (!trimmed) {
    return undefined;
  }
  if (trimmed !== "github" && trimmed !== "gitlab" && trimmed !== "jira" && trimmed !== "notion" && trimmed !== "asana" && trimmed !== "linear" && trimmed !== "miro" && trimmed !== "lucid" && trimmed !== "figma" && trimmed !== "mural") {
    throw new Error("Invalid value for provider. Must be one of: github, gitlab, jira, notion, asana, linear, miro, lucid, figma, mural");
  }
  return trimmed;
}

function parseRepositoryIssueState(value: unknown, provider?: RepositoryIssueSearchInput["provider"]): IssueSearchInput["state"] {
  const trimmed = parseTrimmedQueryString(value, "state");
  if (!trimmed) {
    return undefined;
  }
  if (provider === "notion" || provider === "asana" || provider === "linear" || provider === "miro" || provider === "lucid" || provider === "figma" || provider === "mural") {
    return trimmed;
  }
  if (trimmed !== "open" && trimmed !== "closed" && trimmed !== "all") {
    throw new Error("Invalid value for state. Must be one of: open, closed, all");
  }
  return trimmed;
}

function parseImportStatus(value: unknown, provider?: RepositoryIssueSearchInput["provider"]): IssueSearchInput["status"] {
  const trimmed = parseTrimmedQueryString(value, "status");
  if (!trimmed) {
    return undefined;
  }
  if (provider === "notion" || provider === "asana" || provider === "linear" || provider === "miro" || provider === "lucid" || provider === "figma" || provider === "mural") {
    return trimmed;
  }
  if (trimmed !== "open" && trimmed !== "in_progress" && trimmed !== "done" && trimmed !== "all") {
    throw new Error("Invalid value for status. Must be one of: open, in_progress, done, all");
  }
  return trimmed;
}

function parseRepositorySortField(value: unknown): RepositoryIssueSearchSortField | undefined {
  const trimmed = parseTrimmedQueryString(value, "sortField");
  if (!trimmed) {
    return undefined;
  }
  if (trimmed !== "updated" && trimmed !== "created" && trimmed !== "comments") {
    throw new Error("Invalid value for sortField. Must be one of: updated, created, comments");
  }
  return trimmed;
}

function parseRepositorySortDirection(value: unknown): RepositoryIssueSearchSortDirection | undefined {
  const trimmed = parseTrimmedQueryString(value, "sortDirection");
  if (!trimmed) {
    return undefined;
  }
  if (trimmed !== "asc" && trimmed !== "desc") {
    throw new Error("Invalid value for sortDirection. Must be one of: asc, desc");
  }
  return trimmed;
}

function parseJiraStatus(value: unknown): JiraIssueSearchStatus | undefined {
  const trimmed = parseTrimmedQueryString(value, "status");
  if (!trimmed) {
    return undefined;
  }
  if (trimmed !== "all" && trimmed !== "done" && trimmed !== "in_progress" && trimmed !== "open") {
    throw new Error("Invalid value for status. Must be one of: open, in_progress, done, all");
  }
  return trimmed;
}

function parseJiraAssignee(value: unknown): JiraIssueSearchAssignee | undefined {
  const trimmed = parseTrimmedQueryString(value, "assignee");
  if (!trimmed) {
    return undefined;
  }
  if (trimmed !== "me" && trimmed !== "unassigned" && trimmed !== "any") {
    throw new Error("Invalid value for assignee. Must be one of: any, me, unassigned");
  }
  return trimmed;
}

function parseJiraSortField(value: unknown): JiraIssueSearchSortField | undefined {
  const trimmed = parseTrimmedQueryString(value, "sortField");
  if (!trimmed) {
    return undefined;
  }
  if (trimmed !== "updated" && trimmed !== "created" && trimmed !== "priority" && trimmed !== "status" && trimmed !== "assignee" && trimmed !== "reporter") {
    throw new Error("Invalid value for sortField. Must be one of: updated, created, priority, status, assignee, reporter");
  }
  return trimmed;
}

function parseJiraSortDirection(value: unknown): JiraIssueSearchSortDirection | undefined {
  const trimmed = parseTrimmedQueryString(value, "sortDirection");
  if (!trimmed) {
    return undefined;
  }
  if (trimmed !== "asc" && trimmed !== "desc") {
    throw new Error("Invalid value for sortDirection. Must be one of: asc, desc");
  }
  return trimmed;
}

function parseDateLikeString(value: unknown, fieldName: string): string | undefined {
  const trimmed = parseTrimmedQueryString(value, fieldName);
  if (!trimmed) {
    return undefined;
  }
  if (Number.isNaN(Date.parse(trimmed))) {
    throw new Error(`Invalid value for ${fieldName}. Must be a valid date or ISO timestamp.`);
  }
  return trimmed;
}

function parseClampedLimit(value: unknown, min: number, max: number, fieldName: string): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  let numeric: number;
  if (typeof value === "number") {
    numeric = value;
  } else if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }
    numeric = Number(trimmed);
  } else {
    throw new Error(`Invalid value for ${fieldName}. Must be a number.`);
  }
  if (!Number.isFinite(numeric)) {
    throw new Error(`Invalid value for ${fieldName}. Must be a number.`);
  }
  return Math.max(min, Math.min(max, Math.trunc(numeric)));
}

function parseQueryBoolean(value: unknown, fieldName: string): boolean | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`Invalid value for ${fieldName}. Must be a boolean.`);
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (normalized === "true" || normalized === "1") {
    return true;
  }
  if (normalized === "false" || normalized === "0") {
    return false;
  }
  throw new Error(`Invalid value for ${fieldName}. Must be a boolean.`);
}
