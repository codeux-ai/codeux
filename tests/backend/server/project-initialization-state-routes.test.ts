import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { DashboardDependencies } from "../../../src/server/dashboard-server.js";
import { registerProjectRoutes } from "../../../src/server/project-routes.js";

function createApp(overrides: Partial<DashboardDependencies>) {
  const app = express();
  app.use(express.json());
  registerProjectRoutes(app, {
    listProjects: vi.fn(),
    getProject: vi.fn(),
    ...overrides,
  } as DashboardDependencies);
  return app;
}

describe("project initialization state route", () => {
  it("returns the lightweight initialization state", async () => {
    const state = {
      projectId: "project-1",
      initializationMode: "new-local" as const,
      repositoryState: "initial" as const,
      canCreateInitialAppQuickactions: true,
    };
    const app = createApp({
      getProject: vi.fn(() => ({ id: "project-1", initializationMode: "new-local" } as never)),
      getProjectInitializationState: vi.fn(async () => state),
    });

    const response = await request(app).get("/api/projects/project-1/initialization-state");
    expect(response.status).toBe(200);
    expect(response.body).toEqual(state);
  });

  it("fails closed when inspection is unavailable or the project does not exist", async () => {
    const unavailableApp = createApp({
      getProject: vi.fn(() => ({ id: "project-1", initializationMode: "new-remote" } as never)),
    });
    const unavailable = await request(unavailableApp).get("/api/projects/project-1/initialization-state");
    expect(unavailable.status).toBe(200);
    expect(unavailable.body).toMatchObject({
      initializationMode: "new-remote",
      repositoryState: "unavailable",
      canCreateInitialAppQuickactions: false,
    });

    const failedInspectionApp = createApp({
      getProject: vi.fn(() => ({ id: "project-1", initializationMode: "new-local" } as never)),
      getProjectInitializationState: vi.fn(async () => { throw new Error("git failed"); }),
    });
    const failedInspection = await request(failedInspectionApp).get("/api/projects/project-1/initialization-state");
    expect(failedInspection.status).toBe(200);
    expect(failedInspection.body).toMatchObject({
      repositoryState: "unavailable",
      canCreateInitialAppQuickactions: false,
    });

    const missingApp = createApp({ getProject: vi.fn(() => null) });
    const missing = await request(missingApp).get("/api/projects/missing/initialization-state");
    expect(missing.status).toBe(404);
    expect(missing.body.canCreateInitialAppQuickactions).toBe(false);
  });
});
