import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { ChatThreadRuntimeService } from "../../../src/services/chat-thread-runtime-service.js";
import { schedulerOnlyAgentMcpAccess } from "../../../src/services/agent-mcp-access.js";

describe("ChatThreadRuntimeService", () => {
  let deps: any;
  let service: ChatThreadRuntimeService;

  beforeEach(() => {
    deps = {
      connectionChatRepository: {
        postDashboardMessage: vi.fn(),
        getThread: vi.fn(),
        updateThread: vi.fn(),
        listMessages: vi.fn().mockReturnValue([]),
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
      chatProviderOutboundService: {
        deliverReply: vi.fn().mockResolvedValue(null),
      },
    };
    service = new ChatThreadRuntimeService(deps);
  });

  it("cancels an in-flight turn for the exact thread only", () => {
    const turnHandle = {
      abortController: new AbortController(),
      latestMessage: { id: "msg-live" },
    } as any;
    (service as any).inFlightTurns.set("t1", turnHandle);

    expect(service.cancelInFlightTurn("missing-thread")).toEqual({ cancelled: false });
    expect(service.cancelInFlightTurn("t1")).toEqual({ cancelled: true });
    expect(turnHandle.abortController.signal.aborted).toBe(true);
    expect(turnHandle.abortController.signal.reason).toBeInstanceOf(Error);
    expect((turnHandle.abortController.signal.reason as Error).message).toBe("Cancelled from the dashboard");
  });

  it("throws an error if thread is not found when posting a message", async () => {
    deps.connectionChatRepository.postDashboardMessage.mockReturnValue({ id: "msg-missing", threadId: "t-missing", bodyMarkdown: "hello" });
    deps.connectionChatRepository.getThread.mockReturnValue(undefined); // Simulate missing thread

    await expect(service.postMessage("p1", { bodyMarkdown: "hello" })).rejects.toThrow("Thread not found");
  });

  it("persists a new chat thread title to the project session-title file", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-chat-title-"));
    try {
      deps.connectionChatRepository.postDashboardMessage.mockReturnValue({ id: "msg-title", threadId: "t1", bodyMarkdown: "Please fix the dashboard route title behavior" });
      deps.connectionChatRepository.getThread.mockReturnValue({
        id: "t1",
        projectId: "p1",
        connectionId: null,
        title: "Please fix the dashboard route title behavior",
        runtimeState: {},
      });
      deps.projectManagementRepository.getProject.mockReturnValue({ id: "p1", name: "proj", baseDir: dir });
      deps.taskService.resolveInvocationProvider.mockReturnValue({
        provider: "codex",
        providers: { codex: { model: "gpt-5.3-codex", apiKey: "codex-key" } },
      });
      deps.connectionChatRepository.listMessages.mockReturnValue([
        { authorType: "dashboard_user", bodyMarkdown: "Please fix the dashboard route title behavior" },
      ]);
      deps.chatManagementActionService.processManagementAction.mockResolvedValue({ replyMarkdown: "reply", action: null, approvalRequired: false });

      await service.postMessage("p1", { bodyMarkdown: "Please fix the dashboard route title behavior" });

      await expect(fs.readFile(path.join(dir, ".code-ux", "conversations", "t1", "session-title.md"), "utf8"))
        .resolves.toBe("Please fix the dashboard route title behavior\n");
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
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

  it("suppresses rich widget prompt instructions and delivers persisted replies for chat-provider messages", async () => {
    const inboundMessage = {
      id: "msg-provider",
      threadId: "t-provider",
      bodyMarkdown: "status please",
      metadata: {
        source: "chat_provider",
        inboundDeliveryId: "delivery-in",
        suppressRichWidgets: true,
      },
    };
    const thread = {
      id: "t-provider",
      projectId: "p1",
      title: "External support",
      connectionId: null,
      runtimeState: {},
    };
    const replyMessage = {
      id: "reply-provider",
      threadId: "t-provider",
      bodyMarkdown: "Plain reply",
      metadata: null,
    };
    deps.connectionChatRepository.postDashboardMessage.mockReturnValue(inboundMessage);
    deps.connectionChatRepository.getThread.mockReturnValue(thread);
    deps.projectManagementRepository.getProject.mockReturnValue({ id: "p1", name: "proj", baseDir: "/tmp" });
    deps.taskService.resolveInvocationProvider.mockReturnValue({
      provider: "codex",
      providers: { codex: { model: "gpt-5.3-codex", apiKey: "codex-key" } },
    });
    deps.connectionChatRepository.listMessages.mockReturnValue([inboundMessage]);
    deps.connectionChatRepository.postSystemMessage.mockReturnValue(replyMessage);
    deps.chatManagementActionService.processManagementAction.mockResolvedValue({
      replyMarkdown: "Plain reply",
      action: null,
      approvalRequired: false,
    });

    await service.postMessage("p1", {
      bodyMarkdown: "status please",
      metadata: inboundMessage.metadata,
    });

    expect(deps.chatManagementActionService.processManagementAction).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.not.stringContaining("## RICH WIDGETS"),
      }),
    );
    expect(deps.chatManagementActionService.processManagementAction).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.not.stringContaining("codeux:status"),
      }),
    );
    expect(deps.chatProviderOutboundService.deliverReply).toHaveBeenCalledWith({
      projectId: "p1",
      thread,
      triggeringMessage: inboundMessage,
      replyMessage,
    });
  });

  it("uses scheduler-only Code UX access for the default dashboard reply agent", async () => {
    deps.getDashboardSettings.mockReturnValue({
      agents: { routing: { dashboardReply: { agentPresetId: null } } },
      cliWorkflow: {},
    });
    deps.agentPresetSyncService.resolveDashboardReplyAgent = vi.fn().mockResolvedValue({
      id: "reply-agent",
      instructionMarkdown: "",
    });
    deps.getMcpConnectionInfo = vi.fn().mockReturnValue({ url: "http://127.0.0.1:3000/mcp", authToken: "token" });
    deps.connectionChatRepository.postDashboardMessage.mockReturnValue({ id: "msg-scheduler", threadId: "t1", bodyMarkdown: "remind yourself tomorrow" });
    deps.connectionChatRepository.getThread.mockReturnValue({
      id: "t1",
      projectId: "p1",
      connectionId: null,
      runtimeState: {},
    });
    deps.projectManagementRepository.getProject.mockReturnValue({ id: "p1", name: "proj", baseDir: "/tmp" });
    deps.taskService.resolveInvocationProvider.mockReturnValue({
      provider: "codex",
      providers: { codex: { model: "gpt-5.3-codex", apiKey: "codex-key" } },
    });
    deps.connectionChatRepository.listMessages.mockReturnValue([
      { id: "msg-scheduler", authorType: "dashboard_user", bodyMarkdown: "remind yourself tomorrow" },
    ]);
    deps.chatManagementActionService.processManagementAction.mockResolvedValue({ replyMarkdown: "scheduled", action: null, approvalRequired: false });

    await service.postMessage("p1", { bodyMarkdown: "remind yourself tomorrow" });

    expect(deps.chatManagementActionService.processManagementAction).toHaveBeenCalledWith(
      expect.objectContaining({
        mcpConnection: { url: "http://127.0.0.1:3000/mcp", authToken: "token" },
        mcpAgentId: "reply-agent",
        agentMcpAccess: schedulerOnlyAgentMcpAccess(),
        prompt: expect.stringContaining("You have the `scheduler` MCP tool available"),
      }),
    );
    expect(deps.chatManagementActionService.processManagementAction).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.not.stringContaining("You have the `manage_code_ux` MCP tool available"),
      }),
    );
  });

  it("preserves explicit MCP access for a configured dashboard reply preset", async () => {
    const explicitAccess = {
      codeUxEnabled: true,
      codeUxToolToggles: [{ name: "manage_tasks", enabled: false, isInternal: true }],
      linkedServerIds: ["custom-docs"],
    };
    deps.getDashboardSettings.mockReturnValue({
      agents: { routing: { dashboardReply: { agentPresetId: "custom-reply" } } },
      cliWorkflow: {},
    });
    deps.agentPresetSyncService.resolveDashboardReplyAgent = vi.fn().mockResolvedValue({
      id: "custom-reply",
      instructionMarkdown: "",
      mcpAccess: explicitAccess,
    });
    deps.getMcpConnectionInfo = vi.fn().mockReturnValue({ url: "http://127.0.0.1:3000/mcp", authToken: "token" });
    deps.connectionChatRepository.postDashboardMessage.mockReturnValue({ id: "msg-explicit", threadId: "t1", bodyMarkdown: "list tasks" });
    deps.connectionChatRepository.getThread.mockReturnValue({
      id: "t1",
      projectId: "p1",
      connectionId: null,
      runtimeState: {},
    });
    deps.projectManagementRepository.getProject.mockReturnValue({ id: "p1", name: "proj", baseDir: "/tmp" });
    deps.taskService.resolveInvocationProvider.mockReturnValue({
      provider: "codex",
      providers: { codex: { model: "gpt-5.3-codex", apiKey: "codex-key" } },
    });
    deps.connectionChatRepository.listMessages.mockReturnValue([
      { id: "msg-explicit", authorType: "dashboard_user", bodyMarkdown: "list tasks" },
    ]);
    deps.chatManagementActionService.processManagementAction.mockResolvedValue({ replyMarkdown: "reply", action: null, approvalRequired: false });

    await service.postMessage("p1", { bodyMarkdown: "list tasks" });

    expect(deps.chatManagementActionService.processManagementAction).toHaveBeenCalledWith(
      expect.objectContaining({
        mcpAgentId: "custom-reply",
        agentMcpAccess: explicitAccess,
        prompt: expect.stringContaining("You have the `manage_code_ux` MCP tool available"),
      }),
    );
  });

  it("passes a Docker snapshot checkout for dashboard chat replies", async () => {
    deps.getDashboardSettings.mockReturnValue({
      git: { defaultBranch: "release" },
      cliWorkflow: { executionMode: "DOCKER" },
    });
    deps.connectionChatRepository.postDashboardMessage.mockReturnValue({ id: "msg-checkout", threadId: "t1", bodyMarkdown: "hello" });
    deps.connectionChatRepository.getThread.mockReturnValue({
      id: "t1",
      connectionId: null,
      runtimeState: {},
    });
    deps.projectManagementRepository.getProject.mockReturnValue({
      id: "p1",
      name: "test project",
      baseDir: "/tmp/test-project",
      defaultBranch: "stable",
    });
    deps.taskService.resolveInvocationProvider.mockReturnValue({
      provider: "codex",
      providers: { codex: { model: "gpt-5.3-codex", apiKey: "codex-key" } },
    });
    deps.connectionChatRepository.listMessages.mockReturnValue([
      { authorType: "dashboard_user", bodyMarkdown: "hello" },
    ]);
    deps.chatManagementActionService.processManagementAction.mockResolvedValue({
      replyMarkdown: "reply",
      action: null,
      approvalRequired: false,
    });

    await service.postMessage("p1", { bodyMarkdown: "hello" });

    expect(deps.chatManagementActionService.processManagementAction).toHaveBeenCalledWith(
      expect.objectContaining({
        repoPath: "/tmp/test-project",
        settings: expect.objectContaining({
          cliWorkflow: expect.objectContaining({ executionMode: "DOCKER" }),
        }),
        snapshotCheckout: { branch: "stable" },
      }),
    );
  });

  it("folds a provider instance's customModel into the executed model so local-redirect instances do not hit the real subscription", async () => {
    deps.connectionChatRepository.postDashboardMessage.mockReturnValue({ id: "msg-cm", threadId: "t1", bodyMarkdown: "hello" });
    deps.connectionChatRepository.getThread.mockReturnValue({
      id: "t1",
      connectionId: null,
      runtimeState: {},
    });
    deps.projectManagementRepository.getProject.mockReturnValue({ id: "p1", name: "proj", baseDir: "/tmp" });
    // "Claude Local"-style instance: model stays "default" but a customModel/customBaseUrl
    // redirect points it at a local LM server. The runner keys off `model`, so the route's
    // customModel must be folded into the executed model — otherwise it runs as the default
    // (real) Claude model.
    deps.taskService.resolveInvocationProvider.mockReturnValue({
      provider: "claude-code",
      providerConfigId: "claude-code-local",
      providers: {
        "claude-code-local": {
          provider: "claude-code",
          model: "default",
          apiKey: "sk-lm-key",
          thinkingMode: "HIGH",
          mountAuth: false,
          authPath: "~/.claude",
          customBaseUrl: "http://192.168.0.38:1234",
          customModel: "google/gemma-4-26b-a4b-qat",
        },
      },
    });
    deps.connectionChatRepository.listMessages.mockReturnValue([]);
    deps.executionRepository.createExecutionInvocation.mockReturnValue({ id: "exec-cm" });
    deps.chatManagementActionService.processManagementAction.mockResolvedValue({ replyMarkdown: "local reply", action: null, approvalRequired: false });

    await service.postMessage("p1", { bodyMarkdown: "hello" });

    expect(deps.chatManagementActionService.processManagementAction).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "claude-code",
        model: "google/gemma-4-26b-a4b-qat",
        customModel: "google/gemma-4-26b-a4b-qat",
        customBaseUrl: "http://192.168.0.38:1234",
      })
    );
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

  it("compacts a virtual thread natively and preserves the active session", async () => {
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
    deps.providerRunner.runProviderForText.mockResolvedValue({ text: "## Current Objective\nKeep context", nativeSessionId: "session-1" });
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
      continueSessionId: "session-1",
      nativeSessionOperation: "compact",
      sessionId: "t1",
      workspaceSessionId: "t1",
      providerMountAuth: true,
      providerAuthPath: "~/.claude",
    }));
    expect(JSON.stringify(deps.providerRunner.runProviderForText.mock.calls)).not.toContain("t1:compaction");
    expect(updated.runtimeState).toMatchObject({
      routeKind: "virtual",
      virtualProvider: "claude-code",
      modelLabel: "claude-3",
      replayRequired: false,
      sessionIds: ["session-1"],
      compactionSummary: {
        markdown: "## Current Objective\nKeep context",
        provider: "claude-code",
        model: "claude-3",
        sourceMessageId: "m2",
        sourceMessageCount: 2,
        nativeSessionId: "session-1",
      },
    });
  });

  it("uses the thread logical session for native compaction when no native session is stored and preserves the resolved session", async () => {
    deps.connectionChatRepository.getThread.mockReturnValue({
      id: "t1",
      projectId: "p1",
      title: "Thread",
      connectionId: null,
      runtimeState: {
        routeKind: "virtual",
        virtualProvider: "qwen-code",
        sessionIds: [],
        replayRequired: true,
      },
    });
    deps.connectionChatRepository.listMessages.mockReturnValue([
      { id: "m1", authorType: "dashboard_user", bodyMarkdown: "hello" },
    ]);
    deps.projectManagementRepository.getProject.mockReturnValue({ id: "p1", name: "proj", baseDir: "/tmp" });
    deps.taskService.resolveInvocationProvider.mockReturnValue({
      provider: "qwen-code",
      providers: {
        "qwen-code": {
          model: "qwen3-coder",
          apiKey: "key",
          qwenAuthMode: "MODEL_PROVIDER",
          qwenRegion: "international",
          qwenBaseUrl: "https://qwen.example.test",
          qwenEnvKey: "QWEN_KEY",
          qwenModelId: "qwen3-coder",
          qwenProtocol: "openai",
        },
      },
    });
    deps.executionRepository.createExecutionInvocation.mockReturnValue({ id: "exec-compact-fallback" });
    deps.providerRunner.runProviderForText.mockResolvedValue({
      text: "## Compact Summary\nContinue from here",
      nativeSessionId: "qwen-native-1",
    });
    deps.connectionChatRepository.updateThread.mockImplementation((threadId: string, input: any) => ({
      id: threadId,
      projectId: "p1",
      title: "Thread",
      runtimeState: input.runtimeState,
    }));

    const updated = await service.compactThreadSession("t1");

    expect(deps.providerRunner.runProviderForText).toHaveBeenCalledWith(expect.objectContaining({
      provider: "qwen-code",
      sessionId: "t1",
      workspaceSessionId: "t1",
      continueSessionId: "t1",
      nativeSessionOperation: "compact",
      qwenAuthMode: "MODEL_PROVIDER",
      qwenRegion: "international",
      qwenBaseUrl: "https://qwen.example.test",
      qwenEnvKey: "QWEN_KEY",
      qwenModelId: "qwen3-coder",
      qwenProtocol: "openai",
    }));
    expect(JSON.stringify(deps.providerRunner.runProviderForText.mock.calls)).not.toContain("t1:compaction");
    expect(updated.runtimeState).toMatchObject({
      routeKind: "virtual",
      virtualProvider: "qwen-code",
      modelLabel: "qwen3-coder",
      replayRequired: false,
      sessionIds: ["qwen-native-1"],
      compactionSummary: {
        markdown: "## Compact Summary\nContinue from here",
        provider: "qwen-code",
        model: "qwen3-coder",
        sourceMessageId: "m1",
        sourceMessageCount: 1,
        nativeSessionId: "qwen-native-1",
      },
    });
  });

  it("returns an actionable error instead of native compaction when a provider has no logical continuation fallback", async () => {
    deps.connectionChatRepository.getThread.mockReturnValue({
      id: "t1",
      projectId: "p1",
      title: "Thread",
      connectionId: null,
      runtimeState: {
        routeKind: "virtual",
        virtualProvider: "claude-code",
        sessionIds: [],
      },
    });
    deps.connectionChatRepository.listMessages.mockReturnValue([
      { id: "m1", authorType: "dashboard_user", bodyMarkdown: "hello" },
    ]);
    deps.projectManagementRepository.getProject.mockReturnValue({ id: "p1", name: "proj", baseDir: "/tmp" });
    deps.taskService.resolveInvocationProvider.mockReturnValue({
      provider: "claude-code",
      providers: { "claude-code": { model: "claude-3", apiKey: "key" } },
    });

    await expect(service.compactThreadSession("t1")).rejects.toThrow(
      "Native chat compaction for claude-code requires an active provider session. Send a message in this thread before compacting it.",
    );
    expect(deps.providerRunner.runProviderForText).not.toHaveBeenCalled();
    expect(deps.executionRepository.createExecutionInvocation).not.toHaveBeenCalled();
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
