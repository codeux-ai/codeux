import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { registerPreviewRoutes } from "../../../src/server/preview-routes.js";
import { EntityNotFoundError } from "../../../src/repositories/repository-utils.js";

describe("preview routes", () => {
  it("passes selected preview port from query without forwarding selector parameters upstream", async () => {
    const proxySprintPreviewRequestForProjectSprint = vi.fn(async () => ({
      status: 200,
      headers: { "content-type": "text/plain" },
      body: Buffer.from("ok"),
    }));
    const app = express();
    registerPreviewRoutes(app, { proxySprintPreviewRequestForProjectSprint } as any);

    const response = await request(app)
      .get("/api/projects/project-a/sprints/sprint-a/preview/sessions/session-1/proxy/assets/app.js?previewPort=5173&cache=1");

    expect(response.status).toBe(200);
    expect(proxySprintPreviewRequestForProjectSprint).toHaveBeenCalledWith("project-a", "sprint-a", expect.objectContaining({
      sessionId: "session-1",
      path: "/assets/app.js?cache=1",
      selectedPort: "5173",
    }));
  });

  it("passes selected preview port from header when no selector query is present", async () => {
    const proxySprintPreviewRequestForProjectSprint = vi.fn(async () => ({
      status: 200,
      headers: {},
      body: Buffer.from("ok"),
    }));
    const app = express();
    registerPreviewRoutes(app, { proxySprintPreviewRequestForProjectSprint } as any);

    const response = await request(app)
      .get("/api/projects/project-a/sprints/sprint-a/preview/sessions/session-1/proxy/")
      .set("x-code-ux-preview-port", "5556");

    expect(response.status).toBe(200);
    expect(proxySprintPreviewRequestForProjectSprint).toHaveBeenCalledWith("project-a", "sprint-a", expect.objectContaining({
      path: "/",
      selectedPort: "5556",
    }));
  });

  it("requires project and sprint scope on legacy session control routes", async () => {
    const app = express();
    const rebuildSprintPreviewSessionForProjectSprint = vi.fn();
    registerPreviewRoutes(app, { rebuildSprintPreviewSessionForProjectSprint } as any);

    const response = await request(app)
      .post("/api/browser/sessions/session-1/rebuild");

    expect(response.status).toBe(400);
    expect(rebuildSprintPreviewSessionForProjectSprint).not.toHaveBeenCalled();
  });

  it("allows owning project routes to control a preview session", async () => {
    const rebuildSprintPreviewSessionForProjectSprint = vi.fn(async () => ({
      id: "session-1",
      projectId: "project-a",
      sprintId: "sprint-a",
      status: "running",
    }));
    const app = express();
    registerPreviewRoutes(app, { rebuildSprintPreviewSessionForProjectSprint } as any);

    const response = await request(app)
      .post("/api/projects/project-a/sprints/sprint-a/preview/sessions/session-1/rebuild");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: "session-1",
      projectId: "project-a",
      sprintId: "sprint-a",
    });
    expect(rebuildSprintPreviewSessionForProjectSprint).toHaveBeenCalledWith("project-a", "sprint-a", "session-1");
  });

  it("updates environment overrides through the scoped project route", async () => {
    const updateSprintPreviewEnvironmentOverrides = vi.fn(async () => ({
      id: "session-1",
      projectId: "project-a",
      sprintId: "sprint-a",
      environmentOverrides: [{ key: "CODE_UX_ALLOW_PUBLIC_DASHBOARD", value: "1", enabled: true }],
    }));
    const app = express();
    app.use(express.json());
    registerPreviewRoutes(app, { updateSprintPreviewEnvironmentOverrides } as any);

    const response = await request(app)
      .put("/api/projects/project-a/sprints/sprint-a/preview/sessions/session-1/environment")
      .send({
        environmentOverrides: [
          { key: "CODE_UX_ALLOW_PUBLIC_DASHBOARD", value: "1", enabled: true },
        ],
      });

    expect(response.status).toBe(200);
    expect(updateSprintPreviewEnvironmentOverrides).toHaveBeenCalledWith(
      "project-a",
      "sprint-a",
      "session-1",
      [{ key: "CODE_UX_ALLOW_PUBLIC_DASHBOARD", value: "1", enabled: true }],
    );
  });

  it("updates a startup command override through the scoped project route", async () => {
    const updateSprintPreviewStartupCommandOverride = vi.fn(async () => ({
      id: "session-1",
      projectId: "project-a",
      sprintId: "sprint-a",
      startupCommandOverride: "pnpm dev",
    }));
    const app = express();
    app.use(express.json());
    registerPreviewRoutes(app, { updateSprintPreviewStartupCommandOverride } as any);

    const response = await request(app)
      .put("/api/projects/project-a/sprints/sprint-a/preview/sessions/session-1/startup-command")
      .send({ startupCommandOverride: "pnpm dev" });

    expect(response.status).toBe(200);
    expect(updateSprintPreviewStartupCommandOverride).toHaveBeenCalledWith(
      "project-a",
      "sprint-a",
      "session-1",
      "pnpm dev",
    );
  });

  it("rejects a non-string startup command override", async () => {
    const updateSprintPreviewStartupCommandOverride = vi.fn();
    const app = express();
    app.use(express.json());
    registerPreviewRoutes(app, { updateSprintPreviewStartupCommandOverride } as any);

    const response = await request(app)
      .put("/api/projects/project-a/sprints/sprint-a/preview/sessions/session-1/startup-command")
      .send({ startupCommandOverride: { command: "pnpm dev" } });

    expect(response.status).toBe(400);
    expect(updateSprintPreviewStartupCommandOverride).not.toHaveBeenCalled();
  });

  it("rejects an unsafe startup command override", async () => {
    const updateSprintPreviewStartupCommandOverride = vi.fn();
    const app = express();
    app.use(express.json());
    registerPreviewRoutes(app, { updateSprintPreviewStartupCommandOverride } as any);

    const response = await request(app)
      .put("/api/projects/project-a/sprints/sprint-a/preview/sessions/session-1/startup-command")
      .send({ startupCommandOverride: "bad\0command" });

    expect(response.status).toBe(400);
    expect(updateSprintPreviewStartupCommandOverride).not.toHaveBeenCalled();
  });

  it("hides foreign preview sessions behind a generic not found response", async () => {
    const stopSprintPreviewSessionForProjectSprint = vi.fn(async () => {
      throw new EntityNotFoundError("Sprint preview session not found.");
    });
    const getSprintPreviewLogsForProjectSprint = vi.fn(async () => {
      throw new EntityNotFoundError("Sprint preview session not found.");
    });
    const proxySprintPreviewRequestForProjectSprint = vi.fn(async () => {
      throw new EntityNotFoundError("Sprint preview session not found.");
    });
    const app = express();
    registerPreviewRoutes(app, {
      stopSprintPreviewSessionForProjectSprint,
      getSprintPreviewLogsForProjectSprint,
      proxySprintPreviewRequestForProjectSprint,
    } as any);

    const stopResponse = await request(app)
      .post("/api/projects/project-b/sprints/sprint-b/preview/sessions/session-1/stop");
    const logsResponse = await request(app)
      .get("/api/projects/project-b/sprints/sprint-b/preview/sessions/session-1/logs");
    const proxyResponse = await request(app)
      .get("/api/projects/project-b/sprints/sprint-b/preview/sessions/session-1/proxy/");

    expect(stopResponse.status).toBe(404);
    expect(logsResponse.status).toBe(404);
    expect(proxyResponse.status).toBe(404);
    expect(stopResponse.body.error).toBe("Sprint preview session not found.");
    expect(logsResponse.body.error).toBe("Sprint preview session not found.");
    expect(proxyResponse.body.error).toBe("Sprint preview session not found.");
  });
});
