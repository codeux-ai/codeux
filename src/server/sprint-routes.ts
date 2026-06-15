import type { Express } from "express";
import type { DashboardDependencies } from "./dashboard-server.js";
import { asyncRoute, toErrorResponse, syncRoute } from "./route-utils.js";
import { requireTrimmedString, parseTrimmedString } from "./request-parsers.js";
import type {
  CreateSprintInput,
  IssuePromptContextInput,
  SprintLinkedIssueInput,
  SprintMarkdownImportInput,
  UpdateSprintInput,
} from "../contracts/project-management-types.js";
import type { SprintSettingsOverride } from "../contracts/settings-scope-types.js";
import type { JiraIssueSearchAssignee, JiraIssueSearchStatus } from "../services/jira-api-client.js";

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
        status,
        assignee,
        assigneeText: parseTrimmedString(req.query.assigneeText),
        labels,
        maxResults: typeof req.query.limit === "string" ? Number(req.query.limit) : undefined,
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
      const projectId = requireTrimmedString(req.body.projectId, "projectId");
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
          provider: req.query.provider === "gitlab" ? "gitlab" : req.query.provider === "github" ? "github" : undefined,
          repository: parseTrimmedString(req.query.repository),
          hostDomain: parseTrimmedString(req.query.hostDomain),
          search: parseTrimmedString(req.query.search),
          state: req.query.state === "closed" ? "closed" : req.query.state === "all" ? "all" : "open",
          labels,
          assignee: parseTrimmedString(req.query.assignee),
          limit: typeof req.query.limit === "string" ? Number(req.query.limit) : undefined,
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
      const payload = req.body as CreateSprintInput;
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
      res.json(deps.updateSprint(requireTrimmedString(req.params.sprintId, "sprintId"), req.body as UpdateSprintInput));
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
      deps.deleteSprint(requireTrimmedString(req.params.sprintId, "sprintId"));
      res.json({ ok: true });
    } catch (error) {
      res.status(400).json(toErrorResponse(error, "Failed to delete sprint"));
    }
  }));
}

function parseJiraStatus(value: unknown): JiraIssueSearchStatus | undefined {
  return value === "all" || value === "done" || value === "in_progress" || value === "open"
    ? value
    : undefined;
}

function parseJiraAssignee(value: unknown): JiraIssueSearchAssignee | undefined {
  return value === "me" || value === "unassigned" || value === "any"
    ? value
    : undefined;
}
