import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { registerLiveTaskRoutes } from "../../../../src/server/routes/live-tasks.js";

describe("POST /api/projects/:projectId/tasks/:taskId/force-complete", () => {
  let app: express.Express;
  let deps: any;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    deps = {
      forceCompleteTask: vi.fn().mockResolvedValue(undefined),
    };
    registerLiveTaskRoutes(app, deps);
  });

  it("should call forceCompleteTask and return 200", async () => {
    const response = await request(app)
      .post("/api/projects/p1/tasks/t1/force-complete")
      .send({ reason: "Completed manually" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
    expect(deps.forceCompleteTask).toHaveBeenCalledWith("p1", "t1", "Completed manually");
  });

  it("should return 400 if reason is missing", async () => {
    const response = await request(app)
      .post("/api/projects/p1/tasks/t1/force-complete")
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("reason is required");
    expect(deps.forceCompleteTask).not.toHaveBeenCalled();
  });

  it("should return 400 if reason is empty", async () => {
    const response = await request(app)
      .post("/api/projects/p1/tasks/t1/force-complete")
      .send({ reason: "  " });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("reason is required");
    expect(deps.forceCompleteTask).not.toHaveBeenCalled();
  });
});
