import type { Express } from "express";
import type { DashboardDependencies } from "./dashboard-server.js";
import { asyncRoute, toErrorResponse, syncRoute } from "./route-utils.js";
import { parseCreateSprintInput, parseTrimmedString, parseUpdateSprintInput, requireTrimmedString } from "./request-parsers.js";
import type {
  IssuePromptContextInput,
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

export function registerSprintRoutes(router: Express, deps: DashboardDependencies): void {
  router.get("/api/projects/:projectId/sprints", syncRoute((req, res) => {
    try {
      res.json(deps.listSprints(requireTrimmedString(req.params.projectId, "projectId")));
    } catch (error) {
      res.status(400).json(toErrorResponse(error, "Failed to list sprints"));
    }
  }));

  router.get("/api/projects/:projectId/jira/search", asyncRoute(async (req, res) => {
    try {
      const projectId = requireTrimmedString(req.params.projectId, "projectId");
      const labels = typeof req.query.labels === "string"
        ? req.query.labels.split(",").map((label) => label.trim()).filter(Boolean)
        : [];
      const status = parseJiraStatus(req.query.status);
      const assignee = parseJiraAssignee(req.query.assignee);
      res.json(await deps.searchJiraIssues(projectId, {
        jql: parseTrimmedString(req.query.jql),
        projectKey: parseTrimmedString(req.query.projectKey),
        search: parseTrimmedString(req.query.search),
        issueKey: parseTrimmedString(req.query.issueKey),
        status,
        assignee,
        assigneeText: parseTrimmedString(req.query.assigneeText),
        reporterText: parseTrimmedString(req.query.reporterText),
        issueType: parseTrimmedString(req.query.issueType),
        priority: parseTrimmedString(req.query.priority),
        labels,
        updatedAfter: parseDateLikeString(req.query.updatedAfter, "updatedAfter"),
        updatedBefore: parseDateLikeString(req.query.updatedBefore, "updatedBefore"),
        sortField: parseJiraSortField(req.query.sortField),
        sortDirection: parseJiraSortDirection(req.query.sortDirection),
        limit: parseClampedLimit(req.query.limit, 1, 100, "limit"),
      }));
    } catch (error) {
      res.status(400).json(toErrorResponse(error, "Failed to search Jira issues"));
    }
  }));

  router.get("/api/sprints/:sprintId/linked-issues", syncRoute((req, res) => {
    try {
      res.json(deps.listSprintLinkedIssues(requireTrimmedString(req.params.sprintId, "sprintId")));
    } catch (error) {
      res.status(400).json(toErrorResponse(error, "Failed to list linked issues"));
    }
  }));

  router.put("/api/sprints/:sprintId/linked-issues", syncRoute((req, res) => {
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
      res.status(201).json(deps.replaceSprintLinkedIssues(sprintId, projectId, issues));
    } catch (error) {
      res.status(400).json(toErrorResponse(error, "Failed to update linked issues"));
    }
  }));

  router.get("/api/projects/:projectId/issues", asyncRoute(async (req, res) => {
    if (!deps.sprintIssueService) {
      res.status(501).json({ error: "Issue import service is not available." });
      return;
    }
    try {
      const labels = typeof req.query.labels === "string"
        ? req.query.labels.split(",").map((label) => label.trim()).filter(Boolean)
        : [];
      res.json(await deps.sprintIssueService.searchIssues(
        requireTrimmedString(req.params.projectId, "projectId"),
        {
          provider: parseRepositoryProvider(req.query.provider),
          repository: parseTrimmedString(req.query.repository),
          hostDomain: parseTrimmedString(req.query.hostDomain),
          search: parseTrimmedString(req.query.search),
          state: parseRepositoryIssueState(req.query.state),
          labels,
          assignee: parseTrimmedString(req.query.assignee),
          author: parseTrimmedString(req.query.author),
          reporter: parseTrimmedString(req.query.reporter),
          milestone: parseTrimmedString(req.query.milestone),
          issueText: parseTrimmedString(req.query.issueText),
          createdAfter: parseDateLikeString(req.query.createdAfter, "createdAfter"),
          createdBefore: parseDateLikeString(req.query.createdBefore, "createdBefore"),
          updatedAfter: parseDateLikeString(req.query.updatedAfter, "updatedAfter"),
          updatedBefore: parseDateLikeString(req.query.updatedBefore, "updatedBefore"),
          sortField: parseRepositorySortField(req.query.sortField),
          sortDirection: parseRepositorySortDirection(req.query.sortDirection),
          limit: parseClampedLimit(req.query.limit, 1, 100, "limit"),
        }
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
      res.status(201).json(deps.createSprint(requireTrimmedString(req.params.projectId, "projectId"), payload));
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

function parseRepositoryProvider(value: unknown): RepositoryIssueSearchInput["provider"] | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (value !== "github" && value !== "gitlab") {
    throw new Error("Invalid value for provider. Must be one of: github, gitlab");
  }
  return value;
}

function parseRepositoryIssueState(value: unknown): RepositoryIssueSearchState | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (value !== "open" && value !== "closed" && value !== "all") {
    throw new Error("Invalid value for state. Must be one of: open, closed, all");
  }
  return value;
}

function parseRepositorySortField(value: unknown): RepositoryIssueSearchSortField | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (value !== "updated" && value !== "created" && value !== "comments") {
    throw new Error("Invalid value for sortField. Must be one of: updated, created, comments");
  }
  return value;
}

function parseRepositorySortDirection(value: unknown): RepositoryIssueSearchSortDirection | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (value !== "asc" && value !== "desc") {
    throw new Error("Invalid value for sortDirection. Must be one of: asc, desc");
  }
  return value;
}

function parseJiraStatus(value: unknown): JiraIssueSearchStatus | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (value !== "all" && value !== "done" && value !== "in_progress" && value !== "open") {
    throw new Error("Invalid value for status. Must be one of: open, in_progress, done, all");
  }
  return value;
}

function parseJiraAssignee(value: unknown): JiraIssueSearchAssignee | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (value !== "me" && value !== "unassigned" && value !== "any") {
    throw new Error("Invalid value for assignee. Must be one of: any, me, unassigned");
  }
  return value;
}

function parseJiraSortField(value: unknown): JiraIssueSearchSortField | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (value !== "updated" && value !== "created" && value !== "priority" && value !== "status" && value !== "assignee" && value !== "reporter") {
    throw new Error("Invalid value for sortField. Must be one of: updated, created, priority, status, assignee, reporter");
  }
  return value;
}

function parseJiraSortDirection(value: unknown): JiraIssueSearchSortDirection | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (value !== "asc" && value !== "desc") {
    throw new Error("Invalid value for sortDirection. Must be one of: asc, desc");
  }
  return value;
}

function parseDateLikeString(value: unknown, fieldName: string): string | undefined {
  const trimmed = parseTrimmedString(value);
  if (!trimmed) {
    return undefined;
  }
  if (Number.isNaN(Date.parse(trimmed))) {
    throw new Error(`Invalid value for ${fieldName}. Must be a valid date or ISO timestamp.`);
  }
  return trimmed;
}

function parseClampedLimit(value: unknown, min: number, max: number, fieldName: string): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  let numeric: number;
  if (typeof value === "number") {
    numeric = value;
  } else if (typeof value === "string") {
    numeric = Number(value);
  } else {
    throw new Error(`Invalid value for ${fieldName}. Must be a number.`);
  }
  if (!Number.isFinite(numeric)) {
    throw new Error(`Invalid value for ${fieldName}. Must be a number.`);
  }
  return Math.max(min, Math.min(max, Math.trunc(numeric)));
}
