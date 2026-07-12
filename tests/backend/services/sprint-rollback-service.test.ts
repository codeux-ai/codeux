import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { AppDbStorage } from "../../../src/repositories/app-db-storage.js";
import { ProjectManagementRepository } from "../../../src/repositories/project-management-repository.js";
import type { SettingsRepository } from "../../../src/repositories/settings-repository.js";
import { SprintRollbackService, type SprintRollbackGitRunner } from "../../../src/services/sprint-rollback-service.js";

const tempDirs: string[] = [];

async function createHarness(options: {
  mode?: "REMOTE" | "LOCAL";
  failRevert?: boolean;
} = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-rollback-test-"));
  tempDirs.push(dir);
  const storage = new AppDbStorage(path.join(dir, "app.db"));
  const repository = new ProjectManagementRepository(storage);
  const project = repository.createProject({
    name: "Rollback Test Project",
    sourceType: "local",
    sourceRef: dir,
    defaultBranch: "main",
  });
  const sourceSprint = repository.createSprint(project.id, {
    name: "Source Sprint",
    status: "completed",
    featureBranch: "feature/source-sprint",
  });
  const calls: Array<{ command: string; args: string[]; cwd: string }> = [];
  const gitRunner: SprintRollbackGitRunner = vi.fn(async (command, args, cwd) => {
    calls.push({ command, args, cwd });
    if (args[0] === "rev-parse" && args.join(" ").includes("origin/main")) {
      return { ok: true, code: 0, stdout: "merge-sha\n", stderr: "" };
    }
    if (args[0] === "show") {
      return {
        ok: true,
        code: 0,
        stdout: "parent-one parent-two\0Merge branch 'feature/source-sprint'\0\n",
        stderr: "",
      };
    }
    if (args[0] === "rev-parse" && args.join(" ").includes("origin/feature/source-sprint")) {
      return { ok: true, code: 0, stdout: "parent-two\n", stderr: "" };
    }
    if (options.failRevert && args.includes("revert")) {
      throw new Error("content conflict");
    }
    return { ok: true, code: 0, stdout: "", stderr: "" };
  });
  const orchestrateSprint = vi.fn().mockResolvedValue({ ok: true });
  const settingsRepository = {
    resolveSprintDashboardSettings: () => ({
      settings: {
        git: {
          githubMode: options.mode ?? "REMOTE",
          defaultBranch: "main",
        },
      },
    }),
  } as unknown as SettingsRepository;
  const service = new SprintRollbackService({
    projectManagementRepository: repository,
    settingsRepository,
    orchestrateSprint,
    gitRunner,
  });
  return { storage, repository, project, sourceSprint, service, calls, orchestrateSprint };
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("SprintRollbackService", () => {
  it("creates a deterministic rollback sprint without a provider task invocation", async () => {
    const { repository, project, sourceSprint, service, calls, orchestrateSprint } = await createHarness();

    const assessment = await service.assess(project.id, sourceSprint.id);
    expect(assessment).toMatchObject({ eligible: true, recommendedMode: "automatic" });

    const result = await service.create(project.id, sourceSprint.id);
    expect(result.mode).toBe("automatic");
    expect(result.rollbackSprint).toMatchObject({
      kind: "rollback",
      rollbackSourceSprintId: sourceSprint.id,
      rollbackMode: "automatic",
    });
    expect(repository.listTasks(project.id, result.rollbackSprint.id)).toEqual([
      expect.objectContaining({ status: "completed", isMerged: true, sourceType: "sprint_rollback" }),
    ]);
    expect(calls.some(({ args }) => args.includes("revert") && args.includes("-m") && args.includes("merge-sha"))).toBe(true);
    expect(calls.some(({ args }) => args.includes("push") && args.some((arg) => arg.startsWith("HEAD:refs/heads/rollback/")))).toBe(true);
    expect(orchestrateSprint).toHaveBeenCalledWith(project.id, result.rollbackSprint.id);
  });

  it("keeps temporary worktree commands in the source repository Git context", async () => {
    const { project, sourceSprint, service, calls } = await createHarness();

    const result = await service.create(project.id, sourceSprint.id);

    expect(result.mode).toBe("automatic");
    const worktreeCommands = calls.filter(({ args }) => (
      args.includes("switch") || args.includes("revert") || args.includes("push")
    ));
    expect(worktreeCommands).toHaveLength(3);
    for (const call of worktreeCommands) {
      expect(call.cwd).toBe(project.baseDir);
      expect(call.args[0]).toBe("-C");
      expect(call.args[1]).toContain("code-ux-rollback-");
    }
  });

  it("always routes custom rollback instructions through an agent task", async () => {
    const { repository, project, sourceSprint, service, calls } = await createHarness();

    const result = await service.create(project.id, sourceSprint.id, {
      instructions: "Remove only feature XY and preserve the schema migration.",
    });

    expect(result.mode).toBe("agent_assisted");
    expect(result.rollbackSprint.rollbackInstructions).toContain("feature XY");
    expect(repository.listTasks(project.id, result.rollbackSprint.id)).toEqual([
      expect.objectContaining({ status: "pending", isMerged: false, promptMarkdown: expect.stringContaining("preserve the schema migration") }),
    ]);
    expect(calls.some(({ args }) => args.includes("revert"))).toBe(false);
  });

  it("uses an agent when later sprint work may depend on the source", async () => {
    const { repository, project, sourceSprint, service } = await createHarness();
    repository.createSprint(project.id, {
      name: "Later Sprint",
      status: "completed",
      featureBranch: "feature/later",
    });

    const assessment = await service.assess(project.id, sourceSprint.id);
    expect(assessment).toMatchObject({ eligible: true, recommendedMode: "agent_assisted" });
    expect(assessment.reasons.join(" ")).toContain("Later sprint work exists");
  });

  it("falls back to an agent task when the automated revert conflicts", async () => {
    const { repository, project, sourceSprint, service } = await createHarness({ failRevert: true });

    const result = await service.create(project.id, sourceSprint.id);
    expect(result.mode).toBe("agent_assisted");
    expect(result.assessment.reasons.join(" ")).toContain("content conflict");
    expect(repository.getSprint(result.rollbackSprint.id)?.rollbackMode).toBe("agent_assisted");
    expect(repository.listTasks(project.id, result.rollbackSprint.id)[0]).toMatchObject({ status: "pending" });
  });

  it("rejects rollback creation outside remote git mode", async () => {
    const { project, sourceSprint, service } = await createHarness({ mode: "LOCAL" });
    const assessment = await service.assess(project.id, sourceSprint.id);
    expect(assessment).toMatchObject({ eligible: false });
    await expect(service.create(project.id, sourceSprint.id)).rejects.toThrow("REMOTE git mode");
  });

  it("rejects oversized rollback instructions before creating a sprint", async () => {
    const { repository, project, sourceSprint, service } = await createHarness();
    await expect(service.create(project.id, sourceSprint.id, { instructions: "x".repeat(6001) }))
      .rejects.toThrow("6000 characters");
    expect(repository.listSprints(project.id).sprints).toHaveLength(1);
  });
});
