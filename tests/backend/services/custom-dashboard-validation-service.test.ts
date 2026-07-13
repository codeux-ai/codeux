import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import type { CommandResult } from "../../../src/services/cli-process-runner.js";
import type {
  CustomDashboardFileBundle,
  CustomDashboardManifest,
} from "../../../src/contracts/custom-dashboard-types.js";
import { AppDbStorage } from "../../../src/repositories/app-db-storage.js";
import { CustomDashboardRepository } from "../../../src/repositories/custom-dashboard-repository.js";
import { ProjectManagementRepository } from "../../../src/repositories/project-management-repository.js";
import { SettingsRepository } from "../../../src/repositories/settings-repository.js";
import { CustomDashboardValidationService } from "../../../src/services/custom-dashboard-validation-service.js";
import { runCommandStrict } from "../../../src/services/cli-process-runner.js";
import { AutomationCredentialRepository } from "../../../src/repositories/automation-credential-repository.js";
import { MountedKeyFileProvider } from "../../../src/infrastructure/security/mounted-key-file-provider.js";
import { EncryptedSqliteSecretStore } from "../../../src/infrastructure/security/encrypted-sqlite-secret-store.js";
import { CredentialBroker } from "../../../src/services/credentials/credential-broker.js";
import { AutomationAuditExportService } from "../../../src/services/automation-audit-export-service.js";
import { CustomDashboardCredentialBindingService } from "../../../src/services/custom-dashboard-credential-binding-service.js";

vi.mock("../../../src/services/cli-process-runner.js", () => ({
  runCommandStrict: vi.fn(),
}));

const tempDirs: string[] = [];

function commandResult(stdout = "", stderr = ""): CommandResult {
  return { ok: true, code: 0, stdout, stderr };
}

async function createFixture(): Promise<{
  dir: string;
  storage: AppDbStorage;
  projects: ProjectManagementRepository;
  dashboards: CustomDashboardRepository;
  service: CustomDashboardValidationService;
  bindingService: CustomDashboardCredentialBindingService;
  credentialBroker: CredentialBroker;
  secretStore: EncryptedSqliteSecretStore;
  auditService: AutomationAuditExportService;
  keyProvider: MountedKeyFileProvider;
  projectId: string;
  dashboardId: string;
  revisionId: string;
}> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "custom-dashboard-validation-"));
  tempDirs.push(dir);
  const storage = new AppDbStorage(path.join(dir, "app.db"));
  const projects = new ProjectManagementRepository(storage);
  const project = projects.createProject({
    name: "Custom Dashboard Validation Project",
    sourceType: "local",
    sourceRef: dir,
  });
  const dashboards = new CustomDashboardRepository(storage);
  const credentialRepository = new AutomationCredentialRepository(storage);
  const keyPath = path.join(dir, "credential-root.key");
  await fs.writeFile(keyPath, Buffer.alloc(32, 11).toString("base64"), { mode: 0o600 });
  const keyProvider = new MountedKeyFileProvider(keyPath);
  const secretStore = new EncryptedSqliteSecretStore(credentialRepository, keyProvider);
  const auditService = new AutomationAuditExportService(storage);
  const credentialBroker = new CredentialBroker(credentialRepository, secretStore, keyProvider, auditService);
  const bindingService = new CustomDashboardCredentialBindingService({
    customDashboardRepository: dashboards,
    projectManagementRepository: projects,
    credentialBroker,
    auditService,
  });
  const dashboard = dashboards.createDraft(project.id, {
    title: "Delivery Pulse",
    manifest: manifest(),
    fileBundle: fileBundle(),
    sourceNodeGraph: {
      nodes: [{ id: "incidents", type: "external_api", title: "Incidents", config: { endpoint: "/incidents" } }],
      edges: [],
    },
    runtimeMetadata: { integrations: { incidents: { readonly: true } } },
  });
  const revision = dashboards.createRevision(dashboard.id);
  const service = new CustomDashboardValidationService({
    customDashboardRepository: dashboards,
    customDashboardCredentialBindingService: bindingService,
    projectManagementRepository: projects,
    settingsRepository: new SettingsRepository(path.join(dir, "settings.db")),
    fetchImpl: vi.fn().mockResolvedValue(new Response("ok", { status: 200 })),
    readinessTimeoutMs: 50,
    readinessPollMs: 1,
    managedRuntimeService: {
      resolveImage: vi.fn(async () => "node:24-bookworm"),
    } as any,
  });

  return {
    dir,
    storage,
    projects,
    dashboards,
    service,
    bindingService,
    credentialBroker,
    secretStore,
    auditService,
    keyProvider,
    projectId: project.id,
    dashboardId: dashboard.id,
    revisionId: revision.id,
  };
}

function manifest(): CustomDashboardManifest {
  return {
    schemaVersion: 1,
    title: "Delivery Pulse",
    entryFile: "src/dashboard.tsx",
    filePaths: ["src/dashboard.tsx", "src/data.ts"],
  };
}

function fileBundle(content = "export default function Dashboard() { return <div>ok</div>; }"): CustomDashboardFileBundle {
  return {
    files: [
      { path: "src/dashboard.tsx", content },
      { path: "src/data.ts", content: "export const rows = [];" },
    ],
  };
}

function mockSuccessfulDocker(): void {
  vi.mocked(runCommandStrict).mockImplementation(async (command, args) => {
    if (command !== "docker") {
      return commandResult();
    }
    const action = args[0];
    if (action === "run") {
      await writeFakeViewerDist(args);
      return commandResult("install ok\nbuild ok\n");
    }
    if (action === "create") {
      return commandResult("container-123\n");
    }
    if (action === "start" || action === "rm") {
      return commandResult();
    }
    if (action === "logs") {
      return commandResult("vite preview ready\n");
    }
    if (action === "ps") {
      return commandResult("container-123\tcode-ux-cdash-test\tUp 2 seconds\tproject\tdashboard\trevision\t\t4445\n");
    }
    return commandResult();
  });
}

async function writeFakeViewerDist(args: string[]): Promise<void> {
  const workspaceMount = args.find((arg) => arg.includes("target=/code-ux-custom-dashboard/workspace"));
  const source = workspaceMount
    ?.split(",")
    .find((part) => part.startsWith("source="))
    ?.slice("source=".length);
  if (!source) {
    return;
  }
  const assetsDir = path.join(source, "dist", "assets");
  await fs.mkdir(assetsDir, { recursive: true });
  await fs.writeFile(
    path.join(source, "dist", "index.html"),
    [
      "<!doctype html>",
      "<html>",
      "<head><link rel=\"stylesheet\" href=\"/assets/index.css\"></head>",
      "<body><div id=\"app\"></div><script type=\"module\" src=\"/assets/index.js\"></script></body>",
      "</html>",
      "",
    ].join("\n"),
    "utf8",
  );
  await fs.writeFile(path.join(assetsDir, "index.css"), "main{color:#0f172a;}", "utf8");
  await fs.writeFile(path.join(assetsDir, "index.js"), "document.body.textContent = 'Custom dashboard revision';", "utf8");
}

beforeEach(() => {
  vi.mocked(runCommandStrict).mockReset();
  mockSuccessfulDocker();
});

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("CustomDashboardValidationService", () => {
  it("materializes a revision, builds it in Docker, starts a detached session, and marks validation passed", async () => {
    const { dashboards, service, projectId, dashboardId, revisionId, dir } = await createFixture();

    const session = await service.startValidation(projectId, dashboardId, revisionId);

    expect(session.status).toBe("passed");
    expect(session.validationReport).toMatchObject({
      valid: true,
      issues: [],
      metadata: { containerId: "container-123" },
    });
    const revision = dashboards.getRevisionById(revisionId);
    expect(revision?.validationStatus).toBe("passed");
    expect(revision?.validationReport?.valid).toBe(true);
    expect(revision?.runtimeMetadata).toMatchObject({
      integrations: { incidents: { readonly: true } },
      validation: {
        viewerArtifact: {
          kind: "vite-dist",
          entryFile: "index.html",
          files: expect.arrayContaining([
            expect.objectContaining({ path: "index.html", contentType: "text/html" }),
            expect.objectContaining({ path: "assets/index.js", content: expect.stringContaining("Custom dashboard revision") }),
          ]),
        },
      },
    });
    expect(dashboards.getDashboardById(dashboardId)?.status).toBe("validated");

    const workspacePath = path.join(dir, ".code-ux", "runtime", "custom-dashboards", dashboardId, revisionId, "workspace");
    await expect(fs.readFile(path.join(workspacePath, "src", "dashboard.tsx"), "utf8")).resolves.toContain("Dashboard");
    await expect(fs.readFile(path.join(workspacePath, ".codeux-harness", "codeux-data-bridge.ts"), "utf8")).resolves.toContain("externalApiNodes");

    const dockerCalls = vi.mocked(runCommandStrict).mock.calls.filter(([command]) => command === "docker");
    expect(dockerCalls.some(([, args]) => args[0] === "run" && args.includes("npm install --no-audit --no-fund && npm run build"))).toBe(true);
    expect(dockerCalls.some(([, args]) => args[0] === "create" && args.includes("--name"))).toBe(true);
    expect(dockerCalls.some(([, args]) => args[0] === "start")).toBe(true);
    expect(dockerCalls.flatMap(([, args]) => args).filter((arg) => arg.startsWith("type=")).join(" ")).not.toContain("/opt/credentials");
  });

  it("records failed validation when the Docker build fails and keeps publication state unchanged", async () => {
    const { dashboards, service, projectId, dashboardId, revisionId } = await createFixture();
    vi.mocked(runCommandStrict).mockImplementation(async (_command, args) => {
      if (args[0] === "run") {
        throw new Error("npm run build failed: Build failed.");
      }
      if (args[0] === "logs") {
        return commandResult("build failed\n");
      }
      return commandResult();
    });

    const session = await service.startValidation(projectId, dashboardId, revisionId);

    expect(session.status).toBe("failed");
    expect(session.validationReport).toMatchObject({
      valid: false,
      issues: [{ code: "validation_failed" }],
    });
    expect(dashboards.getRevisionById(revisionId)?.validationStatus).toBe("failed");
    expect(dashboards.getDashboardById(dashboardId)?.publishedRevisionId).toBeNull();
    expect(vi.mocked(runCommandStrict).mock.calls.some(([, args]) => args[0] === "create")).toBe(false);
  });

  it("retrieves bounded validation logs from the persisted log file and container logs", async () => {
    const { service, projectId, dashboardId, revisionId } = await createFixture();
    const session = await service.startValidation(projectId, dashboardId, revisionId);

    const logs = await service.getValidationLogs(session.id, 20);

    expect(logs.logs).toContain("install ok");
    expect(logs.logs).toContain("vite preview ready");
  });

  it("rejects malformed or oversized proxy request bodies before forwarding", async () => {
    const { service } = await createFixture();

    await expect(service.proxyValidationRequest({
      sessionId: "validation-session",
      method: "POST",
      path: "/api/test",
      bodyBytes: "not-a-buffer" as unknown as Buffer,
    })).rejects.toThrow("Request body must be a Buffer");

    await expect(service.proxyValidationRequest({
      sessionId: "validation-session",
      method: "POST",
      path: "/api/test",
      bodyBytes: Buffer.alloc((5 * 1024 * 1024) + 1),
    })).rejects.toThrow("Request body exceeds maximum allowed size");
  });

  it("stops and removes validation sessions without invalidating passed revisions", async () => {
    const { dashboards, service, projectId, dashboardId, revisionId } = await createFixture();
    const session = await service.startValidation(projectId, dashboardId, revisionId);

    const stopped = await service.stopValidation(session.id);
    expect(stopped.status).toBe("passed");
    expect(stopped.validationReport?.valid).toBe(true);
    expect(dashboards.getRevisionById(revisionId)?.validationStatus).toBe("passed");

    await service.removeValidation(session.id);

    expect(dashboards.getValidationSessionById(session.id)).toBeNull();
    expect(dashboards.getRevisionById(revisionId)?.validationStatus).toBe("passed");
    expect(vi.mocked(runCommandStrict).mock.calls.some(([, args]) => args[0] === "rm" && args.includes("container-123"))).toBe(true);
  });

  it("lists validation sessions by project and optional dashboard", async () => {
    const { service, projectId, dashboardId, revisionId } = await createFixture();
    const session = await service.startValidation(projectId, dashboardId, revisionId);

    await expect(service.getValidationSession(session.id)).resolves.toMatchObject({ id: session.id });
    await expect(service.listValidationSessions(projectId)).resolves.toEqual([expect.objectContaining({ id: session.id })]);
    await expect(service.listValidationSessions(projectId, dashboardId)).resolves.toEqual([expect.objectContaining({ id: session.id })]);
  });

  it("keeps a real bound credential canary out of validation artifacts, commands, reports, logs, and audits", async () => {
    const canary = "CUSTOM_DASHBOARD_REAL_SECRET_CANARY_7f8d9a";
    const {
      dir,
      dashboards,
      service,
      bindingService,
      credentialBroker,
      secretStore,
      auditService,
      projectId,
    } = await createFixture();
    const dashboard = dashboards.createDraft(projectId, {
      title: "Bound dashboard",
      manifest: {
        ...manifest(),
        credentialSlots: [{
          slotId: "metrics_api",
          label: "Metrics API",
          phase: "runtime",
          required: true,
          allowedKinds: ["http.token"],
          requiredCapabilities: ["metrics.read"],
        }],
      },
      fileBundle: fileBundle(),
    });
    const credential = await credentialBroker.create(projectId, {
      name: "Metrics",
      kind: "http.token",
      value: canary,
      scope: "project",
      allowedProjectIds: [],
      capabilities: ["metrics.read"],
    });
    const secretRead = vi.spyOn(secretStore, "get");
    await bindingService.bindCredential(projectId, dashboard.id, {
      slotId: "metrics_api",
      credentialId: credential.id,
      expectedBindingRevision: 1,
    });
    const revision = dashboards.createRevision(dashboard.id);
    const session = await service.startValidation(projectId, dashboard.id, revision.id);

    expect(session.status).toBe("passed");
    expect(secretRead).not.toHaveBeenCalled();
    const workspacePath = path.join(dir, ".code-ux", "runtime", "custom-dashboards", dashboard.id, revision.id, "workspace");
    const workspaceText = await readDirectoryText(workspacePath);
    const dockerCapture = JSON.stringify(vi.mocked(runCommandStrict).mock.calls);
    const logs = (await service.getValidationLogs(session.id)).logs;
    const report = JSON.stringify(session);
    const audits = auditService.exportNdjson({ projectId });
    for (const captured of [workspaceText, dockerCapture, logs, report, audits]) {
      expect(captured).not.toContain(canary);
    }
    expect(workspaceText).not.toContain(credential.id);
    expect(dockerCapture).not.toContain(credential.id);
    expect(report).not.toContain(credential.id);
    expect(logs).not.toContain(credential.id);
    const bindingAudit = auditService.list({ projectId }).find((record) => record.action === "custom_dashboard.credential.bind");
    expect(bindingAudit).toMatchObject({
      projectId,
      resourceId: dashboard.id,
      outcome: "succeeded",
      metadata: {
        dashboardId: dashboard.id,
        revision: 2,
        slotId: "metrics_api",
        credentialId: credential.id,
        denialReason: null,
      },
    });
    expect(Object.keys(bindingAudit?.metadata ?? {}).sort()).toEqual([
      "credentialId",
      "dashboardId",
      "denialReason",
      "revision",
      "slotId",
    ]);

    credentialBroker.revoke(projectId, credential.id, { expectedVersion: credential.version });
    vi.mocked(runCommandStrict).mockClear();
    const denied = await service.startValidation(projectId, dashboard.id, revision.id);
    expect(denied).toMatchObject({
      status: "failed",
      validationReport: {
        valid: false,
        issues: expect.arrayContaining([
          expect.objectContaining({ field: "credentialBindings.metrics_api", code: "not_active" }),
        ]),
      },
    });
    expect(JSON.stringify(denied)).not.toContain(credential.id);
    expect(vi.mocked(runCommandStrict)).not.toHaveBeenCalled();
    expect(secretRead).not.toHaveBeenCalled();
  });

  it("allows optional unbound slots and fails closed for every required binding policy dimension", async () => {
    const {
      dashboards,
      service,
      credentialBroker,
      keyProvider,
      projects,
      projectId,
      dir,
    } = await createFixture();
    const slot = (overrides: Partial<NonNullable<CustomDashboardManifest["credentialSlots"]>[number]> = {}) => ({
      slotId: "metrics_api",
      label: "Metrics API",
      phase: "runtime" as const,
      required: true,
      allowedKinds: ["http.token"],
      requiredCapabilities: ["metrics.read"],
      ...overrides,
    });
    const createRevision = (
      title: string,
      declaration: ReturnType<typeof slot>,
      credentialId?: string,
    ) => {
      const dashboard = dashboards.createDraft(projectId, {
        title,
        manifest: { ...manifest(), title, credentialSlots: [declaration] },
        fileBundle: fileBundle(),
      });
      if (credentialId) {
        dashboards.updateCredentialBindings(dashboard.id, {
          expectedBindingRevision: 1,
          bindings: [{ slotId: declaration.slotId, credentialId }],
        });
      }
      return { dashboard, revision: dashboards.createRevision(dashboard.id) };
    };

    const requiredMissing = createRevision("Required missing", slot());
    const requiredMissingSession = await service.startValidation(projectId, requiredMissing.dashboard.id, requiredMissing.revision.id);
    expect(requiredMissingSession.validationReport?.issues).toEqual([
      expect.objectContaining({ code: "required_binding_missing", field: "credentialBindings.metrics_api" }),
    ]);

    const optional = createRevision("Optional", slot({ required: false }));
    expect((await service.startValidation(projectId, optional.dashboard.id, optional.revision.id)).status).toBe("passed");

    const wrongKind = await credentialBroker.create(projectId, {
      name: "Wrong kind",
      kind: "ssh.key",
      value: "wrong-kind-secret",
      scope: "project",
      allowedProjectIds: [],
      capabilities: ["metrics.read"],
    });
    const wrongKindRevision = createRevision("Wrong kind", slot(), wrongKind.id);
    expect((await service.startValidation(projectId, wrongKindRevision.dashboard.id, wrongKindRevision.revision.id))
      .validationReport?.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "kind_not_allowed" })]));

    const missingCapability = await credentialBroker.create(projectId, {
      name: "Missing capability",
      kind: "http.token",
      value: "missing-capability-secret",
      scope: "project",
      allowedProjectIds: [],
      capabilities: ["other.read"],
    });
    const missingCapabilityRevision = createRevision("Missing capability", slot(), missingCapability.id);
    expect((await service.startValidation(projectId, missingCapabilityRevision.dashboard.id, missingCapabilityRevision.revision.id))
      .validationReport?.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "capability_missing" })]));

    const otherProject = projects.createProject({
      name: "Other project",
      sourceType: "local",
      sourceRef: path.join(dir, "other-project"),
    });
    const inaccessible = await credentialBroker.create(otherProject.id, {
      name: "Other project credential",
      kind: "http.token",
      value: "inaccessible-secret",
      scope: "project",
      allowedProjectIds: [],
      capabilities: ["metrics.read"],
    });
    const inaccessibleRevision = createRevision("Inaccessible", slot(), inaccessible.id);
    expect((await service.startValidation(projectId, inaccessibleRevision.dashboard.id, inaccessibleRevision.revision.id))
      .validationReport?.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "project_access_denied" })]));

    const backendCredential = await credentialBroker.create(projectId, {
      name: "Backend health",
      kind: "http.token",
      value: "backend-health-secret",
      scope: "project",
      allowedProjectIds: [],
      capabilities: ["metrics.read"],
    });
    const backendRevision = createRevision("Backend unavailable", slot(), backendCredential.id);
    vi.spyOn(keyProvider, "health").mockResolvedValue({
      available: false,
      secure: true,
      provider: keyProvider.providerName,
      keyId: null,
      keyVersion: null,
      reason: "Test backend unavailable.",
    });
    expect((await service.startValidation(projectId, backendRevision.dashboard.id, backendRevision.revision.id))
      .validationReport?.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "backend_unavailable" })]));
  });
});

async function readDirectoryText(root: string): Promise<string> {
  const chunks: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(target);
      else if (entry.isFile()) chunks.push(await fs.readFile(target, "utf8"));
    }
  };
  await visit(root);
  return chunks.join("\n");
}
