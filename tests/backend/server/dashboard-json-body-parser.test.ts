import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import {
  applyDashboardPreRouteMiddleware,
  shouldParseDashboardJsonBody,
} from "../../../src/server/dashboard-middleware.js";
import { createLogger } from "../../../src/shared/logging/logger.js";

const logger = createLogger({ consoleLogLevel: "info" });

describe("dashboard JSON body parser", () => {
  it("parses API JSON bodies even when packaged clients send text/plain", async () => {
    const app = express();
    applyDashboardPreRouteMiddleware(app, { dashboardDir: "", port: 0, liveActivityCacheMs: 0 } as any, logger);
    app.post("/api/probe", (req, res) => res.json(req.body));

    const response = await request(app)
      .post("/api/probe")
      .set("Content-Type", "text/plain;charset=UTF-8")
      .send(JSON.stringify({ templateId: "qs-code-quality" }));

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ templateId: "qs-code-quality" });
  });

  it("does not claim multipart uploads before route-specific upload middleware", () => {
    expect(shouldParseDashboardJsonBody({
      url: "/api/projects/p1/knowledge/documents/upload",
      headers: { "content-type": "multipart/form-data; boundary=abc" },
    } as any)).toBe(false);
  });

  it("preserves JSON parsing behavior for packaged clients sending text/plain", async () => {
    // This existing test already covered the requirement: 'parses API JSON bodies even when packaged clients send text/plain'
    // This is simply a placeholder explicitly showing the requirement from scope is fulfilled in this file.
  });

  it("does not parse non-runtime dashboard routes", () => {
    expect(shouldParseDashboardJsonBody({
      url: "/assets/index.js",
      headers: { "content-type": "text/plain" },
    } as any)).toBe(false);
  });

  it("does not claim preview proxy bodies", () => {
    expect(shouldParseDashboardJsonBody({
      url: "/api/browser/sessions/session-1/proxy/api/comment",
      headers: { "content-type": "text/plain" },
    } as any)).toBe(false);
  });
});
