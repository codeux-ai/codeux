import re

# Looks like dashboard-server is lowering our coverage a lot because of the quicksprints route. Let's add tests for dashboard-server routes using supertest.
with open("tests/backend/services/quicksprint-server.test.ts", "w") as f:
    f.write("""
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import { setupDashboardServer } from "../../../src/server/dashboard-server.js";

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
      port: 0, // Pick random available
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
    if (serverHandle?.server) {
      serverHandle.server.close();
    }
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
    const res = await request(app).post("/api/projects/p1/quicksprints/execute").send({ templateId: "t1" });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: "s1" });
    expect(quicksprintService.executeQuicksprint).toHaveBeenCalledWith("p1", { templateId: "t1" });
  });
});
""")
