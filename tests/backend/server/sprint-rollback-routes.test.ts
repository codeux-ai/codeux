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

describe("sprint rollback routes", () => {
  it("returns the rollback safety assessment", async () => {
    const assessSprintRollback = vi.fn().mockResolvedValue({
      sourceSprintId: "sprint-1",
      eligible: true,
      recommendedMode: "automatic",
      reasons: ["Safe isolated merge."],
    });
    const response = await request(createApp({ assessSprintRollback }))
      .get("/api/projects/project-1/sprints/sprint-1/rollback/assessment");

    expect(response.status).toBe(200);
    expect(response.body.recommendedMode).toBe("automatic");
    expect(assessSprintRollback).toHaveBeenCalledWith("project-1", "sprint-1");
  });

  it("starts a rollback with scoped user instructions", async () => {
    const createSprintRollback = vi.fn().mockResolvedValue({
      mode: "agent_assisted",
      rollbackSprint: { id: "rollback-1" },
      assessment: { eligible: true, recommendedMode: "agent_assisted", reasons: [] },
    });
    const response = await request(createApp({ createSprintRollback }))
      .post("/api/projects/project-1/sprints/sprint-1/rollback")
      .send({ instructions: "Remove only feature XY." });

    expect(response.status).toBe(202);
    expect(response.body.rollbackSprint.id).toBe("rollback-1");
    expect(createSprintRollback).toHaveBeenCalledWith("project-1", "sprint-1", {
      instructions: "Remove only feature XY.",
    });
  });

  it("returns validation failures without starting a rollback", async () => {
    const createSprintRollback = vi.fn().mockRejectedValue(new Error("Only completed sprints can be rolled back."));
    const response = await request(createApp({ createSprintRollback }))
      .post("/api/projects/project-1/sprints/sprint-1/rollback")
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("Only completed sprints");
  });

  it("rejects malformed instructions instead of selecting an automatic rollback", async () => {
    const createSprintRollback = vi.fn();
    const response = await request(createApp({ createSprintRollback }))
      .post("/api/projects/project-1/sprints/sprint-1/rollback")
      .send({ instructions: { scope: "feature XY" } });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("instructions must be a string");
    expect(createSprintRollback).not.toHaveBeenCalled();
  });
});
