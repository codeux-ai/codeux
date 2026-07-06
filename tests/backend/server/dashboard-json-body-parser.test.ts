import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import {
  applyDashboardPreRouteMiddleware,
  shouldParseDashboardJsonBody,
} from "../../../src/server/dashboard-middleware.js";
import type { Logger, LogMetadata } from "../../../src/shared/logging/logger.js";

const createTestLogger = (): Logger & { warn: ReturnType<typeof vi.fn> } => {
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(),
  };
  logger.child.mockReturnValue(logger);
  return logger as Logger & { warn: (message: string, metadata?: LogMetadata) => void } & { warn: ReturnType<typeof vi.fn> };
};

const createApp = (logger: Logger = createTestLogger()): express.Express => {
  const app = express();
  applyDashboardPreRouteMiddleware(app, { dashboardDir: "", port: 0, liveActivityCacheMs: 0 }, logger);
  return app;
};

describe("dashboard JSON body parser", () => {
  it("parses small normal API JSON payloads", async () => {
    const app = createApp();
    app.post("/api/probe", (req, res) => res.json(req.body));

    const response = await request(app)
      .post("/api/probe")
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ templateId: "qs-code-quality" }));

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ templateId: "qs-code-quality" });
  });

  it("rejects unsupported content types on JSON runtime endpoints", async () => {
    const logger = createTestLogger();
    const app = createApp(logger);
    app.post("/api/probe", (req, res) => res.json(req.body));

    const response = await request(app)
      .post("/api/probe")
      .set("Content-Type", "text/plain;charset=UTF-8")
      .send(JSON.stringify({ templateId: "qs-code-quality" }));

    expect(response.status).toBe(415);
    expect(response.body).toEqual({ error: "Unsupported Content-Type. Use application/json." });
    expect(logger.warn).toHaveBeenCalledWith(
      "Rejected dashboard JSON request with unsupported content type",
      expect.objectContaining({ logPurpose: "security", reason: "unsupported_content_type" })
    );
  });

  it("rejects oversized non-settings JSON payloads before route handlers", async () => {
    const logger = createTestLogger();
    const app = createApp(logger);
    app.post("/api/probe", (_req, res) => res.json({ ok: true }));

    const response = await request(app)
      .post("/api/probe")
      .set("Content-Type", "application/json")
      .send({ value: "x".repeat(2 * 1024 * 1024) });

    expect(response.status).toBe(413);
    expect(response.body).toEqual({ error: "JSON request body exceeds maximum allowed size." });
    expect(logger.warn).toHaveBeenCalledWith(
      "Rejected oversized dashboard JSON request body",
      expect.objectContaining({ logPurpose: "security", reason: "json_body_too_large" })
    );
  });

  it("allows large settings image payloads on documented settings routes", async () => {
    const app = createApp();
    app.put("/api/system-settings", (req, res) => {
      res.json({ imageLength: req.body?.defaults?.appearance?.backgroundImage?.length });
    });

    const backgroundImage = `data:image/png;base64,${"a".repeat(2 * 1024 * 1024)}`;
    const response = await request(app)
      .put("/api/system-settings")
      .set("Content-Type", "application/json")
      .send({ defaults: { appearance: { backgroundImage } } });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ imageLength: backgroundImage.length });
  });

  it("rejects malformed JSON without echoing the request body", async () => {
    const logger = createTestLogger();
    const app = createApp(logger);
    app.post("/api/probe", (req, res) => res.json(req.body));

    const response = await request(app)
      .post("/api/probe")
      .set("Content-Type", "application/json")
      .send("{\"templateId\":");

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "Invalid JSON request body." });
    expect(logger.warn).toHaveBeenCalledWith(
      "Rejected malformed dashboard JSON request body",
      expect.objectContaining({ logPurpose: "request", reason: "malformed_json" })
    );
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("templateId");
  });

  it("does not claim multipart uploads before route-specific upload middleware", async () => {
    expect(shouldParseDashboardJsonBody({
      method: "POST",
      url: "/api/projects/p1/knowledge/documents/upload",
      headers: { "content-type": "multipart/form-data; boundary=abc" },
    } as any)).toBe(false);

    const app = createApp();
    app.post("/api/projects/:projectId/knowledge/documents/upload", (req, res) => {
      res.json({ parsedByDashboardJsonParser: req.body !== undefined });
    });

    const response = await request(app)
      .post("/api/projects/p1/knowledge/documents/upload")
      .field("title", "note");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ parsedByDashboardJsonParser: false });
  });

  it("does not parse non-runtime dashboard routes", () => {
    expect(shouldParseDashboardJsonBody({
      method: "POST",
      url: "/assets/index.js",
      headers: { "content-type": "application/json" },
    } as any)).toBe(false);
  });

  it("does not claim preview proxy bodies", async () => {
    expect(shouldParseDashboardJsonBody({
      method: "POST",
      url: "/api/browser/sessions/session-1/proxy/api/comment",
      headers: { "content-type": "application/json" },
    } as any)).toBe(false);

    const app = createApp();
    app.post("/api/browser/sessions/:sessionId/proxy/api/comment", (req, res) => {
      res.json({ parsedByDashboardJsonParser: req.body !== undefined });
    });

    const response = await request(app)
      .post("/api/browser/sessions/session-1/proxy/api/comment")
      .set("Content-Type", "text/plain")
      .send("proxied body");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ parsedByDashboardJsonParser: false });
  });
});
