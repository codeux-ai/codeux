import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { AppDbStorage } from "../../../src/repositories/app-db-storage.js";
import { ProjectManagementRepository } from "../../../src/repositories/project-management-repository.js";
import { SprintPreviewRepository } from "../../../src/repositories/sprint-preview-repository.js";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../../src/repositories/settings-defaults.js";
import { SprintPreviewService } from "../../../src/services/sprint-preview-service.js";
import { runCommandStrict } from "../../../src/services/cli-process-runner.js";

vi.mock("../../../src/services/cli-process-runner.js", () => ({
  runCommandStrict: vi.fn(),
}));

const tempDirs: string[] = [];

afterEach(async () => {
  vi.clearAllMocks();
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

beforeEach(() => {
  vi.mocked(runCommandStrict).mockImplementation(async (command, args) => {
    if (command === "docker" && args[0] === "ps") {
      if (args.includes("label=code-ux.preview=true")) {
        return { exitCode: 0, stdout: "container-1\ncontainer-2\n", stderr: "", durationMs: 1 };
      }
      if (args.includes("status=running")) {
        return { exitCode: 0, stdout: "helper-1\n", stderr: "", durationMs: 1 };
      }
    }
    if (command === "docker" && args[0] === "inspect") {
      return {
        exitCode: 0,
        stdout: "{}\t[\"/bin/sh\",\"-c\",\"bash /tmp/code-ux-setup.sh && rm -f /tmp/code-ux-setup.sh\"]\n",
        stderr: "",
        durationMs: 1,
      };
    }
    return { exitCode: 0, stdout: "", stderr: "", durationMs: 1 };
  });
});

describe("SprintPreviewService startup cleanup", () => {
  it("stops stale containers, resets persisted sessions, and removes legacy preview worktree directories", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "sprint-preview-cleanup-"));
    tempDirs.push(root);

    const repoPath = path.join(root, "repo");
    const legacyPreviewPath = path.join(repoPath, ".code-ux", "worktrees", "preview-legacy");
    await fs.mkdir(legacyPreviewPath, { recursive: true });
    await fs.writeFile(path.join(legacyPreviewPath, "stale.txt"), "legacy", "utf8");

    const storage = new AppDbStorage(path.join(root, "app.db"));
    const projectRepository = new ProjectManagementRepository(storage);
    const sprintPreviewRepository = new SprintPreviewRepository(storage);

    const project = projectRepository.createProject({
      name: "Preview Project",
      sourceType: "local",
      sourceRef: repoPath,
      defaultBranch: "main",
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Sprint 51",
      status: "running",
      featureBranch: "feature/sprint-51",
    });

    const createdSession = sprintPreviewRepository.createSession({
      projectId: project.id,
      sprintId: sprint.id,
      status: "running",
      containerAppPort: 3000,
      startupScriptPath: ".code-ux/browser/start-preview.sh",
      startupMode: "auto",
      lastKnownPath: "/",
    });
    sprintPreviewRepository.updateSession(createdSession.id, {
      containerId: "container-2",
      containerName: "code-ux-preview-test",
      worktreePath: legacyPreviewPath,
      healthStatus: "healthy",
    });

    const service = new SprintPreviewService({
      sprintPreviewRepository,
      projectManagementRepository: projectRepository,
      executionRepository: {
        getProjectExecutionSnapshot: () => ({
          projectId: project.id,
          projectName: project.name,
          sprintRuns: [],
          taskDispatches: [],
          connections: [],
          primaryAssignedWorker: null,
          overflowAssignedWorkers: [],
          attentionItems: [],
          recentEvents: [],
          updatedAt: null,
        }),
      } as any,
      settingsRepository: {
        resolveSprintDashboardSettings: () => ({ settings: DEFAULT_DASHBOARD_SETTINGS }),
      } as any,
    });

    await service.cleanupStaleContainersOnStartup();

    const updatedSession = sprintPreviewRepository.getSession(createdSession.id);
    expect(updatedSession?.status).toBe("stopped");
    expect(updatedSession?.containerId).toBeNull();
    expect(updatedSession?.containerName).toBeNull();
    await expect(fs.access(legacyPreviewPath)).rejects.toThrow();

    expect(runCommandStrict).toHaveBeenCalledWith("docker", ["rm", "-f", "container-1"], process.cwd());
    expect(runCommandStrict).toHaveBeenCalledWith("docker", ["rm", "-f", "container-2"], process.cwd());
    expect(runCommandStrict).toHaveBeenCalledWith("docker", ["rm", "-f", "helper-1"], process.cwd());
    expect(runCommandStrict).toHaveBeenCalledWith(
      "git",
      ["worktree", "remove", "--force", legacyPreviewPath],
      repoPath,
    );
    expect(runCommandStrict).toHaveBeenCalledWith("git", ["worktree", "prune"], repoPath);
  });
});
