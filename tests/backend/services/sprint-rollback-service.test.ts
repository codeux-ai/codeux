import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { AppDbStorage } from "../../../src/repositories/app-db-storage.js";
import { ProjectManagementRepository } from "../../../src/repositories/project-management-repository.js";
import type { SettingsRepository } from "../../../src/repositories/settings-repository.js";
import { SprintRollbackService, type SprintRollbackGitRunner } from "../../../src/services/sprint-rollback-service.js";

const tempDirs: string[] = [];
const execFileAsync = promisify(execFile);

async function runGit(cwd: string, ...args: string[]): Promise<string> {
  const result = await execFileAsync("git", args, { cwd });
  return result.stdout.trim();
}

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
    if (args[0] === "rev-parse" && /(?:origin\/main|refs\/heads\/main)/.test(args.join(" "))) {
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
    if (args[0] === "rev-parse" && /(?:origin\/feature\/source-sprint|refs\/heads\/feature\/source-sprint)/.test(args.join(" "))) {
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

  it("creates an automatic local rollback branch without fetching or pushing", async () => {
    const { project, sourceSprint, service, calls } = await createHarness({ mode: "LOCAL" });
    const assessment = await service.assess(project.id, sourceSprint.id);
    expect(assessment).toMatchObject({ eligible: true, recommendedMode: "automatic" });

    const result = await service.create(project.id, sourceSprint.id);

    expect(result.mode).toBe("automatic");
    expect(calls.some(({ args }) => args.includes("fetch"))).toBe(false);
    expect(calls.some(({ args }) => args.includes("push"))).toBe(false);
    expect(calls.some(({ args }) => args.includes("refs/heads/main"))).toBe(true);
    expect(calls.some(({ args }) => args.includes("revert") && args.includes("merge-sha"))).toBe(true);
  });

  it("gives agent-assisted local rollbacks local-only Git instructions", async () => {
    const { repository, project, sourceSprint, service } = await createHarness({ mode: "LOCAL" });

    const result = await service.create(project.id, sourceSprint.id, {
      instructions: "Remove only the user-facing behavior.",
    });

    const task = repository.listTasks(project.id, result.rollbackSprint.id)[0];
    expect(task?.promptMarkdown).toContain("do not push or create a pull request");
    expect(task?.promptMarkdown).toContain("merge the rollback branch locally");
  });

  it("materializes a local rollback branch in a repository with no remote", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-local-rollback-integration-"));
    tempDirs.push(root);
    const repoDir = path.join(root, "repo");
    await fs.mkdir(repoDir);
    await runGit(repoDir, "init", "-b", "main");
    await runGit(repoDir, "config", "user.name", "Code UX Test");
    await runGit(repoDir, "config", "user.email", "test@codeux.invalid");
    await fs.writeFile(path.join(repoDir, "feature.txt"), "before\n", "utf8");
    await runGit(repoDir, "add", "feature.txt");
    await runGit(repoDir, "commit", "-m", "Initial state");
    await runGit(repoDir, "switch", "-c", "feature/source-sprint");
    await fs.writeFile(path.join(repoDir, "feature.txt"), "after\n", "utf8");
    await runGit(repoDir, "commit", "-am", "Add feature");
    await runGit(repoDir, "switch", "main");
    await runGit(repoDir, "merge", "--no-ff", "feature/source-sprint", "-m", "Merge branch 'feature/source-sprint'");
    await runGit(repoDir, "branch", "-D", "feature/source-sprint");

    const storage = new AppDbStorage(path.join(root, "app.db"));
    const repository = new ProjectManagementRepository(storage);
    const project = repository.createProject({
      name: "Local Rollback Project",
      sourceType: "local",
      sourceRef: repoDir,
      defaultBranch: "main",
    });
    const sourceSprint = repository.createSprint(project.id, {
      name: "Source Sprint",
      status: "completed",
      featureBranch: "feature/source-sprint",
    });
    const service = new SprintRollbackService({
      projectManagementRepository: repository,
      settingsRepository: {
        resolveSprintDashboardSettings: () => ({
          settings: { git: { githubMode: "LOCAL", defaultBranch: "main" } },
        }),
      } as unknown as SettingsRepository,
      orchestrateSprint: vi.fn().mockResolvedValue({ ok: true }),
    });

    const result = await service.create(project.id, sourceSprint.id);
    const rollbackBranch = result.rollbackSprint.featureBranch;

    expect(result.mode).toBe("automatic");
    expect(rollbackBranch).toMatch(/^rollback\//);
    expect(await runGit(repoDir, "show", `${rollbackBranch}:feature.txt`)).toBe("before");
    expect(await runGit(repoDir, "remote")).toBe("");
  });

  it("rejects oversized rollback instructions before creating a sprint", async () => {
    const { repository, project, sourceSprint, service } = await createHarness();
    await expect(service.create(project.id, sourceSprint.id, { instructions: "x".repeat(6001) }))
      .rejects.toThrow("6000 characters");
    expect(repository.listSprints(project.id).sprints).toHaveLength(1);
  });
});
