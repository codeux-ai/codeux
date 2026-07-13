import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import type {
  CustomDashboardFileBundle,
  CustomDashboardManifest,
  CustomDashboardValidationReport,
} from "../../../src/contracts/custom-dashboard-types.js";
import { ManagementToolHandler } from "../../../src/mcp/management-tool-handler.js";
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

async function createFixture(): Promise<{
  handler: ManagementToolHandler;
  repository: CustomDashboardRepository;
  validationService: CustomDashboardValidationService;
  bindingService: CustomDashboardCredentialBindingService;
  credentialBroker: CredentialBroker;
  projectId: string;
}> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "custom-dashboard-mcp-"));
  tempDirs.push(dir);
  const storage = new AppDbStorage(path.join(dir, "app.db"));
  const projects = new ProjectManagementRepository(storage);
  const project = projects.createProject({
    name: "Custom Dashboard MCP",
    sourceType: "local",
    sourceRef: dir,
  });
  const repository = new CustomDashboardRepository(storage);
  const credentialRepository = new AutomationCredentialRepository(storage);
  const keyPath = path.join(dir, "credential-root.key");
  await fs.writeFile(keyPath, Buffer.alloc(32, 9).toString("base64"), { mode: 0o600 });
  const keyProvider = new MountedKeyFileProvider(keyPath);
  const auditService = new AutomationAuditExportService(storage);
  const credentialBroker = new CredentialBroker(
    credentialRepository,
    new EncryptedSqliteSecretStore(credentialRepository, keyProvider),
    keyProvider,
    auditService,
  );
  const bindingService = new CustomDashboardCredentialBindingService({
    customDashboardRepository: repository,
    projectManagementRepository: projects,
    credentialBroker,
    auditService,
  });
  const validationService = new CustomDashboardValidationService({
    customDashboardRepository: repository,
    customDashboardCredentialBindingService: bindingService,
    projectManagementRepository: projects,
    settingsRepository: new SettingsRepository(path.join(dir, "settings.db")),
    readinessPollMs: 1,
    readinessTimeoutMs: 1,
  });
  const handler = new ManagementToolHandler({
    customDashboardRepository: repository,
    customDashboardCredentialBindingService: bindingService,
    customDashboardValidationService: validationService,
    projectManagementRepository: projects,
    sprintPreviewService: {},
    executionRepository: {},
    getDashboardSettings: () => ({}),
    executionControlService: {},
    taskRerunService: {},
    settingsRepository: {},
    chatProviderRepository: {},
    agentPresetSyncService: {},
    memoryService: {},
    memoryPromotionService: {},
    embeddingModelManager: {},
    skillService: {},
    nodeFlowService: {},
    knowledgeService: {},
    planningAgentService: {},
    sprintIssueService: {},
  } as any);
  return { handler, repository, validationService, bindingService, credentialBroker, projectId: project.id };
}

function parseResponse(response: { content: Array<{ text: string }> }): Record<string, any> {
  return JSON.parse(response.content[0]?.text ?? "{}") as Record<string, any>;
}

function pendingApprovalFingerprints(handler: ManagementToolHandler): string[] {
  return [...(handler as unknown as {
    pendingDestructiveApprovals: Map<string, number>;
  }).pendingDestructiveApprovals.keys()];
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("manage_custom_dashboards", () => {
  it("creates, lists, gets, updates, creates revisions, and returns data catalog entries", async () => {
    const { handler, projectId } = await createFixture();

    const created = parseResponse(await handler.handleManageCustomDashboards({
      action: "create",
      projectId,
      title: "Delivery Pulse",
      manifest: manifest(),
      fileBundle: fileBundle(),
      sourceNodeGraph: {
        nodes: [{ id: "tasks", type: "sqlite_query", title: "Tasks" }],
        edges: [],
      },
    }));
    const dashboardId = created.result.dashboard.id;

    const listed = parseResponse(await handler.handleManageCustomDashboards({ action: "list", projectId }));
    expect(listed.result.dashboards).toHaveLength(1);

    const updated = parseResponse(await handler.handleManageCustomDashboards({
      action: "update",
      dashboardId,
      title: "Delivery Pulse v2",
    }));
    expect(updated.result.dashboard.title).toBe("Delivery Pulse v2");

    const revision = parseResponse(await handler.handleManageCustomDashboards({
      action: "create_revision",
      dashboardId,
    }));
    expect(revision.result.revision.dashboardId).toBe(dashboardId);

    const got = parseResponse(await handler.handleManageCustomDashboards({ action: "get", dashboardId }));
    expect(got.result.revisions).toHaveLength(1);

    const catalog = parseResponse(await handler.handleManageCustomDashboards({ action: "data_catalog", projectId }));
    expect(catalog.result.sources).toEqual([
      expect.objectContaining({ id: "tasks", dashboardId }),
    ]);
  });

  it("validates revisions and returns validation status and logs through the validation service", async () => {
    const { handler, repository, validationService, projectId } = await createFixture();
    const dashboard = repository.createDraft(projectId, {
      title: "Delivery Pulse",
      manifest: manifest(),
      fileBundle: fileBundle(),
    });
    const revision = repository.createRevision(dashboard.id);
    const session = repository.createValidationSession(revision.id, {
      status: "passed",
      validationReport: passedReport(),
      finishedAt: "2026-07-07T00:00:00.000Z",
    });
    vi.spyOn(validationService, "startValidation").mockResolvedValue(session);
    vi.spyOn(validationService, "getValidationLogs").mockResolvedValue({ logs: "validation ok" });

    const validated = parseResponse(await handler.handleManageCustomDashboards({
      action: "validate_revision",
      projectId,
      dashboardId: dashboard.id,
      revisionId: revision.id,
    }));
    expect(validationService.startValidation).toHaveBeenCalledWith(projectId, dashboard.id, revision.id);
    expect(validated.result.session.id).toBe(session.id);

    const status = parseResponse(await handler.handleManageCustomDashboards({
      action: "validation_status",
      sessionId: session.id,
    }));
    expect(status.result.session.status).toBe("passed");

    const logs = parseResponse(await handler.handleManageCustomDashboards({
      action: "validation_logs",
      sessionId: session.id,
      tail: 25,
    }));
    expect(logs.result.logs).toBe("validation ok");
    expect(validationService.getValidationLogs).toHaveBeenCalledWith(session.id, 25);
  });

  it("publishes only passed validation and leaves the previous publication unchanged on failure", async () => {
    const { handler, repository, projectId } = await createFixture();
    const dashboard = repository.createDraft(projectId, {
      title: "Delivery Pulse",
      manifest: manifest(),
      fileBundle: fileBundle(),
    });
    const validRevision = repository.createRevision(dashboard.id);
    const failedRevision = repository.createRevision(dashboard.id);
    const passedSession = repository.createValidationSession(validRevision.id, {
      status: "passed",
      validationReport: passedReport(),
      finishedAt: "2026-07-07T00:00:00.000Z",
    });
    const failedSession = repository.createValidationSession(failedRevision.id, {
      status: "failed",
      validationReport: {
        valid: false,
        summary: "Failed",
        issues: [{ field: "runtime", code: "failed", message: "Failed" }],
      },
      finishedAt: "2026-07-07T00:00:00.000Z",
    });

    const published = parseResponse(await handler.handleManageCustomDashboards({
      action: "publish_revision",
      dashboardId: dashboard.id,
      revisionId: validRevision.id,
      validationSessionId: passedSession.id,
    }));
    expect(published.result.dashboard.publishedRevisionId).toBe(validRevision.id);

    const denied = parseResponse(await handler.handleManageCustomDashboards({
      action: "publish_revision",
      dashboardId: dashboard.id,
      revisionId: failedRevision.id,
      validationSessionId: failedSession.id,
    }));
    expect(denied.result.status).toBe("error");
    expect(denied.result.errorType).toBe("runtime");
    expect(denied.result.message).toContain("Only passed custom dashboard validation sessions can be published");
    expect(repository.getDashboardById(dashboard.id)?.publishedRevisionId).toBe(validRevision.id);
  });

  it("requires approval before archiving", async () => {
    const { handler, repository, projectId } = await createFixture();
    const dashboard = repository.createDraft(projectId, {
      title: "Delivery Pulse",
      manifest: manifest(),
      fileBundle: fileBundle(),
    });

    const blocked = parseResponse(await handler.handleManageCustomDashboards({
      action: "archive",
      dashboardId: dashboard.id,
    }));
    expect(blocked.approvalRequired).toBe(true);
    expect(repository.getDashboardById(dashboard.id)?.status).toBe("draft");

    const archived = parseResponse(await handler.handleManageCustomDashboards({
      action: "archive",
      dashboardId: dashboard.id,
      approval: { confirmed: true },
    }));
    expect(archived.result.dashboard.status).toBe("archived");
  });

  it("lists metadata-only slots and approval-gates project-owned bind and unbind actions", async () => {
    const canary = "CUSTOM_DASHBOARD_REAL_SECRET_CANARY_7f8d9a";
    const { handler, repository, credentialBroker, projectId } = await createFixture();
    const dashboard = repository.createDraft(projectId, {
      title: "Credential dashboard",
      manifest: credentialManifest(),
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

    const listed = parseResponse(await handler.handleManageCustomDashboards({
      action: "list_credential_slots",
      projectId,
      dashboardId: dashboard.id,
    }));
    expect(listed.result.bindings).toMatchObject({ valid: false, credentialBindingRevision: 1 });
    expect(listed.result.bindings.slots[0].candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ credentialId: credential.id, compatible: true }),
    ]));
    expect(JSON.stringify(listed)).not.toContain(canary);

    const bindArgs = {
      action: "bind_credential" as const,
      projectId,
      dashboardId: dashboard.id,
      slotId: "metrics_api",
      credentialId: credential.id,
      expectedBindingRevision: 1,
    };
    const preflight = parseResponse(await handler.handleManageCustomDashboards(bindArgs));
    expect(preflight.approvalRequired).toBe(true);
    expect(repository.getDashboardById(dashboard.id)?.credentialBindings).toEqual([]);

    const bound = parseResponse(await handler.handleManageCustomDashboards({
      ...bindArgs,
      approval: { confirmed: true },
    }));
    expect(bound.result.bindings).toMatchObject({ valid: true, credentialBindingRevision: 2 });
    expect(JSON.stringify(bound)).not.toContain(canary);

    const boundDashboard = repository.getDashboardById(dashboard.id)!;
    repository.updateDraft(dashboard.id, {
      manifest: {
        ...boundDashboard.manifest,
        metadata: { nested: { credentialId: credential.id, value: `prefix-${credential.id}-suffix` } },
      },
      fileBundle: fileBundle(`export const nested = ${JSON.stringify(credential.id)};`),
      sourceNodeGraph: {
        nodes: [{
          id: "metrics",
          type: "integrations_metadata",
          title: "Metrics",
          config: { nested: { credentialId: credential.id, value: credential.id } },
        }],
        edges: [],
      },
      runtimeMetadata: {
        validation: {
          viewerArtifact: {
            kind: "vite-dist",
            entryFile: "index.html",
            files: [{
              path: "index.html",
              content: `<main data-binding="${credential.id}">Nested</main>`,
              contentType: "text/html",
            }],
          },
        },
      },
    });
    const revision = repository.createRevision(dashboard.id);
    const validation = repository.createValidationSession(revision.id, {
      status: "passed",
      validationReport: passedReport(),
      finishedAt: new Date().toISOString(),
    });

    const generic = parseResponse(await handler.handleManageCustomDashboards({ action: "get", dashboardId: dashboard.id }));
    expect(JSON.stringify(generic)).not.toContain("credentialBindings");
    expect(JSON.stringify(generic)).not.toContain(credential.id);
    const catalog = parseResponse(await handler.handleManageCustomDashboards({ action: "data_catalog", projectId }));
    expect(JSON.stringify(catalog)).not.toContain(credential.id);

    credentialBroker.revoke(projectId, credential.id, { expectedVersion: credential.version });
    const deniedPublication = parseResponse(await handler.handleManageCustomDashboards({
      action: "publish_revision",
      dashboardId: dashboard.id,
      revisionId: revision.id,
      validationSessionId: validation.id,
    }));
    expect(deniedPublication.result).toMatchObject({
      status: "error",
      errorType: "validation",
      issues: [expect.objectContaining({ field: "credentialBindings.metrics_api", code: "not_active" })],
    });
    expect(JSON.stringify(deniedPublication)).not.toContain(credential.id);
    expect(JSON.stringify(deniedPublication)).not.toContain(canary);
    expect(repository.getDashboardById(dashboard.id)?.publishedRevisionId).toBeNull();

    const unbindArgs = {
      action: "unbind_credential" as const,
      projectId,
      dashboardId: dashboard.id,
      slotId: "metrics_api",
      expectedBindingRevision: 2,
    };
    expect(parseResponse(await handler.handleManageCustomDashboards(unbindArgs)).approvalRequired).toBe(true);
    const unbound = parseResponse(await handler.handleManageCustomDashboards({
      ...unbindArgs,
      approval: { confirmed: true },
    }));
    expect(unbound.result.bindings).toMatchObject({ valid: false, credentialBindingRevision: 3 });
    expect(repository.getDashboardById(dashboard.id)?.credentialBindings).toEqual([]);
  });

  it("rejects secret-bearing bind fields and cross-project dashboard binding access", async () => {
    const canary = "MCP_REJECTED_BIND_SECRET_CANARY";
    const { handler, repository, credentialBroker, projectId } = await createFixture();
    const dashboard = repository.createDraft(projectId, {
      title: "Credential dashboard",
      manifest: credentialManifest(),
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
    const unsafe = {
      action: "bind_credential" as const,
      projectId,
      dashboardId: dashboard.id,
      slotId: "metrics_api",
      credentialId: credential.id,
      expectedBindingRevision: 1,
      value: canary,
    };
    const deniedInitial = parseResponse(await handler.handleManageCustomDashboards(unsafe as any));
    expect(deniedInitial.result).toMatchObject({ status: "error", errorType: "validation", field: "payload" });
    expect(JSON.stringify(deniedInitial)).not.toContain(canary);
    expect(pendingApprovalFingerprints(handler)).toEqual([]);

    const deniedConfirmed = parseResponse(await handler.handleManageCustomDashboards({
      ...unsafe,
      approval: { confirmed: true },
    } as any));
    expect(deniedConfirmed.result.status).toBe("error");
    expect(JSON.stringify(deniedConfirmed)).not.toContain(canary);
    expect(pendingApprovalFingerprints(handler)).toEqual([]);

    const deniedApprovalPayload = parseResponse(await handler.handleManageCustomDashboards({
      action: "bind_credential",
      projectId,
      dashboardId: dashboard.id,
      slotId: "metrics_api",
      credentialId: credential.id,
      expectedBindingRevision: 1,
      approval: { confirmed: false, value: canary },
    } as any));
    expect(deniedApprovalPayload.result).toMatchObject({
      status: "error",
      errorType: "validation",
      field: "approval",
    });
    expect(JSON.stringify(deniedApprovalPayload)).not.toContain(canary);
    expect(pendingApprovalFingerprints(handler)).toEqual([]);

    const cleanBind = {
      action: "bind_credential" as const,
      projectId,
      dashboardId: dashboard.id,
      slotId: "metrics_api",
      credentialId: credential.id,
      expectedBindingRevision: 1,
      approval: { confirmed: true },
    };
    const cleanPreflight = parseResponse(await handler.handleManageCustomDashboards(cleanBind));
    expect(cleanPreflight.approvalRequired).toBe(true);
    const fingerprints = pendingApprovalFingerprints(handler);
    expect(fingerprints).toHaveLength(1);
    expect(fingerprints[0]).not.toContain(canary);
    expect(fingerprints[0]).not.toContain('"value"');

    const bound = parseResponse(await handler.handleManageCustomDashboards(cleanBind));
    expect(bound.result.bindings.valid).toBe(true);
    expect(pendingApprovalFingerprints(handler)).toEqual([]);

    const unsafeUnbind = {
      action: "unbind_credential" as const,
      projectId,
      dashboardId: dashboard.id,
      slotId: "metrics_api",
      expectedBindingRevision: 2,
      headers: { authorization: canary },
    };
    const deniedUnbind = parseResponse(await handler.handleManageCustomDashboards(unsafeUnbind as any));
    expect(deniedUnbind.result).toMatchObject({ status: "error", errorType: "validation", field: "payload" });
    expect(JSON.stringify(deniedUnbind)).not.toContain(canary);
    expect(pendingApprovalFingerprints(handler)).toEqual([]);

    const crossProject = parseResponse(await handler.handleManageCustomDashboards({
      action: "list_credential_slots",
      projectId: "another-project",
      dashboardId: dashboard.id,
    }));
    expect(crossProject.result.status).toBe("error");
  });
});
