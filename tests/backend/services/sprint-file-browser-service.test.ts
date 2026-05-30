import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

const runCommandStrict = vi.fn();
const commandRun = vi.fn();

vi.mock("../../../src/services/cli-process-runner.js", () => ({
  runCommandStrict: (...args: unknown[]) => runCommandStrict(...args),
  commandRunner: { run: (...args: unknown[]) => commandRun(...args) },
}));

vi.mock("../../../src/services/git-branch-sync-service.js", () => ({
  fetchOriginIfAvailable: vi.fn(async () => undefined),
}));

vi.mock("../../../src/services/git-http-auth.js", () => ({
  buildGitHttpAuthEnvForRepoWithFallbacks: vi.fn(async () => process.env),
}));

vi.mock("../../../src/services/cli-docker-utils.js", () => ({
  getDockerUserSpec: vi.fn(() => "1000:1000"),
  mapPathPrefix: vi.fn((mapped: string) => mapped),
  toDockerMountArg: vi.fn((m: { source: string; destination: string }) => `type=bind,source=${m.source},destination=${m.destination}`),
}));

vi.mock("../../../src/infrastructure/providers/cli/docker-runtime-paths.js", () => ({
  resolveDockerRuntimeRoot: vi.fn(() => "/runtime-root"),
}));

vi.mock("../../../src/git/sprint-branch-scheme.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/git/sprint-branch-scheme.js")>();
  return {
    ...actual,
    formatSprintBranch: vi.fn(() => "feature/sprint-1"),
  };
});

vi.mock("fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs/promises")>();
  return {
    ...actual,
    default: actual,
    mkdir: vi.fn(async () => undefined),
    rm: vi.fn(async () => undefined),
    writeFile: vi.fn(async () => undefined),
    chmod: vi.fn(async () => undefined),
    stat: vi.fn(async () => ({ uid: 1000, gid: 1000 })),
  };
});

import { AppDbStorage } from "../../../src/repositories/app-db-storage.js";
import { ProjectManagementRepository } from "../../../src/repositories/project-management-repository.js";
import { SprintFileBrowserRepository } from "../../../src/repositories/sprint-file-browser-repository.js";
import { SprintFileBrowserService } from "../../../src/services/sprint-file-browser-service.js";

const tempDirs: string[] = [];

const ok = (stdout = "") => ({ ok: true, code: 0, stdout, stderr: "" });
const fail = (stderr = "") => ({ ok: false, code: 1, stdout: "", stderr });

async function createHarness() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-file-browser-"));
  tempDirs.push(dir);
  const storage = new AppDbStorage(path.join(dir, "app.db"));
  const projectRepository = new ProjectManagementRepository(storage);
  const fileBrowserRepository = new SprintFileBrowserRepository(storage);

  const project = projectRepository.createProject({
    name: "File Browser Project",
    sourceType: "local",
    sourceRef: "/workspace/file-browser-project",
  });
  const sprint = projectRepository.createSprint(project.id, {
    name: "Sprint One",
    featureBranch: "feature/test",
    status: "running",
  });

  const settingsRepository = {
    resolveSprintDashboardSettings: () => ({
      settings: {
        git: {
          defaultBranch: "main",
          githubMode: "LOCAL",
          githubToken: "",
          gitlabToken: "",
          sprintBranchScheme: "feature/sprint-{number}",
        },
      },
    }),
  } as unknown as ConstructorParameters<typeof SprintFileBrowserService>[0]["settingsRepository"];

  const service = new SprintFileBrowserService({
    sprintFileBrowserRepository: fileBrowserRepository,
    projectManagementRepository: projectRepository,
    settingsRepository,
  });

  return { service, project, sprint, fileBrowserRepository, projectRepository };
}

afterEach(async () => {
  tempDirs.splice(0);
  vi.clearAllMocks();
});

describe("SprintFileBrowserService", () => {
  it("starts a single containerized snapshot and reports it running", async () => {
    const { service, project, sprint } = await createHarness();
    const containerTsv = `cid123\tcode-ux-filebrowser-x-y\tUp 2 seconds\t${project.id}\t${sprint.id}\tsess`;

    runCommandStrict.mockImplementation(async (cmd: string, args: string[]) => {
      if (cmd === "docker" && args[0] === "ps") {
        return ok(args.includes("--format") ? containerTsv : "");
      }
      if (cmd === "docker" && args[0] === "run" && args.includes("-d")) {
        return ok("cid123\n");
      }
      return ok();
    });
    commandRun.mockImplementation(async (cmd: string, args: string[]) => {
      if (cmd === "git" && args[0] === "show-ref") {
        return args.some((a) => a.startsWith("refs/heads/")) ? ok() : fail();
      }
      return ok();
    });

    const session = await service.startSession(project.id, sprint.id);
    expect(session.status).toBe("running");
    expect(session.featureBranch).toBe("feature/test");

    const runCalls = runCommandStrict.mock.calls.filter(([cmd, args]) => cmd === "docker" && (args as string[]).includes("-d"));
    expect(runCalls.length).toBe(1);
    const dockerRunArgs = runCalls[0][1] as string[];
    expect(dockerRunArgs).toContain("--label");
    expect(dockerRunArgs).toContain("code-ux.file-browser=true");
    expect(dockerRunArgs).toContain("tail");
  });

  it("removes other file browser containers to enforce a single global instance", async () => {
    const { service, project, sprint } = await createHarness();
    const otherContainer = `other999\tcode-ux-filebrowser-a-b\tUp 9 seconds\tother-project\tother-sprint\tsess2`;
    const ownContainer = `cid123\tcode-ux-filebrowser-x-y\tUp 2 seconds\t${project.id}\t${sprint.id}\tsess`;
    let psCount = 0;

    runCommandStrict.mockImplementation(async (cmd: string, args: string[]) => {
      if (cmd === "docker" && args[0] === "ps") {
        if (args.includes("--format")) {
          psCount += 1;
          // First listing (stopOtherSessions) returns a foreign container; later listings return our own.
          return ok(psCount === 1 ? otherContainer : ownContainer);
        }
        return ok("");
      }
      if (cmd === "docker" && args[0] === "run" && args.includes("-d")) {
        return ok("cid123\n");
      }
      return ok();
    });
    commandRun.mockImplementation(async (cmd: string, args: string[]) =>
      cmd === "git" && args[0] === "show-ref"
        ? (args.some((a) => a.startsWith("refs/heads/")) ? ok() : fail())
        : ok(),
    );

    await service.startSession(project.id, sprint.id);

    const removedForeign = runCommandStrict.mock.calls.some(
      ([cmd, args]) => cmd === "docker" && (args as string[])[0] === "rm" && (args as string[]).includes("other999"),
    );
    expect(removedForeign).toBe(true);
  });

  it("parses the container file listing into a sorted tree", async () => {
    const { service, fileBrowserRepository, project, sprint } = await createHarness();
    const containerTsv = `cid123\tcode-ux-filebrowser-x-y\tUp 2 seconds\t${project.id}\t${sprint.id}\tsess`;
    const session = fileBrowserRepository.createSession({
      projectId: project.id,
      sprintId: sprint.id,
      status: "running",
      featureBranch: "feature/test",
      defaultBranch: "main",
      workspacePath: "/runtime-root/file-browser/x/workspace",
    });
    fileBrowserRepository.updateSession(session.id, { status: "running", containerId: "cid123", containerName: "code-ux-filebrowser-x-y" });

    runCommandStrict.mockImplementation(async (cmd: string, args: string[]) =>
      cmd === "docker" && args[0] === "ps" && args.includes("--format") ? ok(containerTsv) : ok(),
    );
    commandRun.mockImplementation(async (cmd: string, args: string[]) => {
      if (cmd === "docker" && args[0] === "exec") {
        return ok("D./src\nF./src/index.ts\nF./README.md\nD./src/lib\nF./src/lib/util.ts\n");
      }
      return ok();
    });

    const tree = await service.getTree(session.id);
    expect(tree.fileCount).toBe(3);
    // Directories sort before files at the root level.
    expect(tree.root[0].name).toBe("src");
    expect(tree.root[0].type).toBe("directory");
    const srcChildren = tree.root[0].children?.map((c) => c.name) ?? [];
    expect(srcChildren).toContain("index.ts");
    expect(srcChildren).toContain("lib");
  });

  it("detects binary files when reading content", async () => {
    const { service, fileBrowserRepository, project, sprint } = await createHarness();
    const containerTsv = `cid123\tname\tUp 2 seconds\t${project.id}\t${sprint.id}\tsess`;
    const session = fileBrowserRepository.createSession({
      projectId: project.id,
      sprintId: sprint.id,
      status: "running",
      workspacePath: "/runtime-root/file-browser/x/workspace",
    });
    fileBrowserRepository.updateSession(session.id, { status: "running", containerId: "cid123" });

    runCommandStrict.mockImplementation(async (cmd: string, args: string[]) =>
      cmd === "docker" && args[0] === "ps" && args.includes("--format") ? ok(containerTsv) : ok(),
    );
    commandRun.mockImplementation(async () => ok("binary content"));

    const result = await service.readFile(session.id, "assets/logo.png");
    expect(result.binary).toBe(true);
    expect(result.content).toBe("");
  });

  it("rejects path traversal attempts", async () => {
    const { service, fileBrowserRepository, project, sprint } = await createHarness();
    const containerTsv = `cid123\tname\tUp 2 seconds\t${project.id}\t${sprint.id}\tsess`;
    const session = fileBrowserRepository.createSession({
      projectId: project.id,
      sprintId: sprint.id,
      status: "running",
      workspacePath: "/runtime-root/file-browser/x/workspace",
    });
    fileBrowserRepository.updateSession(session.id, { status: "running", containerId: "cid123" });
    runCommandStrict.mockImplementation(async (cmd: string, args: string[]) =>
      cmd === "docker" && args[0] === "ps" && args.includes("--format") ? ok(containerTsv) : ok(),
    );

    await expect(service.readFile(session.id, "../../etc/passwd")).rejects.toThrow(/Invalid file path/);
  });

  it("builds a change set comparing the feature branch against the default branch", async () => {
    const { service, fileBrowserRepository, project, sprint } = await createHarness();
    const containerTsv = `cid123\tname\tUp 2 seconds\t${project.id}\t${sprint.id}\tsess`;
    const session = fileBrowserRepository.createSession({
      projectId: project.id,
      sprintId: sprint.id,
      status: "running",
      featureBranch: "feature/test",
      defaultBranch: "main",
      workspacePath: "/runtime-root/file-browser/x/workspace",
    });
    fileBrowserRepository.updateSession(session.id, { status: "running", containerId: "cid123" });

    runCommandStrict.mockImplementation(async (cmd: string, args: string[]) =>
      cmd === "docker" && args[0] === "ps" && args.includes("--format") ? ok(containerTsv) : ok(),
    );
    commandRun.mockImplementation(async (cmd: string, args: string[]) => {
      if (cmd !== "git") return ok();
      if (args[0] === "show-ref") {
        return args.some((a) => a.startsWith("refs/heads/")) ? ok() : fail();
      }
      if (args[0] === "merge-base") return ok("deadbeef\n");
      if (args[0] === "diff" && args.includes("--name-status")) {
        return ok("M\tsrc/a.ts\nA\tsrc/b.ts\nD\tsrc/c.ts\n");
      }
      if (args[0] === "diff" && args.includes("--numstat")) {
        return ok("3\t1\tsrc/a.ts\n10\t0\tsrc/b.ts\n0\t5\tsrc/c.ts\n");
      }
      return ok();
    });

    const changeSet = await service.getChangeSet(session.id);
    expect(changeSet.available).toBe(true);
    expect(changeSet.featureBranch).toBe("feature/test");
    expect(changeSet.defaultBranch).toBe("main");
    expect(changeSet.files).toHaveLength(3);
    const added = changeSet.files.find((f) => f.path === "src/b.ts");
    expect(added?.status).toBe("added");
    expect(added?.additions).toBe(10);
    const deleted = changeSet.files.find((f) => f.path === "src/c.ts");
    expect(deleted?.status).toBe("deleted");
    expect(deleted?.deletions).toBe(5);
  });

  it("produces a diff with original and modified content for a changed file", async () => {
    const { service, fileBrowserRepository, project, sprint } = await createHarness();
    const containerTsv = `cid123\tname\tUp 2 seconds\t${project.id}\t${sprint.id}\tsess`;
    const session = fileBrowserRepository.createSession({
      projectId: project.id,
      sprintId: sprint.id,
      status: "running",
      featureBranch: "feature/test",
      defaultBranch: "main",
      workspacePath: "/runtime-root/file-browser/x/workspace",
    });
    fileBrowserRepository.updateSession(session.id, { status: "running", containerId: "cid123" });

    runCommandStrict.mockImplementation(async (cmd: string, args: string[]) =>
      cmd === "docker" && args[0] === "ps" && args.includes("--format") ? ok(containerTsv) : ok(),
    );
    commandRun.mockImplementation(async (cmd: string, args: string[]) => {
      if (cmd !== "git") return ok();
      if (args[0] === "show-ref") return args.some((a) => a.startsWith("refs/heads/")) ? ok() : fail();
      if (args[0] === "merge-base") return ok("deadbeef\n");
      if (args[0] === "diff" && args.includes("--name-status")) return ok("M\tsrc/a.ts\n");
      if (args[0] === "diff" && args.includes("--numstat")) return ok("3\t1\tsrc/a.ts\n");
      if (args[0] === "show") {
        const ref = args[1] as string;
        return ref.startsWith("deadbeef") ? ok("const a = 1;\n") : ok("const a = 2;\n");
      }
      return ok();
    });

    const diff = await service.getDiff(session.id, "src/a.ts");
    expect(diff.status).toBe("modified");
    expect(diff.original).toBe("const a = 1;\n");
    expect(diff.modified).toBe("const a = 2;\n");
    expect(diff.binary).toBe(false);
    expect(diff.language).toBe("typescript");
  });

  it("stops a session and clears its container", async () => {
    const { service, fileBrowserRepository, project, sprint } = await createHarness();
    const containerTsv = `cid123\tname\tUp 2 seconds\t${project.id}\t${sprint.id}\tsess`;
    const session = fileBrowserRepository.createSession({
      projectId: project.id,
      sprintId: sprint.id,
      status: "running",
      workspacePath: "/runtime-root/file-browser/x/workspace",
    });
    fileBrowserRepository.updateSession(session.id, { status: "running", containerId: "cid123", containerName: "name" });

    runCommandStrict.mockImplementation(async (cmd: string, args: string[]) =>
      cmd === "docker" && args[0] === "ps" && args.includes("--format") ? ok(containerTsv) : ok(),
    );

    const stopped = await service.stopSession(session.id);
    expect(stopped.status).toBe("stopped");
    expect(stopped.containerId).toBeNull();
    const removed = runCommandStrict.mock.calls.some(
      ([cmd, args]) => cmd === "docker" && (args as string[])[0] === "rm" && (args as string[]).includes("cid123"),
    );
    expect(removed).toBe(true);
  });

  it("rebuilds the snapshot when a task completes", async () => {
    const { service, fileBrowserRepository, projectRepository, project, sprint } = await createHarness();
    const containerTsv = `cid123\tname\tUp 2 seconds\t${project.id}\t${sprint.id}\tsess`;
    const session = fileBrowserRepository.createSession({
      projectId: project.id,
      sprintId: sprint.id,
      status: "running",
      featureBranch: "feature/test",
      defaultBranch: "main",
      workspacePath: "/runtime-root/file-browser/x/workspace",
      lastCompletedTaskCount: 0,
    });
    fileBrowserRepository.updateSession(session.id, { status: "running", containerId: "cid123" });

    projectRepository.createTask(project.id, {
      sprintId: sprint.id,
      title: "Finished task",
      status: "completed",
    });

    runCommandStrict.mockImplementation(async (cmd: string, args: string[]) => {
      if (cmd === "docker" && args[0] === "ps") {
        return ok(args.includes("--format") ? containerTsv : "");
      }
      if (cmd === "docker" && args[0] === "run" && args.includes("-d")) {
        return ok("cid123\n");
      }
      return ok();
    });
    commandRun.mockImplementation(async (cmd: string, args: string[]) =>
      cmd === "git" && args[0] === "show-ref"
        ? (args.some((a) => a.startsWith("refs/heads/")) ? ok() : fail())
        : ok(),
    );

    await service.reconcileSessions();

    const rebuilt = runCommandStrict.mock.calls.some(
      ([cmd, args]) => cmd === "docker" && (args as string[])[0] === "run" && (args as string[]).includes("-d"),
    );
    expect(rebuilt).toBe(true);
    const refreshed = fileBrowserRepository.getSession(session.id);
    expect(refreshed?.lastCompletedTaskCount).toBe(1);
  });
});
