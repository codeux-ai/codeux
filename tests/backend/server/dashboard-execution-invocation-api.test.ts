import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { setupDashboardServer } from "../../../src/server/dashboard-server.js";
import type { DashboardServerOptions } from "../../../src/server/dashboard-server.js";
import express from "express";

describe("Dashboard Execution Invocation API", () => {
  let app: express.Express;
  let mockOptions: Partial<DashboardServerOptions>;

  beforeEach(() => {
    app = express();
    app.use(express.json());

    mockOptions = {
      app,
      listProjectInvocations: vi.fn(),
      listInvocationMessages: vi.fn(),
      // Add required mocks to pass setupDashboardServer validation even if unused in these tests
      dashboardDir: "/mock/dir",
      port: 3000,
      liveActivityCacheMs: 1000,
      getStatus: vi.fn(),
      getExecutionSnapshot: vi.fn(),
      getProjectExecutionSnapshot: vi.fn(),
      getProjectStatsSnapshot: vi.fn(),
      getOverviewTelemetrySnapshot: vi.fn(),
      getLiveActivities: vi.fn(),
      getGitStatus: vi.fn(),
      getExternalSettingsHints: vi.fn(),
      getSystemSettings: vi.fn(),
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
      selectSprint: vi.fn(),
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
    };

    setupDashboardServer(mockOptions as DashboardServerOptions);
  });

  describe("GET /api/projects/:projectId/execution/invocations", () => {
    it("returns list of invocations for a project", async () => {
      const mockInvocations = [
        { id: "inv-1", projectId: "proj-1", status: "completed" },
        { id: "inv-2", projectId: "proj-1", status: "running" },
      ];
      vi.mocked(mockOptions.listProjectInvocations!).mockReturnValue(mockInvocations as any);

      const response = await request(app).get("/api/projects/proj-1/execution/invocations");

      expect(response.status).toBe(200);
      expect(response.body).toEqual(mockInvocations);
      expect(mockOptions.listProjectInvocations).toHaveBeenCalledWith("proj-1");
    });

    it("returns invocation usage fields when present and zero values when no provider invocation is linked", async () => {
      const mockInvocations = [
        {
          id: "inv-1",
          projectId: "proj-1",
          status: "completed",
          inputTokens: 100,
          cachedInputTokens: 10,
          outputTokens: 50,
          totalTokens: 150,
        },
        {
          id: "inv-2",
          projectId: "proj-1",
          status: "running",
          inputTokens: 0,
          cachedInputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
        },
      ];
      vi.mocked(mockOptions.listProjectInvocations!).mockReturnValue(mockInvocations as any);

      const response = await request(app).get("/api/projects/proj-1/execution/invocations");

      expect(response.status).toBe(200);
      expect(response.body).toEqual(mockInvocations);
      expect(mockOptions.listProjectInvocations).toHaveBeenCalledWith("proj-1");
    });

    it("handles errors when listing invocations", async () => {
      vi.mocked(mockOptions.listProjectInvocations!).mockImplementation(() => {
        throw new Error("DB Error");
      });

      const response = await request(app).get("/api/projects/proj-1/execution/invocations");

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: "Internal Server Error" });
    });
  });

  describe("GET /api/execution/invocations/:invocationId/messages", () => {
    it("returns list of messages for an invocation", async () => {
      const mockMessages = [
        { id: "msg-1", invocationId: "inv-1", role: "user", contentMarkdown: "hello" },
        { id: "msg-2", invocationId: "inv-1", role: "assistant", contentMarkdown: "hi" },
      ];
      vi.mocked(mockOptions.listInvocationMessages!).mockReturnValue(mockMessages as any);

      const response = await request(app).get("/api/execution/invocations/inv-1/messages");

      expect(response.status).toBe(200);
      expect(response.body).toEqual(mockMessages);
      expect(mockOptions.listInvocationMessages).toHaveBeenCalledWith("inv-1");
    });

    it("handles errors when listing invocation messages", async () => {
      vi.mocked(mockOptions.listInvocationMessages!).mockImplementation(() => {
        throw new Error("DB Error");
      });

      const response = await request(app).get("/api/execution/invocations/inv-1/messages");

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: "Internal Server Error" });
    });
  });
});
