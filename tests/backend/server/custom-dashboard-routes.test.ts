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
import { AutomationCredentialRepository } from "../../../src/repositories/automation-credential-repository.js";
import { MountedKeyFileProvider } from "../../../src/infrastructure/security/mounted-key-file-provider.js";
import { EncryptedSqliteSecretStore } from "../../../src/infrastructure/security/encrypted-sqlite-secret-store.js";
import { CredentialBroker } from "../../../src/services/credentials/credential-broker.js";
import { AutomationAuditExportService } from "../../../src/services/automation-audit-export-service.js";
import { CustomDashboardCredentialBindingService } from "../../../src/services/custom-dashboard-credential-binding-service.js";
import { requiredRoleForDashboardRequest } from "../../../src/services/headless-auth-service.js";

const tempDirs: string[] = [];

function manifest(title = "Delivery Pulse"): CustomDashboardManifest {
  return {
    schemaVersion: 1,
    title,
    entryFile: "src/dashboard.tsx",
    filePaths: ["src/dashboard.tsx"],
  };
}

function credentialManifest(title = "Delivery Pulse"): CustomDashboardManifest {
  return {
    ...manifest(title),
    credentialSlots: [{
      slotId: "metrics_api",
      label: "Metrics API",
      phase: "runtime",
      required: true,
      allowedKinds: ["http.token"],
      requiredCapabilities: ["metrics.read"],
    }],
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
  validationService: CustomDashboardValidationService;
  bindingService: CustomDashboardCredentialBindingService;
  credentialBroker: CredentialBroker;
  projectId: string;
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
  const credentialRepository = new AutomationCredentialRepository(storage);
  const keyPath = path.join(dir, "credential-root.key");
  await fs.writeFile(keyPath, Buffer.alloc(32, 7).toString("base64"), { mode: 0o600 });
  const keyProvider = new MountedKeyFileProvider(keyPath);
  const credentialBroker = new CredentialBroker(
    credentialRepository,
    new EncryptedSqliteSecretStore(credentialRepository, keyProvider),
    keyProvider,
    new AutomationAuditExportService(storage),
  );
  const bindingService = new CustomDashboardCredentialBindingService({
    customDashboardRepository: repository,
    projectManagementRepository: projects,
    credentialBroker,
    auditService: new AutomationAuditExportService(storage),
  });
  const validationService = new CustomDashboardValidationService({
    customDashboardRepository: repository,
    customDashboardCredentialBindingService: bindingService,
    projectManagementRepository: projects,
    settingsRepository: new SettingsRepository(path.join(dir, "settings.db")),
    fetchImpl,
    readinessPollMs: 1,
    readinessTimeoutMs: 1,
  });
  const app = express();
  app.use(express.json());
  registerCustomDashboardRoutes(app, {
    customDashboardRepository: repository,
    customDashboardCredentialBindingService: bindingService,
    customDashboardValidationService: validationService,
  } as any);
  return { app, dir, repository, validationService, bindingService, credentialBroker, projectId: project.id };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("custom dashboard routes", () => {
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

  it("binds, replaces, reviews, and unbinds credentials through metadata-only optimistic routes", async () => {
    const canary = "CUSTOM_DASHBOARD_REAL_SECRET_CANARY_7f8d9a";
    const { app, repository, credentialBroker, projectId } = await createFixture();
    const dashboard = repository.createDraft(projectId, {
      title: "Credential dashboard",
      manifest: credentialManifest(),
      fileBundle: fileBundle(),
    });
    const first = await credentialBroker.create(projectId, {
      name: "Metrics one",
      kind: "http.token",
      value: canary,
      scope: "project",
      allowedProjectIds: [],
      capabilities: ["metrics.read"],
    });
    const second = await credentialBroker.create(projectId, {
      name: "Metrics two",
      kind: "http.token",
      value: `${canary}_REPLACEMENT`,
      scope: "project",
      allowedProjectIds: [],
      capabilities: ["metrics.read"],
    });
    const route = `/api/projects/${projectId}/custom-dashboards/${dashboard.id}/credential-bindings`;

    const bound = await request(app).put(route).send({
      slotId: "metrics_api",
      credentialId: first.id,
      expectedBindingRevision: 1,
    });
    expect(bound.status).toBe(200);
    expect(bound.body).toMatchObject({ valid: true, credentialBindingRevision: 2 });
    expect(bound.body.slots[0].binding).toEqual({ slotId: "metrics_api", credentialId: first.id });
    expect(JSON.stringify(bound.body)).not.toContain(canary);

    const reviewed = await request(app).get(route);
    expect(reviewed.status).toBe(200);
    expect(reviewed.body.slots[0].candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ credentialId: first.id, compatible: true }),
      expect.objectContaining({ credentialId: second.id, compatible: true }),
    ]));

    const replaced = await request(app).put(route).send({
      slotId: "metrics_api",
      credentialId: second.id,
      expectedBindingRevision: 2,
    });
    expect(replaced.body).toMatchObject({ valid: true, credentialBindingRevision: 3 });
    expect(replaced.body.slots[0].binding.credentialId).toBe(second.id);

    const boundDashboard = repository.getDashboardById(dashboard.id)!;
    repository.updateDraft(dashboard.id, {
      manifest: {
        ...boundDashboard.manifest,
        metadata: { nested: { credentialId: second.id, value: `prefix-${second.id}-suffix` } },
      },
      fileBundle: fileBundle(`export const nested = ${JSON.stringify(second.id)};`),
      sourceNodeGraph: {
        nodes: [{
          id: "metrics",
          type: "integrations_metadata",
          title: "Metrics",
          config: { nested: { credentialId: second.id, value: second.id } },
        }],
        edges: [],
      },
      styleguide: { nested: { value: second.id } },
      runtimeMetadata: {
        validation: {
          viewerArtifact: {
            kind: "vite-dist",
            entryFile: "index.html",
            files: [{
              path: "index.html",
              content: `<main data-binding="${second.id}">Nested</main>`,
              contentType: "text/html",
            }],
          },
        },
      },
    });

    const stale = await request(app).put(route).send({
      slotId: "metrics_api",
      credentialId: first.id,
      expectedBindingRevision: 2,
    });
    expect(stale.status).toBe(409);

    const rejectedSecretField = await request(app).put(route).send({
      slotId: "metrics_api",
      credentialId: first.id,
      expectedBindingRevision: 3,
      value: canary,
    });
    expect(rejectedSecretField.status).toBe(400);
    expect(JSON.stringify(rejectedSecretField.body)).not.toContain(canary);

    const revision = repository.createRevision(dashboard.id);
    const generic = await request(app).get(`/api/custom-dashboards/${dashboard.id}`);
    expect(JSON.stringify(generic.body)).not.toContain("credentialBindings");
    expect(JSON.stringify(generic.body)).not.toContain(second.id);
    const catalog = await request(app).get(`/api/projects/${projectId}/custom-dashboards/data-catalog`);
    expect(JSON.stringify(catalog.body)).not.toContain(second.id);

    const validation = repository.createValidationSession(revision.id, {
      status: "passed",
      validationReport: passedReport(),
      finishedAt: new Date().toISOString(),
    });
    credentialBroker.revoke(projectId, second.id, { expectedVersion: second.version });
    const deniedPublication = await request(app)
      .post(`/api/custom-dashboards/${dashboard.id}/revisions/${revision.id}/publish`)
      .send({ validationSessionId: validation.id });
    expect(deniedPublication.status).toBe(400);
    expect(deniedPublication.body.error).toContain("not active");
    expect(deniedPublication.body.issues).toEqual([
      expect.objectContaining({ field: "credentialBindings.metrics_api", code: "not_active" }),
    ]);
    expect(JSON.stringify(deniedPublication.body)).not.toContain(second.id);
    expect(JSON.stringify(deniedPublication.body)).not.toContain(canary);
    expect(repository.getDashboardById(dashboard.id)?.publishedRevisionId).toBeNull();

    const unbound = await request(app)
      .delete(`${route}/metrics_api`)
      .send({ expectedBindingRevision: 3 });
    expect(unbound.status).toBe(200);
    expect(unbound.body).toMatchObject({ valid: false, credentialBindingRevision: 4 });
    expect(unbound.body.issues).toEqual([
      expect.objectContaining({ field: "credentialBindings.metrics_api", code: "required_binding_missing" }),
    ]);
    expect(JSON.stringify(unbound.body)).not.toContain(canary);
  });

  it("classifies custom dashboard credential-binding routes as credential administration", () => {
    expect(requiredRoleForDashboardRequest({
      path: "/api/projects/project-1/custom-dashboards/dashboard-1/credential-bindings",
      method: "GET",
    } as any)).toBe("credential_admin");
  });
});
