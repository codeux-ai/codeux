import express, { type Express } from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { HttpRouteError } from "../../../src/server/http-errors.js";
import { registerConversationRoutes } from "../../../src/server/conversation-routes.js";
import { registerExecutionControlRoutes } from "../../../src/server/execution-control-routes.js";
import type { DashboardDependencies } from "../../../src/server/dashboard-server.js";
import type { OnboardingDependencyInstallerResult } from "../../../src/contracts/app-types.js";
import { registerPlanningRoutes } from "../../../src/server/planning-routes.js";
import { registerProjectRoutes } from "../../../src/server/project-routes.js";
import { registerRuntimeRoutes } from "../../../src/server/runtime-routes.js";
import { registerSettingsRoutes } from "../../../src/server/settings-routes.js";
import { toErrorResponse } from "../../../src/server/route-utils.js";
import { registerSprintRoutes } from "../../../src/server/sprint-routes.js";
import { registerTaskRoutes } from "../../../src/server/task-routes.js";
import { EntityNotFoundError, ValidationError } from "../../../src/repositories/repository-utils.js";
import { ProviderRoutingError } from "../../../src/services/provider-routing-error.js";

const createApp = (...registrars: Array<(app: Express) => void>): Express => {
  const app = express();
  app.use(express.json());
  for (const register of registrars) {
    register(app);
  }
  return app;
};

const onboardingInstallResult = (): OnboardingDependencyInstallerResult => ({
  mode: "docker-engine-git",
  platform: "linux",
  status: "success",
  commands: [
    {
      id: "apt-install-docker",
      groupId: "linux-engine-packages",
      label: "Install Docker Engine packages",
      command: "apt-get",
      args: ["install", "-y", "docker.io", "docker-compose-plugin"],
      displayCommand: "apt-get install -y docker.io docker-compose-plugin",
      status: "success",
      timeoutMs: 120_000,
      maxStdoutChars: 4_000,
      maxStderrChars: 4_000,
      code: 0,
      stdoutSummary: "bounded output",
      stderrSummary: "",
    },
  ],
  skippedDependencyGroups: [],
  requiresPrivilege: false,
  requiresManualDownload: false,
  postInstallGuidance: ["Rerun readiness checks."],
  message: "Installer commands completed.",
});

describe("dashboard route handlers", () => {
  it.each([
    {
      label: "ValidationError",
      route: "/api/status",
      deps: {
        getStatus: () => {
          throw new ValidationError("Invalid status request");
        },
      },
      status: 400,
      body: { error: "Invalid status request" },
      expectedNextError: null,
    },
    {
      label: "parser-style Invalid error",
      route: "/api/projects/project-1/stats?window=custom&from=2024-01-02&to=2024-01-01",
      deps: {
        getProjectStatsSnapshot: () => ({ ok: true }),
      },
      status: 400,
      body: { error: "Invalid custom stats window: start must be earlier than or equal to end." },
      expectedNextError: null,
    },
    {
      label: "parser-style Missing error",
      route: "/api/status",
      deps: {
        getStatus: () => {
          throw new Error("Missing required test field");
        },
      },
      status: 400,
      body: { error: "Missing required test field" },
      expectedNextError: null,
    },
    {
      label: "EntityNotFoundError",
      route: "/api/status",
      deps: {
        getStatus: () => {
          throw new EntityNotFoundError("Project not found");
        },
      },
      status: 404,
      body: { error: "Project not found" },
      expectedNextError: null,
    },
    {
      label: "explicit HttpRouteError",
      route: "/api/status",
      deps: {
        getStatus: () => {
          throw new HttpRouteError(409, "Route conflict");
        },
      },
      status: 409,
      body: { error: "Route conflict" },
      expectedNextError: null,
    },
    {
      label: "explicit forbidden HttpRouteError",
      route: "/api/status",
      deps: {
        getStatus: () => {
          throw new HttpRouteError(403, "Forbidden request");
        },
      },
      status: 403,
      body: { error: "Forbidden request" },
      expectedNextError: null,
    },
    {
      label: "provider routing error",
      route: "/api/status",
      deps: {
        getStatus: () => {
          throw new ProviderRoutingError("Invocation planning selected Claude Local, but it is not eligible because that provider instance is disabled.");
        },
      },
      status: 409,
      body: { error: "Invocation planning selected Claude Local, but it is not eligible because that provider instance is disabled." },
      expectedNextError: null,
    },
    {
      label: "unexpected sync error",
      route: "/api/status",
      deps: {
        getStatus: () => {
          throw new Error("database connection string leaked");
        },
      },
      status: 500,
      body: { error: "Internal Server Error" },
      expectedNextError: "database connection string leaked",
    },
    {
      label: "unexpected async error",
      route: "/api/live",
      deps: {
        getLiveSnapshot: async () => {
          throw new Error("provider token leaked");
        },
      },
      status: 500,
      body: { error: "Internal Server Error" },
      expectedNextError: "provider token leaked",
    },
  ])("maps $label through dashboard route wrappers", async ({ route, deps, status, body, expectedNextError }) => {
    const delegatedErrors: unknown[] = [];
    const app = createApp((router) => registerRuntimeRoutes(router, deps as DashboardDependencies));
    app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      delegatedErrors.push(error);
      if (!res.headersSent) {
        res.status(500).json({ error: "error middleware fallback" });
      }
    });

    const response = await request(app).get(route);

    expect(response.status).toBe(status);
    expect(response.body).toEqual(body);
    if (expectedNextError) {
      expect(delegatedErrors).toHaveLength(1);
      expect(delegatedErrors[0]).toBeInstanceOf(Error);
      expect((delegatedErrors[0] as Error).message).toBe(expectedNextError);
    } else {
      expect(delegatedErrors).toEqual([]);
    }
  });

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
      getSprint: () => ({ projectId: "project-1" }),
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
      getHeaderTokenThroughputSnapshot: (query: { window: string; projectId?: string | null }) => query,
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
    const headerThroughput = await request(app).get("/api/stats/header-throughput?projectId=project-1&window=1h");
    expect(headerThroughput.status).toBe(200);
    expect(headerThroughput.body).toEqual({ window: "1h", projectId: "project-1" });
    expect((await request(app).get("/api/stats/header-throughput?window=bogus")).status).toBe(400);
    expect((await request(app).get("/api/stats/header-throughput?projectId=%20%20")).status).toBe(400);
    expect((await request(app).get("/api/projects/project-1/execution")).status).toBe(200);
    expect((await request(app).get("/api/projects/project-1/stats?window=24h")).status).toBe(200);
    expect((await request(app).get("/api/projects/project-1/stats?window=custom")).status).toBe(400);
    expect((await request(app).get("/api/projects/project-1/stats?window=custom&from=invalid&to=2024-01-01")).status).toBe(400);
    expect((await request(app).get("/api/projects/project-1/stats?window=custom&from=2024-01-02&to=2024-01-01")).status).toBe(400);
    expect((await request(app).get("/api/projects/project-1/stats?window=custom&from=1999-01-01&to=2024-01-01")).status).toBe(400);
    expect((await request(app).get("/api/projects/project-1/stats?window=custom&from=2024-01-01&to=2050-01-01")).status).toBe(400);
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
        installers: {
          platform: "linux",
          recommendedMode: "docker-engine-git",
          options: [],
        },
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

  it("delegates onboarding dependency installation only with valid mode and explicit confirmation", async () => {
    const installOnboardingDependencies = vi.fn(async () => onboardingInstallResult());
    const logger = { info: vi.fn() };
    const app = createApp((router) => registerSettingsRoutes(router, {
      installOnboardingDependencies,
      logger,
    } as unknown as DashboardDependencies, 1000));

    const response = await request(app)
      .post("/api/onboarding/dependencies/install")
      .send({ mode: "docker-engine-git", confirmInstall: true });

    expect(response.status).toBe(200);
    expect(installOnboardingDependencies).toHaveBeenCalledTimes(1);
    expect(installOnboardingDependencies).toHaveBeenCalledWith("docker-engine-git");
    expect(response.body).toMatchObject({
      mode: "docker-engine-git",
      platform: "linux",
      status: "success",
    });
    expect(logger.info).toHaveBeenCalledWith("Onboarding dependency installation completed", expect.objectContaining({
      mode: "docker-engine-git",
      platform: "linux",
      outcome: "success",
      commandLabels: ["Install Docker Engine packages"],
    }));
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain("bounded output");
  });

  it("rejects unsupported onboarding dependency installer modes", async () => {
    const installOnboardingDependencies = vi.fn(async () => onboardingInstallResult());
    const app = createApp((router) => registerSettingsRoutes(router, {
      installOnboardingDependencies,
    } as unknown as DashboardDependencies, 1000));

    const response = await request(app)
      .post("/api/onboarding/dependencies/install")
      .send({ mode: "curl https://example.test/install.sh | sh", confirmInstall: true });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "Unsupported onboarding dependency installer mode." });
    expect(installOnboardingDependencies).not.toHaveBeenCalled();
  });

  it("rejects onboarding dependency installation without explicit confirmation", async () => {
    const installOnboardingDependencies = vi.fn(async () => onboardingInstallResult());
    const app = createApp((router) => registerSettingsRoutes(router, {
      installOnboardingDependencies,
    } as unknown as DashboardDependencies, 1000));

    const response = await request(app)
      .post("/api/onboarding/dependencies/install")
      .send({ mode: "docker-engine-git" });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "Dependency installation requires explicit confirmation." });
    expect(installOnboardingDependencies).not.toHaveBeenCalled();
  });

  it("returns 404 when onboarding dependency installer wiring is unavailable", async () => {
    const app = createApp((router) => registerSettingsRoutes(router, {} as DashboardDependencies, 1000));

    const response = await request(app)
      .post("/api/onboarding/dependencies/install")
      .send({ mode: "docker-engine-git", confirmInstall: true });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Onboarding dependency installation is not available." });
  });

  it("does not expose raw installer error output in onboarding dependency install responses", async () => {
    const delegatedErrors: unknown[] = [];
    const app = createApp((router) => registerSettingsRoutes(router, {
      installOnboardingDependencies: async () => {
        throw new Error(`raw command output ${"x".repeat(5_000)}`);
      },
    } as unknown as DashboardDependencies, 1000));
    app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      delegatedErrors.push(error);
      if (!res.headersSent) {
        res.status(500).json({ error: "error middleware fallback" });
      }
    });

    const response = await request(app)
      .post("/api/onboarding/dependencies/install")
      .send({ mode: "docker-engine-git", confirmInstall: true });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: "Internal Server Error" });
    expect(JSON.stringify(response.body)).not.toContain("raw command output");
    expect(delegatedErrors).toHaveLength(1);
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
      cancelThreadTurn: async () => ({ cancelled: true }),
      deleteConversationThread: () => undefined,
      listConversationMessages: () => [],
      postConversationMessage: () => ({ id: "message-1" }),
      listConversationMessageHistory: () => [],
      recordConversationMessageHistory: () => ({ id: "history-1" }),
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
    expect((await request(app).post("/api/conversations/threads/thread-1/cancel")).status).toBe(200);
    expect((await request(app).delete("/api/conversations/threads/thread-1")).status).toBe(200);
    expect((await request(app).get("/api/conversations/threads/thread-1/messages")).status).toBe(200);
    expect((await request(app).post("/api/projects/project-1/conversations/messages").send({ bodyMarkdown: "Hello" })).status).toBe(201);
    expect((await request(app).post("/api/projects/project-1/conversations/messages").send({ bodyMarkdown: "   " })).status).toBe(400);
    expect((await request(app).get("/api/projects/project-1/conversations/message-history").set("X-CodeUX-Dashboard-User-Id", "user-1")).status).toBe(200);
    expect((await request(app).get("/api/projects/project-1/conversations/message-history")).status).toBe(400);
    expect((await request(app).post("/api/projects/project-1/conversations/message-history").set("X-CodeUX-Dashboard-User-Id", "user-1").send({ bodyMarkdown: "Hello" })).status).toBe(201);
    expect((await request(app).post("/api/projects/project-1/conversations/message-history").set("X-CodeUX-Dashboard-User-Id", "user-1").send({ bodyMarkdown: "   " })).status).toBe(400);

    const failingMessageApp = createApp((router) => registerConversationRoutes(router, {
      ...conversationDeps,
      postConversationMessage: async () => {
        throw new Error("async chat failure");
      },
    } as unknown as DashboardDependencies));
    const failedMessageResponse = await request(failingMessageApp)
      .post("/api/projects/project-1/conversations/messages")
      .send({ bodyMarkdown: "Hello" });
    expect(failedMessageResponse.status).toBe(500);
    expect(failedMessageResponse.body).toEqual({ error: "Internal Server Error" });

    const disabledApp = createApp((router) => registerConversationRoutes(router, {} as DashboardDependencies));
    expect((await request(disabledApp).put("/api/conversations/threads/thread-1/route").send({ routeKind: "worker" })).status).toBe(404);
    expect((await request(disabledApp).post("/api/conversations/threads/thread-1/compact")).status).toBe(404);
    expect((await request(disabledApp).post("/api/conversations/threads/thread-1/cancel")).status).toBe(404);
    expect((await request(disabledApp).get("/api/projects/project-1/conversations/message-history").set("X-CodeUX-Dashboard-User-Id", "user-1")).status).toBe(404);
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
