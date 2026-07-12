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
  app.get("/api/node-flow-catalog", syncRoute((_req, res) => {
    res.json(requireNodeFlowService(deps).catalog());
  }));

  app.get("/api/node-flow-catalog/:nodeType", syncRoute((req, res) => {
    const definition = requireNodeFlowService(deps).nodeDefinition(
      requireTrimmedString(req.params.nodeType, "nodeType"),
      parseOptionalInteger(req.query.version, 1, Number.MAX_SAFE_INTEGER, "version"),
    );
    if (!definition) throw new HttpRouteError(404, "Node definition not found.");
    res.json(definition);
  }));

  app.post("/api/projects/:projectId/node-flow-drafts", syncRoute((req, res) => {
    res.status(201).json(requireNodeFlowService(deps).createDraft(
      requireTrimmedString(req.params.projectId, "projectId"), req.body as CreateNodeFlowInput,
    ));
  }));

  app.patch("/api/node-flow-drafts/:flowId", syncRoute((req, res) => {
    const result = requireNodeFlowService(deps).patchDraft(
      requireTrimmedString(req.params.flowId, "flowId"), req.body,
    );
    res.status(result.conflict ? 409 : 200).json(result);
  }));

  app.post("/api/node-flow-drafts/:flowId/validate", syncRoute((req, res) => {
    res.json(requireNodeFlowService(deps).validateDraft(
      requireTrimmedString(req.body?.projectId, "projectId"), requireTrimmedString(req.params.flowId, "flowId"),
    ));
  }));

  app.post("/api/node-flow-drafts/:flowId/dry-run", syncRoute((req, res) => {
    res.json(requireNodeFlowService(deps).dryRun(
      requireTrimmedString(req.body?.projectId, "projectId"), requireTrimmedString(req.params.flowId, "flowId"), req.body?.input ?? {},
    ));
  }));

  app.get("/api/node-flow-drafts/:flowId/bindings", syncRoute((req, res) => {
    res.json(requireNodeFlowService(deps).inspectBindings(
      requireTrimmedString(req.query.projectId, "projectId"), requireTrimmedString(req.params.flowId, "flowId"),
    ));
  }));

  app.post("/api/node-flow-drafts/:flowId/credential-requests", syncRoute((req, res) => {
    res.status(201).json(requireNodeFlowService(deps).requestCredential(
      requireTrimmedString(req.body?.projectId, "projectId"), requireTrimmedString(req.params.flowId, "flowId"),
      requireTrimmedString(req.body?.nodeId, "nodeId"), requireTrimmedString(req.body?.slot, "slot"),
    ));
  }));

  app.post("/api/projects/:projectId/custom-nodes", asyncRoute(async (req, res) => {
    res.status(201).json(await requireNodeFlowService(deps).createCustomNode(requireTrimmedString(req.params.projectId, "projectId"), req.body));
  }));

  app.put("/api/projects/:projectId/custom-nodes/:nodeId", asyncRoute(async (req, res) => {
    res.json(await requireNodeFlowService(deps).updateCustomNode(
      requireTrimmedString(req.params.projectId, "projectId"), requireTrimmedString(req.params.nodeId, "nodeId"), req.body?.manifest, requireTrimmedString(req.body?.sourceRevision, "sourceRevision"),
    ));
  }));

  app.post("/api/projects/:projectId/custom-nodes/:nodeId/validate", asyncRoute(async (req, res) => {
    res.json(await requireNodeFlowService(deps).validateCustomNode(
      requireTrimmedString(req.params.projectId, "projectId"), requireTrimmedString(req.params.nodeId, "nodeId"),
      requireTrimmedString(req.body?.actor, "actor"), requireTrimmedString(req.body?.invocationId, "invocationId"), requireTrimmedString(req.body?.correlationId, "correlationId"),
    ));
  }));

  app.post("/api/node-flow-drafts/:flowId/publish", syncRoute((req, res) => {
    res.json(requireNodeFlowService(deps).publishDraft(
      requireTrimmedString(req.body?.projectId, "projectId"), requireTrimmedString(req.params.flowId, "flowId"),
      parseRequiredBodyInteger(req.body?.draftRevision, "draftRevision"), requireTrimmedString(req.body?.publishedBy, "publishedBy"),
    ));
  }));

  app.get("/api/node-flows/:flowId/compare", syncRoute((req, res) => {
    res.json(requireNodeFlowService(deps).compareVersions(
      requireTrimmedString(req.query.projectId, "projectId"), requireTrimmedString(req.params.flowId, "flowId"),
      parseRequiredBodyInteger(req.query.fromVersion, "fromVersion"), parseRequiredBodyInteger(req.query.toVersion, "toVersion"),
    ));
  }));

  app.post("/api/node-flows/:flowId/rollback", syncRoute((req, res) => {
    res.json(requireNodeFlowService(deps).rollback(
      requireTrimmedString(req.body?.projectId, "projectId"), requireTrimmedString(req.params.flowId, "flowId"),
      parseRequiredBodyInteger(req.body?.version, "version"), parseRequiredBodyInteger(req.body?.draftRevision, "draftRevision"),
    ));
  }));

  app.post("/api/node-flow-runs/:runId/cancel", syncRoute((req, res) => {
    res.json(requireNodeFlowService(deps).cancelRun(requireTrimmedString(req.body?.projectId, "projectId"), requireTrimmedString(req.params.runId, "runId")));
  }));

  app.post("/api/node-flow-runs/:runId/retry", asyncRoute(async (req, res) => {
    res.status(201).json(await requireNodeFlowService(deps).retryRun(requireTrimmedString(req.body?.projectId, "projectId"), requireTrimmedString(req.params.runId, "runId")));
  }));

  app.post("/api/node-flow-runs/:runId/resume-approval", asyncRoute(async (req, res) => {
    res.json(await requireNodeFlowService(deps).resumeApproval(
      requireTrimmedString(req.body?.projectId, "projectId"),
      requireTrimmedString(req.params.runId, "runId"),
      requireTrimmedString(req.body?.approvalId, "approvalId"),
    ));
  }));
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

  app.get("/api/node-flow-runs/:runId/approvals", syncRoute((req, res) => {
    if (!deps.approvalService) throw new HttpRouteError(404, "Approval service is not enabled.");
    res.json({ approvals: deps.approvalService.listForRun(requireTrimmedString(req.params.runId, "runId")) });
  }));

  app.post("/api/automation-approvals/:approvalId/decision", asyncRoute(async (req, res) => {
    if (!deps.approvalService) throw new HttpRouteError(404, "Approval service is not enabled.");
    const body = req.body as { decision?: string; decidedBy?: string; metadata?: NodeFlowJsonObject };
    const approvalId = requireTrimmedString(req.params.approvalId, "approvalId");
    const decidedBy = requireTrimmedString(body.decidedBy, "decidedBy");
    const current = deps.approvalService.get(approvalId);
    if (current?.status === "expired") {
      const resumed = await requireNodeFlowService(deps).resumeApproval(current.projectId, current.runId, current.id);
      res.json({ ...current, run: resumed.run, nodeRuns: resumed.nodeRuns, attempts: resumed.attempts, output: resumed.output });
      return;
    }
    const approval = body.decision === "approve"
      ? deps.approvalService.approve(approvalId, decidedBy, body.metadata)
      : body.decision === "reject"
        ? deps.approvalService.reject(approvalId, decidedBy, body.metadata)
        : null;
    if (approval) {
      const resumed = await requireNodeFlowService(deps).resumeApproval(approval.projectId, approval.runId, approval.id);
      res.json({ ...approval, run: resumed.run, nodeRuns: resumed.nodeRuns, attempts: resumed.attempts, output: resumed.output });
    }
    else throw new HttpRouteError(400, "decision must be approve or reject.");
  }));

  app.get("/api/node-flows/:flowId/webhook", syncRoute((req, res) => {
    if (!deps.automationWebhookTriggerRepository) throw new HttpRouteError(404, "Webhook triggers are not enabled.");
    res.json(deps.automationWebhookTriggerRepository.getByFlow(requireTrimmedString(req.params.flowId, "flowId")));
  }));

  app.post("/api/node-flows/:flowId/webhook", syncRoute((req, res) => {
    if (!deps.automationWebhookTriggerRepository) throw new HttpRouteError(404, "Webhook triggers are not enabled.");
    const flowId = requireTrimmedString(req.params.flowId, "flowId");
    const flow = requireNodeFlowService(deps).get(flowId);
    if (!flow) throw new HttpRouteError(404, `Node flow not found: ${flowId}`);
    const configured = deps.automationWebhookTriggerRepository.create(flow.projectId, flow.id);
    res.status(201).json({ ...configured.trigger, pathToken: configured.pathToken, secret: configured.secret });
  }));
}

function parseRequiredBodyInteger(value: unknown, label: string): number {
  const parsed = typeof value === "string" && value.trim() ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isInteger(parsed) || parsed < 1) throw new HttpRouteError(400, `${label} must be a positive integer.`);
  return parsed;
}
