import { afterEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import type {
  CustomDashboardFileBundle,
  CustomDashboardManifest,
  CustomDashboardValidationReport,
} from "../../../src/contracts/custom-dashboard-types.js";
import { registerCustomDashboardRoutes } from "../../../src/server/custom-dashboard-routes.js";
import { AppDbStorage } from "../../../src/repositories/app-db-storage.js";
import { CustomDashboardRepository } from "../../../src/repositories/custom-dashboard-repository.js";
import { ProjectManagementRepository } from "../../../src/repositories/project-management-repository.js";
import { SettingsRepository } from "../../../src/repositories/settings-repository.js";
import { CustomDashboardValidationService } from "../../../src/services/custom-dashboard-validation-service.js";
import { CustomDashboardRuntimeService } from "../../../src/services/custom-dashboard-runtime-service.js";
import type { EgressPolicyService } from "../../../src/services/node-flows/egress-policy-service.js";
import type { CredentialBroker } from "../../../src/services/credentials/credential-broker.js";
import { ValidationError } from "../../../src/repositories/repository-utils.js";

const tempDirs: string[] = [];

function manifest(title = "Delivery Pulse"): CustomDashboardManifest {
  return {
    schemaVersion: 1,
    title,
    entryFile: "src/dashboard.tsx",
    filePaths: ["src/dashboard.tsx"],
  };
}

function fileBundle(content = "export default function Dashboard() { return null; }"): CustomDashboardFileBundle {
  return {
    files: [{ path: "src/dashboard.tsx", content, contentType: "text/typescript-jsx" }],
  };
}

function passedReport(): CustomDashboardValidationReport {
  return { valid: true, summary: "Passed", issues: [] };
}

async function createFixture(fetchImpl: typeof fetch = fetch): Promise<{
  app: express.Express;
  dir: string;
  repository: CustomDashboardRepository;
  storage: AppDbStorage;
  validationService: CustomDashboardValidationService;
  projectId: string;
  credentialBroker: { withResolvedCredentialId: ReturnType<typeof vi.fn> };
  egressPolicyService: { request: ReturnType<typeof vi.fn> };
}> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "custom-dashboard-routes-"));
  tempDirs.push(dir);
  const storage = new AppDbStorage(path.join(dir, "app.db"));
  const projects = new ProjectManagementRepository(storage);
  const project = projects.createProject({
    name: "Custom Dashboard Routes",
    sourceType: "local",
    sourceRef: dir,
  });
  const repository = new CustomDashboardRepository(storage);
  const validationService = new CustomDashboardValidationService({
    customDashboardRepository: repository,
    projectManagementRepository: projects,
    settingsRepository: new SettingsRepository(path.join(dir, "settings.db")),
    fetchImpl,
    readinessPollMs: 1,
    readinessTimeoutMs: 1,
  });
  const credentialBroker = {
    withResolvedCredentialId: vi.fn(async (_request, consumer: (secret: Buffer) => unknown) => consumer(Buffer.from("route-secret"))),
  };
  const egressPolicyService = {
    request: vi.fn(async () => ({
      url: "https://api.example.com/incidents",
      status: 200,
      ok: true,
      headers: { "content-type": "application/json", "set-cookie": "upstream=secret" },
      contentType: "application/json",
      body: new TextEncoder().encode(JSON.stringify({ incidents: 2 })),
      text: () => JSON.stringify({ incidents: 2 }),
      json: () => ({ incidents: 2 }),
    })),
  };
  const runtimeService = new CustomDashboardRuntimeService({
    customDashboardRepository: repository,
    credentialBroker: credentialBroker as unknown as CredentialBroker,
    egressPolicyService: egressPolicyService as unknown as EgressPolicyService,
    getProjectExecutionSnapshot: (id) => ({ projectId: id, executions: [] }),
    getProjectStatsSnapshot: (id, query) => ({ projectId: id, window: query?.window }),
    getOverviewTelemetrySnapshot: () => ({ activeProjects: 1 }),
  });
  const app = express();
  app.use(express.json());
  registerCustomDashboardRoutes(app, {
    customDashboardRepository: repository,
    customDashboardValidationService: validationService,
    customDashboardRuntimeService: runtimeService,
  } as any);
  return { app, dir, repository, storage, validationService, projectId: project.id, credentialBroker, egressPolicyService };
}

function insertCredential(storage: AppDbStorage, projectId: string): string {
  const id = "route-credential";
  const now = new Date().toISOString();
  const db = storage.getDatabase();
  db.prepare(`INSERT INTO automation_credentials (
    id, name, kind, scope, project_id, management_project_id, allowed_project_ids_json,
    capabilities_json, status, key_id, key_version, version, created_at, updated_at
  ) VALUES (?, 'Route token', 'api-token', 'project', ?, ?, '[]', '["read"]', 'active', 'test', 1, 1, ?, ?)`)
    .run(id, projectId, projectId, now, now);
  const blob = Buffer.from("route-secret-ciphertext");
  db.prepare(`INSERT INTO automation_credential_secrets (
    credential_id, ciphertext, nonce, auth_tag, wrapped_data_key, wrap_nonce,
    wrap_auth_tag, key_id, key_version, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, 'test', 1, ?)`)
    .run(id, blob, blob, blob, blob, blob, blob, now);
  return id;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("custom dashboard routes", () => {
  it("serves built-in and credentialed sources only through declared published bindings", async () => {
    const { app, repository, storage, projectId, credentialBroker, egressPolicyService } = await createFixture();
    const credentialId = insertCredential(storage, projectId);
    const dashboard = repository.createDraft(projectId, {
      title: "Source gateway",
      manifest: manifest(),
      fileBundle: fileBundle(),
      sourceNodeGraph: {
        nodes: [
          { id: "stats", type: "stats", title: "Stats", config: { window: "24h" } },
          {
            id: "incidents",
            type: "external_api",
            title: "Incidents",
            config: {
              baseUrl: "https://api.example.com/v1/",
              allowedHosts: ["api.example.com"],
              allowedPorts: [443],
              allowedContentTypes: ["application/json"],
              routes: [{ path: "/incidents", methods: ["GET"] }],
            },
            credentialSlots: [{
              slot: "api_token",
              label: "API token",
              required: true,
              allowedKinds: ["api-token"],
              requiredCapability: "read",
              metadata: { headerName: "authorization", scheme: "Bearer" },
            }],
          },
        ],
        edges: [],
      },
      credentialBindings: [{ slot: "api_token", credentialId }],
    });
    const revision = repository.createRevision(dashboard.id);
    const validation = repository.createValidationSession(revision.id, {
      status: "passed",
      validationReport: passedReport(),
      finishedAt: "2026-07-07T00:00:00.000Z",
    });
    repository.publishRevision(dashboard.id, revision.id, validation.id);

    const builtIn = await request(app).post("/api/custom-dashboard-runtime/source").send({
      requestId: "request-stats",
      projectId,
      dashboardId: dashboard.id,
      revisionId: revision.id,
      access: { kind: "published" },
      sourceId: "stats",
    });
    expect(builtIn.status).toBe(200);
    expect(builtIn.body.data).toMatchObject({ projectId, window: "24h" });

    const external = await request(app).post("/api/custom-dashboard-runtime/source").send({
      requestId: "request-external",
      projectId,
      dashboardId: dashboard.id,
      revisionId: revision.id,
      access: { kind: "published" },
      sourceId: "incidents",
      route: "/incidents",
      credentialSlot: "api_token",
      capability: "read",
    });
    expect(external.status).toBe(200);
    expect(external.body).toMatchObject({ requestId: "request-external", data: { incidents: 2 } });
    expect(external.body.headers["set-cookie"]).toBeUndefined();
    expect(credentialBroker.withResolvedCredentialId).toHaveBeenCalledWith(
      expect.objectContaining({ projectId, credentialId, capability: "read" }),
      expect.any(Function),
    );
    expect(egressPolicyService.request).toHaveBeenCalledWith(expect.objectContaining({
      url: expect.objectContaining({ hostname: "api.example.com", pathname: "/v1/incidents" }),
      credentialHeaders: { authorization: "Bearer route-secret" },
      policy: expect.objectContaining({ allowedHosts: ["api.example.com"], maxResponseBytes: 1024 * 1024 }),
    }));
    expect(JSON.stringify(external.body)).not.toContain("route-secret");

    const denied = await request(app).post("/api/custom-dashboard-runtime/source").send({
      requestId: "request-denied",
      projectId,
      dashboardId: dashboard.id,
      revisionId: revision.id,
      access: { kind: "published" },
      sourceId: "incidents",
      route: "/undeclared",
      credentialSlot: "api_token",
    });
    expect(denied.status).toBe(403);
    expect(JSON.stringify(denied.body)).not.toContain("route-secret");

    const unsupported = await request(app).post("/api/custom-dashboard-runtime/source").send({
      requestId: "request-unsupported",
      projectId,
      dashboardId: dashboard.id,
      revisionId: revision.id,
      access: { kind: "published" },
      sourceId: "not-declared",
    });
    expect(unsupported.status).toBe(404);
    expect(unsupported.body.error.code).toBe("source_not_declared");

    const brokerCalls = credentialBroker.withResolvedCredentialId.mock.calls.length;
    const egressCalls = egressPolicyService.request.mock.calls.length;
    const malformedSlot = await request(app).post("/api/custom-dashboard-runtime/source").send({
      requestId: "request-malformed-slot",
      projectId,
      dashboardId: dashboard.id,
      revisionId: revision.id,
      access: { kind: "published" },
      sourceId: "incidents",
      route: "/incidents",
      credentialSlot: " ",
    });
    expect(malformedSlot.status).toBe(400);
    expect(malformedSlot.body.error.code).toBe("invalid_request");
    expect(credentialBroker.withResolvedCredentialId).toHaveBeenCalledTimes(brokerCalls);
    expect(egressPolicyService.request).toHaveBeenCalledTimes(egressCalls);
  });

  it("isolates validation sessions and redacts credential and egress failures", async () => {
    const { app, repository, storage, projectId, credentialBroker, egressPolicyService } = await createFixture();
    const credentialId = insertCredential(storage, projectId);
    const dashboard = repository.createDraft(projectId, {
      title: "Validation gateway",
      manifest: manifest(),
      fileBundle: fileBundle(),
      sourceNodeGraph: {
        nodes: [{
          id: "external",
          type: "external_api",
          title: "External",
          config: { baseUrl: "https://api.example.com", allowedHosts: ["api.example.com"], routes: [{ path: "/data", methods: ["GET"] }] },
          credentialSlots: [{ slot: "token", label: "Token", required: true, allowedKinds: ["api-token"], requiredCapability: "read" }],
        }],
        edges: [],
      },
      credentialBindings: [{ slot: "token", credentialId }],
    });
    const revision = repository.createRevision(dashboard.id);
    const session = repository.createValidationSession(revision.id, { status: "running" });
    const otherDashboard = repository.createDraft(projectId, { title: "Other", manifest: manifest(), fileBundle: fileBundle() });
    const otherRevision = repository.createRevision(otherDashboard.id);
    const otherSession = repository.createValidationSession(otherRevision.id, { status: "running" });
    const payload = {
      projectId,
      dashboardId: dashboard.id,
      revisionId: revision.id,
      access: { kind: "validation", sessionId: otherSession.id },
      sourceId: "external",
      route: "/data",
      credentialSlot: "token",
    };
    const isolated = await request(app).post("/api/custom-dashboard-runtime/source").send({ requestId: "isolated", ...payload });
    expect(isolated.status).toBe(403);

    for (const reason of ["missing", "revoked", "out-of-scope"] as const) {
      credentialBroker.withResolvedCredentialId.mockRejectedValueOnce(new Error(`${reason} route-secret`));
      const deniedCredential = await request(app).post("/api/custom-dashboard-runtime/source").send({
        requestId: `credential-${reason}`,
        ...payload,
        access: { kind: "validation", sessionId: session.id },
      });
      expect(deniedCredential.status).toBe(403);
      expect(deniedCredential.body.error.code).toBe("credential_denied");
      expect(JSON.stringify(deniedCredential.body)).not.toContain("route-secret");
    }

    egressPolicyService.request.mockRejectedValueOnce(new ValidationError("Egress host is not allowlisted: private.example."));
    const egressDenied = await request(app).post("/api/custom-dashboard-runtime/source").send({
      requestId: "egress-denied",
      ...payload,
      access: { kind: "validation", sessionId: session.id },
    });
    expect(egressDenied.status).toBe(502);
    expect(egressDenied.body.error.code).toBe("egress_denied");

    egressPolicyService.request.mockRejectedValueOnce(new ValidationError("Egress response exceeds the configured size limit. route-secret"));
    const oversized = await request(app).post("/api/custom-dashboard-runtime/source").send({
      requestId: "oversized",
      ...payload,
      access: { kind: "validation", sessionId: session.id },
    });
    expect(oversized.status).toBe(502);
    expect(oversized.body.error.code).toBe("egress_denied");
    expect(JSON.stringify(oversized.body)).not.toContain("route-secret");
  });

  it("creates, lists, updates, archives, and exposes a data catalog", async () => {
    const { app, projectId } = await createFixture();

    const createResponse = await request(app)
      .post(`/api/projects/${projectId}/custom-dashboards`)
      .send({
        title: "Delivery Pulse",
        manifest: manifest(),
        fileBundle: fileBundle(),
        sourceNodeGraph: {
          nodes: [{ id: "tasks", type: "sqlite_query", title: "Tasks" }],
          edges: [],
        },
      });

    expect(createResponse.status).toBe(201);
    expect(createResponse.body).toMatchObject({ title: "Delivery Pulse", status: "draft" });

    const listResponse = await request(app).get(`/api/projects/${projectId}/custom-dashboards`);
    expect(listResponse.status).toBe(200);
    expect(listResponse.body.dashboards).toHaveLength(1);

    const patchResponse = await request(app)
      .patch(`/api/custom-dashboards/${createResponse.body.id}`)
      .send({ title: "Delivery Pulse v2" });
    expect(patchResponse.status).toBe(200);
    expect(patchResponse.body.title).toBe("Delivery Pulse v2");

    const catalogResponse = await request(app).get(`/api/projects/${projectId}/custom-dashboards/data-catalog`);
    expect(catalogResponse.status).toBe(200);
    expect(catalogResponse.body.sources).toEqual([
      expect.objectContaining({ id: "tasks", dashboardId: createResponse.body.id }),
    ]);

    const deleteResponse = await request(app).delete(`/api/custom-dashboards/${createResponse.body.id}`);
    expect(deleteResponse.status).toBe(200);
    expect(deleteResponse.body.status).toBe("archived");
  });

  it("returns route and credential metadata without credential secret material", async () => {
    const { app, storage, projectId } = await createFixture();
    const credentialId = insertCredential(storage, projectId);
    const response = await request(app)
      .post(`/api/projects/${projectId}/custom-dashboards`)
      .send({
        title: "Integration view",
        manifest: manifest(),
        fileBundle: fileBundle(),
        sourceNodeGraph: {
          nodes: [{
            id: "external",
            type: "external_api",
            title: "External",
            credentialSlots: [{
              slot: "api_token",
              label: "API token",
              required: true,
              allowedKinds: ["api-token"],
              requiredCapability: "read",
            }],
          }],
          edges: [],
        },
        credentialBindings: [{ slot: "api_token", credentialId }],
        routes: [{ path: "/integration", label: "Integration", entryFile: "src/dashboard.tsx" }],
      });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      routes: [{ path: "/integration" }],
      credentialBindings: [{ slot: "api_token", credential: { name: "Route token" } }],
    });
    expect(JSON.stringify(response.body)).not.toContain("route-secret-ciphertext");

    const catalog = await request(app).get(`/api/projects/${projectId}/custom-dashboards/data-catalog`);
    expect(catalog.body.dashboards[0]).toMatchObject({
      routes: [{ path: "/integration" }],
      credentialBindings: [{ credentialId }],
    });
    expect(JSON.stringify(catalog.body)).not.toContain("route-secret-ciphertext");
  });

  it("creates revisions, starts validation through the service, and denies unsafe publication", async () => {
    const { app, repository, validationService, projectId } = await createFixture();
    const dashboard = repository.createDraft(projectId, {
      title: "Delivery Pulse",
      manifest: manifest(),
      fileBundle: fileBundle(),
    });
    const firstRevision = repository.createRevision(dashboard.id);
    const secondRevision = repository.createRevision(dashboard.id);
    const passedSession = repository.createValidationSession(firstRevision.id, {
      status: "passed",
      validationReport: passedReport(),
      runtimeMetadata: { validation: { hostPort: 4999 } },
      finishedAt: "2026-07-07T00:00:00.000Z",
    });
    const failedSession = repository.createValidationSession(secondRevision.id, {
      status: "failed",
      validationReport: {
        valid: false,
        summary: "Failed",
        issues: [{ field: "runtime", code: "failed", message: "Failed" }],
      },
      finishedAt: "2026-07-07T00:00:00.000Z",
    });
    const startValidation = vi.spyOn(validationService, "startValidation").mockResolvedValue(passedSession);

    const validateResponse = await request(app)
      .post(`/api/custom-dashboards/${dashboard.id}/revisions/${firstRevision.id}/validate`);
    expect(validateResponse.status).toBe(200);
    expect(startValidation).toHaveBeenCalledWith(projectId, dashboard.id, firstRevision.id);

    const publishResponse = await request(app)
      .post(`/api/custom-dashboards/${dashboard.id}/revisions/${firstRevision.id}/publish`)
      .send({ validationSessionId: passedSession.id });
    expect(publishResponse.status).toBe(200);
    expect(publishResponse.body.publishedRevisionId).toBe(firstRevision.id);

    const deniedResponse = await request(app)
      .post(`/api/custom-dashboards/${dashboard.id}/revisions/${secondRevision.id}/publish`)
      .send({ validationSessionId: failedSession.id });
    expect(deniedResponse.status).toBe(400);
    expect(deniedResponse.body.error).toContain("Only passed custom dashboard validation sessions can be published");
    expect(repository.getDashboardById(dashboard.id)?.publishedRevisionId).toBe(firstRevision.id);
  });

  it("persists authenticated runtime halts and requires an explicit validated resume", async () => {
    const { app, repository, projectId } = await createFixture();
    const dashboard = repository.createDraft(projectId, {
      title: "Delivery Pulse",
      manifest: manifest(),
      fileBundle: fileBundle(),
    });
    const revision = repository.markRevisionValidated(repository.createRevision(dashboard.id).id, passedReport());
    repository.publishRevision(dashboard.id, revision.id);

    const crossSite = await request(app)
      .post(`/api/custom-dashboards/${dashboard.id}/runtime/halt`)
      .set("Origin", "https://attacker.example")
      .send({ revisionId: revision.id, reason: "frame failed" });
    expect(crossSite.status).toBe(403);

    const halted = await request(app)
      .post(`/api/custom-dashboards/${dashboard.id}/runtime/halt`)
      .send({ revisionId: revision.id, reason: "token=secret frame failed" });
    expect(halted.status).toBe(200);
    expect(halted.body.runtimeState).toMatchObject({ status: "halted", haltedRevisionId: revision.id });
    expect(JSON.stringify(halted.body)).not.toContain("token=secret");

    const blocked = await request(app).post("/api/custom-dashboard-runtime/source").send({
      requestId: "halted-source",
      projectId,
      dashboardId: dashboard.id,
      revisionId: revision.id,
      access: { kind: "published" },
      sourceId: "missing",
    });
    expect(blocked.status).toBe(423);
    expect(blocked.body.error.code).toBe("runtime_halted");

    const staleResume = await request(app)
      .post(`/api/custom-dashboards/${dashboard.id}/runtime/resume`)
      .send({ revisionId: "stale-revision" });
    expect(staleResume.status).toBe(404);
    const resumed = await request(app)
      .post(`/api/custom-dashboards/${dashboard.id}/runtime/resume`)
      .send({ revisionId: revision.id });
    expect(resumed.status).toBe(200);
    expect(resumed.body.runtimeState.status).toBe("active");
  });

  it("returns validation status, logs, stop, and remove responses", async () => {
    const { app, repository, validationService, projectId } = await createFixture();
    const dashboard = repository.createDraft(projectId, {
      title: "Delivery Pulse",
      manifest: manifest(),
      fileBundle: fileBundle(),
    });
    const revision = repository.createRevision(dashboard.id);
    const session = repository.createValidationSession(revision.id, { status: "running" });

    vi.spyOn(validationService, "getValidationLogs").mockResolvedValue({ logs: "build ok" });
    vi.spyOn(validationService, "stopValidation").mockResolvedValue({ ...session, status: "cancelled" });
    vi.spyOn(validationService, "removeValidation").mockResolvedValue(undefined);

    expect((await request(app).get(`/api/custom-dashboard-validations/${session.id}`)).body.id).toBe(session.id);
    expect((await request(app).get(`/api/custom-dashboard-validations/${session.id}/logs?tail=25`)).body.logs).toBe("build ok");
    expect((await request(app).post(`/api/custom-dashboard-validations/${session.id}/stop`)).body.status).toBe("cancelled");
    expect((await request(app).delete(`/api/custom-dashboard-validations/${session.id}`)).status).toBe(204);
  });

  it("proxies validation sessions with preview-style header and response protections", async () => {
    const captured: Array<{ url: string; headers: Record<string, string> }> = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      captured.push({
        url: String(input),
        headers: init?.headers as Record<string, string>,
      });
      return new Response('<a href="/asset.js">asset</a>', {
        status: 202,
        headers: {
          "content-type": "text/html",
          "set-cookie": "preview=1",
          "content-security-policy": "default-src 'none'",
          location: "/next",
        },
      });
    }) as unknown as typeof fetch;
    const { app, repository, projectId } = await createFixture(fetchImpl);
    const dashboard = repository.createDraft(projectId, {
      title: "Delivery Pulse",
      manifest: manifest(),
      fileBundle: fileBundle(),
    });
    const revision = repository.createRevision(dashboard.id);
    const session = repository.createValidationSession(revision.id, {
      status: "passed",
      validationReport: passedReport(),
      runtimeMetadata: { validation: { hostPort: 4999, containerName: "already-stopped" } },
      finishedAt: "2026-07-07T00:00:00.000Z",
    });

    const response = await request(app)
      .get(`/api/custom-dashboard-validations/${session.id}/proxy/dashboard?x=1`)
      .set("authorization", "Bearer secret")
      .set("cookie", "dashboard=session")
      .set("origin", "http://localhost:4444")
      .set("referer", "http://localhost:4444/custom");

    expect(response.status).toBe(202);
    expect(captured[0]).toMatchObject({ url: "http://127.0.0.1:4999/dashboard?x=1" });
    expect(captured[0]?.headers.authorization).toBeUndefined();
    expect(captured[0]?.headers.cookie).toBeUndefined();
    expect(captured[0]?.headers.origin).toBe("http://127.0.0.1:4999");
    expect(captured[0]?.headers.referer).toBe("http://127.0.0.1:4999/custom");
    expect(response.headers["set-cookie"]).toBeUndefined();
    expect(response.headers["content-security-policy"]).toBeUndefined();
    expect(response.headers.location).toBe(`/api/custom-dashboard-validations/${session.id}/proxy/next`);
    expect(response.text).toContain(`/api/custom-dashboard-validations/${session.id}/proxy/asset.js`);
  });
});
