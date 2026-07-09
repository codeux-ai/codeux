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
});
