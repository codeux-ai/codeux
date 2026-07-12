import { createHash } from "node:crypto";
import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { applyDashboardPreRouteMiddleware } from "../../../src/server/dashboard-middleware.js";
import type { DashboardServerOptions } from "../../../src/server/dashboard-server.js";
import { configureDashboardApp } from "../../../src/server/dashboard-server.js";
import { registerHeadlessOperationsRoutes } from "../../../src/server/headless-operations-routes.js";
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

  it("permits authenticated admin operations when remote credential management is disabled", async () => {
    const adminToken = "headless-dashboard-admin-token";
    const application = express();
    applyDashboardPreRouteMiddleware(application, {
      headlessAuthService: new HeadlessAuthService({
        mode: "service_token",
        serviceIdentities: [{
          id: "admin",
          displayName: "Operations administrator",
          tokenSha256: createHash("sha256").update(adminToken).digest("hex"),
          roles: ["credential_admin"],
          projectIds: ["*"],
          enabled: true,
        }],
        allowInsecureHttp: false,
        remoteCredentialManagement: false,
      }),
    } as DashboardServerOptions, createLogger({ level: "error" }));
    registerHeadlessOperationsRoutes(application, {
      automationAuditService: { exportNdjson: () => "{\"status\":\"ok\"}\n" },
      headlessReadinessService: { refresh: async () => ({ status: "READY" }) },
      automationSloService: { snapshot: () => ({ managementRequestCount: 1 }) },
    } as never);

    const authorized = (path: string) => request(application).get(path)
      .set("Host", "localhost")
      .set("X-Forwarded-Proto", "https")
      .set("Authorization", `Bearer ${adminToken}`);

    await authorized("/api/admin/readiness").expect(200);
    await authorized("/api/admin/audit/export").expect(200);
    await authorized("/api/admin/metrics/slo").expect(200);
  });

  it("keeps webhook ingress on its secret boundary while enforcing host and origin protections", async () => {
    const application = express();
    applyDashboardPreRouteMiddleware(application, {
      headlessAuthService: authService,
    } as DashboardServerOptions, createLogger({ level: "error" }));
    application.post("/api/webhooks/node-flows/path-token", (_req, res) => res.json({ accepted: true }));

    await request(application).post("/api/webhooks/node-flows/path-token")
      .set("Host", "localhost")
      .set("X-Codeux-Webhook-Secret", "webhook-secret")
      .send({ event: "test" })
      .expect(200, { accepted: true });
    await request(application).post("/api/webhooks/node-flows/path-token")
      .set("Host", "untrusted.example")
      .set("X-Codeux-Webhook-Secret", "webhook-secret")
      .send({ event: "test" })
      .expect(403, /Untrusted host/);
    await request(application).post("/api/webhooks/node-flows/path-token")
      .set("Host", "localhost")
      .set("Origin", "https://untrusted.example")
      .set("X-Codeux-Webhook-Secret", "webhook-secret")
      .send({ event: "test" })
      .expect(403, /Cross-site/);
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
