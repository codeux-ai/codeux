import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { registerSprintRoutes } from "../../../src/server/sprint-routes.js";
import type { DashboardDependencies } from "../../../src/server/dashboard-server.js";

function createApp(deps: Partial<DashboardDependencies>): express.Express {
  const app = express();
  app.use(express.json());
  registerSprintRoutes(app, deps as DashboardDependencies);
  return app;
}

describe("sprint manual action routes", () => {
  it("marks a sprint completed through the runtime-aware action", async () => {
    const markSprintCompleted = vi.fn().mockResolvedValue({ id: "sprint-1", status: "completed" });

    const response = await request(createApp({ markSprintCompleted }))
      .post("/api/sprints/sprint-1/complete");

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("completed");
    expect(markSprintCompleted).toHaveBeenCalledWith("sprint-1");
  });

  it("records a manual sprint QA pass", async () => {
    const markSprintQaPassed = vi.fn().mockResolvedValue({
      id: "sprint-1",
      latestReview: { status: "completed", outcome: "pass" },
    });

    const response = await request(createApp({ markSprintQaPassed }))
      .post("/api/sprints/sprint-1/qa-pass");

    expect(response.status).toBe(200);
    expect(response.body.latestReview.outcome).toBe("pass");
    expect(markSprintQaPassed).toHaveBeenCalledWith("sprint-1");
  });

  it("returns a scoped error when manual completion cannot stop the active runtime", async () => {
    const markSprintCompleted = vi.fn().mockRejectedValue(new Error("Active sprint runtime could not be stopped."));

    const response = await request(createApp({ markSprintCompleted }))
      .post("/api/sprints/sprint-1/complete");

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("Active sprint runtime could not be stopped");
  });

  it("fails closed when the manual QA action is not configured", async () => {
    const response = await request(createApp({}))
      .post("/api/sprints/sprint-1/qa-pass");

    expect(response.status).toBe(501);
    expect(response.body.error).toContain("not available");
  });
});
