import { describe, it, expect, vi, beforeEach } from "vitest";
import { ChatThreadRuntimeService } from "../../../src/services/chat-thread-runtime-service.js";

describe("ChatThreadRuntimeService", () => {
  let deps: any;
  let service: ChatThreadRuntimeService;

  beforeEach(() => {
    deps = {
      connectionChatRepository: {
        postDashboardMessage: vi.fn(),
        getThread: vi.fn(),
        updateThread: vi.fn(),
        listMessages: vi.fn(),
        markDashboardMessagesProcessed: vi.fn(),
        markDashboardMessagesFailed: vi.fn(),
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
      chatManagementActionService: {
        processManagementAction: vi.fn(),
        executeApprovedAction: vi.fn(),
      },
    };
    service = new ChatThreadRuntimeService(deps);
  });

  it("throws an error if thread is not found when posting a message", async () => {
    deps.connectionChatRepository.postDashboardMessage.mockReturnValue({ id: "msg-missing", threadId: "t-missing", bodyMarkdown: "hello" });
    deps.connectionChatRepository.getThread.mockReturnValue(undefined); // Simulate missing thread

    await expect(service.postMessage("p1", { bodyMarkdown: "hello" })).rejects.toThrow("Thread not found");
  });

  it("runs virtual provider and replays history on provider switch using chatManagementActionService", async () => {
    deps.connectionChatRepository.postDashboardMessage.mockReturnValue({ id: "msg-2", threadId: "t1", bodyMarkdown: "hello" });
    deps.connectionChatRepository.getThread.mockReturnValue({
      id: "t1",
      connectionId: null,
      runtimeState: { virtualProvider: "old-provider", sessionIds: ["old-session"] }
    });
    deps.projectManagementRepository.getProject.mockReturnValue({ id: "p1", name: "proj", baseDir: "/tmp" });
    deps.taskService.resolveInvocationProvider.mockReturnValue({
      provider: "claude-code",
      providers: { "claude-code": { model: "claude-3", apiKey: "key", thinkingMode: "HIGH", mountAuth: true, authPath: "~/.claude" } }
    });
    deps.connectionChatRepository.listMessages.mockReturnValue([
      { authorType: "dashboard_user", bodyMarkdown: "first" },
      { authorType: "worker", bodyMarkdown: "reply" },
    ]);
    deps.executionRepository.createExecutionInvocation.mockReturnValue({ id: "exec1" });
    deps.chatManagementActionService.processManagementAction.mockResolvedValue({ replyMarkdown: "im a bot", action: null, approvalRequired: false });

    await service.postMessage("p1", { bodyMarkdown: "hello" });

    expect(deps.chatManagementActionService.processManagementAction).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "claude-code",
        sessionId: "t1", // Fallback to thread id when no active session
        providerMountAuth: true,
        providerAuthPath: "~/.claude",
      })
    );
    expect(deps.connectionChatRepository.updateThread).toHaveBeenCalledWith("t1", expect.objectContaining({
      runtimeState: expect.objectContaining({
        routeKind: "virtual",
        virtualProvider: "claude-code",
        sessionIds: ["t1"],
      })
    }));
    expect(deps.connectionChatRepository.markDashboardMessagesProcessed).toHaveBeenCalledWith("t1", {
      upToMessageId: "msg-2",
    });
  });

  it("continues with continueSessionId if same provider using chatManagementActionService", async () => {
    deps.connectionChatRepository.postDashboardMessage.mockReturnValue({ id: "msg-3", threadId: "t1", bodyMarkdown: "hello" });
    deps.connectionChatRepository.getThread.mockReturnValue({
      id: "t1",
      connectionId: null,
      runtimeState: { virtualProvider: "claude-code", sessionIds: ["existing-session"] }
    });
    deps.projectManagementRepository.getProject.mockReturnValue({ id: "p1", name: "proj", baseDir: "/tmp" });
    deps.taskService.resolveInvocationProvider.mockReturnValue({
      provider: "claude-code",
      providers: { "claude-code": { model: "claude-3", apiKey: "key" } }
    });
    deps.executionRepository.createExecutionInvocation.mockReturnValue({ id: "exec1" });
    deps.chatManagementActionService.processManagementAction.mockResolvedValue({ replyMarkdown: "next", action: null, approvalRequired: false });

    await service.postMessage("p1", { bodyMarkdown: "hello" });

    expect(deps.chatManagementActionService.processManagementAction).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "claude-code",
        sessionId: "t1",
        continueSessionId: "existing-session",
      })
    );
  });

  it("uses route mapping instead of stale thread virtual provider state", async () => {
    deps.connectionChatRepository.postDashboardMessage.mockReturnValue({ id: "msg-4", threadId: "t1", bodyMarkdown: "hello" });
    deps.connectionChatRepository.getThread.mockReturnValue({
      id: "t1",
      connectionId: null,
      runtimeState: {
        routeKind: "virtual",
        virtualProvider: "gemini",
        modelLabel: "gemini-2.5-flash",
        sessionIds: ["gemini-session"],
      }
    });
    deps.projectManagementRepository.getProject.mockReturnValue({ id: "p1", name: "proj", baseDir: "/tmp" });
    deps.taskService.resolveInvocationProvider.mockReturnValue({
      provider: "opencode",
      providerConfigId: "opencode",
      providers: {
        gemini: { model: "gemini-2.5-flash", apiKey: "gemini-key", thinkingMode: "MEDIUM" },
        opencode: { model: "openai/gpt-5", apiKey: "opencode-key", thinkingMode: "HIGH" },
      }
    });
    deps.connectionChatRepository.listMessages.mockReturnValue([
      { authorType: "dashboard_user", bodyMarkdown: "first" },
    ]);
    deps.executionRepository.createExecutionInvocation.mockReturnValue({ id: "exec1" });
    deps.chatManagementActionService.processManagementAction.mockResolvedValue({ replyMarkdown: "opencode reply", action: null, approvalRequired: false });

    await service.postMessage("p1", { bodyMarkdown: "hello" });

    expect(deps.chatManagementActionService.processManagementAction).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "opencode",
        model: "openai/gpt-5",
        apiKey: "opencode-key",
        sessionId: "t1",
        continueSessionId: null,
      })
    );
    expect(deps.connectionChatRepository.updateThread).toHaveBeenCalledWith("t1", expect.objectContaining({
      runtimeState: expect.objectContaining({
        routeKind: "virtual",
        virtualProvider: "opencode",
        sessionIds: ["t1"],
      })
    }));
  });

  it("handles user approval for a pending management action directly", async () => {
    deps.connectionChatRepository.postDashboardMessage.mockReturnValue({ id: "msg-appr", threadId: "t1", bodyMarkdown: "yes" });
    deps.connectionChatRepository.getThread.mockReturnValue({
      id: "t1",
      connectionId: null,
      runtimeState: {
        virtualProvider: "codex",
        pendingManagementAction: {
          action: { domain: "projects", action: "delete_project", payload: {} },
          approvalMessage: "Are you sure?",
          proposedAt: new Date().toISOString(),
        }
      }
    });
    deps.projectManagementRepository.getProject.mockReturnValue({ id: "p1", name: "proj", baseDir: "/tmp" });
    deps.taskService.resolveInvocationProvider.mockReturnValue({
      provider: "codex",
      providers: { codex: { model: "gpt-5.3-codex", apiKey: "codex-key" } }
    });
    deps.executionRepository.createExecutionInvocation.mockReturnValue({ id: "exec1" });
    deps.chatManagementActionService.executeApprovedAction.mockResolvedValue({
      replyMarkdown: "Approved action execution completed.",
      action: { domain: "projects", action: "delete_project", payload: {} },
      approvalRequired: false,
      result: { status: "success" }
    });

    await service.postMessage("p1", { bodyMarkdown: "yes" });

    expect(deps.chatManagementActionService.executeApprovedAction).toHaveBeenCalledWith(
      "p1", "codex", "gpt-5.3-codex", expect.objectContaining({ domain: "projects" })
    );
    expect(deps.connectionChatRepository.updateThread).toHaveBeenCalledWith("t1", expect.objectContaining({
      runtimeState: expect.not.objectContaining({ pendingManagementAction: expect.anything() })
    }));
    expect(deps.chatManagementActionService.processManagementAction).not.toHaveBeenCalled();
  });

  it("handles user cancellation of a pending management action directly", async () => {
    deps.connectionChatRepository.postDashboardMessage.mockReturnValue({ id: "msg-rej", threadId: "t1", bodyMarkdown: "no" });
    deps.connectionChatRepository.getThread.mockReturnValue({
      id: "t1",
      connectionId: null,
      runtimeState: {
        virtualProvider: "codex",
        pendingManagementAction: {
          action: { domain: "projects", action: "delete_project", payload: {} },
          approvalMessage: "Are you sure?",
          proposedAt: new Date().toISOString(),
        }
      }
    });
    deps.projectManagementRepository.getProject.mockReturnValue({ id: "p1", name: "proj", baseDir: "/tmp" });
    deps.taskService.resolveInvocationProvider.mockReturnValue({
      provider: "codex",
      providers: { codex: { model: "gpt-5.3-codex", apiKey: "codex-key" } }
    });

    await service.postMessage("p1", { bodyMarkdown: "no" });

    expect(deps.connectionChatRepository.postSystemMessage).toHaveBeenCalledWith("p1", expect.objectContaining({
      bodyMarkdown: "_Management action canceled by user._"
    }));
    expect(deps.connectionChatRepository.updateThread).toHaveBeenCalledWith("t1", expect.objectContaining({
      runtimeState: expect.not.objectContaining({ pendingManagementAction: expect.anything() })
    }));
    expect(deps.chatManagementActionService.executeApprovedAction).not.toHaveBeenCalled();
    expect(deps.chatManagementActionService.processManagementAction).not.toHaveBeenCalled();
  });

  it("compacts a virtual thread into a stored summary and clears the active session", async () => {
    deps.connectionChatRepository.getThread.mockReturnValue({
      id: "t1",
      projectId: "p1",
      title: "Thread",
      connectionId: null,
      runtimeState: {
        routeKind: "virtual",
        virtualProvider: "claude-code",
        sessionIds: ["session-1"],
      },
    });
    deps.connectionChatRepository.listMessages.mockReturnValue([
      { id: "m1", authorType: "dashboard_user", bodyMarkdown: "hello" },
      { id: "m2", authorType: "connection", bodyMarkdown: "world" },
    ]);
    deps.projectManagementRepository.getProject.mockReturnValue({ id: "p1", name: "proj", baseDir: "/tmp" });
    deps.taskService.resolveInvocationProvider.mockReturnValue({
      provider: "claude-code",
      providers: { "claude-code": { model: "claude-3", apiKey: "key", thinkingMode: "HIGH", mountAuth: true, authPath: "~/.claude" } },
    });
    deps.agentPresetSyncService.getWorkerAgent.mockResolvedValue({ instructionMarkdown: "" });
    deps.executionRepository.createExecutionInvocation.mockReturnValue({ id: "exec-compact" });
    deps.providerRunner.runProviderForText.mockResolvedValue({ text: "## Current Objective\nKeep context", nativeSessionId: "ignored" });
    deps.connectionChatRepository.updateThread.mockImplementation((threadId: string, input: any) => ({
      id: threadId,
      projectId: "p1",
      title: "Thread",
      runtimeState: input.runtimeState,
    }));

    const updated = await service.compactThreadSession("t1");

    expect(deps.executionRepository.createExecutionInvocation).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "p1",
      type: "chat_compaction",
      provider: "claude-code",
      model: "claude-3",
    }));
    expect(deps.providerRunner.runProviderForText).toHaveBeenCalledWith(expect.objectContaining({
      provider: "claude-code",
      continueSessionId: null,
      sessionId: "t1:compaction",
      providerMountAuth: true,
      providerAuthPath: "~/.claude",
    }));
    expect(updated.runtimeState).toMatchObject({
      replayRequired: true,
      sessionIds: [],
      compactionSummary: {
        markdown: "## Current Objective\nKeep context",
        provider: "claude-code",
        model: "claude-3",
        sourceMessageId: "m2",
        sourceMessageCount: 2,
      },
    });
  });

  it("replays from the stored compaction summary on the next fresh virtual turn using chatManagementActionService", async () => {
    deps.connectionChatRepository.postDashboardMessage.mockReturnValue({ id: "msg-5", threadId: "t1", bodyMarkdown: "next question" });
    deps.connectionChatRepository.getThread.mockReturnValue({
      id: "t1",
      projectId: "p1",
      title: "Thread",
      connectionId: null,
      runtimeState: {
        routeKind: "virtual",
        virtualProvider: "claude-code",
        replayRequired: true,
        sessionIds: [],
        compactionSummary: {
          markdown: "## Current Objective\nKeep context",
          generatedAt: "2026-03-28T00:00:00.000Z",
          provider: "claude-code",
          model: "claude-3",
          sourceMessageId: "m1",
          sourceMessageCount: 1,
        },
      },
    });
    deps.projectManagementRepository.getProject.mockReturnValue({ id: "p1", name: "proj", baseDir: "/tmp" });
    deps.taskService.resolveInvocationProvider.mockReturnValue({
      provider: "claude-code",
      providers: { "claude-code": { model: "claude-3", apiKey: "key", thinkingMode: "HIGH" } },
    });
    deps.connectionChatRepository.listMessages.mockReturnValue([
      { id: "m1", authorType: "dashboard_user", bodyMarkdown: "historic prompt" },
      { id: "msg-5", authorType: "dashboard_user", bodyMarkdown: "next question" },
    ]);
    deps.executionRepository.createExecutionInvocation.mockReturnValue({ id: "exec-summary-replay" });
    deps.chatManagementActionService.processManagementAction.mockResolvedValue({ replyMarkdown: "reply", action: null, approvalRequired: false });

    await service.postMessage("p1", { bodyMarkdown: "next question" });

    expect(deps.chatManagementActionService.processManagementAction).toHaveBeenCalledWith(expect.objectContaining({
      prompt: expect.stringContaining("## COMPACTED HISTORY"),
    }));
    expect(deps.chatManagementActionService.processManagementAction).toHaveBeenCalledWith(expect.objectContaining({
      prompt: expect.stringContaining("## Current Objective\nKeep context"),
    }));
    expect(deps.chatManagementActionService.processManagementAction).toHaveBeenCalledWith(expect.objectContaining({
      prompt: expect.not.stringContaining("historic prompt"),
    }));
  });

  it("marks a dashboard message failed when virtual chat execution fails", async () => {
    deps.connectionChatRepository.postDashboardMessage.mockReturnValue({ id: "msg-fail", threadId: "t1", bodyMarkdown: "hello", deliveryStatus: "pending" });
    deps.connectionChatRepository.getThread.mockReturnValue({
      id: "t1",
      projectId: "p1",
      connectionId: null,
      runtimeState: { routeKind: "virtual", virtualProvider: "codex" },
    });
    deps.projectManagementRepository.getProject.mockReturnValue({ id: "p1", name: "proj", baseDir: "/tmp" });
    deps.taskService.resolveInvocationProvider.mockReturnValue({
      provider: "codex",
      providers: { codex: { model: "gpt-5.3-codex", apiKey: "codex-key" } },
    });
    deps.connectionChatRepository.listMessages.mockReturnValue([
      { id: "msg-fail", authorType: "dashboard_user", bodyMarkdown: "hello" },
    ]);
    deps.chatManagementActionService.processManagementAction.mockRejectedValue(new Error("provider timeout"));

    const message = await service.postMessage("p1", { bodyMarkdown: "hello" });

    expect(message.deliveryStatus).toBe("failed");
    expect(deps.connectionChatRepository.markDashboardMessagesFailed).toHaveBeenCalledWith("t1", {
      upToMessageId: "msg-fail",
    });
    expect(deps.connectionChatRepository.postSystemMessage).toHaveBeenCalledWith("p1", expect.objectContaining({
      threadId: "t1",
      bodyMarkdown: "Worker execution failed: provider timeout",
    }));
  });
});
