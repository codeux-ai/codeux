import { afterEach, describe, expect, it } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import type {
  CustomDashboardDataSourceNodeGraph,
  CustomDashboardFileBundle,
  CustomDashboardManifest,
  CustomDashboardValidationReport,
} from "../../../src/contracts/custom-dashboard-types.js";
import { AppDbStorage } from "../../../src/repositories/app-db-storage.js";
import { CustomDashboardRepository } from "../../../src/repositories/custom-dashboard-repository.js";
import { ProjectManagementRepository } from "../../../src/repositories/project-management-repository.js";
import { ValidationError } from "../../../src/repositories/repository-utils.js";

const tempDirs: string[] = [];

async function createFixture(): Promise<{
  dir: string;
  storage: AppDbStorage;
  projects: ProjectManagementRepository;
  dashboards: CustomDashboardRepository;
  projectId: string;
}> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "custom-dashboard-repo-"));
  tempDirs.push(dir);
  const storage = new AppDbStorage(path.join(dir, "app.db"));
  const projects = new ProjectManagementRepository(storage);
  const project = projects.createProject({
    name: "Custom Dashboard Project",
    sourceType: "local",
    sourceRef: dir,
  });
  return {
    dir,
    storage,
    projects,
    dashboards: new CustomDashboardRepository(storage),
    projectId: project.id,
  };
}

function manifest(title = "Delivery Pulse"): CustomDashboardManifest {
  return {
    schemaVersion: 1,
    title,
    entryFile: "src/dashboard.tsx",
    filePaths: ["src/dashboard.tsx", "src/data.ts"],
    description: "Operational dashboard manifest",
    metadata: { owner: "runtime", tags: ["delivery", "quality"] },
  };
}

function fileBundle(content = "export const Dashboard = () => null;"): CustomDashboardFileBundle {
  return {
    files: [
      { path: "src/dashboard.tsx", content, contentType: "text/typescript-jsx" },
      { path: "src/data.ts", content: "export const rows = [];", contentType: "text/typescript" },
    ],
    metadata: { generatedBy: "test" },
  };
}

function sourceNodeGraph(): CustomDashboardDataSourceNodeGraph {
  return {
    nodes: [
      { id: "tasks", type: "sqlite_query", title: "Tasks", config: { table: "tasks" } },
      { id: "summary", type: "transform", title: "Summary", config: { groupBy: "status" } },
    ],
    edges: [{ fromNodeId: "tasks", toNodeId: "summary" }],
    metadata: { version: 1 },
  };
}

function passedReport(): CustomDashboardValidationReport {
  return {
    valid: true,
    summary: "Dashboard bundle passed validation.",
    issues: [],
    metadata: { buildMs: 120 },
  };
}

function insertCredential(
  storage: AppDbStorage,
  projectId: string,
  options: { id?: string; capabilities?: string[]; kind?: string } = {},
): string {
  const id = options.id ?? `credential-${Math.random().toString(36).slice(2)}`;
  const now = new Date().toISOString();
  const db = storage.getDatabase();
  db.prepare(`
    INSERT INTO automation_credentials (
      id, name, kind, scope, project_id, management_project_id, allowed_project_ids_json,
      capabilities_json, status, key_id, key_version, version, created_at, updated_at
    ) VALUES (?, 'Dashboard token', ?, 'project', ?, ?, '[]', ?, 'active', 'test', 1, 1, ?, ?)
  `).run(id, options.kind ?? "api-token", projectId, projectId, JSON.stringify(options.capabilities ?? ["read"]), now, now);
  const blob = Buffer.from("encrypted-not-plaintext");
  db.prepare(`
    INSERT INTO automation_credential_secrets (
      credential_id, ciphertext, nonce, auth_tag, wrapped_data_key, wrap_nonce,
      wrap_auth_tag, key_id, key_version, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'test', 1, ?)
  `).run(id, blob, blob, blob, blob, blob, blob, now);
  return id;
}

function credentialSourceNodeGraph(): CustomDashboardDataSourceNodeGraph {
  return {
    nodes: [{
      id: "external",
      type: "external_api",
      title: "External API",
      credentialSlots: [{
        slot: "api_token",
        label: "API token",
        required: true,
        allowedKinds: ["api-token"],
        requiredCapability: "read",
      }],
    }],
    edges: [],
  };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("CustomDashboardRepository", () => {
  it("creates, updates, and lists project-scoped draft dashboards with JSON payloads", async () => {
    const { dashboards, projectId } = await createFixture();

    const created = dashboards.createDraft(projectId, {
      title: "  Delivery Pulse  ",
      description: "  Sprint delivery status  ",
      manifest: manifest(),
      fileBundle: fileBundle(),
      sourceNodeGraph: sourceNodeGraph(),
      styleguide: { palette: { accent: "#14b8a6" } },
      runtimeMetadata: { renderer: "preact" },
    });

    expect(created).toMatchObject({
      projectId,
      title: "Delivery Pulse",
      description: "Sprint delivery status",
      status: "draft",
      manifest: { entryFile: "src/dashboard.tsx" },
      fileBundle: { files: [{ path: "src/dashboard.tsx" }, { path: "src/data.ts" }] },
      sourceNodeGraph: { nodes: [{ id: "tasks" }, { id: "summary" }] },
      styleguide: { palette: { accent: "#14b8a6" } },
      runtimeMetadata: { renderer: "preact" },
      publishedRevisionId: null,
    });

    const updated = dashboards.updateDraft(created.id, {
      title: "Delivery Pulse v2",
      manifest: manifest("Delivery Pulse v2"),
      fileBundle: fileBundle("export const Dashboard = () => 'v2';"),
      runtimeMetadata: { renderer: "preact", format: "esm" },
    });

    expect(updated.title).toBe("Delivery Pulse v2");
    expect(updated.manifest.title).toBe("Delivery Pulse v2");
    expect(updated.fileBundle.files[0]?.content).toContain("v2");
    expect(updated.runtimeMetadata).toEqual({ renderer: "preact", format: "esm" });
    expect(dashboards.listDashboardsByProject(projectId).map((dashboard) => dashboard.id)).toEqual([created.id]);
    expect(dashboards.getDashboardById(created.id)?.manifest.metadata).toEqual({ owner: "runtime", tags: ["delivery", "quality"] });
  });

  it("creates immutable revisions from the current draft bundle", async () => {
    const { dashboards, projectId } = await createFixture();
    const dashboard = dashboards.createDraft(projectId, {
      title: "Delivery Pulse",
      manifest: manifest(),
      fileBundle: fileBundle("first"),
      sourceNodeGraph: sourceNodeGraph(),
    });

    const revision = dashboards.createRevision(dashboard.id);
    dashboards.updateDraft(dashboard.id, {
      fileBundle: fileBundle("second"),
      manifest: manifest("Edited Draft"),
    });

    expect(revision.revisionNumber).toBe(1);
    expect(revision.fileBundle.files[0]?.content).toBe("first");
    expect(dashboards.listRevisions(dashboard.id)).toHaveLength(1);
    expect(dashboards.getRevisionById(revision.id)?.fileBundle.files[0]?.content).toBe("first");
    expect(dashboards.getDashboardById(dashboard.id)?.fileBundle.files[0]?.content).toBe("second");
  });

  it("tracks validation history and rejects publish attempts for unvalidated or failed revisions", async () => {
    const { dashboards, projectId } = await createFixture();
    const dashboard = dashboards.createDraft(projectId, {
      title: "Delivery Pulse",
      manifest: manifest(),
      fileBundle: fileBundle(),
      sourceNodeGraph: sourceNodeGraph(),
    });
    const failedRevision = dashboards.createRevision(dashboard.id);
    const validRevision = dashboards.createRevision(dashboard.id);

    expect(() => dashboards.publishRevision(dashboard.id, failedRevision.id)).toThrow(ValidationError);

    const failedSession = dashboards.createValidationSession(failedRevision.id, { status: "running" });
    const updatedSession = dashboards.updateValidationSession(failedSession.id, {
      status: "failed",
      validationReport: {
        valid: false,
        summary: "Bundle failed validation.",
        issues: [{ field: "files", code: "build_failed", message: "Build failed." }],
      },
      finishedAt: "2026-07-07T00:00:00.000Z",
    });

    expect(updatedSession.status).toBe("failed");
    expect(dashboards.getRevisionById(failedRevision.id)?.validationStatus).toBe("failed");
    expect(dashboards.getDashboardById(dashboard.id)?.status).toBe("rejected");
    expect(() => dashboards.publishRevision(dashboard.id, failedRevision.id)).toThrow(ValidationError);

    const validated = dashboards.markRevisionValidated(validRevision.id, passedReport());
    expect(validated.validationStatus).toBe("passed");
    expect(validated.validationReport?.valid).toBe(true);

    const published = dashboards.publishRevision(dashboard.id, validRevision.id);
    expect(published.status).toBe("published");
    expect(published.publishedRevisionId).toBe(validRevision.id);
    expect(dashboards.listValidationSessions(failedRevision.id).map((session) => session.id)).toEqual([failedSession.id]);
  });

  it("keeps one active publication per dashboard and enforces revision ownership", async () => {
    const { dashboards, projectId } = await createFixture();
    const firstDashboard = dashboards.createDraft(projectId, {
      title: "Delivery Pulse",
      manifest: manifest(),
      fileBundle: fileBundle(),
    });
    const secondDashboard = dashboards.createDraft(projectId, {
      title: "Quality Pulse",
      manifest: manifest("Quality Pulse"),
      fileBundle: fileBundle(),
    });
    const firstRevision = dashboards.markRevisionValidated(dashboards.createRevision(firstDashboard.id).id, passedReport());
    const replacementRevision = dashboards.markRevisionValidated(dashboards.createRevision(firstDashboard.id).id, passedReport());
    const secondRevision = dashboards.markRevisionValidated(dashboards.createRevision(secondDashboard.id).id, passedReport());

    expect(() => dashboards.publishRevision(firstDashboard.id, secondRevision.id)).toThrow(ValidationError);

    expect(dashboards.publishRevision(firstDashboard.id, firstRevision.id).publishedRevisionId).toBe(firstRevision.id);
    expect(dashboards.publishRevision(firstDashboard.id, replacementRevision.id).publishedRevisionId).toBe(replacementRevision.id);

    expect(dashboards.getDashboardById(firstDashboard.id)?.publishedRevisionId).toBe(replacementRevision.id);
  });

  it("durably halts the current revision, rejects stale reports, and resumes only after validation", async () => {
    const { dashboards, projectId, storage } = await createFixture();
    const dashboard = dashboards.createDraft(projectId, {
      title: "Delivery Pulse",
      manifest: manifest(),
      fileBundle: fileBundle(),
    });
    const revision = dashboards.markRevisionValidated(dashboards.createRevision(dashboard.id).id, passedReport());
    dashboards.publishRevision(dashboard.id, revision.id);

    const halted = dashboards.haltRuntime(
      dashboard.id,
      revision.id,
      "Bearer top-secret token=also-secret runtime exploded",
      { source: "iframe" },
    );
    expect(halted.runtimeState).toMatchObject({
      status: "halted",
      haltedRevisionId: revision.id,
      recoveryMetadata: { source: "iframe" },
    });
    expect(halted.runtimeState.haltedReason).toContain("[REDACTED]");
    expect(halted.runtimeState.haltedReason).not.toContain("top-secret");
    expect(dashboards.haltRuntime(dashboard.id, revision.id, "second concurrent report").runtimeState.haltedReason)
      .toBe(halted.runtimeState.haltedReason);
    expect(() => dashboards.haltRuntime(dashboard.id, "stale-revision", "stale report")).toThrow(ValidationError);
    expect(() => dashboards.haltRuntime(dashboard.id, revision.id, "\u0000\n")).toThrow(ValidationError);

    const reopened = new CustomDashboardRepository(storage);
    expect(reopened.getDashboardById(dashboard.id)?.runtimeState.status).toBe("halted");
    reopened.reconcileRuntimeStatesOnStartup();
    expect(reopened.getDashboardById(dashboard.id)?.runtimeState).toMatchObject({
      status: "halted",
      recoveryMetadata: { startupRecoveryCount: 1 },
    });

    expect(reopened.resumeRuntime(dashboard.id, revision.id).runtimeState.status).toBe("active");
    expect(reopened.resumeRuntime(dashboard.id, revision.id).runtimeState.status).toBe("active");
  });

  it("rolls a halted dashboard back only with a validated revision and current publication guard", async () => {
    const { dashboards, projectId } = await createFixture();
    const dashboard = dashboards.createDraft(projectId, {
      title: "Delivery Pulse",
      manifest: manifest(),
      fileBundle: fileBundle("first"),
    });
    const earlier = dashboards.markRevisionValidated(dashboards.createRevision(dashboard.id).id, passedReport());
    dashboards.updateDraft(dashboard.id, { fileBundle: fileBundle("current") });
    const current = dashboards.markRevisionValidated(dashboards.createRevision(dashboard.id).id, passedReport());
    dashboards.publishRevision(dashboard.id, current.id);
    dashboards.haltRuntime(dashboard.id, current.id, "current revision failed");

    expect(() => dashboards.publishRevision(dashboard.id, earlier.id)).toThrow(ValidationError);
    expect(() => dashboards.publishRevision(dashboard.id, earlier.id, undefined, earlier.id)).toThrow(ValidationError);
    const rolledBack = dashboards.publishRevision(dashboard.id, earlier.id, undefined, current.id);
    expect(rolledBack).toMatchObject({ publishedRevisionId: earlier.id, runtimeState: { status: "active" } });
  });

  it("keeps a published dashboard open when later draft validation fails", async () => {
    const { dashboards, projectId } = await createFixture();
    const dashboard = dashboards.createDraft(projectId, {
      title: "Delivery Pulse",
      manifest: manifest(),
      fileBundle: fileBundle("published"),
    });
    const publishedRevision = dashboards.markRevisionValidated(dashboards.createRevision(dashboard.id).id, {
      ...passedReport(),
      summary: "Published revision passed.",
    });

    dashboards.publishRevision(dashboard.id, publishedRevision.id);

    const draftRevision = dashboards.createRevision(dashboard.id, {
      fileBundle: fileBundle("draft"),
    });
    const runningSession = dashboards.createValidationSession(draftRevision.id, { status: "running" });

    expect(dashboards.getDashboardById(dashboard.id)).toMatchObject({
      status: "published",
      publishedRevisionId: publishedRevision.id,
    });

    const failedSession = dashboards.updateValidationSession(runningSession.id, {
      status: "failed",
      validationReport: {
        valid: false,
        summary: "Draft validation failed.",
        issues: [{ field: "files", code: "build_failed", message: "Draft bundle failed." }],
      },
      finishedAt: "2026-07-07T00:00:00.000Z",
    });
    const openedDashboard = dashboards.getDashboardById(dashboard.id);
    const openedRevision = dashboards.getRevisionById(publishedRevision.id);

    expect(failedSession).toMatchObject({
      status: "failed",
      validationReport: { valid: false, summary: "Draft validation failed." },
    });
    expect(dashboards.getRevisionById(draftRevision.id)).toMatchObject({
      validationStatus: "failed",
      validationReport: { valid: false, summary: "Draft validation failed." },
    });
    expect(openedDashboard).toMatchObject({
      status: "published",
      publishedRevisionId: publishedRevision.id,
    });
    expect(openedRevision).toMatchObject({
      validationStatus: "passed",
      validationReport: { valid: true, summary: "Published revision passed." },
    });

    const replacementDraftRevision = dashboards.createRevision(dashboard.id, {
      fileBundle: fileBundle("replacement draft"),
    });
    dashboards.markRevisionValidated(replacementDraftRevision.id, {
      ...passedReport(),
      summary: "Replacement draft passed.",
    });

    expect(dashboards.getDashboardById(dashboard.id)).toMatchObject({
      status: "published",
      publishedRevisionId: publishedRevision.id,
    });
  });

  it("keeps later validation session results off the active published revision", async () => {
    const { dashboards, projectId } = await createFixture();
    const dashboard = dashboards.createDraft(projectId, {
      title: "Delivery Pulse",
      manifest: manifest(),
      fileBundle: fileBundle(),
    });
    const publishedRevision = dashboards.markRevisionValidated(dashboards.createRevision(dashboard.id).id, {
      ...passedReport(),
      summary: "Original published validation.",
      metadata: { viewer: "published" },
    });

    dashboards.publishRevision(dashboard.id, publishedRevision.id);
    const session = dashboards.createValidationSession(publishedRevision.id, { status: "running" });
    const failedSession = dashboards.updateValidationSession(session.id, {
      status: "failed",
      validationReport: {
        valid: false,
        summary: "Later validation failed.",
        issues: [{ field: "runtime", code: "regression", message: "Later validation should not invalidate publication." }],
      },
    });
    const stillPublishedRevision = dashboards.markRevisionValidated(publishedRevision.id, {
      ...passedReport(),
      summary: "Later direct validation result.",
      metadata: { viewer: "later" },
    });

    expect(failedSession).toMatchObject({
      status: "failed",
      validationReport: { valid: false, summary: "Later validation failed." },
    });
    expect(stillPublishedRevision).toMatchObject({
      validationStatus: "passed",
      validationReport: { valid: true, summary: "Original published validation.", metadata: { viewer: "published" } },
    });
    expect(dashboards.getDashboardById(dashboard.id)?.status).toBe("published");
  });

  it("archives dashboards and cascades dashboard data when the project is deleted", async () => {
    const { storage, projects, dashboards, projectId } = await createFixture();
    const dashboard = dashboards.createDraft(projectId, {
      title: "Delivery Pulse",
      manifest: manifest(),
      fileBundle: fileBundle(),
    });
    const revision = dashboards.markRevisionValidated(dashboards.createRevision(dashboard.id).id, passedReport());
    dashboards.publishRevision(dashboard.id, revision.id);

    const archived = dashboards.archiveDashboard(dashboard.id);
    expect(archived.status).toBe("archived");
    expect(archived.publishedRevisionId).toBeNull();

    projects.deleteProject(projectId);

    const db = storage.getDatabase();
    expect(db.prepare(`SELECT COUNT(*) AS count FROM custom_dashboards`).get()).toMatchObject({ count: 0 });
    expect(db.prepare(`SELECT COUNT(*) AS count FROM custom_dashboard_revisions`).get()).toMatchObject({ count: 0 });
    expect(db.prepare(`SELECT COUNT(*) AS count FROM custom_dashboard_publications`).get()).toMatchObject({ count: 0 });
  });

  it("validates required fields at the repository boundary", async () => {
    const { dashboards, projectId } = await createFixture();

    expect(() => dashboards.createDraft(projectId, {
      title: "",
      manifest: manifest(),
      fileBundle: fileBundle(),
    })).toThrow(ValidationError);

    expect(() => dashboards.createDraft(projectId, {
      title: "Broken",
      manifest: { ...manifest(), entryFile: "missing.tsx" },
      fileBundle: fileBundle(),
    })).toThrow(ValidationError);

    expect(() => dashboards.createDraft(projectId, {
      title: "Broken",
      manifest: manifest(),
      fileBundle: { files: [{ path: "src/dashboard.tsx", content: "one" }, { path: "src/dashboard.tsx", content: "two" }] },
    })).toThrow(ValidationError);
  });

  it("rejects raw credentials before draft, update, and revision persistence", async () => {
    const { dashboards, projectId, storage } = await createFixture();
    const sentinel = "sentinel-custom-dashboard-secret";
    const base = {
      title: "Credential-safe dashboard",
      manifest: manifest(),
      fileBundle: fileBundle(),
      sourceNodeGraph: sourceNodeGraph(),
    };

    expect(() => dashboards.createDraft(projectId, {
      ...base,
      fileBundle: { ...fileBundle(), metadata: { "x-api-key": sentinel } },
    })).toThrow(/raw secret literal/);
    expect(() => dashboards.createDraft(projectId, {
      ...base,
      sourceNodeGraph: {
        nodes: [{ id: "external", type: "external_api", title: "External", config: { apiKey: sentinel } }],
        edges: [],
      },
    })).toThrow(/raw secret literal/);

    const dashboard = dashboards.createDraft(projectId, {
      ...base,
      sourceNodeGraph: {
        nodes: [{
          id: "external",
          type: "external_api",
          title: "External",
          config: { baseUrl: "https://api.example.test", timeoutMs: 5000 },
          credentialSlots: [{
            slot: "api_token",
            label: "API token",
            required: false,
            allowedKinds: ["api-token"],
            requiredCapability: "read",
            metadata: { headerName: "authorization", scheme: "Bearer" },
          }],
        }],
        edges: [],
      },
    });
    expect(() => dashboards.updateDraft(dashboard.id, {
      routes: [{
        path: "/unsafe",
        label: "Unsafe",
        entryFile: "src/dashboard.tsx",
        metadata: { Authorization: sentinel },
      }],
    })).toThrow(/raw secret literal/);
    expect(() => dashboards.createRevision(dashboard.id, {
      manifest: { ...manifest(), metadata: { "access-token": sentinel } },
    })).toThrow(/raw secret literal/);
    expect(() => dashboards.createRevision(dashboard.id, {
      runtimeMetadata: { nested: { password: sentinel } },
    })).toThrow(/raw secret literal/);

    const serializedRows = storage.getDatabase().prepare(`
      SELECT manifest_json, files_json, source_node_graph_json, routes_json, styleguide_json, runtime_metadata_json
      FROM custom_dashboards
      WHERE id = ?
    `).get(dashboard.id);
    expect(JSON.stringify(serializedRows)).not.toContain(sentinel);
    expect(JSON.stringify(dashboards.getDashboardById(dashboard.id))).not.toContain(sentinel);
    expect(dashboards.listRevisions(dashboard.id)).toEqual([]);
  });

  it("normalizes safe routes and snapshots credential metadata and bindings in revisions", async () => {
    const { storage, dashboards, projectId } = await createFixture();
    const firstCredentialId = insertCredential(storage, projectId, { id: "credential-first" });
    const secondCredentialId = insertCredential(storage, projectId, { id: "credential-second" });
    const dashboard = dashboards.createDraft(projectId, {
      id: "dashboard-stable",
      title: "Credential dashboard",
      manifest: manifest(),
      fileBundle: fileBundle(),
      sourceNodeGraph: credentialSourceNodeGraph(),
      credentialBindings: [{ slot: "api_token", credentialId: firstCredentialId }],
      routes: [{ path: "delivery/", label: "Delivery", entryFile: "src/dashboard.tsx", metadata: { view: "summary" } }],
    });
    const revision = dashboards.createRevision(dashboard.id);

    dashboards.updateDraft(dashboard.id, {
      credentialBindings: [{ slot: "api_token", credentialId: secondCredentialId }],
      routes: [{ path: "/quality", label: "Quality", entryFile: "src/dashboard.tsx" }],
    });

    expect(dashboard.routes[0]?.path).toBe("/delivery");
    expect(dashboard.credentialBindings[0]).toMatchObject({
      slot: "api_token",
      credentialId: firstCredentialId,
      capability: "read",
      bindingKey: "custom-dashboard:dashboard-stable:api_token",
      credential: { id: firstCredentialId, configured: true },
    });
    expect(dashboards.getRevisionById(revision.id)).toMatchObject({
      routes: [{ path: "/delivery" }],
      credentialBindings: [{ credentialId: firstCredentialId }],
    });
    expect(dashboards.getDashboardById(dashboard.id)).toMatchObject({
      routes: [{ path: "/quality" }],
      credentialBindings: [{ credentialId: secondCredentialId }],
    });
    expect(storage.getDatabase().prepare(`
      SELECT credential_id, binding_key, required_capabilities_json
      FROM automation_credential_bindings
      WHERE project_id = ?
    `).get(projectId)).toMatchObject({
      credential_id: secondCredentialId,
      binding_key: "custom-dashboard:dashboard-stable:api_token",
      required_capabilities_json: '["read"]',
    });
    expect(JSON.stringify(dashboard)).not.toContain("encrypted-not-plaintext");
  });

  it("rejects duplicate or unsafe routes and inaccessible or insufficient credentials", async () => {
    const { storage, projects, dashboards, projectId, dir } = await createFixture();
    const missingCapability = insertCredential(storage, projectId, { capabilities: ["write"] });
    const otherProject = projects.createProject({ name: "Other", sourceType: "local", sourceRef: dir });
    const crossProjectCredential = insertCredential(storage, otherProject.id);
    const base = {
      title: "Credential dashboard",
      manifest: manifest(),
      fileBundle: fileBundle(),
      sourceNodeGraph: credentialSourceNodeGraph(),
    };

    expect(() => dashboards.createDraft(projectId, {
      ...base,
      credentialBindings: [{ slot: "api_token", credentialId: missingCapability }],
    })).toThrow(/does not grant capability/);
    expect(() => dashboards.createDraft(projectId, {
      ...base,
      credentialBindings: [{ slot: "api_token", credentialId: crossProjectCredential }],
    })).toThrow(/not accessible/);
    expect(() => dashboards.createDraft(projectId, {
      ...base,
      credentialBindings: [{ slot: "api_token", credentialId: insertCredential(storage, projectId) }],
      routes: [
        { path: "/same", label: "One", entryFile: "src/dashboard.tsx" },
        { path: "same/", label: "Two", entryFile: "src/dashboard.tsx" },
      ],
    })).toThrow(/duplicated/);
    expect(() => dashboards.createDraft(projectId, {
      ...base,
      credentialBindings: [{ slot: "api_token", credentialId: insertCredential(storage, projectId) }],
      routes: [{ path: "/api/secrets", label: "Unsafe", entryFile: "src/dashboard.tsx" }],
    })).toThrow(/reserved host route/);
    expect(() => dashboards.createDraft(projectId, {
      ...base,
      credentialBindings: [{
        slot: "api_token",
        credentialId: insertCredential(storage, projectId),
        value: "raw-secret",
      } as never],
    })).toThrow(/cannot contain secret values/);
    expect(() => dashboards.createDraft(projectId, {
      ...base,
      credentialBindings: [{ slot: "api_token", credentialId: insertCredential(storage, projectId) }],
      routes: [{
        path: "/unsafe-metadata",
        label: "Unsafe metadata",
        entryFile: "src/dashboard.tsx",
        metadata: { script: "javascript:alert(1)" },
      }],
    })).toThrow(/cannot contain URLs or filesystem paths/);
  });

  it("loads legacy-style rows with empty route and binding defaults", async () => {
    const { storage, dashboards, projectId } = await createFixture();
    const now = new Date().toISOString();
    storage.getDatabase().prepare(`
      INSERT INTO custom_dashboards (
        id, project_id, title, manifest_json, files_json, source_node_graph_json,
        created_at, updated_at
      ) VALUES ('legacy-dashboard', ?, 'Legacy', ?, ?, '{"nodes":[],"edges":[]}', ?, ?)
    `).run(projectId, JSON.stringify(manifest()), JSON.stringify(fileBundle()), now, now);

    expect(dashboards.getDashboardById("legacy-dashboard")).toMatchObject({
      credentialBindings: [],
      routes: [],
    });
  });
});
