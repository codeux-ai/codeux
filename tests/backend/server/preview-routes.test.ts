import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { registerPreviewRoutes } from "../../../src/server/preview-routes.js";

describe("preview routes", () => {
  it("passes selected preview port from query without forwarding selector parameters upstream", async () => {
    const proxySprintPreviewRequest = vi.fn(async () => ({
      status: 200,
      headers: { "content-type": "text/plain" },
      body: Buffer.from("ok"),
    }));
    const app = express();
    registerPreviewRoutes(app, { proxySprintPreviewRequest } as any);

    const response = await request(app)
      .get("/api/browser/sessions/session-1/proxy/assets/app.js?previewPort=5173&cache=1");

    expect(response.status).toBe(200);
    expect(proxySprintPreviewRequest).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: "session-1",
      path: "/assets/app.js?cache=1",
      selectedPort: "5173",
    }));
  });

  it("passes selected preview port from header when no selector query is present", async () => {
    const proxySprintPreviewRequest = vi.fn(async () => ({
      status: 200,
      headers: {},
      body: Buffer.from("ok"),
    }));
    const app = express();
    registerPreviewRoutes(app, { proxySprintPreviewRequest } as any);

    const response = await request(app)
      .get("/api/browser/sessions/session-1/proxy/")
      .set("x-code-ux-preview-port", "5556");

    expect(response.status).toBe(200);
    expect(proxySprintPreviewRequest).toHaveBeenCalledWith(expect.objectContaining({
      path: "/",
      selectedPort: "5556",
    }));
  });
});
