import type { Express } from "express";
import type { DashboardDependencies } from "./dashboard-server.js";
import { syncRoute } from "./route-utils.js";
import { requireTrimmedString } from "./request-parsers.js";

import type { ProjectInvocationsQuery } from "../contracts/invocation-types.js";
import type { PlanningInvocationRestartMode } from "../services/planning-agent-service.js";

function parseRestartMode(body: unknown): PlanningInvocationRestartMode {
  const mode = body && typeof body === "object" ? (body as Record<string, unknown>).mode : undefined;
  if (mode === undefined || mode === null || mode === "") {
    return "retry_full_prompt";
  }
  if (mode === "retry_full_prompt" || mode === "continue_session") {
    return mode;
  }
  throw new Error("Invalid invocation restart mode.");
}

export function registerExecutionInvocationRoutes(router: Express, deps: DashboardDependencies): void {
  router.get("/api/projects/:projectId/execution/invocations", syncRoute((req, res) => {
    const projectId = requireTrimmedString(req.params.projectId, "projectId");

    if (Object.keys(req.query).length > 0 && deps.executionRepository) {
      const query: ProjectInvocationsQuery = {
        limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
        offset: req.query.offset ? parseInt(req.query.offset as string, 10) : undefined,
        status: req.query.status as any,
        purpose: req.query.purpose as any,
        provider: req.query.provider as string,
        agentPresetId: req.query.agentPresetId as string,
        search: req.query.search as string,
        sortKey: req.query.sortKey as any,
        sortDir: req.query.sortDir as any,
        errorCategories: Array.isArray(req.query.errorCategories)
          ? (req.query.errorCategories as string[])
          : typeof req.query.errorCategories === 'string'
            ? [req.query.errorCategories]
            : undefined,
      };
      res.json(deps.executionRepository.queryProjectInvocations({ ...query, projectId }));
      return;
    }

    res.json(deps.listProjectInvocations(projectId));
  }));

  router.get("/api/execution/invocations/:invocationId/messages", syncRoute((req, res) => {
    res.json(deps.listInvocationMessages(requireTrimmedString(req.params.invocationId, "invocationId")));
  }));

  router.post("/api/execution/invocations/:invocationId/restart", async (req, res, next) => {
    try {
      if (!deps.restartExecutionInvocation) {
        res.status(404).json({ error: "Invocation restart is not enabled." });
        return;
      }
      const result = await deps.restartExecutionInvocation(
        requireTrimmedString(req.params.invocationId, "invocationId"),
        parseRestartMode(req.body),
      );
      res.status(202).json(result);
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/execution/invocations/:invocationId/cancel", async (req, res, next) => {
    try {
      if (!deps.cancelExecutionInvocation) {
        res.status(404).json({ error: "Invocation cancellation is not enabled." });
        return;
      }
      const result = await deps.cancelExecutionInvocation(
        requireTrimmedString(req.params.invocationId, "invocationId"),
      );
      res.status(202).json(result);
    } catch (error) {
      next(error);
    }
  });
}
