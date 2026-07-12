import { createHash } from "node:crypto";
import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { applyDashboardPreRouteMiddleware } from "../../../src/server/dashboard-middleware.js";
import type { DashboardServerOptions } from "../../../src/server/dashboard-server.js";
import { configureDashboardApp } from "../../../src/server/dashboard-server.js";
import type { HeadlessOperationalReadinessService } from "../../../src/services/headless-operational-readiness-service.js";
import { HeadlessAuthService } from "../../../src/services/headless-auth-service.js";
import { createLogger } from "../../../src/shared/logging/logger.js";

describe("headless dashboard API authentication", () => {
  const token = "headless-dashboard-fixture-token";
  const authService = new HeadlessAuthService({
    mode: "service_token",
    serviceIdentities: [{
      id: "author",
      displayName: "Automation author",
      tokenSha256: createHash("sha256").update(token).digest("hex"),
      roles: ["automation_author", "automation_runner", "viewer"],
      projectIds: ["project-one"],
      enabled: true,
    }],
    allowInsecureHttp: false,
    remoteCredentialManagement: false,
  });

  function app() {
    const application = express();
    applyDashboardPreRouteMiddleware(application, {
      headlessAuthService: authService,
    } as DashboardServerOptions, createLogger({ level: "error" }));
    application.get("/api/projects/:projectId/node-flows", (req, res) => res.json({ projectId: req.params.projectId }));
    application.get("/api/projects/:projectId/credentials", (_req, res) => res.json({ secret: "must-not-run" }));
    return application;
  }

  it("rejects missing identity, insecure transport, unauthorized projects, and disabled credential administration", async () => {
    await request(app()).get("/api/projects/project-one/node-flows").set("Host", "localhost").expect(403);
    await request(app()).get("/api/projects/project-one/node-flows")
      .set("Host", "localhost").set("Authorization", `Bearer ${token}`).expect(403, /TLS/);
    await request(app()).get("/api/projects/project-two/node-flows")
      .set("Host", "localhost").set("X-Forwarded-Proto", "https").set("Authorization", `Bearer ${token}`).expect(403, /not authorized/);
    await request(app()).get("/api/projects/project-one/credentials")
      .set("Host", "localhost").set("X-Forwarded-Proto", "https").set("Authorization", `Bearer ${token}`).expect(403, /credential_admin/);
  });

  it("accepts an authorized TLS request and returns a correlation id", async () => {
    const response = await request(app()).get("/api/projects/project-one/node-flows")
      .set("Host", "localhost")
      .set("X-Forwarded-Proto", "https")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(response.body).toEqual({ projectId: "project-one" });
    expect(response.headers["x-correlation-id"]).toMatch(/^[a-f\d-]+$/i);
  });

  it("keeps health live while key-backed readiness fails closed", async () => {
    const application = express();
    const readiness = {
      refresh: async () => ({
        status: "NOT_READY",
        checkedAt: new Date().toISOString(),
        components: {
          credentialKey: { status: "not_ready", provider: "vault", reason: "vault unavailable" },
          auditStore: { status: "ready" },
          distributedRunner: { status: "ready" },
        },
      }),
    } as unknown as HeadlessOperationalReadinessService;
    configureDashboardApp({
      app: application,
      dashboardDir: "/nonexistent",
      liveActivityCacheMs: 1_000,
      port: 0,
      headlessReadinessService: readiness,
      headlessAuthService: new HeadlessAuthService({ mode: "local", serviceIdentities: [], allowInsecureHttp: true, remoteCredentialManagement: false }),
      isHealthy: () => ({ status: "UP" }),
      isReady: () => ({ status: "READY" }),
    } as DashboardServerOptions);
    await request(application).get("/health").set("Host", "localhost").expect(200, { status: "UP" });
    const response = await request(application).get("/ready").set("Host", "localhost").expect(503);
    expect(response.body).toMatchObject({ status: "NOT_READY", components: { credentialKey: { provider: "vault" } } });
  });
});
