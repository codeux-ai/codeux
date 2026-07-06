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

  it("strips dashboard credentials and proxy control headers before dispatching API proxy requests", async () => {
    const proxySprintPreviewRequest = vi.fn(async () => ({
      status: 200,
      headers: {},
      body: Buffer.from("ok"),
    }));
    const app = express();
    registerPreviewRoutes(app, { proxySprintPreviewRequest } as any);

    const response = await request(app)
      .get("/api/browser/sessions/session-1/proxy/api/data")
      .set("Authorization", "Bearer dashboard-token")
      .set("Cookie", "dashboardSession=secret")
      .set("Set-Cookie", "should-not-forward=true")
      .set("Host", "localhost:4444")
      .set("Connection", "keep-alive")
      .set("Upgrade", "websocket")
      .set("Transfer-Encoding", "chunked")
      .set("Accept-Encoding", "gzip")
      .set("Proxy-Authorization", "Basic secret")
      .set("X-Code-UX-Preview-Port", "5556")
      .set("X-Custom", "allowed");

    expect(response.status).toBe(200);
    const dispatched = proxySprintPreviewRequest.mock.calls[0][0];
    expect(dispatched.selectedPort).toBe("5556");
    expect(dispatched.headers).toMatchObject({ "x-custom": "allowed" });
    expect(dispatched.headers.authorization).toBeUndefined();
    expect(dispatched.headers.cookie).toBeUndefined();
    expect(dispatched.headers["set-cookie"]).toBeUndefined();
    expect(dispatched.headers.host).toBeUndefined();
    expect(dispatched.headers.connection).toBeUndefined();
    expect(dispatched.headers.upgrade).toBeUndefined();
    expect(dispatched.headers["transfer-encoding"]).toBeUndefined();
    expect(dispatched.headers["accept-encoding"]).toBeUndefined();
    expect(dispatched.headers["proxy-authorization"]).toBeUndefined();
    expect(dispatched.headers["x-code-ux-preview-port"]).toBeUndefined();
  });

  it("strips unsafe proxy response headers from the dashboard API origin", async () => {
    const proxySprintPreviewRequest = vi.fn(async () => ({
      status: 200,
      headers: {
        "content-type": "text/plain",
        "set-cookie": "preview=true",
        "content-security-policy": "default-src 'none'",
        "content-security-policy-report-only": "default-src 'self'",
        "x-frame-options": "DENY",
        "x-custom": "allowed",
      },
      body: Buffer.from("ok"),
    }));
    const app = express();
    registerPreviewRoutes(app, { proxySprintPreviewRequest } as any);

    const response = await request(app)
      .get("/api/browser/sessions/session-1/proxy/");

    expect(response.status).toBe(200);
    expect(response.headers["set-cookie"]).toBeUndefined();
    expect(response.headers["content-security-policy"]).toBeUndefined();
    expect(response.headers["content-security-policy-report-only"]).toBeUndefined();
    expect(response.headers["x-frame-options"]).toBeUndefined();
    expect(response.headers["x-custom"]).toBe("allowed");
  });
});
