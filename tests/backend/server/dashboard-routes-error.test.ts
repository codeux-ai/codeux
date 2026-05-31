import express, { type Express } from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { registerConversationRoutes } from "../../../src/server/conversation-routes.js";
import { registerExecutionControlRoutes } from "../../../src/server/execution-control-routes.js";
import type { DashboardDependencies } from "../../../src/server/dashboard-server.js";
import { registerPlanningRoutes } from "../../../src/server/planning-routes.js";
import { registerProjectRoutes } from "../../../src/server/project-routes.js";
import { registerRuntimeRoutes } from "../../../src/server/runtime-routes.js";
import { registerSettingsRoutes } from "../../../src/server/settings-routes.js";
import { toErrorResponse } from "../../../src/server/route-utils.js";
import { registerSprintRoutes } from "../../../src/server/sprint-routes.js";
import { registerTaskRoutes } from "../../../src/server/task-routes.js";

const createApp = (...registrars: Array<(app: Express) => void>): Express => {
  const app = express();
  app.use(express.json());
  for (const register of registrars) {
    register(app);
  }
  return app;
};

describe("dashboard route handlers", () => {
  it("covers project route errors, success branches, and 404 handling", async () => {
    const projectDeps = {
      listProjects: () => [{ id: "project-1" }],
      createProject: () => { throw new Error("project create"); },
      getProject: (projectId: string) => projectId === "project-1" ? { id: projectId } : null,
      getProjectSettings: () => { throw new Error("project settings"); },
      saveProjectSettings: () => { throw new Error("project save"); },
      resetProjectSettings: () => { throw new Error("project reset"); },
      getProjectEffectiveSettings: () => { throw new Error("project effective"); },
      updateProject: () => { throw new Error("project update"); },
      deleteProject: () => { throw new Error("project delete"); },
      selectProject: () => "project-1",
      selectSprint: () => "sprint-1",
    } as unknown as DashboardDependencies;

    const app = createApp((router) => registerProjectRoutes(router, projectDeps));

    expect((await request(app).get("/api/projects")).status).toBe(200);
    expect((await request(app).post("/api/projects").send({})).status).toBe(400);
    expect((await request(app).get("/api/projects/project-1")).status).toBe(200);
    expect((await request(app).get("/api/projects/missing")).status).toBe(404);
    expect((await request(app).get("/api/projects/project-1/settings")).status).toBe(400);
    expect((await request(app).put("/api/projects/project-1/settings").send({})).status).toBe(400);
    expect((await request(app).delete("/api/projects/project-1/settings")).status).toBe(400);
    expect((await request(app).get("/api/projects/project-1/settings/effective")).status).toBe(400);
    expect((await request(app).patch("/api/projects/project-1").send({})).status).toBe(400);
    expect((await request(app).delete("/api/projects/project-1")).status).toBe(400);
    expect((await request(app).put("/api/projects/project-1/select")).status).toBe(200);
    expect((await request(app).put("/api/projects/project-1/selected-sprint").send({ sprintId: "sprint-1" })).status).toBe(200);
    expect((await request(app).put("/api/projects/project-1/selected-sprint").send({})).status).toBe(200);
  });

  it("covers sprint route errors, success branches, and validation", async () => {
    const sprintDeps = {
      listSprints: () => ({ sprints: [] }),
      createSprint: () => { throw new Error("sprint create"); },
      importSprintFromMarkdown: () => ({ id: "sprint-1" }),
      exportSprintToMarkdown: () => ({ markdown: "# sprint" }),
      updateSprint: () => { throw new Error("sprint update"); },
      getSprintSettings: () => { throw new Error("sprint settings"); },
      saveSprintSettings: () => ({ ok: true }),
      resetSprintSettings: () => { throw new Error("sprint reset"); },
      getSprintEffectiveSettings: () => ({ settings: {}, sources: {} }),
      deleteSprint: () => { throw new Error("sprint delete"); },
    } as unknown as DashboardDependencies;

    const app = createApp((router) => registerSprintRoutes(router, sprintDeps));

    expect((await request(app).get("/api/projects/project-1/sprints")).status).toBe(200);
    expect((await request(app).post("/api/projects/project-1/sprints").send({})).status).toBe(400);
    expect((await request(app).post("/api/projects/project-1/sprints/import").send({})).status).toBe(201);
    expect((await request(app).get("/api/projects/project-1/sprints/sprint-1/export")).status).toBe(200);
    expect((await request(app).patch("/api/sprints/sprint-1").send({})).status).toBe(400);
    expect((await request(app).get("/api/sprints/sprint-1/settings")).status).toBe(400);
    expect((await request(app).put("/api/sprints/sprint-1/settings").send({})).status).toBe(400);
    expect((await request(app).put("/api/sprints/sprint-1/settings").send({ projectId: "project-1" })).status).toBe(200);
    expect((await request(app).delete("/api/sprints/sprint-1/settings")).status).toBe(400);
    expect((await request(app).get("/api/projects/project-1/sprints/sprint-1/settings/effective")).status).toBe(200);
    expect((await request(app).delete("/api/sprints/sprint-1")).status).toBe(400);
  });

  it("covers task route errors and query parsing", async () => {
    const taskDeps = {
      listTasks: (_projectId: string, sprintId?: string | null) => [{ id: sprintId ?? "task-1" }],
      createTask: () => { throw new Error("task create"); },
      updateTask: () => { throw new Error("task update"); },
      deleteTask: () => { throw new Error("task delete"); },
    } as unknown as DashboardDependencies;

    const app = createApp((router) => registerTaskRoutes(router, taskDeps));

    expect((await request(app).get("/api/projects/project-1/tasks")).status).toBe(200);
    expect((await request(app).get("/api/projects/project-1/tasks?sprintId=sprint-1")).status).toBe(200);
    expect((await request(app).get("/api/projects/project-1/tasks?sprintId=%20%20%20")).status).toBe(200);
    expect((await request(app).post("/api/projects/project-1/tasks").send({})).status).toBe(400);
    expect((await request(app).patch("/api/tasks/task-1").send({})).status).toBe(400);
    expect((await request(app).delete("/api/tasks/task-1")).status).toBe(400);
  });

  it("covers runtime routes, stats parsing, and optional feature guards", async () => {
    const runtimeDeps = {
      getStatus: () => ({ ok: true }),
      getExecutionSnapshot: () => ({ projectId: null }),
      getLiveSnapshot: async () => ({ projectId: null }),
      getOverviewTelemetrySnapshot: () => ({ updatedAt: null }),
      getProjectExecutionSnapshot: () => ({ projectId: "project-1" }),
      getProjectStatsSnapshot: (_projectId: string, query: { window: string; from?: string; to?: string }) => query,
      setPreferredWorker: (_projectId: string, payload: unknown) => payload,
      claimAttentionItem: (_projectId: string, _attentionItemId: string, payload: unknown) => payload,
      resolveAttentionItem: (_projectId: string, _attentionItemId: string, payload: unknown) => payload,
    } as unknown as DashboardDependencies;

    const disabledDeps = {} as DashboardDependencies;

    const app = createApp(
      (router) => registerRuntimeRoutes(router, runtimeDeps),
      (router) => registerRuntimeRoutes(router, disabledDeps),
    );

    expect((await request(app).get("/api/status")).status).toBe(200);
    expect((await request(app).get("/api/execution")).status).toBe(200);
    expect((await request(app).get("/api/live")).status).toBe(200);
    expect((await request(app).get("/api/telemetry/overview")).status).toBe(200);
    expect((await request(app).get("/api/projects/project-1/execution")).status).toBe(200);
    expect((await request(app).get("/api/projects/project-1/stats?window=24h")).status).toBe(200);
    expect((await request(app).get("/api/projects/project-1/stats?window=custom")).status).toBe(400);
    expect((await request(app).put("/api/projects/project-1/preferred-worker").send({ workerEndpointId: "worker-1" })).status).toBe(200);
    expect((await request(app).post("/api/projects/project-1/attention-items/item-1/claim").send({ claimReason: "test" })).status).toBe(200);
    expect((await request(app).post("/api/projects/project-1/attention-items/item-1/resolve").send({ status: "resolved" })).status).toBe(200);

    const disabledApp = createApp((router) => registerRuntimeRoutes(router, disabledDeps));
    expect((await request(disabledApp).put("/api/projects/project-1/preferred-worker").send({})).status).toBe(501);
    expect((await request(disabledApp).post("/api/projects/project-1/attention-items/item-1/claim").send({})).status).toBe(501);
    expect((await request(disabledApp).post("/api/projects/project-1/attention-items/item-1/resolve").send({})).status).toBe(501);
  });

  it("returns onboarding readiness payload from settings routes", async () => {
    const settingsDeps = {
      getOnboardingRuntimeReadiness: async () => ({
        checkedAt: "2026-05-12T00:00:00.000Z",
        cluster: {
          status: "not_ready",
          label: "Cluster not ready",
          detail: "Docker must be installed and running before containerized provider CLIs can execute tasks.",
        },
        dependencies: [
          {
            id: "docker-daemon",
            label: "Docker daemon",
            status: "missing",
            required: true,
            description: "Docker daemon is not available.",
            resolution: "Start Docker Desktop or Docker Engine.",
          },
        ],
        providers: [],
      }),
      listDockerContainers: async () => [],
      getLiveActivities: async () => ({}),
      getSystemSettings: () => ({}),
      saveSystemSettings: (settings: unknown) => settings,
      resetDatabase: async () => undefined,
      getExternalSettingsHints: () => ({}),
      getGitStatus: async () => ({}),
    } as unknown as DashboardDependencies;

    const app = createApp((router) => registerSettingsRoutes(router, settingsDeps, 1000));
    const response = await request(app).get("/api/onboarding/readiness");

    expect(response.status).toBe(200);
    expect(response.body.cluster.label).toBe("Cluster not ready");
    expect(response.body.dependencies[0].id).toBe("docker-daemon");
  });

  it("covers execution control routes and body validation", async () => {
    const controlDeps = {
      rerunTask: async () => ({ id: "task-1" }),
      orchestrateSprint: async () => ({ ok: true }),
      pauseSprintRun: async () => ({ ok: true }),
      resumeSprintRun: async () => ({ ok: true }),
      cancelSprintRun: async () => ({ ok: true }),
      forceCancelSprintRun: async () => ({ ok: true }),
      cancelTaskDispatch: async () => ({ ok: true }),
      forceCancelTaskDispatch: async () => ({ ok: true }),
      retryTaskDispatch: async () => ({ ok: true }),
    } as unknown as DashboardDependencies;

    const app = createApp((router) => registerExecutionControlRoutes(router, controlDeps));

    expect((await request(app).post("/api/tasks/task-1/rerun").send({ provider: "jules" })).status).toBe(200);
    expect((await request(app).post("/api/tasks/task-1/rerun").send(null)).status).toBe(400);
    expect((await request(app).post("/api/projects/project-1/sprints/sprint-1/orchestrate")).status).toBe(202);
    expect((await request(app).post("/api/sprint-runs/run-1/pause")).status).toBe(200);
    expect((await request(app).post("/api/sprint-runs/run-1/resume")).status).toBe(200);
    expect((await request(app).post("/api/sprint-runs/run-1/cancel")).status).toBe(200);
    expect((await request(app).post("/api/sprint-runs/run-1/force-cancel")).status).toBe(200);
    expect((await request(app).post("/api/task-dispatches/dispatch-1/cancel")).status).toBe(200);
    expect((await request(app).post("/api/task-dispatches/dispatch-1/force-cancel")).status).toBe(200);
    expect((await request(app).post("/api/task-dispatches/dispatch-1/retry")).status).toBe(200);
  });

  it("covers conversation routes, validation, and optional feature guards", async () => {
    const conversationDeps = {
      listConversationThreads: () => [],
      createConversationThread: () => ({ id: "thread-1" }),
      updateConversationThread: () => ({ id: "thread-1" }),
      updateThreadRoute: () => ({ id: "thread-1" }),
      compactThreadSession: async () => ({ ok: true }),
      deleteConversationThread: () => undefined,
      listConversationMessages: () => [],
      postConversationMessage: () => ({ id: "message-1" }),
    } as unknown as DashboardDependencies;

    const app = createApp((router) => registerConversationRoutes(router, conversationDeps));

    expect((await request(app).get("/api/projects/project-1/conversations/threads")).status).toBe(200);
    expect((await request(app).post("/api/projects/project-1/conversations/threads").send({ title: "Thread" })).status).toBe(201);
    expect((await request(app).post("/api/projects/project-1/conversations/threads").send({ title: "   " })).status).toBe(400);
    expect((await request(app).post("/api/projects/project-1/conversations/threads").send({ title: "Thread", scope: "invalid" })).status).toBe(400);
    expect((await request(app).patch("/api/conversations/threads/thread-1").send({ connectionId: null })).status).toBe(200);
    expect((await request(app).patch("/api/conversations/threads/thread-1").send(null)).status).toBe(400);
    expect((await request(app).put("/api/conversations/threads/thread-1/route").send({ routeKind: "worker", workerEndpointId: "worker-1" })).status).toBe(200);
    expect((await request(app).put("/api/conversations/threads/thread-1/route").send({ routeKind: "invalid" })).status).toBe(400);
    expect((await request(app).post("/api/conversations/threads/thread-1/compact")).status).toBe(200);
    expect((await request(app).delete("/api/conversations/threads/thread-1")).status).toBe(200);
    expect((await request(app).get("/api/conversations/threads/thread-1/messages")).status).toBe(200);
    expect((await request(app).post("/api/projects/project-1/conversations/messages").send({ bodyMarkdown: "Hello" })).status).toBe(201);
    expect((await request(app).post("/api/projects/project-1/conversations/messages").send({ bodyMarkdown: "   " })).status).toBe(400);

    const failingMessageApp = createApp((router) => registerConversationRoutes(router, {
      ...conversationDeps,
      postConversationMessage: async () => {
        throw new Error("async chat failure");
      },
    } as unknown as DashboardDependencies));
    const failedMessageResponse = await request(failingMessageApp)
      .post("/api/projects/project-1/conversations/messages")
      .send({ bodyMarkdown: "Hello" });
    expect(failedMessageResponse.status).toBe(400);
    expect(failedMessageResponse.body).toEqual({ error: "async chat failure" });

    const disabledApp = createApp((router) => registerConversationRoutes(router, {} as DashboardDependencies));
    expect((await request(disabledApp).put("/api/conversations/threads/thread-1/route").send({ routeKind: "worker" })).status).toBe(404);
    expect((await request(disabledApp).post("/api/conversations/threads/thread-1/compact")).status).toBe(404);
  });

  it("covers planning routes, validation, and optional feature guards", async () => {
    const planningDeps = {
      improveSprintPrompt: async () => ({ ok: true }),
      planSprint: async () => ({ ok: true }),
    } as unknown as DashboardDependencies;

    const app = createApp((router) => registerPlanningRoutes(router, planningDeps));

    expect((await request(app).post("/api/projects/project-1/planning/improve-sprint-prompt").send({ name: "Sprint", goal: "Ship it" })).status).toBe(202);
    expect((await request(app).post("/api/projects/project-1/planning/improve-sprint-prompt").send(null)).status).toBe(400);
    expect((await request(app).post("/api/projects/project-1/sprints/sprint-1/plan").send({ autoStart: true })).status).toBe(202);
    expect((await request(app).post("/api/projects/project-1/sprints/sprint-1/plan").send(null)).status).toBe(400);
    expect((await request(app).post("/api/planning-requests/request-1/cancel")).status).toBe(202);

    const disabledApp = createApp((router) => registerPlanningRoutes(router, {} as DashboardDependencies));
    expect((await request(disabledApp).post("/api/projects/project-1/planning/improve-sprint-prompt").send({})).status).toBe(404);
    expect((await request(disabledApp).post("/api/projects/project-1/sprints/sprint-1/plan").send({})).status).toBe(404);
  });
});

describe("toErrorResponse", () => {
  it("formats Error values", () => {
    expect(toErrorResponse(new Error("boom"), "Prefix")).toEqual({ error: "Prefix: boom" });
  });

  it("formats non-Error values", () => {
    expect(toErrorResponse("boom", "Prefix")).toEqual({ error: "Prefix: boom" });
    expect(toErrorResponse({ message: "boom" }, "Prefix")).toEqual({ error: "Prefix: [object Object]" });
  });
});
