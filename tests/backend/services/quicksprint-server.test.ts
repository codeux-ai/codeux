import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import express from "express";
import { setupDashboardServer } from "../../../src/server/dashboard-server.js";
import * as http from "http";

vi.mock("http", async () => {
  const actual = await vi.importActual<typeof import("http")>("http");
  return {
    ...actual,
    createServer: vi.fn().mockReturnValue({
      listen: vi.fn((port, host, cb) => {
        if (cb) cb();
      }),
      on: vi.fn(),
      close: vi.fn(),
    }),
  };
});

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: vi.fn().mockReturnThis(),
} as any;

describe("dashboard-server quicksprint routes", () => {
  let app: express.Express;
  let quicksprintService: any;
  let serverHandle: any;

  beforeEach(async () => {
    app = express();
    app.use(express.json());

    quicksprintService = {
      listTemplates: vi.fn().mockReturnValue([{ id: "t1" }]),
      getTemplate: vi.fn().mockReturnValue({ id: "t1" }),
      createCustomTemplate: vi.fn().mockReturnValue({ id: "t2" }),
      updateCustomTemplate: vi.fn().mockReturnValue({ id: "t1" }),
      deleteCustomTemplate: vi.fn().mockReturnValue(undefined),
      executeQuicksprint: vi.fn().mockResolvedValue({ id: "s1" }),
    };

    serverHandle = await setupDashboardServer({
      app,
      dashboardDir: "./dummy",
      port: 8080,
      liveActivityCacheMs: 1000,
      getStatus: vi.fn(),
      getExecutionSnapshot: vi.fn(),
      getProjectExecutionSnapshot: vi.fn(),
      getProjectStatsSnapshot: vi.fn(),
      getOverviewTelemetrySnapshot: vi.fn(),
      getLiveActivities: vi.fn().mockResolvedValue({}),
      getGitStatus: vi.fn().mockResolvedValue({}),
      getExternalSettingsHints: vi.fn().mockReturnValue({}),
      getSystemSettings: vi.fn().mockReturnValue({}),
      saveSystemSettings: vi.fn(),
      resetDatabase: vi.fn(),
      getProjectSettings: vi.fn(),
      saveProjectSettings: vi.fn(),
      resetProjectSettings: vi.fn(),
      getProjectEffectiveSettings: vi.fn(),
      getSprintSettings: vi.fn(),
      saveSprintSettings: vi.fn(),
      resetSprintSettings: vi.fn(),
      getSprintEffectiveSettings: vi.fn(),
      listProjects: vi.fn(),
      createProject: vi.fn(),
      getProject: vi.fn(),
      updateProject: vi.fn(),
      deleteProject: vi.fn(),
      selectProject: vi.fn(),
      listSprints: vi.fn(),
      createSprint: vi.fn(),
      updateSprint: vi.fn(),
      deleteSprint: vi.fn(),
      importSprintFromMarkdown: vi.fn(),
      exportSprintToMarkdown: vi.fn(),
      listTasks: vi.fn(),
      createTask: vi.fn(),
      updateTask: vi.fn(),
      deleteTask: vi.fn(),
      listConnections: vi.fn(),
      updateConnection: vi.fn(),
      listAgentPresets: vi.fn(),
      createAgentPreset: vi.fn(),
      updateAgentPreset: vi.fn(),
      deleteAgentPreset: vi.fn(),
      listConversationThreads: vi.fn(),
      createConversationThread: vi.fn(),
      updateConversationThread: vi.fn(),
      deleteConversationThread: vi.fn(),
      listConversationMessages: vi.fn(),
      postConversationMessage: vi.fn(),
      rerunTask: vi.fn(),
      orchestrateSprint: vi.fn(),
      pauseSprintRun: vi.fn(),
      cancelSprintRun: vi.fn(),
      forceCancelSprintRun: vi.fn(),
      cancelTaskDispatch: vi.fn(),
      forceCancelTaskDispatch: vi.fn(),
      retryTaskDispatch: vi.fn(),
      logger: mockLogger,
      quicksprintService,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("GET /api/projects/:projectId/quicksprints/templates", async () => {
    const res = await request(app).get("/api/projects/p1/quicksprints/templates");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: "t1" }]);
    expect(quicksprintService.listTemplates).toHaveBeenCalledWith("p1");
  });

  it("GET /api/projects/:projectId/quicksprints/templates/:templateId", async () => {
    const res = await request(app).get("/api/projects/p1/quicksprints/templates/t1");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: "t1" });
    expect(quicksprintService.getTemplate).toHaveBeenCalledWith("p1", "t1");
  });

  it("GET /api/projects/:projectId/quicksprints/templates/:templateId not found", async () => {
    quicksprintService.getTemplate.mockReturnValue(null);
    const res = await request(app).get("/api/projects/p1/quicksprints/templates/t1");
    expect(res.status).toBe(404);
  });

  it("POST /api/projects/:projectId/quicksprints/templates", async () => {
    const res = await request(app).post("/api/projects/p1/quicksprints/templates").send({ name: "n" });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: "t2" });
    expect(quicksprintService.createCustomTemplate).toHaveBeenCalledWith("p1", { name: "n" });
  });

  it("PATCH /api/projects/:projectId/quicksprints/templates/:templateId", async () => {
    const res = await request(app).patch("/api/projects/p1/quicksprints/templates/t1").send({ name: "n2" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: "t1" });
    expect(quicksprintService.updateCustomTemplate).toHaveBeenCalledWith("p1", "t1", { name: "n2" });
  });

  it("DELETE /api/projects/:projectId/quicksprints/templates/:templateId", async () => {
    const res = await request(app).delete("/api/projects/p1/quicksprints/templates/t1");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(quicksprintService.deleteCustomTemplate).toHaveBeenCalledWith("p1", "t1");
  });

  it("POST /api/projects/:projectId/quicksprints/execute", async () => {
    const input = { templateId: "t1", taskCount: 3, submitMode: "plan_only" };
    const res = await request(app).post("/api/projects/p1/quicksprints/execute").send(input);
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: "s1" });
    expect(quicksprintService.executeQuicksprint).toHaveBeenCalledWith("p1", input, expect.any(AbortSignal));
  });

  it("POST /api/projects/:projectId/quicksprints/execute rejects missing JSON payload before service access", async () => {
    const res = await request(app).post("/api/projects/p1/quicksprints/execute");
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Missing or empty required field: templateId" });
    expect(quicksprintService.executeQuicksprint).not.toHaveBeenCalled();
  });

  it("Handles missing quicksprintService", async () => {
      // Create a specific app setup just for this
      const app2 = express();
      app2.use(express.json());
      await setupDashboardServer({
          app: app2,
          dashboardDir: "./dummy",
          port: 8081,
          liveActivityCacheMs: 1000,
          getStatus: vi.fn(),
          getExecutionSnapshot: vi.fn(),
          getProjectExecutionSnapshot: vi.fn(),
          getProjectStatsSnapshot: vi.fn(),
          getOverviewTelemetrySnapshot: vi.fn(),
          getLiveActivities: vi.fn().mockResolvedValue({}),
          getGitStatus: vi.fn().mockResolvedValue({}),
          getExternalSettingsHints: vi.fn().mockReturnValue({}),
          getSystemSettings: vi.fn().mockReturnValue({}),
          saveSystemSettings: vi.fn(),
          resetDatabase: vi.fn(),
          getProjectSettings: vi.fn(),
          saveProjectSettings: vi.fn(),
          resetProjectSettings: vi.fn(),
          getProjectEffectiveSettings: vi.fn(),
          getSprintSettings: vi.fn(),
          saveSprintSettings: vi.fn(),
          resetSprintSettings: vi.fn(),
          getSprintEffectiveSettings: vi.fn(),
          listProjects: vi.fn(),
          createProject: vi.fn(),
          getProject: vi.fn(),
          updateProject: vi.fn(),
          deleteProject: vi.fn(),
          selectProject: vi.fn(),
          listSprints: vi.fn(),
          createSprint: vi.fn(),
          updateSprint: vi.fn(),
          deleteSprint: vi.fn(),
          importSprintFromMarkdown: vi.fn(),
          exportSprintToMarkdown: vi.fn(),
          listTasks: vi.fn(),
          createTask: vi.fn(),
          updateTask: vi.fn(),
          deleteTask: vi.fn(),
          listConnections: vi.fn(),
          updateConnection: vi.fn(),
          listAgentPresets: vi.fn(),
          createAgentPreset: vi.fn(),
          updateAgentPreset: vi.fn(),
          deleteAgentPreset: vi.fn(),
          listConversationThreads: vi.fn(),
          createConversationThread: vi.fn(),
          updateConversationThread: vi.fn(),
          deleteConversationThread: vi.fn(),
          listConversationMessages: vi.fn(),
          postConversationMessage: vi.fn(),
          rerunTask: vi.fn(),
          orchestrateSprint: vi.fn(),
          pauseSprintRun: vi.fn(),
          cancelSprintRun: vi.fn(),
          forceCancelSprintRun: vi.fn(),
          cancelTaskDispatch: vi.fn(),
          forceCancelTaskDispatch: vi.fn(),
          retryTaskDispatch: vi.fn(),
          logger: mockLogger,
      });
      const res = await request(app2).get("/api/projects/p1/quicksprints/templates");
      expect(res.status).toBe(404);
      const res2 = await request(app2).get("/api/projects/p1/quicksprints/templates/t1");
      expect(res2.status).toBe(404);
      const res3 = await request(app2).post("/api/projects/p1/quicksprints/templates").send({});
      expect(res3.status).toBe(404);
      const res4 = await request(app2).patch("/api/projects/p1/quicksprints/templates/t1").send({});
      expect(res4.status).toBe(404);
      const res5 = await request(app2).delete("/api/projects/p1/quicksprints/templates/t1");
      expect(res5.status).toBe(404);
      const res6 = await request(app2).post("/api/projects/p1/quicksprints/execute").send({});
      expect(res6.status).toBe(404);
  });

  it("Handles exceptions gracefully", async () => {
      quicksprintService.listTemplates.mockImplementation(() => { throw new Error("Oops"); });
      const res = await request(app).get("/api/projects/p1/quicksprints/templates");
      expect(res.status).toBe(500);

      quicksprintService.getTemplate.mockImplementation(() => { throw new Error("Oops"); });
      const res2 = await request(app).get("/api/projects/p1/quicksprints/templates/t1");
      expect(res2.status).toBe(500);

      quicksprintService.createCustomTemplate.mockImplementation(() => { throw new Error("Oops"); });
      const res3 = await request(app).post("/api/projects/p1/quicksprints/templates").send({});
      expect(res3.status).toBe(500);

      quicksprintService.updateCustomTemplate.mockImplementation(() => { throw new Error("Oops"); });
      const res4 = await request(app).patch("/api/projects/p1/quicksprints/templates/t1").send({});
      expect(res4.status).toBe(500);

      quicksprintService.deleteCustomTemplate.mockImplementation(() => { throw new Error("Oops"); });
      const res5 = await request(app).delete("/api/projects/p1/quicksprints/templates/t1");
      expect(res5.status).toBe(500);

      quicksprintService.executeQuicksprint.mockImplementation(() => { throw new Error("Oops"); });
      const res6 = await request(app).post("/api/projects/p1/quicksprints/execute").send({
        templateId: "t1",
        taskCount: 3,
        submitMode: "plan_only",
      });
      expect(res6.status).toBe(500);
  });
});
