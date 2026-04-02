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
        listThreads: vi.fn(),
        updateThread: vi.fn(),
        listMessages: vi.fn(),
        markDashboardMessagesProcessed: vi.fn(),
        postSystemMessage: vi.fn(),
      },
      projectWorkerAssignmentRepository: {
        listAssignmentsForProject: vi.fn().mockReturnValue([]),
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
      providerTextInvocationService: {
        runProviderForText: vi.fn(),
      },
    };
    service = new ChatThreadRuntimeService(deps);
  });

  it("binds to an active live worker assignment if available", async () => {
    deps.projectWorkerAssignmentRepository.listAssignmentsForProject.mockReturnValue([
      { assignmentRole: "primary", capabilities: { canSuperviseProjects: true }, workerStatus: "online", connectionId: "live-conn-1" },
    ]);
    deps.connectionChatRepository.postDashboardMessage.mockReturnValue({ id: "msg-1", threadId: "t1", bodyMarkdown: "hello" });
    deps.connectionChatRepository.listThreads.mockReturnValue([{ id: "t1", connectionId: null }]);
    deps.projectManagementRepository.getProject.mockReturnValue({ id: "p1", name: "proj" });

    await service.postMessage("p1", { bodyMarkdown: "hello" });

    expect(deps.connectionChatRepository.updateThread).toHaveBeenCalledWith("t1", { connectionId: "live-conn-1" });
    expect(deps.providerTextInvocationService.runProviderForText).not.toHaveBeenCalled();
  });

  it("runs virtual provider and replays history on provider switch", async () => {
    deps.connectionChatRepository.postDashboardMessage.mockReturnValue({ id: "msg-2", threadId: "t1", bodyMarkdown: "hello" });
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
    deps.providerTextInvocationService.runProviderForText.mockResolvedValue({ text: "im a bot", nativeSessionId: "new-session" });

    await service.postMessage("p1", { bodyMarkdown: "hello" });

    expect(deps.providerTextInvocationService.runProviderForText).toHaveBeenCalledWith(
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
    expect(deps.connectionChatRepository.markDashboardMessagesProcessed).toHaveBeenCalledWith("t1", {
      upToMessageId: "msg-2",
    });
  });

  it("continues with continueSessionId if same provider", async () => {
    deps.connectionChatRepository.postDashboardMessage.mockReturnValue({ id: "msg-3", threadId: "t1", bodyMarkdown: "hello" });
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
    deps.providerTextInvocationService.runProviderForText.mockResolvedValue({ text: "next", nativeSessionId: "existing-session" });

    await service.postMessage("p1", { bodyMarkdown: "hello" });

    expect(deps.providerTextInvocationService.runProviderForText).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "claude-code",
        continueSessionId: "existing-session",
      })
    );
  });

  it("honors an explicitly routed virtual provider before falling back to global routing", async () => {
    deps.connectionChatRepository.postDashboardMessage.mockReturnValue({ id: "msg-4", threadId: "t1", bodyMarkdown: "hello" });
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
    deps.providerTextInvocationService.runProviderForText.mockResolvedValue({ text: "codex reply", nativeSessionId: "codex-session" });

    await service.postMessage("p1", { bodyMarkdown: "hello" });

    expect(deps.providerTextInvocationService.runProviderForText).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "codex",
        model: "gpt-5.3-codex",
        apiKey: "codex-key",
      })
    );
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
      providers: { "claude-code": { model: "claude-3", apiKey: "key", thinkingMode: "HIGH" } },
    });
    deps.agentPresetSyncService.getWorkerAgent.mockResolvedValue({ instructionMarkdown: "" });
    deps.providerTextInvocationService.runProviderForText.mockResolvedValue({ text: "## Current Objective\nKeep context", nativeSessionId: "ignored" });
    deps.connectionChatRepository.updateThread.mockImplementation((threadId: string, input: any) => ({
      id: threadId,
      projectId: "p1",
      title: "Thread",
      runtimeState: input.runtimeState,
    }));

    const updated = await service.compactThreadSession("t1");

    expect(deps.providerTextInvocationService.runProviderForText).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "p1",
      type: "chat_compaction",
      provider: "claude-code",
      model: "claude-3",
      continueSessionId: null,
      sessionId: "t1:compaction",
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

  it("compacts a connected worker thread through a hidden worker inbox request", async () => {
    let requestId = "";
    deps.projectWorkerAssignmentRepository.listAssignmentsForProject.mockReturnValue([
      {
        assignmentRole: "primary",
        capabilities: { canSuperviseProjects: true },
        workerStatus: "online",
        connectionId: "conn-1",
        workerEndpointId: "conn-1",
      },
    ]);
    deps.connectionChatRepository.getThread.mockReturnValue({
      id: "t1",
      projectId: "p1",
      title: "Thread",
      connectionId: "conn-1",
      runtimeState: {
        routeKind: "worker",
        workerEndpointId: "conn-1",
        sessionIds: ["worker-session"],
      },
    });
    deps.connectionChatRepository.listMessages.mockImplementation((_threadId: string, options?: { includeHidden?: boolean }) => {
      if (options?.includeHidden) {
        return [
          { id: "m1", authorType: "dashboard_user", bodyMarkdown: "hello" },
          { id: "m2", authorType: "connection", bodyMarkdown: "world" },
          {
            id: "m-hidden-result",
            authorType: "connection",
            bodyMarkdown: "## Current Objective\nKeep context",
            metadata: {
              internalOperation: "thread_compaction_result",
              requestId,
              provider: "gemini",
              model: "gemini-2.5-pro",
              generatedAt: "2026-03-28T05:00:00.000Z",
            },
          },
        ];
      }
      return [
        { id: "m1", authorType: "dashboard_user", bodyMarkdown: "hello" },
        { id: "m2", authorType: "connection", bodyMarkdown: "world" },
      ];
    });
    deps.projectManagementRepository.getProject.mockReturnValue({ id: "p1", name: "proj", baseDir: "/tmp" });
    deps.connectionChatRepository.postDashboardMessage.mockImplementation((_projectId: string, input: any) => {
      requestId = input.metadata.requestId;
      return {
        id: "m-hidden-request",
        threadId: input.threadId,
        bodyMarkdown: input.bodyMarkdown,
        metadata: input.metadata,
      };
    });
    deps.connectionChatRepository.updateThread.mockImplementation((threadId: string, input: any) => ({
      id: threadId,
      projectId: "p1",
      title: "Thread",
      connectionId: input.connectionId ?? "conn-1",
      runtimeState: input.runtimeState,
    }));

    const updated = await service.compactThreadSession("t1");

    expect(deps.connectionChatRepository.postDashboardMessage).toHaveBeenCalledWith("p1", expect.objectContaining({
      threadId: "t1",
      connectionId: "conn-1",
      metadata: expect.objectContaining({
        internalVisibility: "hidden",
        internalOperation: "thread_compaction_request",
      }),
    }));
    expect(updated.runtimeState).toMatchObject({
      routeKind: "worker",
      workerEndpointId: "conn-1",
      replayRequired: true,
      sessionIds: [],
      compactionSummary: {
        markdown: "## Current Objective\nKeep context",
        provider: "gemini",
        model: "gemini-2.5-pro",
        sourceMessageId: "m2",
        sourceMessageCount: 2,
      },
    });
  });

  it("replays from the stored compaction summary on the next fresh virtual turn", async () => {
    deps.connectionChatRepository.postDashboardMessage.mockReturnValue({ id: "msg-5", threadId: "t1", bodyMarkdown: "next question" });
    deps.connectionChatRepository.listThreads.mockReturnValue([{
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
    }]);
    deps.projectManagementRepository.getProject.mockReturnValue({ id: "p1", name: "proj", baseDir: "/tmp" });
    deps.taskService.resolveInvocationProvider.mockReturnValue({
      provider: "claude-code",
      providers: { "claude-code": { model: "claude-3", apiKey: "key", thinkingMode: "HIGH" } },
    });
    deps.connectionChatRepository.listMessages.mockReturnValue([
      { id: "m1", authorType: "dashboard_user", bodyMarkdown: "historic prompt" },
      { id: "msg-5", authorType: "dashboard_user", bodyMarkdown: "next question" },
    ]);
    deps.providerTextInvocationService.runProviderForText.mockResolvedValue({ text: "reply", nativeSessionId: "fresh-session" });

    await service.postMessage("p1", { bodyMarkdown: "next question" });

    expect(deps.providerTextInvocationService.runProviderForText).toHaveBeenCalledWith(expect.objectContaining({
      prompt: expect.stringContaining("## COMPACTED HISTORY"),
    }));
    expect(deps.providerTextInvocationService.runProviderForText).toHaveBeenCalledWith(expect.objectContaining({
      prompt: expect.stringContaining("## Current Objective\nKeep context"),
    }));
    expect(deps.providerTextInvocationService.runProviderForText).toHaveBeenCalledWith(expect.objectContaining({
      prompt: expect.not.stringContaining("historic prompt"),
    }));
  });
});
