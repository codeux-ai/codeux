import { describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { registerRuntimeAssetsRoutes } from "../../../src/server/runtime-assets-routes.js";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../../src/repositories/settings-defaults.js";

describe("runtime asset routes", () => {
  const createApp = () => {
    const app = express();
    app.use(express.json());
    const prepare = vi.fn(async () => ({ volumeName: "tool-volume" }));
    const providerStatus = {
      provider: "codex",
      state: "ready",
      installedVersion: "1.2.3",
      targetVersion: "1.2.3",
      progressPercent: 100,
      stepText: "Codex is ready.",
      error: null,
      retryable: true,
      updatedAt: new Date().toISOString(),
    };
    const browserStatus = {
      state: "ready",
      installedVersion: "1.61.1",
      targetVersion: "1.61.1",
      progressPercent: 100,
      stepText: "Playwright browser is ready.",
      error: null,
      retryable: true,
      updatedAt: new Date().toISOString(),
    };
    registerRuntimeAssetsRoutes(app, {
      getSystemSettings: () => ({ defaults: DEFAULT_DASHBOARD_SETTINGS }) as any,
      managedRuntimeService: {
        getStatus: () => ({ state: "ready", activeVersion: "abc" }),
      } as any,
      providerToolManager: {
        getStatuses: () => [providerStatus],
        getStatus: () => providerStatus,
        prepare,
      } as any,
      playwrightBrowserManager: {
        getStatus: () => browserStatus,
        prepare: vi.fn(async () => ({ volumeName: "browser-volume" })),
      } as any,
      logger: { info: vi.fn() },
    } as any);
    return { app, prepare };
  };

  it("returns runtime and provider preparation status", async () => {
    const { app } = createApp();
    const response = await request(app).get("/api/runtime-assets/status");
    expect(response.status).toBe(200);
    expect(response.body.managedRuntime).toMatchObject({ state: "ready", activeVersion: "abc" });
    expect(response.body.playwrightBrowser).toMatchObject({ state: "ready", installedVersion: "1.61.1" });
    expect(response.body.providers[0]).toMatchObject({ provider: "codex", installedVersion: "1.2.3" });
  });

  it("starts an idempotent supported provider preparation", async () => {
    const { app, prepare } = createApp();
    const response = await request(app).post("/api/provider-tools/codex/prepare");
    expect(response.status).toBe(202);
    expect(response.body).toMatchObject({ provider: "codex", state: "ready" });
    await vi.waitFor(() => expect(prepare).toHaveBeenCalledTimes(1));
  });

  it("starts idempotent Playwright browser preparation", async () => {
    const { app } = createApp();
    const response = await request(app).post("/api/playwright-browser/prepare");
    expect(response.status).toBe(202);
    expect(response.body).toMatchObject({ state: "ready", installedVersion: "1.61.1" });
  });

  it.each(["jules", "mockup-cli", "unknown"])("rejects unsupported provider %s", async (provider) => {
    const { app, prepare } = createApp();
    const response = await request(app).post(`/api/provider-tools/${provider}/prepare`);
    expect(response.status).toBe(400);
    expect(prepare).not.toHaveBeenCalled();
  });
});
