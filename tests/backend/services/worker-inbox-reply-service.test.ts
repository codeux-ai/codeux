import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkerInboxReplyService } from "../../../src/services/worker-inbox-reply-service.js";


describe("WorkerInboxReplyService", () => {
  const mockRunProviderForText = vi.fn();
  const settings = {
    aiProvider: {
      invocationRouting: {},
      providers: {
        jules: { enabled: true, model: "default", weight: 0, thinkingMode: "MEDIUM", apiKey: "" },
        gemini: { enabled: true, model: "gemini-2.5-pro", weight: 10, thinkingMode: "SMALL", apiKey: "g-key" },
        codex: { enabled: true, model: "gpt-5.3-codex", weight: 10, thinkingMode: "HIGH", apiKey: "o-key" },
        "claude-code": { enabled: false, model: "default", weight: 0, thinkingMode: "MEDIUM", apiKey: "" },
      },
    },
  } as any;
  const geminiRoute = {
    provider: "gemini",
    providers: settings.aiProvider.providers,
    enabledProviders: ["gemini"],
    strategy: "MANUAL",
    manualProvider: "gemini",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockRunProviderForText.mockReset();
  });

  it("generates a markdown reply with worker agent context", async () => {
    mockRunProviderForText.mockResolvedValue({ text: "Current status: one task is running." });

    const service = new WorkerInboxReplyService({
      projectManagementRepository: {
        getProject: vi.fn().mockReturnValue({
          id: "project-1",
          name: "Sprint OS",
          baseDir: "/repo",
        }),
      } as any,
      connectionChatRepository: {
        getThread: vi.fn().mockReturnValue({ id: "thread-1", title: "Status", runtimeState: null }),
        listMessages: vi.fn().mockReturnValue([
          { id: "m1", authorType: "dashboard_user", bodyMarkdown: "What is the current worker status?" },
        ]),
      } as any,
      taskService: {
        resolveInvocationProvider: vi.fn().mockReturnValue(geminiRoute),
      } as any,
      agentPresetSyncService: {
        getWorkerAgent: vi.fn().mockResolvedValue({
          instructionMarkdown: "Always answer with operational clarity.",
        }),
        getProjectManagerAgent: vi.fn().mockResolvedValue({
          instructionMarkdown: "Coordinate the sprint and answer blocked clarifications directly.",
        }),
      } as any,
      executionRepository: {
        createExecutionInvocation: vi.fn().mockReturnValue({ id: "exec-inv-1" }),
        appendExecutionInvocationMessage: vi.fn(),
        updateExecutionInvocation: vi.fn(),
      } as any,
      getDashboardSettings: () => settings,
      getGithubToken: () => "gh-token",
      providerRunner: { runProviderForText: mockRunProviderForText } as any,
    });

    const result = await service.generateReply({
      projectId: "project-1",
      threadId: "thread-1",
      threadTitle: "Status",
      bodyMarkdown: "What is the current worker status?",
    });

    expect(result.bodyMarkdown).toBe("Current status: one task is running.");
    expect((service as any).deps.executionRepository.createExecutionInvocation).toHaveBeenCalled();
    expect((service as any).deps.executionRepository.appendExecutionInvocationMessage).toHaveBeenCalledWith("exec-inv-1", {
      role: "user",
      contentMarkdown: expect.stringContaining("What is the current worker status?"),
    });
    expect((service as any).deps.executionRepository.appendExecutionInvocationMessage).toHaveBeenCalledWith("exec-inv-1", {
      role: "assistant",
      contentMarkdown: "Current status: one task is running.",
    });
    expect(result.provider).toBe("gemini");
    expect(mockRunProviderForText).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "gemini",
        cwd: "/repo",
        apiKey: "g-key",
        model: "gemini-2.5-pro",
        githubToken: "gh-token",
      })
    );
  });

  it("includes the editable worker agent instructions in the reply prompt", async () => {
    mockRunProviderForText.mockResolvedValue({ text: "Use the worker queue view in Live." });

    const service = new WorkerInboxReplyService({
      projectManagementRepository: {
        getProject: vi.fn().mockReturnValue({
          id: "project-1",
          name: "Sprint OS",
          baseDir: "/repo",
        }),
      } as any,
      connectionChatRepository: {
        getThread: vi.fn().mockReturnValue({ id: "thread-1", title: "Thread", runtimeState: null }),
        listMessages: vi.fn().mockReturnValue([
          { id: "m1", authorType: "dashboard_user", bodyMarkdown: "How do I inspect the queue?" },
        ]),
      } as any,
      taskService: {
        resolveInvocationProvider: vi.fn().mockReturnValue(geminiRoute),
      } as any,
      agentPresetSyncService: {
        getWorkerAgent: vi.fn().mockResolvedValue({
          instructionMarkdown: "Worker guide fallback",
        }),
        getProjectManagerAgent: vi.fn().mockResolvedValue({
          instructionMarkdown: "Coordinate the sprint and answer blocked clarifications directly.",
        }),
      } as any,
      executionRepository: {
        createExecutionInvocation: vi.fn().mockReturnValue({ id: "exec-inv-2" }),
        appendExecutionInvocationMessage: vi.fn(),
        updateExecutionInvocation: vi.fn(),
      } as any,
      getDashboardSettings: () => settings,
      getGithubToken: () => undefined,
      providerRunner: { runProviderForText: mockRunProviderForText } as any,
    });

    const result = await service.generateReply({
      projectId: "project-1",
      threadId: "thread-1",
      bodyMarkdown: "How do I inspect the queue?",
    });

    expect(result.bodyMarkdown).toContain("worker queue");
  });

  it("unwraps provider response envelopes for dashboard replies", async () => {
    mockRunProviderForText.mockResolvedValue({ text: JSON.stringify({
        session_id: "b0536833-b397-4d12-b39d-b8818bcf5e12",
        response: "Only the markdown reply body.",
        stats: { models: {} },
      }) });

    const service = new WorkerInboxReplyService({
      projectManagementRepository: {
        getProject: vi.fn().mockReturnValue({
          id: "project-1",
          name: "Sprint OS",
          baseDir: "/repo",
        }),
      } as any,
      connectionChatRepository: {
        getThread: vi.fn().mockReturnValue({ id: "thread-1", title: "Thread", runtimeState: null }),
        listMessages: vi.fn().mockReturnValue([
          { id: "m1", authorType: "dashboard_user", bodyMarkdown: "Reply with the unblocker." },
        ]),
      } as any,
      taskService: {
        resolveInvocationProvider: vi.fn().mockReturnValue(geminiRoute),
      } as any,
      agentPresetSyncService: {
        getWorkerAgent: vi.fn().mockResolvedValue({
          instructionMarkdown: "Worker guide fallback",
        }),
        getProjectManagerAgent: vi.fn().mockResolvedValue({
          instructionMarkdown: "Coordinate the sprint and answer blocked clarifications directly.",
        }),
      } as any,
      executionRepository: {
        createExecutionInvocation: vi.fn().mockReturnValue({ id: "exec-inv-3" }),
        appendExecutionInvocationMessage: vi.fn(),
        updateExecutionInvocation: vi.fn(),
      } as any,
      getDashboardSettings: () => settings,
      getGithubToken: () => undefined,
      providerRunner: { runProviderForText: mockRunProviderForText } as any,
    });

    const result = await service.generateReply({
      projectId: "project-1",
      threadId: "thread-1",
      bodyMarkdown: "Reply with the unblocker.",
    });

    expect(result.bodyMarkdown).toBe("Only the markdown reply body.");
  });

  it("runs compact_thread mode as a chat compaction invocation without reply wrapping", async () => {
    mockRunProviderForText.mockResolvedValue({ text: "## Current Objective\nCompact summary" });

    const service = new WorkerInboxReplyService({
      projectManagementRepository: {
        getProject: vi.fn().mockReturnValue({
          id: "project-1",
          name: "Sprint OS",
          baseDir: "/repo",
        }),
      } as any,
      connectionChatRepository: {
        getThread: vi.fn().mockReturnValue({ id: "thread-1", title: "Thread", runtimeState: null }),
        listMessages: vi.fn().mockReturnValue([
          { id: "m1", authorType: "dashboard_user", bodyMarkdown: "## ROLE\nCompact this thread." },
        ]),
      } as any,
      taskService: {
        resolveInvocationProvider: vi.fn().mockReturnValue(geminiRoute),
      } as any,
      agentPresetSyncService: {
        getWorkerAgent: vi.fn().mockResolvedValue({
          instructionMarkdown: "Worker guide fallback",
        }),
        getProjectManagerAgent: vi.fn().mockResolvedValue({
          instructionMarkdown: "Project manager guide fallback",
        }),
      } as any,
      executionRepository: {
        createExecutionInvocation: vi.fn().mockReturnValue({ id: "exec-inv-compact" }),
        appendExecutionInvocationMessage: vi.fn(),
        updateExecutionInvocation: vi.fn(),
      } as any,
      getDashboardSettings: () => settings,
      getGithubToken: () => undefined,
      providerRunner: { runProviderForText: mockRunProviderForText } as any,
    });

    const result = await service.generateReply({
      projectId: "project-1",
      threadId: "thread-1",
      bodyMarkdown: "## ROLE\nCompact this thread.",
      mode: "compact_thread",
    });

    expect(result.bodyMarkdown).toBe("## Current Objective\nCompact summary");
    expect((service as any).deps.executionRepository.createExecutionInvocation).toHaveBeenCalledWith(expect.objectContaining({
      type: "chat_compaction",
    }));
    expect(mockRunProviderForText).toHaveBeenCalledWith(expect.objectContaining({
      prompt: expect.stringContaining("## ROLE\nCompact this thread."),
    }));
    expect((service as any).deps.executionRepository.appendExecutionInvocationMessage).toHaveBeenCalledWith("exec-inv-compact", {
      role: "user",
      contentMarkdown: "## ROLE\nCompact this thread.",
    });
  });

  it("replays connected worker replies from the stored compaction summary", async () => {
    mockRunProviderForText.mockResolvedValue({ text: "Use the compact handoff." });

    const service = new WorkerInboxReplyService({
      projectManagementRepository: {
        getProject: vi.fn().mockReturnValue({
          id: "project-1",
          name: "Sprint OS",
          baseDir: "/repo",
        }),
      } as any,
      connectionChatRepository: {
        getThread: vi.fn().mockReturnValue({
          id: "thread-1",
          title: "Thread",
          runtimeState: {
            compactionSummary: {
              markdown: "## Current Objective\nKeep context",
              generatedAt: "2026-03-28T05:00:00.000Z",
              provider: "gemini",
              model: "gemini-2.5-pro",
              sourceMessageId: "m1",
              sourceMessageCount: 1,
            },
          },
        }),
        listMessages: vi.fn().mockReturnValue([
          { id: "m1", authorType: "dashboard_user", bodyMarkdown: "Historic request" },
          { id: "m2", authorType: "dashboard_user", bodyMarkdown: "Latest request" },
        ]),
      } as any,
      taskService: {
        resolveInvocationProvider: vi.fn().mockReturnValue(geminiRoute),
      } as any,
      agentPresetSyncService: {
        getWorkerAgent: vi.fn().mockResolvedValue({
          instructionMarkdown: "Worker guide fallback",
        }),
        getProjectManagerAgent: vi.fn().mockResolvedValue({
          instructionMarkdown: "Project manager guide fallback",
        }),
      } as any,
      executionRepository: {
        createExecutionInvocation: vi.fn().mockReturnValue({ id: "exec-inv-summary" }),
        appendExecutionInvocationMessage: vi.fn(),
        updateExecutionInvocation: vi.fn(),
      } as any,
      getDashboardSettings: () => settings,
      getGithubToken: () => undefined,
      providerRunner: { runProviderForText: mockRunProviderForText } as any,
    });

    await service.generateReply({
      projectId: "project-1",
      threadId: "thread-1",
      bodyMarkdown: "Latest request",
    });

    expect(mockRunProviderForText).toHaveBeenCalledWith(expect.objectContaining({
      prompt: expect.stringContaining("## COMPACTED HISTORY"),
    }));
    expect(mockRunProviderForText).toHaveBeenCalledWith(expect.objectContaining({
      prompt: expect.stringContaining("## Current Objective\nKeep context"),
    }));
    expect(mockRunProviderForText).toHaveBeenCalledWith(expect.objectContaining({
      prompt: expect.stringContaining("Latest request"),
    }));
    expect(mockRunProviderForText).toHaveBeenCalledWith(expect.objectContaining({
      prompt: expect.not.stringContaining("Historic request"),
    }));
  });

  it("builds clarification replies from the editable project manager agent and the latest Jules request", async () => {
    mockRunProviderForText.mockResolvedValue({ text: JSON.stringify({
        session_id: "b0536833-b397-4d12-b39d-b8818bcf5e12",
        response: "Only the clarification answer.",
        stats: { models: {} },
      }) });

    const service = new WorkerInboxReplyService({
      projectManagementRepository: {
        getProject: vi.fn().mockReturnValue({
          id: "project-1",
          name: "Sprint OS",
          baseDir: "/repo",
        }),
      } as any,
      connectionChatRepository: {
        getThread: vi.fn(),
        listMessages: vi.fn(),
      } as any,
      taskService: {
        resolveInvocationProvider: vi.fn().mockReturnValue(geminiRoute),
      } as any,
      agentPresetSyncService: {
        getProjectManagerAgent: vi.fn().mockResolvedValue({
          instructionMarkdown: "Project manager guide fallback",
        }),
      } as any,
      executionRepository: {
        createExecutionInvocation: vi.fn().mockReturnValue({ id: "exec-inv-4" }),
        appendExecutionInvocationMessage: vi.fn(),
        updateExecutionInvocation: vi.fn(),
      } as any,
      getDashboardSettings: () => settings,
      getGithubToken: () => undefined,
      providerRunner: { runProviderForText: mockRunProviderForText } as any,
    });

    const result = await service.generateClarificationReply({
      projectId: "project-1",
      sprintGoal: "Ship the fix",
      subtasks: [{
        record_id: "task-123",
        id: "T1",
        title: "Fix clarification handling",
        prompt: "Repair the Jules clarification flow.",
        depends_on: [],
        is_independent: true,
        status: "BLOCKED",
        session_state: "AWAITING_USER_FEEDBACK",
        activities: [
          {
            agentMessaged: {
              agentMessage: "Should I preserve the current session semantics or replace them?",
            },
          },
        ],
      }],
      task: {
        record_id: "task-123",
        id: "T1",
        title: "Fix clarification handling",
        prompt: "Repair the Jules clarification flow.",
        depends_on: [],
        is_independent: true,
        status: "BLOCKED",
        session_state: "AWAITING_USER_FEEDBACK",
        activities: [
          {
            agentMessaged: {
              agentMessage: "Should I preserve the current session semantics or replace them?",
            },
          },
        ],
      },
    });

    expect(result).toBe("Only the clarification answer.");
    expect((service as any).deps.executionRepository.createExecutionInvocation).toHaveBeenCalled();
    expect((service as any).deps.executionRepository.appendExecutionInvocationMessage).toHaveBeenCalledWith("exec-inv-4", {
      role: "user",
      contentMarkdown: expect.stringContaining("Repair the Jules clarification flow."),
    });
    expect((service as any).deps.executionRepository.appendExecutionInvocationMessage).toHaveBeenCalledWith("exec-inv-4", {
      role: "user",
      contentMarkdown: expect.stringContaining("## PROJECT MANAGER INSTRUCTIONS"),
    });
    expect((service as any).deps.executionRepository.appendExecutionInvocationMessage).toHaveBeenCalledWith("exec-inv-4", {
      role: "user",
      contentMarkdown: expect.stringContaining("Project manager guide fallback"),
    });
    expect((service as any).deps.executionRepository.appendExecutionInvocationMessage).toHaveBeenCalledWith("exec-inv-4", {
      role: "user",
      contentMarkdown: expect.stringContaining("## JULES CLARIFICATION REQUEST"),
    });
    expect((service as any).deps.executionRepository.appendExecutionInvocationMessage).toHaveBeenCalledWith("exec-inv-4", {
      role: "user",
      contentMarkdown: expect.stringContaining("Should I preserve the current session semantics or replace them?"),
    });
    expect((service as any).deps.executionRepository.appendExecutionInvocationMessage).not.toHaveBeenCalledWith("exec-inv-4", {
      role: "user",
      contentMarkdown: expect.stringContaining("## WORKER INSTRUCTIONS"),
    });
    expect((service as any).deps.executionRepository.appendExecutionInvocationMessage).toHaveBeenCalledWith("exec-inv-4", {
      role: "assistant",
      contentMarkdown: "Only the clarification answer.",
    });
    expect((service as any).deps.executionRepository.createExecutionInvocation).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-1",
        taskId: "task-123",
        type: "worker_reply",
      }),
    );
  });

  it("falls back to the latest activity summary when Jules did not emit an explicit clarification message", async () => {
    mockRunProviderForText.mockResolvedValue({ text: "Use the persisted session semantics." });

    const appendMessage = vi.fn();
    const service = new WorkerInboxReplyService({
      projectManagementRepository: {
        getProject: vi.fn().mockReturnValue({
          id: "project-1",
          name: "Sprint OS",
          baseDir: "/repo",
        }),
      } as any,
      connectionChatRepository: {
        getThread: vi.fn(),
        listMessages: vi.fn(),
      } as any,
      taskService: {
        resolveInvocationProvider: vi.fn().mockReturnValue(geminiRoute),
      } as any,
      agentPresetSyncService: {
        getProjectManagerAgent: vi.fn().mockResolvedValue({
          instructionMarkdown: "Project manager guide fallback",
        }),
      } as any,
      executionRepository: {
        createExecutionInvocation: vi.fn().mockReturnValue({ id: "exec-inv-5" }),
        appendExecutionInvocationMessage: appendMessage,
        updateExecutionInvocation: vi.fn(),
      } as any,
      getDashboardSettings: () => settings,
      getGithubToken: () => undefined,
      providerRunner: { runProviderForText: mockRunProviderForText } as any,
    });

    await service.generateClarificationReply({
      projectId: "project-1",
      sprintGoal: "Ship the fix",
      subtasks: [{
        id: "T1",
        title: "Fix clarification handling",
        prompt: "Repair the Jules clarification flow.",
        depends_on: [],
        is_independent: true,
        status: "BLOCKED",
        session_state: "AWAITING_USER_FEEDBACK",
        activities: [
          {
            description: "Jules is asking whether the new service should preserve session lineage.",
          },
        ],
      }],
      task: {
        id: "T1",
        title: "Fix clarification handling",
        prompt: "Repair the Jules clarification flow.",
        depends_on: [],
        is_independent: true,
        status: "BLOCKED",
        session_state: "AWAITING_USER_FEEDBACK",
        activities: [
          {
            description: "Jules is asking whether the new service should preserve session lineage.",
          },
        ],
      },
    });

    expect(appendMessage).toHaveBeenCalledWith("exec-inv-5", {
      role: "user",
      contentMarkdown: expect.stringContaining(
        "No explicit Jules clarification message was captured. Latest related activity summary: Jules is asking whether the new service should preserve session lineage.",
      ),
    });
  });
});
