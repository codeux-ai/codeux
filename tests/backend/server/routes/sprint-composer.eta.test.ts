import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { registerSprintComposerRoutes } from "../../../../src/server/routes/sprint-composer.js";
import { PLANNING_ETA_FALLBACK_MS } from "../../../../src/domain/sprint/composer/eta-estimator.js";

describe("Sprint Composer ETA Route", () => {
  const setupApp = (deps: any) => {
    const app = express();
    app.use(express.json());
    registerSprintComposerRoutes(app, deps);
    return app;
  };

  it("returns ETA estimate based on recent project planning invocations", async () => {
    const mockListInvocations = vi.fn().mockReturnValue([
      { type: "planning", status: "completed", startedAt: "2026-05-31T10:00:00Z", finishedAt: "2026-05-31T10:01:00Z" }, // 60s
      { type: "planning", status: "completed", startedAt: "2026-05-31T09:00:00Z", finishedAt: "2026-05-31T09:02:00Z" }, // 120s
      { type: "other", status: "completed", startedAt: "2026-05-31T08:00:00Z", finishedAt: "2026-05-31T08:05:00Z" }, // Should be ignored
    ]);

    const app = setupApp({ listProjectInvocations: mockListInvocations });
    const response = await request(app).get("/api/projects/p1/sprints/composer/eta");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      estimatedMs: 90000, // (60 + 120) / 2 = 90
      sampleSize: 2,
      isFallback: false,
    });
    expect(mockListInvocations).toHaveBeenCalledWith("p1");
  });

  it("respects the 10-record limit", async () => {
    const manyInvocations = Array.from({ length: 15 }, (_, i) => ({
      type: "planning",
      status: "completed",
      startedAt: "2026-05-31T10:00:00Z",
      finishedAt: `2026-05-31T10:00:${(i + 1).toString().padStart(2, '0')}Z`, // 1s to 15s
    }));

    const mockListInvocations = vi.fn().mockReturnValue(manyInvocations);
    const app = setupApp({ listProjectInvocations: mockListInvocations });
    const response = await request(app).get("/api/projects/p1/sprints/composer/eta");

    expect(response.status).toBe(200);
    expect(response.body.sampleSize).toBe(10);
    // Average of 1..10 is 5.5s
    expect(response.body.estimatedMs).toBe(5500);
  });

  it("returns fallback if no planning invocations found", async () => {
    const mockListInvocations = vi.fn().mockReturnValue([]);
    const app = setupApp({ listProjectInvocations: mockListInvocations });
    const response = await request(app).get("/api/projects/p1/sprints/composer/eta");

    expect(response.status).toBe(200);
    expect(response.body.estimatedMs).toBe(PLANNING_ETA_FALLBACK_MS);
    expect(response.body.isFallback).toBe(true);
  });
});
