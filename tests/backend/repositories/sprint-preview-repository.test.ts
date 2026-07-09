import { afterEach, describe, expect, it } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { AppDbStorage } from "../../../src/repositories/app-db-storage.js";
import { ProjectManagementRepository } from "../../../src/repositories/project-management-repository.js";
import { SprintPreviewRepository } from "../../../src/repositories/sprint-preview-repository.js";

const tempDirs: string[] = [];

async function createFixture(): Promise<{
  storage: AppDbStorage;
  repository: SprintPreviewRepository;
  projectId: string;
  sprintId: string;
}> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-preview-repo-"));
  tempDirs.push(dir);
  const storage = new AppDbStorage(path.join(dir, "app.db"));
  const projects = new ProjectManagementRepository(storage);
  const project = projects.createProject({
    name: "Preview Project",
    sourceType: "local",
    sourceRef: dir,
  });
  const sprint = projects.createSprint(project.id, {
    name: "Preview Sprint",
    number: 1,
  });
  return {
    storage,
    repository: new SprintPreviewRepository(storage),
    projectId: project.id,
    sprintId: sprint.id,
  };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("SprintPreviewRepository", () => {
  it("maps legacy single-port rows to a primary port mapping", async () => {
    const { storage, repository, projectId, sprintId } = await createFixture();
    const now = "2026-01-01T00:00:00.000Z";
    storage.getDatabase().prepare(`
      INSERT INTO sprint_preview_sessions (
        id, project_id, sprint_id, status, host_port, container_app_port,
        startup_script_path, startup_mode, last_completed_task_count, health_status,
        created_at, updated_at
      ) VALUES (?, ?, ?, 'running', ?, ?, ?, 'auto', 0, 'healthy', ?, ?)
    `).run("preview-legacy", projectId, sprintId, 6123, 4173, ".code-ux/browser/start-preview.sh", now, now);

    const session = repository.getSession("preview-legacy");

    expect(session?.hostPort).toBe(6123);
    expect(session?.containerAppPort).toBe(4173);
    expect(session?.portMappings).toEqual([
      { containerPort: 4173, hostPort: 6123, isPrimary: true },
    ]);
  });

  it("persists multi-port mappings and derives legacy fields from the primary mapping", async () => {
    const { repository, projectId, sprintId } = await createFixture();

    const session = repository.createSession({
      projectId,
      sprintId,
      status: "starting",
      containerAppPort: 3000,
      startupScriptPath: ".code-ux/browser/start-preview.sh",
      startupMode: "auto",
      portMappings: [
        { containerPort: 3000, hostPort: 5555, label: "web" },
        { containerPort: 6006, hostPort: null, label: "storybook", isPrimary: true },
      ],
    });

    expect(session.hostPort).toBeNull();
    expect(session.containerAppPort).toBe(6006);
    expect(session.portMappings).toEqual([
      { containerPort: 3000, hostPort: 5555, label: "web" },
      { containerPort: 6006, hostPort: null, label: "storybook", isPrimary: true },
    ]);
    expect(repository.listSessions(projectId)[0]?.portMappings).toEqual(session.portMappings);
  });

  it("preserves explicit null host ports and omitted update fields distinctly", async () => {
    const { repository, projectId, sprintId } = await createFixture();
    const session = repository.createSession({
      projectId,
      sprintId,
      status: "starting",
      containerAppPort: 3000,
      startupScriptPath: ".code-ux/browser/start-preview.sh",
      startupMode: "auto",
      portMappings: [{ containerPort: 3000, hostPort: null, isPrimary: true }],
    });

    const statusOnly = repository.updateSession(session.id, { status: "running" });
    expect(statusOnly.hostPort).toBeNull();
    expect(statusOnly.portMappings).toEqual([{ containerPort: 3000, hostPort: null, isPrimary: true }]);

    const withHostPort = repository.updateSession(session.id, { hostPort: 6100 });
    expect(withHostPort.hostPort).toBe(6100);
    expect(withHostPort.portMappings).toEqual([{ containerPort: 3000, hostPort: 6100, isPrimary: true }]);
  });

  it("persists sanitized environment overrides", async () => {
    const { repository, projectId, sprintId } = await createFixture();
    const session = repository.createSession({
      projectId,
      sprintId,
      status: "starting",
      containerAppPort: 3000,
      startupScriptPath: ".code-ux/browser/start-preview.sh",
      startupMode: "auto",
      environmentOverrides: [
        { key: "CODE_UX_ALLOW_PUBLIC_DASHBOARD", value: "1", enabled: true },
        { key: "SPRINT_PREVIEW_PORT", value: "9999", enabled: true },
      ],
    });

    expect(session.environmentOverrides).toEqual([
      { key: "CODE_UX_ALLOW_PUBLIC_DASHBOARD", value: "1", enabled: true },
    ]);

    const updated = repository.updateSession(session.id, {
      environmentOverrides: [
        { key: "API_BASE_URL", value: "http://api.local", enabled: true },
        { key: "API_BASE_URL", value: "", enabled: false },
      ],
    });

    expect(repository.getSession(updated.id)?.environmentOverrides).toEqual([
      { key: "API_BASE_URL", value: "", enabled: false },
    ]);
  });

  it("falls back to the first mapping as primary when none is marked", async () => {
    const { repository, projectId, sprintId } = await createFixture();

    const session = repository.createSession({
      projectId,
      sprintId,
      status: "starting",
      containerAppPort: 3000,
      startupScriptPath: ".code-ux/browser/start-preview.sh",
      startupMode: "auto",
      portMappings: [
        { containerPort: 5173, hostPort: 6200 },
        { containerPort: 6006, hostPort: 6201 },
      ],
    });

    expect(session.containerAppPort).toBe(5173);
    expect(session.hostPort).toBe(6200);
    expect(session.portMappings).toEqual([
      { containerPort: 5173, hostPort: 6200, isPrimary: true },
      { containerPort: 6006, hostPort: 6201 },
    ]);
  });

  it("only returns a session when the project and sprint scope match", async () => {
    const { storage, repository, projectId, sprintId } = await createFixture();
    const projects = new ProjectManagementRepository(storage);
    const otherProject = projects.createProject({
      name: "Other Preview Project",
      sourceType: "local",
      sourceRef: "/tmp/other-preview-project",
    });
    const otherSprint = projects.createSprint(otherProject.id, {
      name: "Other Preview Sprint",
      number: 2,
    });
    const session = repository.createSession({
      projectId,
      sprintId,
      status: "running",
      containerAppPort: 3000,
      startupScriptPath: ".code-ux/browser/start-preview.sh",
      startupMode: "auto",
      hostPort: 5555,
    });

    expect(repository.getSessionForProjectSprint(projectId, sprintId, session.id)?.id).toBe(session.id);
    expect(repository.getSessionForProjectSprint(otherProject.id, otherSprint.id, session.id)).toBeNull();
  });
});
