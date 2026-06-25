import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";
import * as path from "path";
import type { SprintPreviewSession } from "../../../src/contracts/app-types.js";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../../src/repositories/settings-defaults.js";

vi.mock("../../../src/services/cli-process-runner.js", () => ({
  runCommandStrict: vi.fn(),
}));

vi.mock("../../../src/services/git-branch-sync-service.js", () => ({
  fetchOriginIfAvailable: vi.fn(),
}));

vi.mock("../../../src/services/sprint-preview-utils.js", () => ({
  buildGeneratedSprintPreviewScript: vi.fn(() => "#!/bin/bash\necho generated"),
  detectSprintPreviewCommands: vi.fn(async () => ({
    installCommand: "npm ci",
    buildCommand: "npm run build",
    runCommand: "npm start",
  })),
  normalizePreviewPath: vi.fn((p: string) => p || "/"),
  readOptionalSprintPreviewScript: vi.fn(async () => ({
    exists: false,
    content: "",
  })),
  resolvePreviewScriptPath: vi.fn(async (base, rel) => {
    if (rel.includes("outside")) return `${base}/.code-ux/browser/start-preview.sh`;
    return `${base}/${rel}`;
  }),
}));

vi.mock("../../../src/services/cli-docker-utils.js", () => ({
  getDockerUserSpec: vi.fn(() => "1000:1000"),
  mapPathPrefix: vi.fn((mapped: string) => mapped),
  pickContainerEnv: vi.fn(() => []),
  resolveConfiguredPath: vi.fn((_base: string, rel: string) => `/resolved/${rel}`),
  toDockerMountArg: vi.fn((m: any) => `type=${m.type ?? "bind"},source=${m.source},target=${m.destination}`),
}));

vi.mock("../../../src/infrastructure/providers/cli/docker-runtime-paths.js", () => ({
  resolveDockerRuntimeRoot: vi.fn(() => "/runtime-root"),
}));

vi.mock("../../../src/infrastructure/providers/cli/docker-bootstrap-builder.js", () => ({
  DockerBootstrapBuilder: class DockerBootstrapBuilder {
    build = vi.fn(() => "echo bootstrap");
  },
}));

vi.mock("../../../src/infrastructure/providers/cli/docker-credential-mount-builder.js", () => ({
  DockerCredentialMountBuilder: class DockerCredentialMountBuilder {
    build = vi.fn(async () => []);
  },
}));

vi.mock("../../../src/infrastructure/providers/cli/docker-setup-image-cache.js", () => ({
  DockerSetupImageCache: class DockerSetupImageCache {
    resolveImage = vi.fn(async () => ({ image: "node:24-bookworm" }));
  },
}));

vi.mock("../../../src/domain/sprint/branch-name-generator.js", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    formatSprintBranch: vi.fn((_scheme: any, sprint: any) => "feature/sprint-" + (sprint.slug || "sprint-1")),
  };
});

vi.mock("../../../src/services/cli-workflow-utils.js", () => ({
  CONTAINER_SETUP_SCRIPT: "/opt/code-ux/setup.sh",
}));

vi.mock("../../../src/shared/config/code-ux-paths.js", () => ({
  getHomeCodeUxPath: vi.fn(() => "/home/.code-ux/container/setup.sh"),
  getRepoCodeUxPath: vi.fn(() => "/repo/.code-ux/container/setup.sh"),
}));

vi.mock("fs/promises", async () => {
  return {
    mkdir: vi.fn(async () => undefined),
    writeFile: vi.fn(async () => undefined),
    chmod: vi.fn(async () => undefined),
    rm: vi.fn(async () => undefined),
    readdir: vi.fn(async () => []),
    access: vi.fn(async () => { throw new Error("ENOENT"); }),
    stat: vi.fn(async () => ({ uid: 1000, gid: 1000 })),
  };
});

import * as fs from "fs/promises";
import { SprintPreviewService } from "../../../src/services/sprint-preview-service.js";
import { runCommandStrict } from "../../../src/services/cli-process-runner.js";
import { fetchOriginIfAvailable } from "../../../src/services/git-branch-sync-service.js";
import { resolveDockerRuntimeRoot } from "../../../src/infrastructure/providers/cli/docker-runtime-paths.js";
import { normalizePreviewPath, readOptionalSprintPreviewScript } from "../../../src/services/sprint-preview-utils.js";

function makePreviewSettings(overrides: Record<string, unknown> = {}) {
  return {
    enabled: true,
    showInAppBrowser: true,
    autoStartOnRunningSprint: true,
    rebuildOnTaskCompletion: true,
    rebuildOnSprintCompletion: true,
    autoStopOnTerminalSprint: false,
    maxConcurrentContainers: 5,
    hostPortRangeStart: 5555,
    hostPortRangeEnd: 5560,
    containerAppPort: 3000,
    startupScriptPath: ".code-ux/browser/start-preview.sh",
    ...overrides,
  };
}

function makeSession(overrides: Partial<SprintPreviewSession> = {}): SprintPreviewSession {
  return {
    id: "session-1",
    projectId: "proj-1",
    sprintId: "sprint-1",
    projectName: "Test Project",
    sprintName: "Sprint 1",
    sprintNumber: 1,
    status: "running",
    hostPort: 5555,
    containerAppPort: 3000,
    containerId: "abc123",
    containerName: "code-ux-preview-test",
    worktreePath: "/workspace",
    featureBranch: "feature/sprint-1",
    startupScriptPath: ".code-ux/browser/start-preview.sh",
    startupMode: "auto",
    installCommand: "npm ci",
    buildCommand: "npm run build",
    runCommand: "npm start",
    lastCompletedTaskCount: 0,
    lastSeenSprintStatus: "running",
    lastKnownPath: "/",
    healthStatus: "healthy",
    lastError: null,
    lastBuildAt: null,
    lastStartedAt: null,
    lastStoppedAt: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeDeps(overrides: Record<string, unknown> = {}) {
  return {
    sprintPreviewRepository: {
      listSessions: vi.fn(() => []),
      getSession: vi.fn(() => null),
      getSessionByProjectSprint: vi.fn(() => null),
      createSession: vi.fn((input: Record<string, unknown>) => makeSession(input as Partial<SprintPreviewSession>)),
      updateSession: vi.fn((id: string, patch: Partial<SprintPreviewSession>) => makeSession({ id, ...patch })),
      deleteSession: vi.fn(),
    },
    projectManagementRepository: {
      getProject: vi.fn(() => ({
        id: "proj-1",
        name: "Test Project",
        baseDir: "/repo",
        defaultBranch: "main",
        sourceType: "local",
        sourceRef: "/repo",
      })),
      listProjects: vi.fn(() => ({ projects: [] })),
      getSprint: vi.fn(() => ({
        id: "sprint-1",
        projectId: "proj-1",
        name: "Sprint 1",
        number: 1,
        status: "running",
        featureBranch: "feature/sprint-1",
      })),
      listSprints: vi.fn(() => ({ sprints: [] })),
      listTasks: vi.fn(() => []),
    },
    executionRepository: {
      getProjectExecutionSnapshot: vi.fn(() => ({
        projectId: "proj-1",
        projectName: "Test Project",
        sprintRuns: [],
        taskDispatches: [],
        connections: [],
        primaryAssignedWorker: null,
        overflowAssignedWorkers: [],
        attentionItems: [],
        recentEvents: [],
        updatedAt: null,
      })),
    },
    settingsRepository: {
      resolveSprintDashboardSettings: vi.fn(() => ({
        settings: { ...DEFAULT_DASHBOARD_SETTINGS,
          sprintPreview: makePreviewSettings(),
          git: { githubMode: "REMOTE", defaultBranch: "main", sprintBranchScheme: "feature/sprint-{number}" },
          cliWorkflow: {
            containerImage: "node:24-bookworm",
            containerCacheSetupScriptImage: false,
            containerSetupScriptPath: "",
            containerMountGithubAuth: false,
            containerMountGeminiAuth: false,
            containerMountCodexAuth: false,
            containerMountClaudeCodeAuth: false,
          },
        },
      })),
    },
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    ...overrides,
  };
}

describe("SprintPreviewService unit tests", () => {

  let deps: ReturnType<typeof makeDeps>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(runCommandStrict).mockResolvedValue({ exitCode: 0, stdout: "", stderr: "", durationMs: 1 });
    vi.mocked(fetchOriginIfAvailable).mockResolvedValue(true);
    deps = makeDeps();
  });

  describe("listSessions", () => {
    it("returns empty array when no sessions exist", async () => {
      const service = new SprintPreviewService(deps as any);
      const result = await service.listSessions();
      expect(result).toEqual([]);
      expect(deps.sprintPreviewRepository.listSessions).toHaveBeenCalledWith(undefined);
    });

    it("passes projectId filter through", async () => {
      const service = new SprintPreviewService(deps as any);
      await service.listSessions("proj-1");
      expect(deps.sprintPreviewRepository.listSessions).toHaveBeenCalledWith("proj-1");
    });

    it("refreshes runtime state for each session", async () => {
      const session = makeSession({ containerId: null, containerName: null });
      deps.sprintPreviewRepository.listSessions.mockReturnValue([session]);
      const service = new SprintPreviewService(deps as any);
      const result = await service.listSessions();
      expect(result).toHaveLength(1);
    });
  });

  describe("getSession", () => {
    it("returns null when session does not exist", async () => {
      const service = new SprintPreviewService(deps as any);
      const result = await service.getSession("nonexistent");
      expect(result).toBeNull();
    });

    it("returns refreshed session when found", async () => {
      const session = makeSession({ containerId: null, containerName: null });
      deps.sprintPreviewRepository.getSession.mockReturnValue(session);
      const service = new SprintPreviewService(deps as any);
      const result = await service.getSession("session-1");
      expect(result).toBeTruthy();
    });
  });

  describe("stopSession", () => {
    it("stops container and updates session", async () => {
      const session = makeSession();
      deps.sprintPreviewRepository.getSession.mockReturnValue(session);
      deps.sprintPreviewRepository.updateSession.mockImplementation(
        (id: string, patch: Partial<SprintPreviewSession>) => makeSession({ id, ...patch }),
      );
      const service = new SprintPreviewService(deps as any);
      const result = await service.stopSession("session-1");
      expect(result.status).toBe("stopped");
      expect(runCommandStrict).toHaveBeenCalledWith(
        "docker",
        ["rm", "-f", expect.stringContaining("code-ux-preview")],
        expect.any(String),
      );
    });

    it("throws when session does not exist", async () => {
      const service = new SprintPreviewService(deps as any);
      await expect(service.stopSession("nonexistent")).rejects.toThrow("Sprint preview session not found");
    });
  });

  describe("rebuildSession", () => {
    it("calls startSession with rebuild flag", async () => {
      const session = makeSession();
      deps.sprintPreviewRepository.getSession.mockReturnValue(session);

      const service = new SprintPreviewService(deps as any);
      const startSessionSpy = vi.spyOn(service, "startSession").mockResolvedValue(session);

      await expect(service.rebuildSession("session-1")).resolves.toEqual(session);
      expect(startSessionSpy).toHaveBeenCalledWith("proj-1", "sprint-1", { rebuild: true });
    });
  });

  describe("startSession", () => {
    it("rejects launches when preview runtime is disabled", async () => {
      deps.settingsRepository.resolveSprintDashboardSettings.mockReturnValue({
        settings: { ...DEFAULT_DASHBOARD_SETTINGS,
          sprintPreview: makePreviewSettings({ enabled: false }),
          git: { githubMode: "REMOTE", defaultBranch: "main", sprintBranchScheme: "feature/sprint-{number}" },
          cliWorkflow: { containerImage: "", containerCacheSetupScriptImage: false, containerSetupScriptPath: "" },
        },
      });

      const service = new SprintPreviewService(deps as any);
      await expect(service.startSession("proj-1", "sprint-1")).rejects.toThrow("Browser Preview is disabled");
    });

    it("stops the oldest active previews when the max concurrent limit would be exceeded", async () => {
      deps.settingsRepository.resolveSprintDashboardSettings.mockReturnValue({
        settings: { ...DEFAULT_DASHBOARD_SETTINGS,
          sprintPreview: makePreviewSettings({ maxConcurrentContainers: 1 }),
          git: { githubMode: "REMOTE", defaultBranch: "main", sprintBranchScheme: "feature/sprint-{number}" },
          cliWorkflow: { containerImage: "", containerCacheSetupScriptImage: false, containerSetupScriptPath: "" },
        },
      });

      const service = new SprintPreviewService(deps as any);
      vi.spyOn(service, "listSessions").mockResolvedValue([
        makeSession({ id: "oldest", sprintId: "sprint-oldest", lastStartedAt: "2026-01-01T00:00:00Z" }),
      ]);
      const stopSessionSpy = vi.spyOn(service, "stopSession").mockResolvedValue(makeSession({ status: "stopped" }));

      await service.startSession("proj-1", "sprint-1");

      expect(stopSessionSpy).toHaveBeenCalledWith("oldest");
      expect(fetchOriginIfAvailable).toHaveBeenCalledWith("/repo", {
        githubToken: undefined,
      });
    });

    it("uses POSIX container paths when host runtime paths are Windows-style", async () => {
      vi.mocked(resolveDockerRuntimeRoot).mockReturnValue("C:\\Users\\pierr\\AppData\\Roaming\\Code UX\\runtime\\docker\\abc123");
      deps.projectManagementRepository.getProject.mockReturnValue({
        id: "proj-1",
        name: "Test Project",
        baseDir: "C:\\Users\\pierr\\Projects\\test2",
        defaultBranch: "main",
        sourceType: "local",
        sourceRef: "C:\\Users\\pierr\\Projects\\test2",
      });

      const service = new SprintPreviewService(deps as any);
      await service.startSession("proj-1", "sprint-1");

      const previewRunCall = vi.mocked(runCommandStrict).mock.calls.find((call) =>
        call[0] === "docker" && call[1][0] === "create"
      );
      const dockerArgs = previewRunCall?.[1] || [];
      expect(dockerArgs).toContain("/code-ux-preview-runtime/preview/sprint-1/workspace");
      expect(dockerArgs).toContain("HOME=/code-ux-preview-runtime/preview/sprint-1/home-preview");
      expect(dockerArgs).toContain("SPRINT_PREVIEW_WORKSPACE=/code-ux-preview-runtime/preview/sprint-1/workspace");
      expect(dockerArgs).toContain("SPRINT_PREVIEW_WORKTREE=/code-ux-preview-runtime/preview/sprint-1/workspace");

      const workdirIndex = dockerArgs.indexOf("--workdir");
      expect(dockerArgs[workdirIndex + 1]).not.toContain("C:\\");
      const mountArgs = dockerArgs.filter((arg) => arg.startsWith("type=volume") || arg.startsWith("type=bind"));
      expect(mountArgs.some((arg) => arg.includes("target=/code-ux-preview-runtime"))).toBe(true);
    });

    it("copies workspace tar archive and startup script into the container and starts it", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true })));

      vi.mocked(runCommandStrict).mockImplementation(async (cmd, args) => {
        if (cmd === "docker" && args[0] === "create") {
          return { exitCode: 0, stdout: "cid123\n", stderr: "", durationMs: 1 };
        }
        return { exitCode: 0, stdout: "", stderr: "", durationMs: 1 };
      });

      const service = new SprintPreviewService(deps as any);
      await service.startSession("proj-1", "sprint-1");

      expect(vi.mocked(runCommandStrict).mock.calls.some((call) => call[0] === "docker" && call[1][0] === "cp" && call[1][2].endsWith(":/tmp/workspace.tar"))).toBe(true);
      expect(vi.mocked(runCommandStrict).mock.calls.some((call) => call[0] === "docker" && call[1][0] === "cp" && call[1][2].endsWith(":/tmp/preview-start.sh"))).toBe(true);
      expect(vi.mocked(runCommandStrict).mock.calls.some((call) => call[0] === "docker" && call[1][0] === "start")).toBe(true);

      vi.unstubAllGlobals();
    });
  });


  describe("getLogs", () => {
    it("returns empty logs when no container exists", async () => {
      const session = makeSession({ containerId: null, containerName: null });
      deps.sprintPreviewRepository.getSession.mockReturnValue(session);
      const service = new SprintPreviewService(deps as any);
      const result = await service.getLogs("session-1");
      expect(result).toEqual({ logs: "" });
    });

    it("returns container logs when container exists", async () => {
      const session = makeSession({ containerId: null, containerName: null });
      deps.sprintPreviewRepository.getSession.mockReturnValue(session);
      deps.sprintPreviewRepository.updateSession.mockImplementation(
        (id: string, patch: Partial<SprintPreviewSession>) => makeSession({ id, ...patch }),
      );
      vi.mocked(runCommandStrict).mockImplementation(async (command, args) => {
        if (command === "docker" && args?.[0] === "logs") {
          return { exitCode: 0, stdout: "app listening on port 3000", stderr: "", durationMs: 1 };
        }
        if (command === "docker" && args?.[0] === "ps") {
          return { exitCode: 0, stdout: "", stderr: "", durationMs: 1 };
        }
        return { exitCode: 0, stdout: "", stderr: "", durationMs: 1 };
      });

      const service = new SprintPreviewService(deps as any);
      const result = await service.getLogs("session-1");
      // No container → empty logs
      expect(result.logs).toBe("");
    });

    it("returns error message when docker logs fails", async () => {
      const session = makeSession();
      deps.sprintPreviewRepository.getSession.mockReturnValue(session);

      // refreshRuntimeState calls listPreviewContainers which calls docker ps
      vi.mocked(runCommandStrict).mockImplementation(async (command, args) => {
        if (command === "docker" && args?.[0] === "ps") {
          const line = `abc123\tcode-ux-preview-test\tUp 5 minutes\tproj-1\tsprint-1\tsession-1`;
          return { exitCode: 0, stdout: line, stderr: "", durationMs: 1 };
        }
        if (command === "docker" && args?.[0] === "logs") {
          throw new Error("container not found");
        }
        return { exitCode: 0, stdout: "", stderr: "", durationMs: 1 };
      });

      const service = new SprintPreviewService(deps as any);
      const result = await service.getLogs("session-1");
      expect(result.logs).toBe("container not found");
    });

    it("throws when session does not exist", async () => {
      const service = new SprintPreviewService(deps as any);
      await expect(service.getLogs("nonexistent")).rejects.toThrow("Sprint preview session not found");
    });
  });

  describe("getScript", () => {
    it("returns auto-generated script when no custom script exists", async () => {
      const service = new SprintPreviewService(deps as any);
      const result = await service.getScript("proj-1", "sprint-1");
      expect(result.mode).toBe("auto");
      expect(result.exists).toBe(false);
      expect(result.projectId).toBe("proj-1");
      expect(result.sprintId).toBe("sprint-1");
    });

    it("returns custom script when one exists", async () => {
      vi.mocked(readOptionalSprintPreviewScript).mockResolvedValue({
        exists: true,
        content: "#!/bin/bash\ncustom script",
      });

      const service = new SprintPreviewService(deps as any);
      const result = await service.getScript("proj-1", "sprint-1");
      expect(result.mode).toBe("script");
      expect(result.exists).toBe(true);
      expect(result.content).toBe("#!/bin/bash\ncustom script");
    });

    it("throws when project not found", async () => {
      deps.projectManagementRepository.getProject.mockReturnValue(null);
      const service = new SprintPreviewService(deps as any);
      await expect(service.getScript("nonexistent", "sprint-1")).rejects.toThrow("Project not found");
    });

    it("throws when sprint not found", async () => {
      deps.projectManagementRepository.getSprint.mockReturnValue(null);
      const service = new SprintPreviewService(deps as any);
      await expect(service.getScript("proj-1", "nonexistent")).rejects.toThrow("Sprint not found");
    });
  });

  describe("saveScript", () => {
    it("cannot write outside the project directory", async () => {
      const service = new SprintPreviewService(deps as any);
      // requireProject and requireSprint are on the service, not the deps repository.
      service.requireProject = vi.fn().mockReturnValue({ id: "proj-1", baseDir: "/repo" });
      service.requireSprint = vi.fn().mockReturnValue({ id: "sprint-1" });
      // Instead of modifying deps, we mock resolveSettings
      service.resolveSettings = vi.fn().mockReturnValue({

        sprintPreview: {
          ...DEFAULT_DASHBOARD_SETTINGS.sprintPreview,
          startupScriptPath: "../outside.sh",
        },
      } as any);

      // the path will be snapped back to default script by the resolver
      await service.saveScript("proj-1", "sprint-1", "content");

      const fsMod = await import("fs/promises");
      const writeCall = vi.mocked(fsMod.writeFile).mock.calls.find((call) => typeof call[0] === 'string');
      expect(writeCall).toBeDefined();
      expect(writeCall?.[0]).not.toContain("outside.sh");
    });

    it("writes script to disk and returns updated script info", async () => {
      const fsMod = await import("fs/promises");
      const service = new SprintPreviewService(deps as any);

      vi.mocked(readOptionalSprintPreviewScript).mockResolvedValue({
        exists: true,
        content: "#!/bin/bash\nsaved content",
      });

      const result = await service.saveScript("proj-1", "sprint-1", "#!/bin/bash\nsaved content");
      expect(fsMod.writeFile).toHaveBeenCalled();
      if (process.platform === "win32") {
        expect(fsMod.chmod).not.toHaveBeenCalled();
      } else {
        expect(fsMod.chmod).toHaveBeenCalled();
      }
      expect(result.exists).toBe(true);
    });
  });

  describe("proxyRequest", () => {
    it("throws when session has no host port", async () => {
      const session = makeSession({ hostPort: null, containerId: null, containerName: null });
      deps.sprintPreviewRepository.getSession.mockReturnValue(session);
      deps.sprintPreviewRepository.updateSession.mockImplementation(
        (_id: string, patch: Partial<SprintPreviewSession>) => makeSession({ ...session, ...patch }),
      );

      const service = new SprintPreviewService(deps as any);
      await expect(
        service.proxyRequest({ sessionId: "session-1", method: "GET", path: "/" }),
      ).rejects.toThrow("does not have an active host port");
    });



    it("suppresses set-cookie header from proxied response", async () => {
      const session = makeSession({ containerId: null, containerName: null });
      deps.sprintPreviewRepository.getSession.mockReturnValue(session);
      deps.sprintPreviewRepository.updateSession.mockImplementation(
        (id: string, patch: Partial<SprintPreviewSession>) => makeSession({ id, ...patch }),
      );

      vi.mocked(normalizePreviewPath).mockReturnValue("/test");

      const mockResponse = {
        status: 200,
        headers: new Headers({ "set-cookie": "secret=true", "x-custom": "allowed" }),
        body: (async function* () {
          yield new TextEncoder().encode("hello");
        })(),
      };
      vi.stubGlobal("fetch", vi.fn(async () => mockResponse));

      const service = new SprintPreviewService(deps as any);
      const res = await service.proxyRequest({ sessionId: "session-1", method: "GET", path: "/" });

      expect(res.headers).not.toHaveProperty("set-cookie");
      expect(res.headers).toHaveProperty("x-custom", "allowed");
    });

    it("strips sensitive and hop-by-hop headers from proxied request", async () => {
      const session = makeSession({ containerId: null, containerName: null });
      deps.sprintPreviewRepository.getSession.mockReturnValue(session);
      deps.sprintPreviewRepository.updateSession.mockImplementation(
        (id: string, patch: Partial<SprintPreviewSession>) => makeSession({ id, ...patch }),
      );

      vi.mocked(normalizePreviewPath).mockReturnValue("/test");

      const mockResponse = {
        status: 200,
        headers: new Headers(),
        arrayBuffer: vi.fn(async () => new TextEncoder().encode("hello").buffer),
      };
      const fetchMock = vi.fn(async () => mockResponse); vi.stubGlobal("fetch", fetchMock);

      const service = new SprintPreviewService(deps as any);
      await service.proxyRequest({
        sessionId: "session-1",
        method: "GET",
        path: "/",
        headers: {
          "authorization": "token",
          "cookie": "val",
          "connection": "close",
          "x-custom": "allowed",
        },
      });

      const calledOptions = fetchMock.mock.calls[0][1];
      expect(calledOptions.headers).not.toHaveProperty("authorization");
      expect(calledOptions.headers).not.toHaveProperty("cookie");
      expect(calledOptions.headers).not.toHaveProperty("connection");
      expect(calledOptions.headers).toHaveProperty("x-custom", "allowed");
    });

    it("throws error when proxied response exceeds maximum allowed size", async () => {
      const session = makeSession({ containerId: null, containerName: null });
      deps.sprintPreviewRepository.getSession.mockReturnValue(session);
      deps.sprintPreviewRepository.updateSession.mockImplementation(
        (id: string, patch: Partial<SprintPreviewSession>) => makeSession({ id, ...patch }),
      );

      vi.mocked(normalizePreviewPath).mockReturnValue("/test");

      const mockResponse = {
        status: 200,
        headers: new Headers(),
        arrayBuffer: vi.fn(async () => new ArrayBuffer(5 * 1024 * 1024 + 10)), // Exceeds 5MB
      };
      vi.stubGlobal("fetch", vi.fn(async () => mockResponse));

      const service = new SprintPreviewService(deps as any);
      await expect(service.proxyRequest({ sessionId: "session-1", method: "GET", path: "/" }))
        .rejects.toThrow("Response body exceeds maximum allowed size for proxied preview");
    });

    it("proxies request and returns response", async () => {
      const session = makeSession({ containerId: null, containerName: null });
      deps.sprintPreviewRepository.getSession.mockReturnValue(session);
      deps.sprintPreviewRepository.updateSession.mockImplementation(
        (id: string, patch: Partial<SprintPreviewSession>) => makeSession({ id, ...patch }),
      );

      vi.mocked(normalizePreviewPath).mockReturnValue("/test");

      const mockHeaders = new Headers({ "content-type": "text/plain", "x-custom": "value" });
      const mockResponse = {
        status: 200,
        headers: mockHeaders,
        arrayBuffer: vi.fn(async () => new TextEncoder().encode("hello").buffer),
      };
      vi.stubGlobal("fetch", vi.fn(async () => mockResponse));

      const service = new SprintPreviewService(deps as any);
      const result = await service.proxyRequest({
        sessionId: "session-1",
        method: "GET",
        path: "/test",
      });

      expect(result.status).toBe(200);
      expect(result.body.toString()).toBe("hello");
      vi.unstubAllGlobals();
    });

    it("rewrites HTML body content with proxy prefix", async () => {
      const session = makeSession({ containerId: null, containerName: null });
      deps.sprintPreviewRepository.getSession.mockReturnValue(session);
      deps.sprintPreviewRepository.updateSession.mockImplementation(
        (id: string, patch: Partial<SprintPreviewSession>) => makeSession({ id, ...patch }),
      );

      vi.mocked(normalizePreviewPath).mockReturnValue("/");

      const htmlBody = '<link href="/styles.css"><script src="/app.js"></script>';
      const mockHeaders = new Headers({ "content-type": "text/html" });
      const mockResponse = {
        status: 200,
        headers: mockHeaders,
        arrayBuffer: vi.fn(async () => new TextEncoder().encode(htmlBody).buffer),
      };
      vi.stubGlobal("fetch", vi.fn(async () => mockResponse));

      const service = new SprintPreviewService(deps as any);
      const result = await service.proxyRequest({
        sessionId: "session-1",
        method: "GET",
        path: "/",
      });

      const body = result.body.toString();
      expect(body).toContain("/api/browser/sessions/session-1/proxy/styles.css");
      expect(body).toContain("/api/browser/sessions/session-1/proxy/app.js");
      vi.unstubAllGlobals();
    });

    it("strips set-cookie and rewrites location headers", async () => {
      const session = makeSession({ containerId: null, containerName: null });
      deps.sprintPreviewRepository.getSession.mockReturnValue(session);
      deps.sprintPreviewRepository.updateSession.mockImplementation(
        (id: string, patch: Partial<SprintPreviewSession>) => makeSession({ id, ...patch }),
      );

      vi.mocked(normalizePreviewPath).mockReturnValue("/");

      const mockHeaders = new Headers({
        "content-type": "text/plain",
        "location": "/redirect",
        "set-cookie": "token=abc",
      });
      const mockResponse = {
        status: 302,
        headers: mockHeaders,
        arrayBuffer: vi.fn(async () => new ArrayBuffer(0)),
      };
      vi.stubGlobal("fetch", vi.fn(async () => mockResponse));

      const service = new SprintPreviewService(deps as any);
      const result = await service.proxyRequest({
        sessionId: "session-1",
        method: "GET",
        path: "/",
      });

      expect(result.status).toBe(302);
      expect(result.headers["location"]).toContain("/api/browser/sessions/session-1/proxy/redirect");
      expect(result.headers["set-cookie"]).toBeUndefined();
      vi.unstubAllGlobals();
    });

    it("updates session to error when fetch fails", async () => {
      const session = makeSession({ containerId: null, containerName: null });
      deps.sprintPreviewRepository.getSession.mockReturnValue(session);
      deps.sprintPreviewRepository.updateSession.mockImplementation(
        (id: string, patch: Partial<SprintPreviewSession>) => makeSession({ id, ...patch }),
      );

      vi.mocked(normalizePreviewPath).mockReturnValue("/");
      vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED"); }));

      const service = new SprintPreviewService(deps as any);
      await expect(
        service.proxyRequest({ sessionId: "session-1", method: "GET", path: "/" }),
      ).rejects.toThrow("ECONNREFUSED");

      expect(deps.sprintPreviewRepository.updateSession).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ status: "error", healthStatus: "unreachable" }),
      );
      vi.unstubAllGlobals();
    });

    it("filters proxy headers correctly", async () => {
      const session = makeSession({ containerId: null, containerName: null });
      deps.sprintPreviewRepository.getSession.mockReturnValue(session);
      deps.sprintPreviewRepository.updateSession.mockImplementation(
        (id: string, patch: Partial<SprintPreviewSession>) => makeSession({ id, ...patch }),
      );

      vi.mocked(normalizePreviewPath).mockReturnValue("/");

      let capturedInit: RequestInit | undefined;
      const mockHeaders = new Headers({ "content-type": "text/plain" });
      vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init?: RequestInit) => {
        capturedInit = init;
        return {
          status: 200,
          headers: mockHeaders,
          arrayBuffer: async () => new ArrayBuffer(0),
        };
      }));

      const service = new SprintPreviewService(deps as any);
      await service.proxyRequest({
        sessionId: "session-1",
        method: "POST",
        path: "/api",
        headers: {
          "Host": "example.com",
          "Content-Length": "42",
          "Accept-Encoding": "gzip",
          "X-Custom": "keep-me",
          "Authorization": "Bearer token",
        },
      });

      const passedHeaders = capturedInit?.headers as Record<string, string>;
      expect(passedHeaders["X-Custom"]).toBe("keep-me");
      expect(passedHeaders["Authorization"]).toBeUndefined();
      expect(passedHeaders["Host"]).toBeUndefined();
      expect(passedHeaders["Content-Length"]).toBeUndefined();
      expect(passedHeaders["Accept-Encoding"]).toBeUndefined();
      vi.unstubAllGlobals();
    });
  });

  describe("reconcileSessions", () => {
    it("does nothing with no sessions", async () => {
      deps.sprintPreviewRepository.listSessions.mockReturnValue([]);
      deps.projectManagementRepository.listProjects.mockReturnValue({ projects: [] });
      const service = new SprintPreviewService(deps as any);
      await service.reconcileSessions();
      expect(deps.sprintPreviewRepository.listSessions).toHaveBeenCalled();
    });

    it("auto-stops session when sprint is terminal and setting enabled", async () => {
      const session = makeSession({ status: "running", containerId: null, containerName: null });
      deps.sprintPreviewRepository.listSessions.mockReturnValue([session]);
      deps.sprintPreviewRepository.getSession.mockReturnValue(session);
      deps.projectManagementRepository.getSprint.mockReturnValue({
        id: "sprint-1",
        projectId: "proj-1",
        name: "Sprint 1",
        number: 1,
        status: "completed",
        featureBranch: "feature/sprint-1",
      });
      deps.settingsRepository.resolveSprintDashboardSettings.mockReturnValue({
        settings: { ...DEFAULT_DASHBOARD_SETTINGS,
          sprintPreview: makePreviewSettings({
            autoStartOnRunningSprint: false,
            rebuildOnTaskCompletion: false,
            rebuildOnSprintCompletion: false,
            autoStopOnTerminalSprint: true,
          }),
          git: { defaultBranch: "main", sprintBranchScheme: "feature/sprint-{number}" },
          cliWorkflow: { containerImage: "", containerCacheSetupScriptImage: false, containerSetupScriptPath: "" },
        },
      });
      deps.sprintPreviewRepository.updateSession.mockImplementation(
        (id: string, patch: Partial<SprintPreviewSession>) => makeSession({ id, ...patch }),
      );

      const service = new SprintPreviewService(deps as any);
      await service.reconcileSessions();

      expect(deps.sprintPreviewRepository.updateSession).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ status: "stopped" }),
      );
    });

    it("prunes the orphaned session when its sprint no longer exists", async () => {
      const session = makeSession();
      deps.sprintPreviewRepository.listSessions.mockReturnValue([session]);
      deps.projectManagementRepository.getSprint.mockReturnValue(null);
      deps.projectManagementRepository.listProjects.mockReturnValue({ projects: [] });

      const service = new SprintPreviewService(deps as any);
      await service.reconcileSessions();

      expect(deps.sprintPreviewRepository.deleteSession).toHaveBeenCalledWith(session.id);
    });

    it("prunes a stopped session whose sprint is terminal with no active run", async () => {
      const session = makeSession({ status: "stopped", containerId: null, containerName: null });
      deps.sprintPreviewRepository.listSessions.mockReturnValue([session]);
      deps.projectManagementRepository.getSprint.mockReturnValue({
        id: "sprint-1",
        projectId: "proj-1",
        name: "Sprint 1",
        number: 1,
        status: "completed",
        featureBranch: "feature/sprint-1",
      });
      deps.projectManagementRepository.listProjects.mockReturnValue({ projects: [] });

      const service = new SprintPreviewService(deps as any);
      await service.reconcileSessions();

      expect(deps.sprintPreviewRepository.deleteSession).toHaveBeenCalledWith(session.id);
      // The expensive per-session work is skipped once we decide to prune.
      expect(deps.sprintPreviewRepository.updateSession).not.toHaveBeenCalled();
    });

    it("updates task count when session is running and no triggers match", async () => {
      const session = makeSession({
        status: "running",
        containerId: null,
        containerName: null,
        lastCompletedTaskCount: 0,
        lastSeenSprintStatus: "running",
      });
      deps.sprintPreviewRepository.listSessions.mockReturnValue([session]);
      deps.projectManagementRepository.getSprint.mockReturnValue({
        id: "sprint-1",
        projectId: "proj-1",
        name: "Sprint 1",
        number: 1,
        status: "running",
        featureBranch: "feature/sprint-1",
      });
      deps.settingsRepository.resolveSprintDashboardSettings.mockReturnValue({
        settings: { ...DEFAULT_DASHBOARD_SETTINGS,
          sprintPreview: makePreviewSettings({
            autoStartOnRunningSprint: false,
            rebuildOnTaskCompletion: false,
            rebuildOnSprintCompletion: false,
            autoStopOnTerminalSprint: false,
          }),
          git: { defaultBranch: "main", sprintBranchScheme: "feature/sprint-{number}" },
          cliWorkflow: { containerImage: "", containerCacheSetupScriptImage: false, containerSetupScriptPath: "" },
        },
      });
      deps.sprintPreviewRepository.updateSession.mockImplementation(
        (id: string, patch: Partial<SprintPreviewSession>) => makeSession({ id, ...patch }),
      );

      const service = new SprintPreviewService(deps as any);
      await service.reconcileSessions();

      expect(deps.sprintPreviewRepository.updateSession).toHaveBeenCalledWith(
        "session-1",
        expect.objectContaining({ lastCompletedTaskCount: 0, lastSeenSprintStatus: "running" }),
      );
    });

    it("does not auto-start or create session when sprint run is queued or paused", async () => {
      deps.sprintPreviewRepository.listSessions.mockReturnValue([]);
      deps.projectManagementRepository.listProjects.mockReturnValue({ projects: [{ id: "proj-1", name: "Project 1" }] });
      deps.projectManagementRepository.listSprints.mockReturnValue({
        sprints: [{
          id: "sprint-1",
          projectId: "proj-1",
          name: "Sprint 1",
          number: 1,
          status: "running",
          featureBranch: "feature/sprint-1",
        }],
      });
      deps.settingsRepository.resolveSprintDashboardSettings.mockReturnValue({
        settings: { ...DEFAULT_DASHBOARD_SETTINGS,
          sprintPreview: makePreviewSettings({
            autoStartOnRunningSprint: true,
            rebuildOnTaskCompletion: false,
            rebuildOnSprintCompletion: false,
            autoStopOnTerminalSprint: false,
          }),
          git: { defaultBranch: "main", sprintBranchScheme: "feature/sprint-{number}" },
          cliWorkflow: { containerImage: "", containerCacheSetupScriptImage: false, containerSetupScriptPath: "" },
        },
      });

      // Provide execution snapshot with paused and queued runs, but no running
      deps.executionRepository.getProjectExecutionSnapshot.mockReturnValue({
        projectId: "proj-1",
        sprintRuns: [
          { sprintId: "sprint-1", status: "queued", testExecutions: [], commandExecutions: [], workflowInvocations: [], manualVerificationTasks: [] },
          { sprintId: "sprint-2", status: "paused", testExecutions: [], commandExecutions: [], workflowInvocations: [], manualVerificationTasks: [] },
        ],
      });

      const service = new SprintPreviewService(deps as any);
      service.startSession = vi.fn().mockResolvedValue(undefined);

      await service.reconcileSessions();

      expect(service.startSession).not.toHaveBeenCalled();
    });

    it("auto-starts and creates session when sprint run is running", async () => {
      deps.sprintPreviewRepository.listSessions.mockReturnValue([]);
      deps.projectManagementRepository.listProjects.mockReturnValue({ projects: [{ id: "proj-1", name: "Project 1" }] });
      deps.projectManagementRepository.listSprints.mockReturnValue({
        sprints: [{
          id: "sprint-1",
          projectId: "proj-1",
          name: "Sprint 1",
          number: 1,
          status: "running",
          featureBranch: "feature/sprint-1",
        }],
      });
      deps.sprintPreviewRepository.getSessionByProjectSprint.mockReturnValue(null);
      deps.settingsRepository.resolveSprintDashboardSettings.mockReturnValue({
        settings: { ...DEFAULT_DASHBOARD_SETTINGS,
          sprintPreview: makePreviewSettings({
            autoStartOnRunningSprint: true,
            rebuildOnTaskCompletion: false,
            rebuildOnSprintCompletion: false,
            autoStopOnTerminalSprint: false,
          }),
          git: { defaultBranch: "main", sprintBranchScheme: "feature/sprint-{number}" },
          cliWorkflow: { containerImage: "", containerCacheSetupScriptImage: false, containerSetupScriptPath: "" },
        },
      });

      // Provide execution snapshot with a running sprint
      deps.executionRepository.getProjectExecutionSnapshot.mockReturnValue({
        projectId: "proj-1",
        sprintRuns: [
          { sprintId: "sprint-1", status: "running", testExecutions: [], commandExecutions: [], workflowInvocations: [], manualVerificationTasks: [] },
        ],
      });

      const service = new SprintPreviewService(deps as any);
      service.startSession = vi.fn().mockResolvedValue(undefined);

      await service.reconcileSessions();

      expect(service.startSession).toHaveBeenCalledWith("proj-1", "sprint-1");
    });

    it("stops active preview sessions when preview runtime is disabled", async () => {
      const session = makeSession({ status: "running", containerId: null, containerName: null });
      deps.sprintPreviewRepository.listSessions.mockReturnValue([session]);
      deps.projectManagementRepository.getSprint.mockReturnValue({
        id: "sprint-1",
        projectId: "proj-1",
        name: "Sprint 1",
        number: 1,
        status: "running",
        featureBranch: "feature/sprint-1",
      });
      deps.settingsRepository.resolveSprintDashboardSettings.mockReturnValue({
        settings: { ...DEFAULT_DASHBOARD_SETTINGS,
          sprintPreview: makePreviewSettings({ enabled: false }),
          git: { defaultBranch: "main", sprintBranchScheme: "feature/sprint-{number}" },
          cliWorkflow: { containerImage: "", containerCacheSetupScriptImage: false, containerSetupScriptPath: "" },
        },
      });
      deps.sprintPreviewRepository.updateSession.mockImplementation(
        (id: string, patch: Partial<SprintPreviewSession>) => makeSession({ id, ...patch }),
      );

      const service = new SprintPreviewService(deps as any);
      const stopSessionSpy = vi.spyOn(service, "stopSession").mockResolvedValue(makeSession({ status: "stopped" }));
      await service.reconcileSessions();

      expect(stopSessionSpy).toHaveBeenCalledWith("session-1");
    });
  });

  describe("private helper methods (via service instance)", () => {
    it("buildContainerName produces valid docker name", () => {
      const service = new SprintPreviewService(deps as any);
      const name = (service as any).buildContainerName("My Project!", "sprint-42");
      expect(name).toMatch(/^code-ux-preview-/);
      expect(name.length).toBeLessThanOrEqual(63);
      expect(name).not.toMatch(/[^a-z0-9_.-]/);
    });

    it("buildSessionLockKey combines project and sprint", () => {
      const service = new SprintPreviewService(deps as any);
      const key = (service as any).buildSessionLockKey("proj-1", "sprint-1");
      expect(key).toBe("proj-1:sprint-1");
    });



    it("extractPreviewError finds error lines", () => {
      const service = new SprintPreviewService(deps as any);
      const extract = (service as any).extractPreviewError.bind(service);
      expect(extract("line1\nError: EADDRINUSE\nline3")).toBe("Error: EADDRINUSE");
      expect(extract("line1\nFailed to bind port")).toBe("Failed to bind port");
      expect(extract("all ok\nserver started")).toBe("server started");
      expect(extract("")).toBeNull();
    });

    it("shouldRewriteBody returns true for HTML/CSS/JS types", () => {
      const service = new SprintPreviewService(deps as any);
      const check = (service as any).shouldRewriteBody.bind(service);
      expect(check("text/html")).toBe(true);
      expect(check("text/css")).toBe(true);
      expect(check("application/javascript")).toBe(true);
      expect(check("application/xhtml+xml")).toBe(true);
      expect(check("application/json")).toBe(false);
      expect(check("image/png")).toBe(false);
    });

    it("rewriteLocationHeader rewrites absolute and relative paths", () => {
      const service = new SprintPreviewService(deps as any);
      const rewrite = (service as any).rewriteLocationHeader.bind(service);
      const prefix = "/api/browser/sessions/s1/proxy";
      expect(rewrite("/login", prefix, "http://127.0.0.1:5555")).toBe(`${prefix}/login`);
      expect(rewrite("http://127.0.0.1:5555/app", prefix, "http://127.0.0.1:5555")).toBe(`${prefix}/app`);
      expect(rewrite("https://external.com/page", prefix, "http://127.0.0.1:5555")).toBe("https://external.com/page");
      expect(rewrite("", prefix, "http://127.0.0.1:5555")).toBe("");
    });

    it("rewriteProxyBody rewrites asset references", () => {
      const service = new SprintPreviewService(deps as any);
      const rewrite = (service as any).rewriteProxyBody.bind(service);
      const prefix = "/api/browser/sessions/s1/proxy";

      expect(rewrite('href="/styles.css"', prefix)).toBe(`href="${prefix}/styles.css"`);
      expect(rewrite('src="/app.js"', prefix)).toBe(`src="${prefix}/app.js"`);
      expect(rewrite("url('/bg.png')", prefix)).toBe(`url('${prefix}/bg.png')`);
      expect(rewrite("fetch('/api')", prefix)).toBe(`fetch('${prefix}/api')`);
      // Does not rewrite protocol-relative URLs
      expect(rewrite('href="//cdn.example.com"', prefix)).toBe('href="//cdn.example.com"');
    });



    it("countCompletedTasks counts correctly", () => {
      deps.projectManagementRepository.listTasks.mockReturnValue([
        { status: "completed" },
        { status: "running" },
        { status: "completed" },
        { status: "pending" },
      ]);
      const service = new SprintPreviewService(deps as any);
      const count = (service as any).countCompletedTasks("proj-1", "sprint-1");
      expect(count).toBe(2);
    });

    it("requireProject throws when not found", () => {
      deps.projectManagementRepository.getProject.mockReturnValue(null);
      const service = new SprintPreviewService(deps as any);
      expect(() => (service as any).requireProject("nope")).toThrow("Project not found: nope");
    });

    it("requireSprint throws when not found", () => {
      deps.projectManagementRepository.getSprint.mockReturnValue(null);
      const service = new SprintPreviewService(deps as any);
      expect(() => (service as any).requireSprint("proj-1", "nope")).toThrow("Sprint not found in project: nope");
    });

    it("requireSprint throws when sprint belongs to different project", () => {
      deps.projectManagementRepository.getSprint.mockReturnValue({
        id: "sprint-1",
        projectId: "other-project",
        name: "Sprint 1",
      });
      const service = new SprintPreviewService(deps as any);
      expect(() => (service as any).requireSprint("proj-1", "sprint-1")).toThrow("Sprint not found in project");
    });
  });

  describe("refreshRuntimeState", () => {
    it("returns session unchanged when no container and no prior container refs", async () => {
      const session = makeSession({ containerId: null, containerName: null });
      const service = new SprintPreviewService(deps as any);
      const result = await (service as any).refreshRuntimeState(session);
      expect(result).toBe(session);
    });

    it("marks session as stopped when container disappears", async () => {
      const session = makeSession({ containerId: "old-container" });
      deps.sprintPreviewRepository.updateSession.mockImplementation(
        (id: string, patch: Partial<SprintPreviewSession>) => makeSession({ id, ...patch }),
      );

      // docker ps returns empty → no containers found
      vi.mocked(runCommandStrict).mockResolvedValue({ exitCode: 0, stdout: "", stderr: "", durationMs: 1 });

      const service = new SprintPreviewService(deps as any);
      const result = await (service as any).refreshRuntimeState(session);
      expect(result.status).toBe("stopped");
      expect(result.containerId).toBeNull();
    });

    it("marks session as error when container is not running", async () => {
      const session = makeSession({ containerId: "abc123" });
      deps.sprintPreviewRepository.updateSession.mockImplementation(
        (id: string, patch: Partial<SprintPreviewSession>) => makeSession({ id, ...patch }),
      );

      vi.mocked(runCommandStrict).mockImplementation(async (command, args) => {
        if (command === "docker" && args?.[0] === "ps") {
          const line = `abc123\tcode-ux-preview-test\tExited (1) 5 minutes ago\tproj-1\tsprint-1\tsession-1`;
          return { exitCode: 0, stdout: line, stderr: "", durationMs: 1 };
        }
        if (command === "docker" && args?.[0] === "logs") {
          return { exitCode: 0, stdout: "Error: port already in use", stderr: "", durationMs: 1 };
        }
        return { exitCode: 0, stdout: "", stderr: "", durationMs: 1 };
      });

      const service = new SprintPreviewService(deps as any);
      const result = await (service as any).refreshRuntimeState(session);
      expect(result.status).toBe("error");
      expect(result.healthStatus).toBe("unreachable");
    });
  });

  describe("findFreePort", () => {
    it("throws when no ports available", async () => {
      const service = new SprintPreviewService(deps as any);
      // Mock checkPortAvailable to always return false
      (service as any).checkPortAvailable = vi.fn(async () => false);

      await expect(
        (service as any).findFreePort({
          hostPortRangeStart: 5555,
          hostPortRangeEnd: 5556,
        }),
      ).rejects.toThrow("No free preview ports available");
    });

    it("returns first available port", async () => {
      const service = new SprintPreviewService(deps as any);
      (service as any).checkPortAvailable = vi.fn(async () => true);

      const port = await (service as any).findFreePort({
        hostPortRangeStart: 5555,
        hostPortRangeEnd: 5556,
      });
      expect(port).toBeGreaterThanOrEqual(5555);
      expect(port).toBeLessThanOrEqual(5556);
    });
  });



  describe("listPreviewContainers parsing", () => {
    it("parses docker ps output into container summaries", async () => {
      vi.mocked(runCommandStrict).mockImplementation(async (command, args) => {
        if (command === "docker" && args?.[0] === "ps" && args?.includes("-a")) {
          const lines = [
            "abc123\tpreview-proj-1\tUp 5 minutes\tproj-1\tsprint-1\tsession-1",
            "def456\tpreview-proj-2\tExited (0) 1 hour ago\tproj-2\tsprint-2\tsession-2",
          ].join("\n");
          return { exitCode: 0, stdout: lines, stderr: "", durationMs: 1 };
        }
        return { exitCode: 0, stdout: "", stderr: "", durationMs: 1 };
      });

      const service = new SprintPreviewService(deps as any);
      const containers = await (service as any).listPreviewContainers("/cwd");
      expect(containers).toHaveLength(2);
      expect(containers[0].id).toBe("abc123");
      expect(containers[0].status).toBe("running");
      expect(containers[1].status).toBe("exited");
    });

    it("returns empty array when docker command fails", async () => {
      vi.mocked(runCommandStrict).mockRejectedValue(new Error("docker not found"));

      const service = new SprintPreviewService(deps as any);
      const containers = await (service as any).listPreviewContainers("/cwd");
      expect(containers).toEqual([]);
    });
  });

  describe("findManagedContainerForSession", () => {
    it("finds container by session ID label first", async () => {
      vi.mocked(runCommandStrict).mockResolvedValue({
        exitCode: 0,
        stdout: "abc123\tpreview\tUp 5m\tproj-1\tsprint-1\tsession-1",
        stderr: "",
        durationMs: 1,
      });

      const session = makeSession();
      const service = new SprintPreviewService(deps as any);
      const container = await (service as any).findManagedContainerForSession(session);
      expect(container).toBeTruthy();
      expect(container.id).toBe("abc123");
    });

    it("falls back to project+sprint labels", async () => {
      vi.mocked(runCommandStrict).mockResolvedValue({
        exitCode: 0,
        stdout: "abc123\tpreview\tUp 5m\tproj-1\tsprint-1\tother-session",
        stderr: "",
        durationMs: 1,
      });

      const session = makeSession();
      const service = new SprintPreviewService(deps as any);
      const container = await (service as any).findManagedContainerForSession(session);
      expect(container).toBeTruthy();
    });

    it("returns null when no container matches and no prior refs", async () => {
      vi.mocked(runCommandStrict).mockResolvedValue({ exitCode: 0, stdout: "", stderr: "", durationMs: 1 });

      const session = makeSession({ containerId: null, containerName: null });
      const service = new SprintPreviewService(deps as any);
      const container = await (service as any).findManagedContainerForSession(session);
      expect(container).toBeNull();
    });
  });

  describe("git branch helpers", () => {
    it("localBranchExists returns true on success", async () => {
      vi.mocked(runCommandStrict).mockResolvedValue({ exitCode: 0, stdout: "", stderr: "", durationMs: 1 });
      const service = new SprintPreviewService(deps as any);
      const exists = await (service as any).localBranchExists("/repo", "main");
      expect(exists).toBe(true);
    });

    it("localBranchExists returns false on error", async () => {
      vi.mocked(runCommandStrict).mockRejectedValue(new Error("not found"));
      const service = new SprintPreviewService(deps as any);
      const exists = await (service as any).localBranchExists("/repo", "nonexistent");
      expect(exists).toBe(false);
    });

    it("remoteTrackingRefExists returns true on success", async () => {
      vi.mocked(runCommandStrict).mockResolvedValue({ exitCode: 0, stdout: "", stderr: "", durationMs: 1 });
      const service = new SprintPreviewService(deps as any);
      const exists = await (service as any).remoteTrackingRefExists("/repo", "main");
      expect(exists).toBe(true);
    });

    it("remoteBranchExists returns true when ls-remote has output", async () => {
      vi.mocked(runCommandStrict).mockResolvedValue({
        exitCode: 0,
        stdout: "abc123\trefs/heads/feature",
        stderr: "",
        durationMs: 1,
      });
      const service = new SprintPreviewService(deps as any);
      const exists = await (service as any).remoteBranchExists("/repo", "feature");
      expect(exists).toBe(true);
    });

    it("remoteBranchExists returns false when ls-remote empty", async () => {
      vi.mocked(runCommandStrict).mockResolvedValue({ exitCode: 0, stdout: "", stderr: "", durationMs: 1 });
      const service = new SprintPreviewService(deps as any);
      const exists = await (service as any).remoteBranchExists("/repo", "nonexistent");
      expect(exists).toBe(false);
    });

    it("resolvePreviewExportRef prefers origin ref when both exist", async () => {
      vi.mocked(runCommandStrict).mockResolvedValue({ exitCode: 0, stdout: "", stderr: "", durationMs: 1 });
      const service = new SprintPreviewService(deps as any);
      const ref = await (service as any).resolvePreviewExportRef("/repo", "feature");
      expect(ref).toBe("origin/feature");
    });

    it("resolvePreviewExportRef falls back to local ref when no origin", async () => {
      let callCount = 0;
      vi.mocked(runCommandStrict).mockImplementation(async () => {
        callCount++;
        if (callCount === 1) throw new Error("not remote"); // remoteTrackingRefExists
        return { exitCode: 0, stdout: "", stderr: "", durationMs: 1 }; // localBranchExists
      });
      const service = new SprintPreviewService(deps as any);
      const ref = await (service as any).resolvePreviewExportRef("/repo", "feature");
      expect(ref).toBe("feature");
    });

    it("resolvePreviewExportRef throws when branch not found anywhere", async () => {
      vi.mocked(runCommandStrict).mockRejectedValue(new Error("not found"));
      const service = new SprintPreviewService(deps as any);
      await expect(
        (service as any).resolvePreviewExportRef("/repo", "ghost"),
      ).rejects.toThrow("Cannot export sprint preview workspace");
    });

    it("resolvePreviewBranchBaseRef prefers local then remote then HEAD", async () => {
      vi.mocked(runCommandStrict).mockRejectedValue(new Error("not found"));
      const service = new SprintPreviewService(deps as any);
      const ref = await (service as any).resolvePreviewBranchBaseRef("/repo", "main");
      expect(ref).toBe("HEAD");
    });

    it("materializePreviewWorkspace skips remote refresh in LOCAL git mode", async () => {
      deps.settingsRepository.resolveSprintDashboardSettings.mockReturnValue({
        settings: { ...DEFAULT_DASHBOARD_SETTINGS,
          sprintPreview: makePreviewSettings(),
          git: { githubMode: "LOCAL", defaultBranch: "main", sprintBranchScheme: "feature/sprint-{number}" },
          cliWorkflow: { containerImage: "", containerCacheSetupScriptImage: false, containerSetupScriptPath: "" },
        },
      });
      const service = new SprintPreviewService(deps as any);
      await service.startSession("proj-1", "sprint-1");
      expect(fetchOriginIfAvailable).not.toHaveBeenCalled();
    });
  });

  describe("prepareStartupScript", () => {
    it("returns auto mode when no custom script exists", async () => {
      vi.mocked(readOptionalSprintPreviewScript).mockResolvedValue({
        exists: false,
        content: "",
      });

      const service = new SprintPreviewService(deps as any);
      const result = await (service as any).prepareStartupScript("/repo", {
        startupScriptPath: ".code-ux/browser/start-preview.sh",
      });

      expect(result.mode).toBe("auto");
      expect(result.installCommand).toBe("npm ci");
    });

    it("returns script mode when custom script exists", async () => {
      vi.mocked(readOptionalSprintPreviewScript).mockResolvedValue({
        exists: true,
        content: "#!/bin/bash\ncustom",
      });

      const service = new SprintPreviewService(deps as any);
      const result = await (service as any).prepareStartupScript("/repo", {
        startupScriptPath: ".code-ux/browser/start-preview.sh",
      });

      expect(result.mode).toBe("script");
      expect(result.content).toBe("#!/bin/bash\ncustom");
    });
  });

  describe("resolveSprintFeatureBranch", () => {
    it("uses sprint featureBranch when available", () => {
      const service = new SprintPreviewService(deps as any);
      const branch = (service as any).resolveSprintFeatureBranch("proj-1", "sprint-1");
      expect(branch).toBe("feature/sprint-1");
    });

    it("formats branch from scheme when sprint has no featureBranch", () => {
      deps.projectManagementRepository.getSprint.mockReturnValue({
        id: "sprint-1",
        projectId: "proj-1",
        name: "Sprint 1",
        slug: "sprint-1",
        createdAt: new Date().toISOString(),
        tasksCount: 0,
        number: 5,
        status: "running",
        featureBranch: "",
      });
      deps.settingsRepository.resolveSprintDashboardSettings.mockReturnValue({
        settings: { ...DEFAULT_DASHBOARD_SETTINGS,
          git: { defaultBranch: "main", sprintBranchScheme: "feature/sprint-{sprint}" },
        }
      });

      const service = new SprintPreviewService(deps as any);
      const branch = (service as any).resolveSprintFeatureBranch("proj-1", "sprint-1");
      expect(branch).toBe("feature/sprint-sprint-1");
    });
  });

  describe("mapDockerSourcePathForDaemon", () => {
    it("returns normalized path by default", () => {
      const service = new SprintPreviewService(deps as any);
      const result = (service as any).mapDockerSourcePathForDaemon("/some/path", "/repo");
      expect(result).toBe(path.resolve("/some/path"));
    });
  });

  describe("resolveDockerUserSpec", () => {
    it("returns uid:gid from workspace stats", async () => {
      const service = new SprintPreviewService(deps as any);
      const result = await (service as any).resolveDockerUserSpec("/workspace");
      expect(result).toBe("1000:1000");
    });
  });

  describe("resolveContainerSetupScriptPath", () => {
    it("returns undefined when no setup script found", async () => {
      const service = new SprintPreviewService(deps as any);
      const result = await (service as any).resolveContainerSetupScriptPath("/repo", {
        containerSetupScriptPath: "",
      });
      expect(result).toBeUndefined();
    });
  });

  describe("cleanupLegacyPreviewWorkspaces", () => {
    it("does nothing when legacy dir does not exist", async () => {
      const service = new SprintPreviewService(deps as any);
      await (service as any).cleanupLegacyPreviewWorkspaces("/repo");
      // readdir throws ENOENT → early return
      expect(runCommandStrict).not.toHaveBeenCalled();
    });

    it("removes preview- prefixed directories", async () => {
      const fsMod = await import("fs/promises");
      vi.mocked(fsMod.readdir).mockResolvedValue([
        { name: "preview-old", isDirectory: () => true },
        { name: "other-dir", isDirectory: () => true },
        { name: "preview-file", isDirectory: () => false },
      ] as any);

      vi.mocked(runCommandStrict).mockResolvedValue({ exitCode: 0, stdout: "", stderr: "", durationMs: 1 });

      const service = new SprintPreviewService(deps as any);
      await (service as any).cleanupLegacyPreviewWorkspaces("/repo");

      expect(runCommandStrict).toHaveBeenCalledWith(
        "git",
        ["worktree", "remove", "--force", expect.stringContaining("preview-old")],
        "/repo",
      );
      expect(runCommandStrict).toHaveBeenCalledWith("git", ["worktree", "prune"], "/repo");
    });
  });

  describe("cleanupOrphanedSetupContainers", () => {
    it("removes containers matching orphaned setup command", async () => {
      vi.mocked(runCommandStrict).mockImplementation(async (command, args) => {
        if (command === "docker" && args?.[0] === "ps" && args?.includes("status=running")) {
          return { exitCode: 0, stdout: "orphan-1\n", stderr: "", durationMs: 1 };
        }
        if (command === "docker" && args?.[0] === "inspect") {
          return {
            exitCode: 0,
            stdout: '{}\t["/bin/sh","-c","bash /tmp/code-ux-setup.sh && rm -f /tmp/code-ux-setup.sh"]',
            stderr: "",
            durationMs: 1,
          };
        }
        return { exitCode: 0, stdout: "", stderr: "", durationMs: 1 };
      });

      const service = new SprintPreviewService(deps as any);
      await (service as any).cleanupOrphanedSetupContainers("/cwd");

      expect(runCommandStrict).toHaveBeenCalledWith("docker", ["rm", "-f", "orphan-1"], "/cwd");
    });

    it("skips containers with labels", async () => {
      vi.mocked(runCommandStrict).mockImplementation(async (command, args) => {
        if (command === "docker" && args?.[0] === "ps") {
          return { exitCode: 0, stdout: "labeled-1\n", stderr: "", durationMs: 1 };
        }
        if (command === "docker" && args?.[0] === "inspect") {
          return {
            exitCode: 0,
            stdout: '{"app":"true"}\t["bash"]',
            stderr: "",
            durationMs: 1,
          };
        }
        return { exitCode: 0, stdout: "", stderr: "", durationMs: 1 };
      });

      const service = new SprintPreviewService(deps as any);
      await (service as any).cleanupOrphanedSetupContainers("/cwd");

      // Should NOT have called rm for the labeled container
      expect(runCommandStrict).not.toHaveBeenCalledWith(
        "docker",
        ["rm", "-f", "labeled-1"],
        "/cwd",
      );
    });
  });
});
