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

async function createFixture(): Promise<{
  handler: ManagementToolHandler;
  repository: CustomDashboardRepository;
  storage: AppDbStorage;
  validationService: CustomDashboardValidationService;
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
  const validationService = new CustomDashboardValidationService({
    customDashboardRepository: repository,
    projectManagementRepository: projects,
    settingsRepository: new SettingsRepository(path.join(dir, "settings.db")),
    readinessPollMs: 1,
    readinessTimeoutMs: 1,
  });
  const handler = new ManagementToolHandler({
    customDashboardRepository: repository,
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
  return { handler, repository, storage, validationService, projectId: project.id };
}

function insertCredential(storage: AppDbStorage, projectId: string): string {
  const id = "mcp-dashboard-credential";
  const now = new Date().toISOString();
  const db = storage.getDatabase();
  db.prepare(`INSERT INTO automation_credentials (
    id, name, kind, scope, project_id, management_project_id, allowed_project_ids_json,
    capabilities_json, status, key_id, key_version, version, created_at, updated_at
  ) VALUES (?, 'MCP token', 'api-token', 'project', ?, ?, '[]', '["read"]', 'active', 'test', 1, 1, ?, ?)`)
    .run(id, projectId, projectId, now, now);
  const blob = Buffer.from("mcp-secret-ciphertext");
  db.prepare(`INSERT INTO automation_credential_secrets (
    credential_id, ciphertext, nonce, auth_tag, wrapped_data_key, wrap_nonce,
    wrap_auth_tag, key_id, key_version, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, 'test', 1, ?)`)
    .run(id, blob, blob, blob, blob, blob, blob, now);
  return id;
}

function parseResponse(response: { content: Array<{ text: string }> }): Record<string, any> {
  return JSON.parse(response.content[0]?.text ?? "{}") as Record<string, any>;
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

  it("parses routes and bindings and returns credential metadata only", async () => {
    const { handler, storage, projectId } = await createFixture();
    const credentialId = insertCredential(storage, projectId);
    const created = parseResponse(await handler.handleManageCustomDashboards({
      action: "create",
      projectId,
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
    }));

    expect(created.result.dashboard).toMatchObject({
      routes: [{ path: "/integration" }],
      credentialBindings: [{ slot: "api_token", credential: { name: "MCP token" } }],
    });
    expect(JSON.stringify(created)).not.toContain("mcp-secret-ciphertext");
  });

  it("rejects raw credential metadata from MCP mutations and keeps revisions and catalogs secret-free", async () => {
    const { handler, projectId } = await createFixture();
    const sentinel = "sentinel-mcp-dashboard-secret";
    const rejectedCreate = parseResponse(await handler.handleManageCustomDashboards({
      action: "create",
      projectId,
      title: "Unsafe dashboard",
      manifest: manifest(),
      fileBundle: { ...fileBundle(), metadata: { "x-api-key": sentinel } },
    }));
    expect(rejectedCreate.result.status).toBe("error");
    expect(JSON.stringify(rejectedCreate)).not.toContain(sentinel);

    const created = parseResponse(await handler.handleManageCustomDashboards({
      action: "create",
      projectId,
      title: "Safe dashboard",
      manifest: manifest(),
      fileBundle: fileBundle(),
    }));
    const dashboardId = created.result.dashboard.id;

    const rejectedUpdate = parseResponse(await handler.handleManageCustomDashboards({
      action: "update",
      dashboardId,
      sourceNodeGraph: {
        nodes: [{ id: "external", type: "external_api", title: "External", config: { "api-token": sentinel } }],
        edges: [],
      },
    }));
    expect(rejectedUpdate.result.status).toBe("error");
    expect(JSON.stringify(rejectedUpdate)).not.toContain(sentinel);

    const rejectedRevision = parseResponse(await handler.handleManageCustomDashboards({
      action: "create_revision",
      dashboardId,
      runtimeMetadata: { headers: { Authorization: `Bearer ${sentinel}` } },
    }));
    expect(rejectedRevision.result.status).toBe("error");
    expect(JSON.stringify(rejectedRevision)).not.toContain(sentinel);

    const opened = parseResponse(await handler.handleManageCustomDashboards({ action: "get", dashboardId }));
    const catalog = parseResponse(await handler.handleManageCustomDashboards({ action: "data_catalog", projectId }));
    expect(opened.result.revisions).toEqual([]);
    expect(JSON.stringify({ opened, catalog })).not.toContain(sentinel);
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
});
