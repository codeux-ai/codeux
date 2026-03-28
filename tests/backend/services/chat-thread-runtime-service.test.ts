import { describe, it, expect, vi, beforeEach } from "vitest";
import { ChatThreadRuntimeService } from "../../../src/services/chat-thread-runtime-service.js";

describe("ChatThreadRuntimeService", () => {
  let deps: any;
  let service: ChatThreadRuntimeService;

  beforeEach(() => {
    deps = {
      connectionChatRepository: {
        postDashboardMessage: vi.fn(),
        listThreads: vi.fn(),
        updateThread: vi.fn(),
        listMessages: vi.fn(),
        postSystemMessage: vi.fn(),
      },
      projectWorkerAssignmentRepository: {
        listAssignmentsForProject: vi.fn().mockReturnValue([]),
      },
      executionRepository: {
        createExecutionInvocation: vi.fn(),
        appendExecutionInvocationMessage: vi.fn(),
        updateExecutionInvocation: vi.fn(),
      },
      taskService: {
        resolveInvocationProvider: vi.fn(),
      },
      getDashboardSettings: vi.fn().mockReturnValue({ cliWorkflow: {} }),
      getGithubToken: vi.fn(),
      agentPresetSyncService: {
        getWorkerAgent: vi.fn().mockResolvedValue({ instructionMarkdown: "" }),
      },
      projectManagementRepository: {
        getProject: vi.fn(),
      },
      providerRunner: {
        runProviderForText: vi.fn(),
      },
    };
    service = new ChatThreadRuntimeService(deps);
  });

  it("binds to an active live worker assignment if available", async () => {
    deps.projectWorkerAssignmentRepository.listAssignmentsForProject.mockReturnValue([
      { assignmentRole: "primary", capabilities: { canSuperviseProjects: true }, workerStatus: "online", connectionId: "live-conn-1" },
    ]);
    deps.connectionChatRepository.postDashboardMessage.mockReturnValue({ threadId: "t1", bodyMarkdown: "hello" });
    deps.connectionChatRepository.listThreads.mockReturnValue([{ id: "t1", connectionId: null }]);
    deps.projectManagementRepository.getProject.mockReturnValue({ id: "p1", name: "proj" });

    await service.postMessage("p1", { bodyMarkdown: "hello" });

    expect(deps.connectionChatRepository.updateThread).toHaveBeenCalledWith("t1", { connectionId: "live-conn-1" });
    expect(deps.providerRunner.runProviderForText).not.toHaveBeenCalled();
  });

  it("runs virtual provider and replays history on provider switch", async () => {
    deps.connectionChatRepository.postDashboardMessage.mockReturnValue({ threadId: "t1", bodyMarkdown: "hello" });
    deps.connectionChatRepository.listThreads.mockReturnValue([{
      id: "t1",
      connectionId: null,
      runtimeState: { virtualProvider: "old-provider", sessionIds: ["old-session"] }
    }]);
    deps.projectManagementRepository.getProject.mockReturnValue({ id: "p1", name: "proj", baseDir: "/tmp" });
    deps.taskService.resolveInvocationProvider.mockReturnValue({
      provider: "claude-code",
      providers: { "claude-code": { model: "claude-3", apiKey: "key", thinkingMode: "HIGH" } }
    });
    deps.connectionChatRepository.listMessages.mockReturnValue([
      { authorType: "dashboard_user", bodyMarkdown: "first" },
      { authorType: "worker", bodyMarkdown: "reply" },
    ]);
    deps.executionRepository.createExecutionInvocation.mockReturnValue({ id: "exec1" });
    deps.providerRunner.runProviderForText.mockResolvedValue({ text: "im a bot", nativeSessionId: "new-session" });

    await service.postMessage("p1", { bodyMarkdown: "hello" });

    expect(deps.providerRunner.runProviderForText).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "claude-code",
        continueSessionId: null,
      })
    );
    expect(deps.connectionChatRepository.updateThread).toHaveBeenCalledWith("t1", expect.objectContaining({
      runtimeState: expect.objectContaining({
        routeKind: "virtual",
        virtualProvider: "claude-code",
        sessionIds: ["new-session"],
      })
    }));
  });

  it("continues with continueSessionId if same provider", async () => {
    deps.connectionChatRepository.postDashboardMessage.mockReturnValue({ threadId: "t1", bodyMarkdown: "hello" });
    deps.connectionChatRepository.listThreads.mockReturnValue([{
      id: "t1",
      connectionId: null,
      runtimeState: { virtualProvider: "claude-code", sessionIds: ["existing-session"] }
    }]);
    deps.projectManagementRepository.getProject.mockReturnValue({ id: "p1", name: "proj", baseDir: "/tmp" });
    deps.taskService.resolveInvocationProvider.mockReturnValue({
      provider: "claude-code",
      providers: { "claude-code": { model: "claude-3", apiKey: "key" } }
    });
    deps.executionRepository.createExecutionInvocation.mockReturnValue({ id: "exec1" });
    deps.providerRunner.runProviderForText.mockResolvedValue({ text: "next", nativeSessionId: "existing-session" });

    await service.postMessage("p1", { bodyMarkdown: "hello" });

    expect(deps.providerRunner.runProviderForText).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "claude-code",
        continueSessionId: "existing-session",
      })
    );
  });

  it("honors an explicitly routed virtual provider before falling back to global routing", async () => {
    deps.connectionChatRepository.postDashboardMessage.mockReturnValue({ threadId: "t1", bodyMarkdown: "hello" });
    deps.connectionChatRepository.listThreads.mockReturnValue([{
      id: "t1",
      connectionId: null,
      runtimeState: {
        routeKind: "virtual",
        virtualProvider: "codex",
      }
    }]);
    deps.projectManagementRepository.getProject.mockReturnValue({ id: "p1", name: "proj", baseDir: "/tmp" });
    deps.taskService.resolveInvocationProvider.mockReturnValue({
      provider: "jules",
      providers: {
        jules: { model: "default", apiKey: "", thinkingMode: "MEDIUM" },
        codex: { model: "gpt-5.3-codex", apiKey: "codex-key", thinkingMode: "HIGH" },
      }
    });
    deps.connectionChatRepository.listMessages.mockReturnValue([
      { authorType: "dashboard_user", bodyMarkdown: "first" },
    ]);
    deps.executionRepository.createExecutionInvocation.mockReturnValue({ id: "exec1" });
    deps.providerRunner.runProviderForText.mockResolvedValue({ text: "codex reply", nativeSessionId: "codex-session" });

    await service.postMessage("p1", { bodyMarkdown: "hello" });

    expect(deps.providerRunner.runProviderForText).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "codex",
        model: "gpt-5.3-codex",
        apiKey: "codex-key",
      })
    );
  });
});
