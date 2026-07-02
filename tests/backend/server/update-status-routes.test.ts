import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { registerUpdateStatusRoutes } from "../../../src/server/update-status-routes.js";

describe("update status routes", () => {
  it("returns update status from the dashboard dependency", async () => {
    const getUpdateStatus = vi.fn().mockResolvedValue({
      currentVersion: "0.8.9",
      latestVersion: "0.9.0",
      updateAvailable: true,
      checkedAt: "2026-07-02T00:00:00.000Z",
    });

    const app = express();
    registerUpdateStatusRoutes(app, { getUpdateStatus } as any);

    const response = await request(app).get("/api/system/update-status");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      currentVersion: "0.8.9",
      latestVersion: "0.9.0",
      updateAvailable: true,
      checkedAt: "2026-07-02T00:00:00.000Z",
    });
    expect(getUpdateStatus).toHaveBeenCalledTimes(1);
  });
});
