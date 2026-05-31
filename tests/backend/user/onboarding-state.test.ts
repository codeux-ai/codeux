import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { registerSettingsRoutes } from "../../../src/server/settings-routes.js";
import type { DashboardDependencies } from "../../../src/server/dashboard-server.js";

describe("user onboarding state routes", () => {
  it("returns onboarding state and persists complete/cancel actions", async () => {
    const getOnboardingState = vi.fn(() => ({ onboardingCompletedAt: null }));
    const markOnboardingCompleted = vi.fn(() => ({ onboardingCompletedAt: "2026-05-31T00:00:00.000Z" }));
    const resetOnboardingState = vi.fn(() => ({ onboardingCompletedAt: null }));

    const app = express();
    app.use(express.json());
    registerSettingsRoutes(app, {
      getOnboardingState,
      markOnboardingCompleted,
      resetOnboardingState,
      listDockerContainers: async () => [],
      getLiveActivities: async () => ({}),
      getSystemSettings: () => ({}),
      saveSystemSettings: (settings: unknown) => settings,
      resetDatabase: async () => undefined,
      getExternalSettingsHints: () => ({}),
      getGitStatus: async () => ({}),
    } as unknown as DashboardDependencies, 1000);

    const initial = await request(app).get("/api/user/onboarding");
    expect(initial.status).toBe(200);
    expect(initial.body).toEqual({ completed: false, onboardingCompletedAt: null });

    const completed = await request(app).post("/api/user/onboarding/complete");
    expect(completed.status).toBe(200);
    expect(completed.body.completed).toBe(true);
    expect(markOnboardingCompleted).toHaveBeenCalledTimes(1);

    const cancelled = await request(app).post("/api/user/onboarding/cancel");
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.completed).toBe(true);
    expect(markOnboardingCompleted).toHaveBeenCalledTimes(2);

    const reset = await request(app).post("/api/user/onboarding/reset");
    expect(reset.status).toBe(200);
    expect(reset.body).toEqual({ completed: false, onboardingCompletedAt: null });
    expect(resetOnboardingState).toHaveBeenCalledTimes(1);
  });
});
