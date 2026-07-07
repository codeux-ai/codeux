import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { registerNodeFlowRoutes } from "../../../src/server/node-flow-routes.js";
import { NodeFlowValidationError } from "../../../src/domain/node-flows/node-flow-validation.js";

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
    });
  });
});
