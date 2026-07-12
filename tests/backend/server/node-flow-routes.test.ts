import { createHash } from "node:crypto";
import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { registerNodeFlowRoutes } from "../../../src/server/node-flow-routes.js";
import { NodeFlowValidationError } from "../../../src/domain/node-flows/node-flow-validation.js";
import { applyDashboardPreRouteMiddleware } from "../../../src/server/dashboard-middleware.js";
import { HeadlessAuthService } from "../../../src/services/headless-auth-service.js";
import { createLogger } from "../../../src/shared/logging/logger.js";

describe("node flow routes", () => {
  it("creates project-scoped node flows through the service", async () => {
    const nodeFlowService = {
      create: vi.fn().mockReturnValue({
        id: "flow-1",
        projectId: "project-1",
        title: "Flow",
        description: "",
        graph: { nodes: [{ id: "one", type: "manual", title: "One" }], edges: [] },
        version: 1,
        createdAt: "2026-07-07T00:00:00.000Z",
        updatedAt: "2026-07-07T00:00:00.000Z",
      }),
    };
    const app = express();
    app.use(express.json());
    registerNodeFlowRoutes(app, { nodeFlowService } as any);

    const response = await request(app)
      .post("/api/projects/project-1/node-flows")
      .send({
        title: "Flow",
        graph: { nodes: [{ id: "one", type: "manual", title: "One" }], edges: [] },
      });

    expect(response.status).toBe(201);
    expect(response.body.id).toBe("flow-1");
    expect(nodeFlowService.create).toHaveBeenCalledWith("project-1", {
      title: "Flow",
      graph: { nodes: [{ id: "one", type: "manual", title: "One" }], edges: [] },
    });
  });

  it("returns validation details from service errors", async () => {
    const nodeFlowService = {
      create: vi.fn(() => {
        throw new NodeFlowValidationError("Node flow graph validation failed with 1 errors.", [
          { field: "edges", code: "cycle_detected", message: "Node flow graph must be acyclic." },
        ]);
      }),
    };
    const app = express();
    app.use(express.json());
    registerNodeFlowRoutes(app, { nodeFlowService } as any);

    const response = await request(app)
      .post("/api/projects/project-1/node-flows")
      .send({
        title: "Bad flow",
        graph: { nodes: [{ id: "one", type: "manual", title: "One" }], edges: [{ fromNodeId: "one", toNodeId: "one" }] },
      });

    expect(response.status).toBe(400);
    expect(response.body.details).toEqual([
      { field: "edges", code: "cycle_detected", message: "Node flow graph must be acyclic." },
    ]);
  });

  it("attaches and detaches agent skills", async () => {
    const nodeFlowService = {
      attachToAgent: vi.fn().mockReturnValue({
        flowId: "flow-1",
        projectId: "project-1",
        agentPresetId: "agent-1",
        skillName: "Flow skill",
        description: "",
        createdAt: "2026-07-07T00:00:00.000Z",
        updatedAt: "2026-07-07T00:00:00.000Z",
      }),
      detachFromAgent: vi.fn(),
    };
    const app = express();
    app.use(express.json());
    registerNodeFlowRoutes(app, { nodeFlowService } as any);

    const attachResponse = await request(app)
      .post("/api/node-flows/flow-1/agent-skills")
      .send({ agentPresetId: "agent-1", skillName: "Flow skill" });
    const detachResponse = await request(app)
      .delete("/api/node-flows/flow-1/agent-skills")
      .send({ agentPresetId: "agent-1" });

    expect(attachResponse.status).toBe(201);
    expect(detachResponse.status).toBe(200);
    expect(nodeFlowService.attachToAgent).toHaveBeenCalledWith("flow-1", {
      agentPresetId: "agent-1",
      skillName: "Flow skill",
    });
    expect(nodeFlowService.detachFromAgent).toHaveBeenCalledWith("flow-1", "agent-1");
  });

  it("reads persisted run summaries and node runs through service routes", async () => {
    const nodeFlowService = {
      listRuns: vi.fn().mockReturnValue({ runs: [{ id: "run-1" }] }),
      getRun: vi.fn().mockReturnValue({ id: "run-1" }),
      listNodeRuns: vi.fn().mockReturnValue({ nodeRuns: [{ id: "node-run-1" }] }),
    };
    const app = express();
    app.use(express.json());
    registerNodeFlowRoutes(app, { nodeFlowService } as any);

    expect((await request(app).get("/api/node-flows/flow-1/runs?limit=5")).body).toEqual({ runs: [{ id: "run-1" }] });
    expect((await request(app).get("/api/node-flow-runs/run-1")).body).toEqual({ id: "run-1" });
    expect((await request(app).get("/api/node-flow-runs/run-1/node-runs")).body).toEqual({ nodeRuns: [{ id: "node-run-1" }] });
    expect(nodeFlowService.listRuns).toHaveBeenCalledWith("flow-1", 5);
    expect(nodeFlowService.getRun).toHaveBeenCalledWith("run-1");
    expect(nodeFlowService.listNodeRuns).toHaveBeenCalledWith("run-1");
  });

  it("runs a node flow through the runtime service route", async () => {
    const nodeFlowService = {
      runFlow: vi.fn().mockResolvedValue({
        run: { id: "run-1", status: "succeeded", executionInvocationId: "xi-flow" },
        nodeRuns: [{ id: "node-run-1", nodeId: "input", status: "succeeded" }],
        output: { ok: true },
      }),
    };
    const app = express();
    app.use(express.json());
    registerNodeFlowRoutes(app, { nodeFlowService } as any);

    const response = await request(app)
      .post("/api/node-flows/flow-1/run")
      .send({
        projectId: "project-1",
        input: { prompt: "Ship" },
        triggerType: "manual",
      });

    expect(response.status).toBe(201);
    expect(response.body.output).toEqual({ ok: true });
    expect(nodeFlowService.runFlow).toHaveBeenCalledWith("project-1", "flow-1", { prompt: "Ship" }, {
      triggerType: "manual",
      triggerPayload: undefined,
      versionSelection: { mode: "latest_published" },
    });
  });

  it("returns HTTP 409 for optimistic draft conflicts", async () => {
    const nodeFlowService = { patchDraft: vi.fn(() => ({ conflict: { code: "draft_revision_conflict", expectedDraftRevision: 1, actualDraftRevision: 2 } })) };
    const app = express();
    app.use(express.json());
    registerNodeFlowRoutes(app, { nodeFlowService } as any);
    const response = await request(app).patch("/api/node-flow-drafts/flow-1").send({ projectId: "project-1", draftRevision: 1, operations: [] });
    expect(response.status).toBe(409);
    expect(response.body.conflict).toMatchObject({ code: "draft_revision_conflict", actualDraftRevision: 2 });
  });

  it.each(["approve", "reject"] as const)("decides and resumes the exact run for an approval %s", async (decision) => {
    const approval = { id: "approval-1", projectId: "project-1", flowId: "flow-1", runId: "run-1", nodeId: "send", logicalItem: "default", status: decision === "approve" ? "approved" : "rejected" };
    const approvalService = {
      get: vi.fn().mockReturnValue(null),
      approve: vi.fn().mockReturnValue(approval),
      reject: vi.fn().mockReturnValue(approval),
    };
    const nodeFlowService = {
      resumeApproval: vi.fn().mockResolvedValue({ run: { id: "run-1", status: decision === "approve" ? "succeeded" : "failed" }, nodeRuns: [], attempts: [], output: {} }),
    };
    const app = express(); app.use(express.json()); registerNodeFlowRoutes(app, { approvalService, nodeFlowService } as any);

    const response = await request(app).post("/api/automation-approvals/approval-1/decision").send({ decision, decidedBy: "operator" });

    expect(response.status).toBe(200);
    expect(response.body.run.id).toBe("run-1");
    expect(nodeFlowService.resumeApproval).toHaveBeenCalledWith("project-1", "run-1", "approval-1");
  });

  it("exposes an explicit idempotent approval-resume route", async () => {
    const nodeFlowService = { resumeApproval: vi.fn().mockResolvedValue({ run: { id: "run-1", status: "succeeded" }, nodeRuns: [], attempts: [] }) };
    const app = express(); app.use(express.json()); registerNodeFlowRoutes(app, { nodeFlowService } as any);
    const response = await request(app).post("/api/node-flow-runs/run-1/resume-approval").send({ projectId: "project-1", approvalId: "approval-1" });
    expect(response.status).toBe(200);
    expect(nodeFlowService.resumeApproval).toHaveBeenCalledWith("project-1", "run-1", "approval-1");
  });

  it("terminates an expired approval through the decision route without overwriting its decision", async () => {
    const expired = { id: "approval-1", projectId: "project-1", flowId: "flow-1", runId: "run-1", nodeId: "send", logicalItem: "default", status: "expired" };
    const approvalService = { get: vi.fn().mockReturnValue(expired), approve: vi.fn(), reject: vi.fn() };
    const nodeFlowService = { resumeApproval: vi.fn().mockResolvedValue({ run: { id: "run-1", status: "failed" }, nodeRuns: [], attempts: [] }) };
    const app = express(); app.use(express.json()); registerNodeFlowRoutes(app, { approvalService, nodeFlowService } as any);
    const response = await request(app).post("/api/automation-approvals/approval-1/decision").send({ decision: "approve", decidedBy: "operator" });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: "expired", run: { status: "failed" } });
    expect(approvalService.approve).not.toHaveBeenCalled();
  });

  it("denies project-scoped principals access to another project's flow and run resources", async () => {
    const token = "project-one-node-flow-token";
    const forbiddenHandler = vi.fn(() => {
      throw new Error("A forbidden node-flow handler must not run.");
    });
    const nodeFlowService = {
      resolveFlowProjectId: vi.fn((flowId: string) => flowId === "flow-two" ? "project-two" : null),
      resolveRunProjectId: vi.fn((runId: string) => runId === "run-two" ? "project-two" : null),
      get: forbiddenHandler,
      runFlow: forbiddenHandler,
      patchDraft: forbiddenHandler,
      publishDraft: forbiddenHandler,
      rollback: forbiddenHandler,
      cancelRun: forbiddenHandler,
      getRun: forbiddenHandler,
      listNodeRuns: forbiddenHandler,
      listNodeAttempts: forbiddenHandler,
      list: forbiddenHandler,
      delete: forbiddenHandler,
    };
    const approvalService = {
      resolveProjectId: vi.fn((approvalId: string) => approvalId === "approval-two" ? "project-two" : null),
      approve: forbiddenHandler,
      reject: forbiddenHandler,
    };
    const app = express();
    applyDashboardPreRouteMiddleware(app, {
      nodeFlowService,
      approvalService,
      headlessAuthService: new HeadlessAuthService({
        mode: "service_token",
        serviceIdentities: [{
          id: "project-one-automation",
          displayName: "Project one automation principal",
          tokenSha256: createHash("sha256").update(token).digest("hex"),
          roles: ["viewer", "automation_author", "automation_publisher", "automation_runner"],
          projectIds: ["project-one"],
          enabled: true,
        }],
        allowInsecureHttp: false,
        remoteCredentialManagement: false,
      }),
    } as never, createLogger({ level: "error" }));
    registerNodeFlowRoutes(app, { nodeFlowService, approvalService } as any);

    const authorized = (method: "get" | "post" | "patch" | "delete", path: string) => request(app)[method](path)
      .set("Host", "localhost")
      .set("X-Forwarded-Proto", "https")
      .set("Authorization", `Bearer ${token}`);

    await authorized("get", "/api/node-flows/flow-two").expect(403);
    await authorized("post", "/api/node-flows/flow-two/run").send({ projectId: "project-one" }).expect(403);
    await authorized("patch", "/api/node-flow-drafts/flow-two").send({ projectId: "project-one", draftRevision: 1 }).expect(403);
    await authorized("post", "/api/node-flow-drafts/flow-two/publish").send({ projectId: "project-one", draftRevision: 1, publishedBy: "principal" }).expect(403);
    await authorized("post", "/api/node-flows/flow-two/rollback").send({ projectId: "project-one", version: 1, draftRevision: 1 }).expect(403);
    await authorized("post", "/api/node-flow-runs/run-two/cancel").send({ projectId: "project-one" }).expect(403);
    await authorized("get", "/api/node-flow-runs/run-two").expect(403);
    await authorized("get", "/api/node-flow-runs/run-two/node-runs").expect(403);
    await authorized("get", "/api/node-flow-runs/run-two/attempts").expect(403);
    await authorized("get", "/api/node-flows/flow-two/webhook").expect(403);
    await authorized("post", "/api/automation-approvals/approval-two/decision").send({ decision: "approve", decidedBy: "principal" }).expect(403);
    await authorized("get", "/API/PROJECTS/project-two/NODE-FLOWS").expect(403);
    await authorized("delete", "/API/NODE-FLOWS/flow-two").expect(403);
    expect(forbiddenHandler).not.toHaveBeenCalled();
  });
});
