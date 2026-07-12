import type { Express } from "express";
import type { DashboardDependencies } from "./dashboard-server.js";
import { HttpRouteError } from "./http-errors.js";
import { asyncRoute, syncRoute } from "./route-utils.js";
import { requireTrimmedString, parseOptionalInteger } from "./request-parsers.js";
import type {
  AttachNodeFlowSkillInput,
  CreateNodeFlowInput,
  NodeFlowGraph,
  NodeFlowJsonObject,
  UpdateNodeFlowInput,
} from "../contracts/node-flow-types.js";

function requireNodeFlowService(deps: DashboardDependencies): NonNullable<DashboardDependencies["nodeFlowService"]> {
  if (!deps.nodeFlowService) {
    throw new HttpRouteError(404, "Node flow service is not enabled.");
  }
  return deps.nodeFlowService;
}

export function registerNodeFlowRoutes(app: Express, deps: DashboardDependencies): void {
  app.get("/api/projects/:projectId/node-flows", syncRoute((req, res) => {
    res.json(requireNodeFlowService(deps).list(requireTrimmedString(req.params.projectId, "projectId")));
  }));

  app.post("/api/projects/:projectId/node-flows", syncRoute((req, res) => {
    const flow = requireNodeFlowService(deps).create(
      requireTrimmedString(req.params.projectId, "projectId"),
      req.body as CreateNodeFlowInput,
    );
    res.status(201).json(flow);
  }));

  app.get("/api/node-flows/:flowId", syncRoute((req, res) => {
    const flow = requireNodeFlowService(deps).get(requireTrimmedString(req.params.flowId, "flowId"));
    if (!flow) {
      res.status(404).json({ error: `Node flow not found: ${req.params.flowId}` });
      return;
    }
    res.json(flow);
  }));

  app.patch("/api/node-flows/:flowId", syncRoute((req, res) => {
    res.json(requireNodeFlowService(deps).update(
      requireTrimmedString(req.params.flowId, "flowId"),
      req.body as UpdateNodeFlowInput,
    ));
  }));

  app.delete("/api/node-flows/:flowId", syncRoute((req, res) => {
    requireNodeFlowService(deps).delete(requireTrimmedString(req.params.flowId, "flowId"));
    res.json({ ok: true });
  }));

  app.post("/api/node-flows/:flowId/validate", syncRoute((req, res) => {
    const body = req.body as { graph?: NodeFlowGraph };
    res.json(requireNodeFlowService(deps).validateFlow(
      requireTrimmedString(req.params.flowId, "flowId"),
      body.graph,
    ));
  }));

  app.post("/api/node-flows/:flowId/run", asyncRoute(async (req, res) => {
    const body = req.body as {
      projectId?: string;
      input?: Record<string, unknown>;
      triggerType?: string;
      triggerPayload?: NodeFlowJsonObject;
      flowVersion?: number;
    };
    const result = await requireNodeFlowService(deps).runFlow(
      requireTrimmedString(body.projectId, "projectId"),
      requireTrimmedString(req.params.flowId, "flowId"),
      body.input,
      {
        triggerType: body.triggerType,
        triggerPayload: body.triggerPayload,
        versionSelection: body.flowVersion === undefined
          ? { mode: "latest_published" }
          : { mode: "pinned", version: body.flowVersion },
      },
    );
    res.status(201).json(result);
  }));

  app.get("/api/node-flows/:flowId/agent-skills", syncRoute((req, res) => {
    res.json(requireNodeFlowService(deps).listAgentSkills(requireTrimmedString(req.params.flowId, "flowId")));
  }));

  app.post("/api/node-flows/:flowId/agent-skills", syncRoute((req, res) => {
    const attachment = requireNodeFlowService(deps).attachToAgent(
      requireTrimmedString(req.params.flowId, "flowId"),
      req.body as AttachNodeFlowSkillInput,
    );
    res.status(201).json(attachment);
  }));

  app.delete("/api/node-flows/:flowId/agent-skills", syncRoute((req, res) => {
    const body = req.body as { agentPresetId?: string };
    const agentPresetId = body.agentPresetId ?? (typeof req.query.agentPresetId === "string" ? req.query.agentPresetId : undefined);
    requireNodeFlowService(deps).detachFromAgent(
      requireTrimmedString(req.params.flowId, "flowId"),
      requireTrimmedString(agentPresetId, "agentPresetId"),
    );
    res.json({ ok: true });
  }));

  app.get("/api/node-flows/:flowId/runs", syncRoute((req, res) => {
    const limit = parseOptionalInteger(req.query.limit, 1, 250, "limit");
    res.json(requireNodeFlowService(deps).listRuns(
      requireTrimmedString(req.params.flowId, "flowId"),
      limit,
    ));
  }));

  app.get("/api/node-flow-runs/:runId", syncRoute((req, res) => {
    const run = requireNodeFlowService(deps).getRun(requireTrimmedString(req.params.runId, "runId"));
    if (!run) {
      res.status(404).json({ error: `Node flow run not found: ${req.params.runId}` });
      return;
    }
    res.json(run);
  }));

  app.get("/api/node-flow-runs/:runId/node-runs", syncRoute((req, res) => {
    res.json(requireNodeFlowService(deps).listNodeRuns(requireTrimmedString(req.params.runId, "runId")));
  }));
  app.get("/api/node-flow-runs/:runId/attempts", syncRoute((req, res) => {
    res.json(requireNodeFlowService(deps).listNodeAttempts(requireTrimmedString(req.params.runId, "runId")));
  }));
}
