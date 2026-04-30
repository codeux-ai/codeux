import { describe, it, expect, vi, beforeEach } from "vitest";
import { TaskService } from "../../../src/services/task-service.js";

vi.mock("../../../src/services/git-branch-sync-service.js", () => ({
  fetchOriginIfAvailable: vi.fn(),
  syncRemoteBranchIfAvailable: vi.fn(),
}));

import { syncRemoteBranchIfAvailable } from "../../../src/services/git-branch-sync-service.js";

describe("TaskService", () => {
  const createSession = vi.fn();
  const getWorkerAgent = vi.fn();
  const startCliTask = vi.fn();
  const resolveJulesSourceId = vi.fn();

  const service = new TaskService({
    julesApi: { createSession } as any,
    agentPresetSyncService: { getOptionalWorkerAgentForRepoPath: getWorkerAgent } as any,
    resolveJulesSourceId,
    getDashboardSettings: () => ({
      aiProvider: {
        provider: "jules",
        strategy: "MANUAL",
        julesApiKey: "",
        providers: {
          jules: { enabled: true, model: "default", weight: 60, thinkingMode: "MEDIUM", apiKey: "" },
          gemini: { enabled: true, model: "default", weight: 20, thinkingMode: "MEDIUM", apiKey: "" },
          codex: { enabled: true, model: "gpt-5.3-codex", weight: 20, thinkingMode: "HIGH", apiKey: "" },
        },
      },
      git: { githubMode: "REMOTE", defaultBranch: "main" },
    }) as any,
    isJulesApiConfigured: () => true,
    cliWorkflowService: { startTask: startCliTask } as any,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(syncRemoteBranchIfAvailable).mockResolvedValue(true);
    resolveJulesSourceId.mockImplementation(async ({ sourceId }: { sourceId?: string }) =>
      sourceId?.startsWith("sources/") ? sourceId : `sources/${sourceId || "auto"}`
    );
  });

  it("creates task_agent session with worker agent instructions injected", async () => {
    getWorkerAgent.mockResolvedValue({ instructionMarkdown: "## Worker Rules" });
    createSession.mockResolvedValue({ id: "s1" });

    await service.createTaskAgentSession({
      prompt: "Implement feature X",
      source_id: "123",
      repo_path: "/tmp/repo",
      title: "Task Title",
      branch: "feature/branch",
    });

    expect(getWorkerAgent).toHaveBeenCalledWith("/tmp/repo");
    expect(createSession).toHaveBeenCalledTimes(1);
    const payload = createSession.mock.calls[0][0];
    expect(payload.prompt).toContain("## Worker Rules");
    expect(payload.prompt).toContain("Implement feature X");
    expect(payload.sourceContext.source).toBe("sources/123");
    expect(payload.sourceContext.githubRepoContext.startingBranch).toBe("feature/branch");
    expect(payload.title).toBe("Task Title");
    expect(payload.automationMode).toBe("AUTO_CREATE_PR");
  });

  it("falls back to raw prompt when worker agent instructions are missing", async () => {
    getWorkerAgent.mockResolvedValue(null);
    createSession.mockResolvedValue({ id: "s2" });

    await service.createTaskAgentSession({
      prompt: "Raw prompt only",
      source_id: "321",
      repo_path: "/tmp/repo",
    });

    const payload = createSession.mock.calls[0][0];
    expect(payload.prompt).toBe("Raw prompt only");
  });

  it("auto-resolves source id when omitted", async () => {
    getWorkerAgent.mockResolvedValue({ instructionMarkdown: "Rules" });
    createSession.mockResolvedValue({ id: "s-auto" });

    await service.createTaskAgentSession({
      prompt: "Auto source",
      repo_path: "/tmp/repo",
    });

    expect(resolveJulesSourceId).toHaveBeenCalledWith({
      repoPath: "/tmp/repo",
      sourceId: undefined,
    });
    const payload = createSession.mock.calls[0][0];
    expect(payload.sourceContext.source).toBe("sources/auto");
  });

  it("creates sprint task session payload with sprint metadata", async () => {
    getWorkerAgent.mockResolvedValue({ instructionMarkdown: "Rules" });
    createSession.mockResolvedValue({ id: "s3" });

    await service.startSprintTask(
      {
        id: "01-task",
        title: "Do Thing",
        prompt: "Implement",
        depends_on: [],
        is_independent: true,
      },
      "999",
      "feature/sprint1",
      "/tmp/repo",
      1
    );

    const payload = createSession.mock.calls[0][0];
    expect(payload.title).toContain("Sprint 1:");
    expect(payload.title).toContain("[01-task] Do Thing");
    expect(payload.title).toContain("[run:");
    expect(payload.sourceContext.source).toBe("sources/999");
    expect(payload.sourceContext.githubRepoContext.startingBranch).toBe("feature/sprint1");
    expect(payload.prompt).toContain("SUBTASK TO EXECUTE");
    expect(syncRemoteBranchIfAvailable).toHaveBeenCalledWith("/tmp/repo", "feature/sprint1");
  });

  it("uses matching provider settings when a persisted task provider overrides the resolved route", async () => {
    const overrideStartCliTask = vi.fn().mockResolvedValue({
      id: "cli-gemini",
      name: "sessions/cli-gemini",
      provider: "gemini",
      state: "RUNNING",
      prompt: "",
    });
    const overrideService = new TaskService({
      julesApi: { createSession } as any,
      agentPresetSyncService: { getOptionalWorkerAgentForRepoPath: getWorkerAgent } as any,
      resolveJulesSourceId,
      getDashboardSettings: () => ({
        aiProvider: {
          provider: "jules",
          strategy: "MANUAL",
          julesApiKey: "",
          providers: {
            jules: { provider: "jules", enabled: true, model: "default", weight: 60, thinkingMode: "MEDIUM", apiKey: "", mountAuth: false, authPath: "" },
            gemini: { provider: "gemini", enabled: true, model: "gemini-2.5-pro", weight: 20, thinkingMode: "HIGH", apiKey: "", mountAuth: true, authPath: "~/.gemini" },
          },
        },
        git: { githubMode: "REMOTE", defaultBranch: "main" },
      }) as any,
      isJulesApiConfigured: () => true,
      cliWorkflowService: { startTask: overrideStartCliTask } as any,
    });

    await overrideService.startSprintTask(
      {
        id: "01-task",
        title: "Do Thing",
        prompt: "Implement",
        depends_on: [],
        is_independent: true,
        provider: "gemini",
      },
      "999",
      "feature/sprint1",
      "/tmp/repo",
      1,
    );

    expect(createSession).not.toHaveBeenCalled();
    expect(overrideStartCliTask).toHaveBeenCalledWith(expect.objectContaining({
      provider: "gemini",
      providerSettingsOverride: expect.objectContaining({
        model: "gemini-2.5-pro",
        thinkingMode: "HIGH",
        providerMountAuth: true,
        providerAuthPath: "~/.gemini",
      }),
    }));
  });

  it("falls back to cli provider when jules is unavailable", async () => {
    const fallbackService = new TaskService({
      julesApi: { createSession } as any,
      agentPresetSyncService: { getOptionalWorkerAgentForRepoPath: getWorkerAgent } as any,
      resolveJulesSourceId,
      getDashboardSettings: () => ({
        aiProvider: {
          provider: "jules",
          strategy: "MANUAL",
          julesApiKey: "",
          providers: {
            jules: { enabled: true, model: "default", weight: 60, thinkingMode: "MEDIUM", apiKey: "" },
            gemini: { enabled: true, model: "default", weight: 20, thinkingMode: "MEDIUM", apiKey: "" },
            codex: { enabled: true, model: "gpt-5.3-codex", weight: 20, thinkingMode: "HIGH", apiKey: "" },
          },
        },
        git: { githubMode: "REMOTE", defaultBranch: "main" },
      }) as any,
      isJulesApiConfigured: () => false,
      cliWorkflowService: {
        startTask: vi.fn().mockResolvedValue({ id: "cli-1", name: "sessions/cli-1", provider: "gemini", state: "RUNNING", prompt: "" }),
      } as any,
    });

    getWorkerAgent.mockResolvedValue({ instructionMarkdown: "Rules" });
    await fallbackService.startSprintTask(
      {
        id: "01-task",
        title: "Do Thing",
        prompt: "Implement",
        depends_on: [],
        is_independent: true,
      },
      "999",
      "feature/sprint1",
      "/tmp/repo",
      1
    );

    expect(createSession).not.toHaveBeenCalled();
  });

  it("falls back to cli provider when githubMode is LOCAL and throws if no CLI providers are enabled", () => {
    const localModeService = new TaskService({
      julesApi: { createSession } as any,
      agentPresetSyncService: { getOptionalWorkerAgentForRepoPath: getWorkerAgent } as any,
      resolveJulesSourceId,
      getDashboardSettings: () => ({
        aiProvider: {
          provider: "jules",
          strategy: "MANUAL",
          julesApiKey: "",
          providers: {
            jules: { enabled: true, model: "default", weight: 60, thinkingMode: "MEDIUM", apiKey: "" },
            gemini: { enabled: true, model: "default", weight: 20, thinkingMode: "MEDIUM", apiKey: "" },
            codex: { enabled: false, model: "gpt-5.3-codex", weight: 20, thinkingMode: "HIGH", apiKey: "" },
            "claude-code": { enabled: false, model: "default", weight: 0, thinkingMode: "HIGH", apiKey: "" },
          },
          invocationRouting: {
            task_coding: {
              profile: "GLOBAL",
              strategy: "MANUAL",
              provider: null,
              allowedProviders: [],
              providers: {},
            },
          },
        },
        git: { githubMode: "LOCAL", defaultBranch: "main" },
      }) as any,
      isJulesApiConfigured: () => true,
      cliWorkflowService: { startTask: startCliTask } as any,
    });

    const route = localModeService.resolveInvocationProvider("task_coding", {
      id: "chat",
      title: "Chat",
      prompt: "hello",
      depends_on: [],
      is_independent: true,
      status: "PENDING",
    });

    expect(route.provider).toBe("gemini");

    // Test the throw when all CLI providers are disabled
    const emptyLocalModeService = new TaskService({
      julesApi: { createSession } as any,
      agentPresetSyncService: { getOptionalWorkerAgentForRepoPath: getWorkerAgent } as any,
      resolveJulesSourceId,
      getDashboardSettings: () => ({
        aiProvider: {
          provider: "jules",
          strategy: "MANUAL",
          julesApiKey: "",
          providers: {
            jules: { enabled: true, model: "default", weight: 60, thinkingMode: "MEDIUM", apiKey: "" },
            gemini: { enabled: false, model: "default", weight: 20, thinkingMode: "MEDIUM", apiKey: "" },
            codex: { enabled: false, model: "gpt-5.3-codex", weight: 20, thinkingMode: "HIGH", apiKey: "" },
            "claude-code": { enabled: false, model: "default", weight: 0, thinkingMode: "HIGH", apiKey: "" },
          },
          invocationRouting: {
            task_coding: {
              profile: "GLOBAL",
              strategy: "MANUAL",
              provider: null,
              allowedProviders: [],
              providers: {},
            },
          },
        },
        git: { githubMode: "LOCAL", defaultBranch: "main" },
      }) as any,
      isJulesApiConfigured: () => true,
      cliWorkflowService: { startTask: startCliTask } as any,
    });

    expect(() => emptyLocalModeService.resolveInvocationProvider("task_coding", {
      id: "chat",
      title: "Chat",
      prompt: "hello",
      depends_on: [],
      is_independent: true,
      status: "PENDING",
    })).toThrow("requires a CLI provider");
  });

  it("does not fetch origin before starting sprint tasks in LOCAL git mode", async () => {
    const localModeService = new TaskService({
      julesApi: { createSession } as any,
      agentPresetSyncService: { getOptionalWorkerAgentForRepoPath: getWorkerAgent } as any,
      resolveJulesSourceId,
      getDashboardSettings: () => ({
        aiProvider: {
          provider: "jules",
          strategy: "MANUAL",
          julesApiKey: "",
          providers: {
            jules: { enabled: true, model: "default", weight: 60, thinkingMode: "MEDIUM", apiKey: "" },
            gemini: { enabled: true, model: "default", weight: 20, thinkingMode: "MEDIUM", apiKey: "" },
            codex: { enabled: true, model: "gpt-5.3-codex", weight: 20, thinkingMode: "HIGH", apiKey: "" },
          },
        },
        git: { githubMode: "LOCAL", defaultBranch: "main" },
      }) as any,
      isJulesApiConfigured: () => true,
      cliWorkflowService: { startTask: startCliTask } as any,
    });

    getWorkerAgent.mockResolvedValue({ instructionMarkdown: "Rules" });
    startCliTask.mockResolvedValue({ id: "cli-local", name: "sessions/cli-local", provider: "gemini", state: "RUNNING", prompt: "" });
    createSession.mockResolvedValue({ id: "s-local" });

    await localModeService.startSprintTask(
      {
        id: "01-task",
        title: "Do Thing",
        prompt: "Implement",
        depends_on: [],
        is_independent: true,
      },
      "999",
      "feature/sprint1",
      "/tmp/repo",
      1,
    );

    expect(syncRemoteBranchIfAvailable).not.toHaveBeenCalled();
  });

  it("surfaces a clear error when remote origin refresh fails before starting a sprint task", async () => {
    vi.mocked(syncRemoteBranchIfAvailable).mockRejectedValueOnce(new Error("fetch failed"));

    await expect(service.startSprintTask(
      {
        id: "01-task",
        title: "Do Thing",
        prompt: "Implement",
        depends_on: [],
        is_independent: true,
      },
      "999",
      "feature/sprint1",
      "/tmp/repo",
      1,
    )).rejects.toThrow("Failed to refresh origin before starting work from feature/sprint1: fetch failed");
  });

  it("throws a clear error when a CLI-only invocation has no eligible CLI providers", () => {
    const cliOnlyService = new TaskService({
      julesApi: { createSession } as any,
      agentPresetSyncService: { getOptionalWorkerAgentForRepoPath: getWorkerAgent } as any,
      resolveJulesSourceId,
      getDashboardSettings: () => ({
        aiProvider: {
          provider: "jules",
          strategy: "MANUAL",
          julesApiKey: "",
          providers: {
            jules: { enabled: true, model: "default", weight: 60, thinkingMode: "MEDIUM", apiKey: "" },
            gemini: { enabled: false, model: "default", weight: 20, thinkingMode: "MEDIUM", apiKey: "" },
            codex: { enabled: false, model: "gpt-5.3-codex", weight: 20, thinkingMode: "HIGH", apiKey: "" },
            "claude-code": { enabled: false, model: "default", weight: 0, thinkingMode: "HIGH", apiKey: "" },
          },
          invocationRouting: {
            dashboard_reply: {
              profile: "GLOBAL",
              strategy: "MANUAL",
              provider: null,
              allowedProviders: [],
              providers: {},
            },
          },
        },
        git: { defaultBranch: "main" },
      }) as any,
      isJulesApiConfigured: () => true,
      cliWorkflowService: { startTask: startCliTask } as any,
    });

    expect(() => cliOnlyService.resolveInvocationProvider("dashboard_reply", {
      id: "chat",
      title: "Chat",
      prompt: "hello",
      depends_on: [],
      is_independent: true,
      status: "PENDING",
    }, {
      cliOnly: true,
    })).toThrow("requires a CLI provider");
  });
});
