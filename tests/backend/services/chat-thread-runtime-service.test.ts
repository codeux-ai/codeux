import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { ChatThreadRuntimeService } from "../../../src/services/chat-thread-runtime-service.js";
import { ProviderExecutionService } from "../../../src/services/provider-execution-service.js";
import { codeUxAgentMcpAccess, dashboardReplyAgentMcpAccess } from "../../../src/services/agent-mcp-access.js";
import { CREATE_APP_QUICKACTION_CATALOG } from "../../../src/domain/chat/create-app-quickaction-catalog.js";

describe("ChatThreadRuntimeService", () => {
  let deps: any;
  let service: ChatThreadRuntimeService;

  const providerTextResult = (text: string, nativeSessionId: string) => ({
    ok: true,
    stdout: text,
    stderr: "",
    exitCode: 0,
    text,
    nativeSessionId,
    usageTelemetry: {
      transcriptText: text,
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      reasoningOutputTokens: 0,
      totalTokens: 0,
      usageSource: "unknown",
      rawUsageJson: null,
    },
  });

  beforeEach(() => {
    deps = {
      connectionChatRepository: {
        postDashboardMessage: vi.fn(),
        getThread: vi.fn(),
        updateThread: vi.fn(),
        listMessages: vi.fn().mockReturnValue([]),
        getMessage: vi.fn(),
        markDashboardMessagesProcessed: vi.fn(),
        markDashboardMessagesFailed: vi.fn(),
        postSystemMessage: vi.fn(),
        updateMessageMetadata: vi.fn(),
      },
      projectWorkerAssignmentRepository: {
        listAssignmentsForProject: vi.fn().mockReturnValue([]),
      },
      executionRepository: {
        createExecutionInvocation: vi.fn(),
        appendExecutionInvocationMessage: vi.fn(),
        updateExecutionInvocation: vi.fn(),
        createProviderInvocationUsage: vi.fn().mockReturnValue({ id: "provider-invocation-1" }),
        updateProviderInvocationUsage: vi.fn(),
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
        getSprint: vi.fn(),
        listTasks: vi.fn().mockReturnValue([]),
        updateSprint: vi.fn(),
      },
      providerRunner: {
        runProvider: vi.fn(),
        runProviderForText: vi.fn(),
      },
      chatManagementActionService: {
        processManagementAction: vi.fn(),
        executeApprovedAction: vi.fn(),
      },
      chatProviderOutboundService: {
        deliverReply: vi.fn().mockResolvedValue(null),
      },
      getProjectInitializationState: vi.fn().mockResolvedValue({
        projectId: "p1",
        initializationMode: "new-local",
        repositoryState: "initial",
        canCreateInitialAppQuickactions: true,
      }),
    };
    deps.providerExecutionService = new ProviderExecutionService({
      providerRunner: deps.providerRunner,
      executionRepository: deps.executionRepository,
      getDashboardSettings: deps.getDashboardSettings,
      getGithubToken: deps.getGithubToken,
    });
    service = new ChatThreadRuntimeService(deps);
  });

  const configureSingleFlightThread = () => {
    const messages: any[] = [];
    const statusTransitions = new Map<string, number>();
    let messageCounter = 0;
    let replyCounter = 0;
    let runtimeState: any = {
      routeKind: "virtual",
      virtualProvider: "codex",
      modelLabel: "gpt-5.3-codex",
      sessionIds: ["native-session-1"],
      replayRequired: false,
    };
    const thread = () => ({
      id: "t1",
      projectId: "p1",
      connectionId: null,
      title: "Thread",
      runtimeState,
    });
    const transitionThrough = (messageId: string, deliveryStatus: "processed" | "failed") => {
      const targetIndex = messages.findIndex((message) => message.id === messageId);
      for (const [index, message] of messages.entries()) {
        if (
          index <= targetIndex
          && message.direction === "dashboard_to_connection"
          && message.deliveryStatus === "pending"
        ) {
          message.deliveryStatus = deliveryStatus;
          statusTransitions.set(message.id, (statusTransitions.get(message.id) ?? 0) + 1);
        }
      }
    };

    deps.connectionChatRepository.postDashboardMessage.mockImplementation((_projectId: string, input: any) => {
      messageCounter += 1;
      const message = {
        id: `msg-${messageCounter}`,
        threadId: "t1",
        direction: "dashboard_to_connection",
        authorType: "dashboard_user",
        authorConnectionId: null,
        bodyMarkdown: input.bodyMarkdown,
        deliveryStatus: "pending",
        metadata: input.metadata ?? null,
        createdAt: `2026-07-13T00:00:0${messageCounter}.000Z`,
      };
      messages.push(message);
      return message;
    });
    deps.connectionChatRepository.getThread.mockImplementation(thread);
    deps.connectionChatRepository.listMessages.mockImplementation(() => messages);
    deps.connectionChatRepository.markDashboardMessagesProcessed.mockImplementation((_threadId: string, options: any) => {
      transitionThrough(options.upToMessageId, "processed");
      return thread();
    });
    deps.connectionChatRepository.markDashboardMessagesFailed.mockImplementation((_threadId: string, options: any) => {
      transitionThrough(options.upToMessageId, "failed");
      return thread();
    });
    deps.connectionChatRepository.postSystemMessage.mockImplementation((_projectId: string, input: any) => {
      replyCounter += 1;
      const message = {
        id: `reply-${replyCounter}`,
        threadId: "t1",
        direction: "connection_to_dashboard",
        authorType: "system",
        authorConnectionId: null,
        bodyMarkdown: input.bodyMarkdown,
        deliveryStatus: "processed",
        metadata: input.metadata ?? null,
        createdAt: `2026-07-13T00:01:0${replyCounter}.000Z`,
      };
      messages.push(message);
      return message;
    });
    deps.connectionChatRepository.updateThread.mockImplementation((_threadId: string, input: any) => {
      runtimeState = input.runtimeState;
      return thread();
    });
    deps.projectManagementRepository.getProject.mockReturnValue({ id: "p1", name: "proj", baseDir: "/tmp" });
    deps.taskService.resolveInvocationProvider.mockReturnValue({
      provider: "codex",
      providers: { codex: { model: "gpt-5.3-codex", apiKey: "codex-key" } },
    });

    return { messages, statusTransitions };
  };

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

  it("queues and coalesces scheduled messages without aborting the active turn", async () => {
    const { messages, statusTransitions } = configureSingleFlightThread();
    let activeSignal: AbortSignal | null = null;
    let resolveActive!: (value: any) => void;
    deps.chatManagementActionService.processManagementAction
      .mockImplementationOnce((input: any) => {
        activeSignal = input.signal;
        return new Promise((resolve) => {
          resolveActive = resolve;
        });
      })
      .mockResolvedValueOnce({
        replyMarkdown: "Scheduled work completed.",
        action: null,
        approvalRequired: false,
        nativeSessionId: "native-session-1",
      });

    const activeTurn = service.postMessage("p1", { threadId: "t1", bodyMarkdown: "Active dashboard request." });
    await vi.waitFor(() => expect(deps.chatManagementActionService.processManagementAction).toHaveBeenCalledTimes(1));
    expect(service.isThreadBusy("t1")).toBe(true);

    await service.postMessage("p1", {
      threadId: "t1",
      bodyMarkdown: "First scheduled continuation.",
      metadata: { source: "agent_scheduler", origin: "agent_scheduler", schedulerEntryId: "entry-1" },
    });
    await service.postMessage("p1", {
      threadId: "t1",
      bodyMarkdown: "Second scheduled continuation.",
      metadata: { source: "agent_scheduler", origin: "agent_scheduler", schedulerEntryId: "entry-2" },
    });

    expect(activeSignal?.aborted).toBe(false);
    resolveActive({
      replyMarkdown: "Active work completed.",
      action: null,
      approvalRequired: false,
      nativeSessionId: "native-session-1",
    });
    await activeTurn;

    expect(service.isThreadBusy("t1")).toBe(false);
    expect(deps.chatManagementActionService.processManagementAction).toHaveBeenCalledTimes(2);
    const scheduledPrompt = deps.chatManagementActionService.processManagementAction.mock.calls[1]?.[0].prompt as string;
    expect(scheduledPrompt.indexOf("First scheduled continuation.")).toBeLessThan(
      scheduledPrompt.indexOf("Second scheduled continuation."),
    );
    expect(deps.connectionChatRepository.postSystemMessage).toHaveBeenCalledTimes(2);
    expect(messages.filter((message) => message.direction === "connection_to_dashboard")).toHaveLength(2);
    expect(messages.filter((message) => message.direction === "dashboard_to_connection").map((message) => message.deliveryStatus))
      .toEqual(["processed", "processed", "processed"]);
    expect([...statusTransitions.values()]).toEqual([1, 1, 1]);
  });

  it("does not replay or post a failure reply for an explicitly cancelled turn", async () => {
    const { messages, statusTransitions } = configureSingleFlightThread();
    deps.chatManagementActionService.processManagementAction.mockImplementation((input: any) => (
      new Promise((_resolve, reject) => {
        input.signal.addEventListener("abort", () => reject(input.signal.reason), { once: true });
      })
    ));

    const activeTurn = service.postMessage("p1", { threadId: "t1", bodyMarkdown: "Cancel this request." });
    await vi.waitFor(() => expect(deps.chatManagementActionService.processManagementAction).toHaveBeenCalledTimes(1));

    expect(service.cancelInFlightTurn("t1")).toEqual({ cancelled: true });
    const result = await activeTurn;

    expect(result.deliveryStatus).toBe("failed");
    expect(deps.chatManagementActionService.processManagementAction).toHaveBeenCalledTimes(1);
    expect(deps.connectionChatRepository.postSystemMessage).not.toHaveBeenCalled();
    expect(messages[0]?.deliveryStatus).toBe("failed");
    expect(statusTransitions.get("msg-1")).toBe(1);
  });

  it("retains ordinary user supersession and combines the pending messages once", async () => {
    const { messages, statusTransitions } = configureSingleFlightThread();
    deps.chatManagementActionService.processManagementAction
      .mockImplementationOnce((input: any) => (
        new Promise((_resolve, reject) => {
          input.signal.addEventListener("abort", () => reject(input.signal.reason), { once: true });
        })
      ))
      .mockResolvedValueOnce({
        replyMarkdown: "Combined reply.",
        action: null,
        approvalRequired: false,
        nativeSessionId: "native-session-1",
      });

    const owningTurn = service.postMessage("p1", { threadId: "t1", bodyMarkdown: "First user request." });
    await vi.waitFor(() => expect(deps.chatManagementActionService.processManagementAction).toHaveBeenCalledTimes(1));
    await service.postMessage("p1", { threadId: "t1", bodyMarkdown: "Newer user request." });
    await owningTurn;

    expect(deps.chatManagementActionService.processManagementAction).toHaveBeenCalledTimes(2);
    const combinedPrompt = deps.chatManagementActionService.processManagementAction.mock.calls[1]?.[0].prompt as string;
    expect(combinedPrompt.indexOf("First user request.")).toBeLessThan(combinedPrompt.indexOf("Newer user request."));
    expect(deps.connectionChatRepository.postSystemMessage).toHaveBeenCalledTimes(1);
    expect(messages.filter((message) => message.direction === "connection_to_dashboard")).toHaveLength(1);
    expect(messages.slice(0, 2).map((message) => message.deliveryStatus)).toEqual(["processed", "processed"]);
    expect([...statusTransitions.values()]).toEqual([1, 1]);
  });

  it("records a provider failure once without creating duplicate assistant replies", async () => {
    const { messages, statusTransitions } = configureSingleFlightThread();
    deps.chatManagementActionService.processManagementAction.mockRejectedValueOnce(new Error("provider unavailable"));

    const result = await service.postMessage("p1", { threadId: "t1", bodyMarkdown: "Run this once." });

    expect(result.deliveryStatus).toBe("failed");
    expect(deps.chatManagementActionService.processManagementAction).toHaveBeenCalledTimes(1);
    expect(deps.connectionChatRepository.markDashboardMessagesFailed).toHaveBeenCalledTimes(1);
    expect(deps.connectionChatRepository.postSystemMessage).toHaveBeenCalledTimes(1);
    expect(messages.filter((message) => message.direction === "connection_to_dashboard")).toHaveLength(1);
    expect(messages[0]?.deliveryStatus).toBe("failed");
    expect(statusTransitions.get("msg-1")).toBe(1);
  });

  it("accepts a scheduler tick during reply finalization as a new single flight", async () => {
    const { messages, statusTransitions } = configureSingleFlightThread();
    let tickCount = 0;
    deps.chatManagementActionService.processManagementAction
      .mockResolvedValueOnce({
        replyMarkdown: "Dashboard reply.",
        action: null,
        approvalRequired: false,
        nativeSessionId: "native-session-1",
      })
      .mockResolvedValueOnce({
        replyMarkdown: "Scheduled reply.",
        action: null,
        approvalRequired: false,
        nativeSessionId: "native-session-1",
      });
    deps.runDueSchedulerEntriesAfterReply = vi.fn(async () => {
      tickCount += 1;
      if (tickCount === 1) {
        await service.postMessage("p1", {
          threadId: "t1",
          bodyMarkdown: "Finalization wakeup.",
          metadata: { source: "agent_scheduler", origin: "agent_scheduler", schedulerEntryId: "entry-finalize" },
        });
      }
    });

    await service.postMessage("p1", { threadId: "t1", bodyMarkdown: "Finish this reply." });

    expect(deps.chatManagementActionService.processManagementAction).toHaveBeenCalledTimes(2);
    expect(deps.connectionChatRepository.postSystemMessage).toHaveBeenCalledTimes(2);
    expect(messages.filter((message) => message.direction === "connection_to_dashboard")).toHaveLength(2);
    expect(messages.filter((message) => message.direction === "dashboard_to_connection").map((message) => message.deliveryStatus))
      .toEqual(["processed", "processed"]);
    expect([...statusTransitions.values()]).toEqual([1, 1]);
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

  it("launches create-app quickactions as detached quicksprints and posts an app progress widget", async () => {
    const quickactionMetadata = {
      quickaction: {
        type: "create_app",
        kind: "web_app",
        requestId: "quickaction-web-1",
        templateId: "qs-create-web-app",
        designGuidance: {
          selectedTechStackId: "code-ux-product-stack",
          selectedStyleguideId: "code-ux-award-winning",
        },
        taskCount: 6,
        stackSummary: {
          techstackId: "preact-fullstack",
          techstackName: "Preact Fullstack",
          language: "TypeScript",
          framework: "Preact",
          runtime: "Node.js",
          packageManager: "pnpm",
          styling: "Tailwind",
          testFramework: "Vitest",
        },
        suggestionTags: ["auth", "dashboard"],
      },
    };
    const quicksprintLauncher = {
      launchDetachedQuicksprint: vi.fn().mockResolvedValue({
        sprint: {
          id: "sprint-web-1",
          name: "QS: Create Web App",
        },
        planningRequest: {
          projectId: "p1",
          sprintId: "sprint-web-1",
          templateId: "qs-create-web-app",
          submitMode: "plan_and_start",
          clientRequestId: "quickaction-web-1",
          planOptions: {
            autoStart: true,
            replan: false,
            clientRequestId: "quickaction-web-1",
          },
        },
        planningPromise: new Promise(() => undefined),
      }),
    };
    service.setQuicksprintLauncher(quicksprintLauncher);
    deps.connectionChatRepository.postDashboardMessage.mockReturnValue({
      id: "msg-app",
      threadId: "t-app",
      bodyMarkdown: "Create a web app for the selected project.",
      metadata: quickactionMetadata,
    });
    deps.connectionChatRepository.getThread.mockReturnValue({
      id: "t-app",
      projectId: "p1",
      connectionId: null,
      title: "Create a web app",
      runtimeState: {},
    });

    await service.postMessage("p1", {
      bodyMarkdown: "Create a web app for the selected project.",
      metadata: quickactionMetadata,
    });

    expect(quicksprintLauncher.launchDetachedQuicksprint).toHaveBeenCalledTimes(1);
    expect(quicksprintLauncher.launchDetachedQuicksprint).toHaveBeenCalledWith("p1", expect.objectContaining({
      templateId: "qs-create-web-app",
      taskCount: 6,
      submitMode: "plan_and_start",
      clientRequestId: "quickaction-web-1",
      planningOverrides: {
        designGuidance: {
          selectedTechStackId: "code-ux-product-stack",
          selectedStyleguideId: "code-ux-award-winning",
        },
      },
      additionalPrompt: expect.stringContaining("Create an app sprint for a web app."),
    }));
    const launchInput = quicksprintLauncher.launchDetachedQuicksprint.mock.calls[0][1];
    expect(launchInput.additionalPrompt).toContain("answer quickly");
    expect(launchInput.additionalPrompt).toContain("Invite directional follow-up");
    expect(launchInput.additionalPrompt).toContain("prepare for follow-up details to be appended after planning finishes");
    expect(launchInput.additionalPrompt).toContain("- Techstack: Preact Fullstack");
    expect(launchInput.additionalPrompt).toContain("Suggestion tags from the dashboard: auth, dashboard.");
    expect(deps.connectionChatRepository.markDashboardMessagesProcessed).toHaveBeenCalledWith("t-app", {
      upToMessageId: "msg-app",
    });
    expect(deps.connectionChatRepository.postSystemMessage).toHaveBeenCalledWith("p1", {
      threadId: "t-app",
      bodyMarkdown: expect.stringContaining("Started a web app sprint"),
      metadata: {
        widget_metadata: {
          type: "app_progress",
          status: "running",
          appKind: "web_app",
          sprintId: "sprint-web-1",
          sprintName: "QS: Create Web App",
          stackSummary: expect.objectContaining({
            techstackId: "preact-fullstack",
            techstackName: "Preact Fullstack",
            applicationKind: "web_app",
          }),
          planningStages: [
            { id: "planning", label: "Planning", status: "running" },
            { id: "plan", label: "Plan", status: "pending" },
            { id: "start", label: "Start", status: "pending" },
            { id: "finish", label: "Finish", status: "pending" },
          ],
          suggestionTags: ["auth", "dashboard"],
          quickactionRequestId: "quickaction-web-1",
          clientRequestId: "quickaction-web-1",
        },
      },
    });
    expect(deps.chatManagementActionService.processManagementAction).not.toHaveBeenCalled();
  });

  it.each(CREATE_APP_QUICKACTION_CATALOG)(
    "launches $kind with its catalog template, scoped guidance, and progress label",
    async (spec) => {
      const requestId = `quickaction-${spec.kind}-catalog`;
      const metadata = {
        quickaction: {
          type: "create_app",
          kind: spec.kind,
          requestId,
          templateId: spec.templateId,
          designGuidance: spec.designGuidance,
        },
      };
      const quicksprintLauncher = {
        launchDetachedQuicksprint: vi.fn().mockResolvedValue({
          sprint: { id: `sprint-${spec.kind}`, name: `QS: ${spec.displayLabel}` },
          planningRequest: {
            projectId: "p1",
            sprintId: `sprint-${spec.kind}`,
            templateId: spec.templateId,
            submitMode: "plan_and_start",
            clientRequestId: requestId,
            planOptions: { autoStart: true, replan: false, clientRequestId: requestId },
          },
          planningPromise: new Promise(() => undefined),
        }),
      };
      service.setQuicksprintLauncher(quicksprintLauncher);
      deps.connectionChatRepository.postDashboardMessage.mockReturnValue({
        id: `msg-${spec.kind}`,
        threadId: "t-app",
        bodyMarkdown: spec.displayLabel,
        metadata,
      });
      deps.connectionChatRepository.getThread.mockReturnValue({
        id: "t-app",
        projectId: "p1",
        connectionId: null,
        title: spec.displayLabel,
        runtimeState: {},
      });

      await service.postMessage("p1", { bodyMarkdown: spec.displayLabel, metadata });

      expect(quicksprintLauncher.launchDetachedQuicksprint).toHaveBeenCalledWith("p1", expect.objectContaining({
        templateId: spec.templateId,
        submitMode: "plan_and_start",
        clientRequestId: requestId,
        planningOverrides: { designGuidance: spec.designGuidance },
      }));
      expect(deps.connectionChatRepository.postSystemMessage).toHaveBeenCalledWith("p1", expect.objectContaining({
        bodyMarkdown: expect.stringContaining(`Started a ${spec.appKindLabel.toLowerCase()} sprint`),
        metadata: {
          widget_metadata: expect.objectContaining({ appKind: spec.kind, quickactionRequestId: requestId }),
        },
      }));
    },
  );

  it.each(CREATE_APP_QUICKACTION_CATALOG.map(({ kind }) => kind))(
    "fails %s safely when the project is not eligible for an initial app",
    async (kind) => {
      const spec = CREATE_APP_QUICKACTION_CATALOG.find((entry) => entry.kind === kind)!;
      const metadata = {
        quickaction: { type: "create_app", kind, requestId: `request-${kind}`, templateId: spec.templateId },
      };
      const quicksprintLauncher = { launchDetachedQuicksprint: vi.fn() };
      service.setQuicksprintLauncher(quicksprintLauncher);
      deps.getProjectInitializationState.mockResolvedValue({
        projectId: "p1",
        initializationMode: "existing",
        repositoryState: "unavailable",
        canCreateInitialAppQuickactions: false,
      });
      deps.connectionChatRepository.postDashboardMessage.mockReturnValue({
        id: `msg-${kind}`,
        threadId: "t-app",
        bodyMarkdown: spec.displayLabel,
        metadata,
      });
      deps.connectionChatRepository.getThread.mockReturnValue({
        id: "t-app",
        projectId: "p1",
        connectionId: null,
        runtimeState: {},
      });

      const result = await service.postMessage("p1", { bodyMarkdown: spec.displayLabel, metadata });

      expect(result.deliveryStatus).toBe("failed");
      expect(quicksprintLauncher.launchDetachedQuicksprint).not.toHaveBeenCalled();
      expect(deps.connectionChatRepository.postSystemMessage).toHaveBeenCalledWith("p1", expect.objectContaining({
        bodyMarkdown: expect.stringContaining(`${spec.displayLabel} is only available for an eligible initial project.`),
      }));
    },
  );

  it.each([
    ["template", { templateId: "qs-create-game" }],
    ["guidance", { designGuidance: { selectedTechStackId: "client-markdown", selectedStyleguideId: "code-ux-award-winning" } }],
  ] as const)("rejects invalid create-app %s metadata", async (_label, override) => {
    const metadata = {
      quickaction: {
        type: "create_app",
        kind: "web_app",
        requestId: "invalid-request",
        templateId: "qs-create-web-app",
        ...override,
      },
    };
    const quicksprintLauncher = { launchDetachedQuicksprint: vi.fn() };
    service.setQuicksprintLauncher(quicksprintLauncher);
    deps.connectionChatRepository.postDashboardMessage.mockReturnValue({
      id: "msg-invalid",
      threadId: "t-app",
      bodyMarkdown: "Create a web app",
      metadata,
    });
    deps.connectionChatRepository.getThread.mockReturnValue({ id: "t-app", projectId: "p1", runtimeState: {} });

    const result = await service.postMessage("p1", { bodyMarkdown: "Create a web app", metadata });

    expect(result.deliveryStatus).toBe("failed");
    expect(quicksprintLauncher.launchDetachedQuicksprint).not.toHaveBeenCalled();
  });

  it("queues normal chat follow-ups while create-app planning has no tasks yet", async () => {
    const runtimeState = {
      createAppQuickaction: {
        activeSprintId: "sprint-web-1",
        appKind: "web_app",
        planningStatus: "running",
        queuedFollowUps: [],
        quickactionRequestId: "quickaction-web-1",
        clientRequestId: "quickaction-web-1",
        activePlanningRequestId: "quickaction-web-1",
        progressMessageId: "msg-progress",
      },
    };
    deps.connectionChatRepository.postDashboardMessage.mockReturnValue({
      id: "msg-follow-up",
      threadId: "t-app",
      bodyMarkdown: "Make it offline-first.",
      deliveryStatus: "pending",
      createdAt: "2026-07-07T00:01:00.000Z",
      metadata: null,
    });
    deps.connectionChatRepository.getThread.mockReturnValue({
      id: "t-app",
      projectId: "p1",
      connectionId: null,
      title: "Create a web app",
      runtimeState,
    });
    deps.projectManagementRepository.listTasks.mockReturnValue([]);

    await service.postMessage("p1", { threadId: "t-app", bodyMarkdown: "Make it offline-first." });

    expect(deps.connectionChatRepository.updateThread).toHaveBeenCalledWith("t-app", {
      runtimeState: expect.objectContaining({
        createAppQuickaction: expect.objectContaining({
          activeSprintId: "sprint-web-1",
          planningStatus: "running",
          queuedFollowUps: [{
            messageId: "msg-follow-up",
            bodyMarkdown: "Make it offline-first.",
            createdAt: "2026-07-07T00:01:00.000Z",
          }],
        }),
      }),
    });
    expect(deps.connectionChatRepository.markDashboardMessagesProcessed).toHaveBeenCalledWith("t-app", {
      upToMessageId: "msg-follow-up",
    });
    expect(deps.connectionChatRepository.postSystemMessage).toHaveBeenCalledWith("p1", expect.objectContaining({
      threadId: "t-app",
      bodyMarkdown: "Got it. I'll apply that direction to the app sprint after planning finishes.",
    }));
    expect(deps.projectManagementRepository.updateSprint).not.toHaveBeenCalled();
    expect(deps.chatManagementActionService.processManagementAction).not.toHaveBeenCalled();
  });

  it("appends queued create-app follow-ups when tasks appear during the queue write", async () => {
    let tasksExist = false;
    let runtimeState: any = {
      createAppQuickaction: {
        activeSprintId: "sprint-web-1",
        appKind: "web_app",
        planningStatus: "running",
        queuedFollowUps: [],
        quickactionRequestId: "quickaction-web-1",
        clientRequestId: "quickaction-web-1",
        activePlanningRequestId: "quickaction-web-1",
        progressMessageId: "msg-progress",
      },
    };
    deps.connectionChatRepository.postDashboardMessage.mockReturnValue({
      id: "msg-follow-up",
      threadId: "t-app",
      bodyMarkdown: "Make setup import existing projects.",
      deliveryStatus: "pending",
      createdAt: "2026-07-07T00:01:30.000Z",
      metadata: null,
    });
    deps.connectionChatRepository.getThread.mockImplementation(() => ({
      id: "t-app",
      projectId: "p1",
      connectionId: null,
      title: "Create a web app",
      runtimeState,
    }));
    deps.connectionChatRepository.updateThread.mockImplementation((_threadId: string, input: any) => {
      runtimeState = input.runtimeState;
      tasksExist = true;
      return { id: "t-app", projectId: "p1", title: "Create a web app", runtimeState };
    });
    deps.projectManagementRepository.listTasks.mockImplementation(() => (
      tasksExist ? [{ id: "task-1" }] : []
    ));
    deps.projectManagementRepository.getSprint.mockReturnValue({
      id: "sprint-web-1",
      projectId: "p1",
      goal: "Build the app.",
      originalPrompt: null,
    });

    await service.postMessage("p1", {
      threadId: "t-app",
      bodyMarkdown: "Make setup import existing projects.",
    });

    expect(deps.projectManagementRepository.updateSprint).toHaveBeenCalledWith("sprint-web-1", {
      goal: expect.stringContaining("Make setup import existing projects."),
    });
    expect(runtimeState.createAppQuickaction.queuedFollowUps).toEqual([]);
    expect(deps.connectionChatRepository.markDashboardMessagesProcessed).toHaveBeenCalledWith("t-app", {
      upToMessageId: "msg-follow-up",
    });
    expect(deps.connectionChatRepository.postSystemMessage).toHaveBeenCalledWith("p1", expect.objectContaining({
      threadId: "t-app",
      bodyMarkdown: "Updated the app sprint direction with your latest note.",
    }));
    expect(deps.connectionChatRepository.postSystemMessage).not.toHaveBeenCalledWith("p1", expect.objectContaining({
      bodyMarkdown: "Got it. I'll apply that direction to the app sprint after planning finishes.",
    }));
    expect(deps.chatManagementActionService.processManagementAction).not.toHaveBeenCalled();
  });

  it("appends normal chat follow-ups immediately after create-app tasks exist", async () => {
    const runtimeState = {
      createAppQuickaction: {
        activeSprintId: "sprint-web-1",
        appKind: "web_app",
        planningStatus: "running",
        queuedFollowUps: [],
        quickactionRequestId: "quickaction-web-1",
        clientRequestId: "quickaction-web-1",
      },
    };
    deps.connectionChatRepository.postDashboardMessage.mockReturnValue({
      id: "msg-follow-up",
      threadId: "t-app",
      bodyMarkdown: "Prioritize keyboard navigation.",
      deliveryStatus: "pending",
      createdAt: "2026-07-07T00:02:00.000Z",
      metadata: null,
    });
    deps.connectionChatRepository.getThread.mockReturnValue({
      id: "t-app",
      projectId: "p1",
      connectionId: null,
      title: "Create a web app",
      runtimeState,
    });
    deps.projectManagementRepository.listTasks.mockReturnValue([{ id: "task-1" }]);
    deps.projectManagementRepository.getSprint.mockReturnValue({
      id: "sprint-web-1",
      projectId: "p1",
      goal: "Build the app.",
      originalPrompt: null,
    });

    await service.postMessage("p1", { threadId: "t-app", bodyMarkdown: "Prioritize keyboard navigation." });

    expect(deps.projectManagementRepository.updateSprint).toHaveBeenCalledWith("sprint-web-1", {
      goal: expect.stringContaining("## Additional direction from chat"),
    });
    expect(deps.projectManagementRepository.updateSprint).toHaveBeenCalledWith("sprint-web-1", {
      goal: expect.stringContaining("Prioritize keyboard navigation."),
    });
    expect(deps.connectionChatRepository.markDashboardMessagesProcessed).toHaveBeenCalledWith("t-app", {
      upToMessageId: "msg-follow-up",
    });
    expect(deps.connectionChatRepository.postSystemMessage).toHaveBeenCalledWith("p1", expect.objectContaining({
      bodyMarkdown: "Updated the app sprint direction with your latest note.",
    }));
    expect(deps.chatManagementActionService.processManagementAction).not.toHaveBeenCalled();
  });

  it("does not mark failed create-app follow-up messages as processed", async () => {
    const runtimeState = {
      createAppQuickaction: {
        activeSprintId: "sprint-web-1",
        appKind: "web_app",
        planningStatus: "completed",
        queuedFollowUps: [],
        quickactionRequestId: "quickaction-web-1",
        clientRequestId: "quickaction-web-1",
      },
    };
    deps.connectionChatRepository.postDashboardMessage.mockReturnValue({
      id: "msg-follow-up",
      threadId: "t-app",
      bodyMarkdown: "Add an installable PWA mode.",
      deliveryStatus: "pending",
      createdAt: "2026-07-07T00:02:30.000Z",
      metadata: null,
    });
    deps.connectionChatRepository.getThread.mockReturnValue({
      id: "t-app",
      projectId: "p1",
      connectionId: null,
      title: "Create a web app",
      runtimeState,
    });
    deps.projectManagementRepository.listTasks.mockReturnValue([{ id: "task-1" }]);
    deps.projectManagementRepository.getSprint.mockReturnValue(null);

    const message = await service.postMessage("p1", {
      threadId: "t-app",
      bodyMarkdown: "Add an installable PWA mode.",
    });

    expect(message.deliveryStatus).toBe("failed");
    expect(deps.connectionChatRepository.markDashboardMessagesFailed).toHaveBeenCalledWith("t-app", {
      upToMessageId: "msg-follow-up",
    });
    expect(deps.connectionChatRepository.markDashboardMessagesProcessed).not.toHaveBeenCalled();
    expect(deps.connectionChatRepository.postSystemMessage).toHaveBeenCalledWith("p1", expect.objectContaining({
      bodyMarkdown: expect.stringContaining("Create-app follow-up failed"),
    }));
  });

  it("appends queued create-app follow-ups when detached planning completes and marks the widget completed", async () => {
    let runtimeState: any = {};
    let resolvePlanning!: (value: unknown) => void;
    const planningPromise = new Promise((resolve) => {
      resolvePlanning = resolve;
    });
    const quickactionMetadata = {
      quickaction: {
        type: "create_app",
        kind: "web_app",
        requestId: "quickaction-web-1",
        templateId: "qs-create-web-app",
      },
    };
    service.setQuicksprintLauncher({
      launchDetachedQuicksprint: vi.fn().mockResolvedValue({
        sprint: { id: "sprint-web-1", name: "QS: Create Web App" },
        planningRequest: {
          projectId: "p1",
          sprintId: "sprint-web-1",
          templateId: "qs-create-web-app",
          submitMode: "plan_and_start",
          clientRequestId: "quickaction-web-1",
          planOptions: { autoStart: true, replan: false, clientRequestId: "quickaction-web-1" },
        },
        planningPromise,
      }),
    });
    deps.connectionChatRepository.postDashboardMessage.mockImplementation((_projectId: string, input: any) => ({
      id: input.metadata ? "msg-app" : "msg-follow-up",
      threadId: "t-app",
      bodyMarkdown: input.bodyMarkdown,
      deliveryStatus: "pending",
      createdAt: input.metadata ? "2026-07-07T00:00:00.000Z" : "2026-07-07T00:03:00.000Z",
      metadata: input.metadata ?? null,
    }));
    deps.connectionChatRepository.getThread.mockImplementation(() => ({
      id: "t-app",
      projectId: "p1",
      connectionId: null,
      title: "Create a web app",
      runtimeState,
    }));
    deps.connectionChatRepository.updateThread.mockImplementation((_threadId: string, input: any) => {
      runtimeState = input.runtimeState;
      return { id: "t-app", projectId: "p1", title: "Create a web app", runtimeState };
    });
    deps.connectionChatRepository.postSystemMessage.mockImplementation((_projectId: string, input: any) => ({
      id: input.metadata ? "msg-progress" : "msg-system",
      threadId: input.threadId,
      bodyMarkdown: input.bodyMarkdown,
      metadata: input.metadata ?? null,
    }));
    deps.connectionChatRepository.getMessage.mockReturnValue({
      id: "msg-progress",
      threadId: "t-app",
      metadata: {
        widget_metadata: {
          type: "app_progress",
          status: "running",
          planningStages: [
            { id: "planning", label: "Planning", status: "running" },
            { id: "plan", label: "Plan", status: "pending" },
          ],
        },
      },
    });
    deps.projectManagementRepository.listTasks.mockReturnValue([]);
    deps.projectManagementRepository.getSprint.mockReturnValue({
      id: "sprint-web-1",
      projectId: "p1",
      goal: "Build the app.",
      originalPrompt: null,
    });

    await service.postMessage("p1", {
      bodyMarkdown: "Create a web app.",
      metadata: quickactionMetadata,
    });
    await service.postMessage("p1", {
      threadId: "t-app",
      bodyMarkdown: "Use local-first storage.",
    });
    resolvePlanning({ ok: true });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(deps.projectManagementRepository.updateSprint).toHaveBeenCalledWith("sprint-web-1", {
      goal: expect.stringContaining("## Additional direction from chat"),
    });
    expect(deps.projectManagementRepository.updateSprint).toHaveBeenCalledWith("sprint-web-1", {
      goal: expect.stringContaining("Use local-first storage."),
    });
    expect(runtimeState.createAppQuickaction).toMatchObject({
      activeSprintId: "sprint-web-1",
      planningStatus: "completed",
      queuedFollowUps: [],
    });
    expect(runtimeState.createAppQuickaction.activePlanningRequestId).toBeUndefined();
    expect(deps.connectionChatRepository.updateMessageMetadata).toHaveBeenCalledWith("msg-progress", expect.objectContaining({
      widget_metadata: expect.objectContaining({
        status: "completed",
        planningStages: [
          { id: "planning", label: "Planning", status: "completed" },
          { id: "plan", label: "Plan", status: "completed" },
        ],
      }),
    }));
  });

  it("keeps follow-ups queued during detached planning completion and appends them before clearing state", async () => {
    let runtimeState: any = {};
    let followUpCounter = 0;
    let queuedRaceFollowUp = false;
    let resolvePlanning!: (value: unknown) => void;
    const planningPromise = new Promise((resolve) => {
      resolvePlanning = resolve;
    });
    const quickactionMetadata = {
      quickaction: {
        type: "create_app",
        kind: "web_app",
        requestId: "quickaction-web-1",
        templateId: "qs-create-web-app",
      },
    };
    service.setQuicksprintLauncher({
      launchDetachedQuicksprint: vi.fn().mockResolvedValue({
        sprint: { id: "sprint-web-1", name: "QS: Create Web App" },
        planningRequest: {
          projectId: "p1",
          sprintId: "sprint-web-1",
          templateId: "qs-create-web-app",
          submitMode: "plan_and_start",
          clientRequestId: "quickaction-web-1",
          planOptions: { autoStart: true, replan: false, clientRequestId: "quickaction-web-1" },
        },
        planningPromise,
      }),
    });
    deps.connectionChatRepository.postDashboardMessage.mockImplementation((_projectId: string, input: any) => {
      const isQuickaction = Boolean(input.metadata);
      if (!isQuickaction) {
        followUpCounter += 1;
      }
      return {
        id: isQuickaction ? "msg-app" : `msg-follow-up-${followUpCounter}`,
        threadId: "t-app",
        bodyMarkdown: input.bodyMarkdown,
        deliveryStatus: "pending",
        createdAt: isQuickaction ? "2026-07-07T00:00:00.000Z" : `2026-07-07T00:0${followUpCounter}:00.000Z`,
        metadata: input.metadata ?? null,
      };
    });
    deps.connectionChatRepository.getThread.mockImplementation(() => ({
      id: "t-app",
      projectId: "p1",
      connectionId: null,
      title: "Create a web app",
      runtimeState,
    }));
    deps.connectionChatRepository.updateThread.mockImplementation((_threadId: string, input: any) => {
      runtimeState = input.runtimeState;
      return { id: "t-app", projectId: "p1", title: "Create a web app", runtimeState };
    });
    deps.connectionChatRepository.postSystemMessage.mockImplementation((_projectId: string, input: any) => ({
      id: input.metadata ? "msg-progress" : "msg-system",
      threadId: input.threadId,
      bodyMarkdown: input.bodyMarkdown,
      metadata: input.metadata ?? null,
    }));
    deps.connectionChatRepository.getMessage.mockReturnValue({
      id: "msg-progress",
      threadId: "t-app",
      metadata: {
        widget_metadata: {
          type: "app_progress",
          status: "running",
          planningStages: [
            { id: "planning", label: "Planning", status: "running" },
            { id: "plan", label: "Plan", status: "pending" },
          ],
        },
      },
    });
    deps.projectManagementRepository.listTasks.mockReturnValue([]);
    deps.projectManagementRepository.getSprint.mockReturnValue({
      id: "sprint-web-1",
      projectId: "p1",
      goal: "Build the app.",
      originalPrompt: null,
    });
    deps.projectManagementRepository.updateSprint.mockImplementation(() => {
      if (!queuedRaceFollowUp) {
        queuedRaceFollowUp = true;
        void service.postMessage("p1", {
          threadId: "t-app",
          bodyMarkdown: "Keep the setup wizard skippable.",
        });
      }
    });

    await service.postMessage("p1", {
      bodyMarkdown: "Create a web app.",
      metadata: quickactionMetadata,
    });
    await service.postMessage("p1", {
      threadId: "t-app",
      bodyMarkdown: "Use local-first storage.",
    });
    resolvePlanning({ ok: true });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(deps.projectManagementRepository.updateSprint).toHaveBeenCalledWith("sprint-web-1", {
      goal: expect.stringContaining("Use local-first storage."),
    });
    expect(deps.projectManagementRepository.updateSprint).toHaveBeenCalledWith("sprint-web-1", {
      goal: expect.stringContaining("Keep the setup wizard skippable."),
    });
    expect(runtimeState.createAppQuickaction).toMatchObject({
      activeSprintId: "sprint-web-1",
      planningStatus: "completed",
      queuedFollowUps: [],
    });
    expect(runtimeState.createAppQuickaction.activePlanningRequestId).toBeUndefined();
    expect(deps.connectionChatRepository.markDashboardMessagesProcessed).toHaveBeenCalledWith("t-app", {
      upToMessageId: "msg-follow-up-2",
    });
  });

  it("marks create-app planning failed without dropping queued follow-ups", async () => {
    let runtimeState: any = {};
    let rejectPlanning!: (error: unknown) => void;
    const planningPromise = new Promise((_resolve, reject) => {
      rejectPlanning = reject;
    });
    const quickactionMetadata = {
      quickaction: {
        type: "create_app",
        kind: "desktop_app",
        requestId: "quickaction-desktop-1",
        templateId: "qs-create-desktop-app",
      },
    };
    service.setQuicksprintLauncher({
      launchDetachedQuicksprint: vi.fn().mockResolvedValue({
        sprint: { id: "sprint-desktop-1", name: "QS: Create Desktop App" },
        planningRequest: {
          projectId: "p1",
          sprintId: "sprint-desktop-1",
          templateId: "qs-create-desktop-app",
          submitMode: "plan_and_start",
          clientRequestId: "quickaction-desktop-1",
          planOptions: { autoStart: true, replan: false, clientRequestId: "quickaction-desktop-1" },
        },
        planningPromise,
      }),
    });
    deps.connectionChatRepository.postDashboardMessage.mockImplementation((_projectId: string, input: any) => ({
      id: input.metadata ? "msg-app" : "msg-follow-up",
      threadId: "t-app",
      bodyMarkdown: input.bodyMarkdown,
      deliveryStatus: "pending",
      createdAt: input.metadata ? "2026-07-07T00:00:00.000Z" : "2026-07-07T00:04:00.000Z",
      metadata: input.metadata ?? null,
    }));
    deps.connectionChatRepository.getThread.mockImplementation(() => ({
      id: "t-app",
      projectId: "p1",
      connectionId: null,
      title: "Create a desktop app",
      runtimeState,
    }));
    deps.connectionChatRepository.updateThread.mockImplementation((_threadId: string, input: any) => {
      runtimeState = input.runtimeState;
      return { id: "t-app", projectId: "p1", title: "Create a desktop app", runtimeState };
    });
    deps.connectionChatRepository.postSystemMessage.mockImplementation((_projectId: string, input: any) => ({
      id: input.metadata ? "msg-progress" : "msg-system",
      threadId: input.threadId,
      bodyMarkdown: input.bodyMarkdown,
      metadata: input.metadata ?? null,
    }));
    deps.connectionChatRepository.getMessage.mockReturnValue({
      id: "msg-progress",
      threadId: "t-app",
      metadata: {
        widget_metadata: {
          type: "app_progress",
          status: "running",
          planningStages: [
            { id: "planning", label: "Planning", status: "running" },
            { id: "plan", label: "Plan", status: "pending" },
          ],
        },
      },
    });
    deps.projectManagementRepository.listTasks.mockReturnValue([]);

    await service.postMessage("p1", {
      bodyMarkdown: "Create a desktop app.",
      metadata: quickactionMetadata,
    });
    await service.postMessage("p1", {
      threadId: "t-app",
      bodyMarkdown: "Make tray behavior explicit.",
    });
    rejectPlanning(new Error("planner failed"));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(deps.projectManagementRepository.updateSprint).not.toHaveBeenCalled();
    expect(runtimeState.createAppQuickaction).toMatchObject({
      activeSprintId: "sprint-desktop-1",
      planningStatus: "failed",
      planningError: "planner failed",
      queuedFollowUps: [{
        messageId: "msg-follow-up",
        bodyMarkdown: "Make tray behavior explicit.",
        createdAt: "2026-07-07T00:04:00.000Z",
      }],
    });
    expect(runtimeState.createAppQuickaction.activePlanningRequestId).toBeUndefined();
    expect(deps.connectionChatRepository.updateMessageMetadata).toHaveBeenCalledWith("msg-progress", expect.objectContaining({
      widget_metadata: expect.objectContaining({
        status: "failed",
        planningStages: [
          { id: "planning", label: "Planning", status: "failed" },
          { id: "plan", label: "Plan", status: "pending" },
        ],
      }),
    }));
  });

  it("keeps non-create-app quickaction metadata on the normal chat path", async () => {
    const quicksprintLauncher = {
      launchDetachedQuicksprint: vi.fn(),
    };
    service.setQuicksprintLauncher(quicksprintLauncher);
    deps.connectionChatRepository.postDashboardMessage.mockReturnValue({
      id: "msg-normal",
      threadId: "t1",
      bodyMarkdown: "Show project status",
      metadata: { quickaction: { type: "status_report", requestId: "quickaction-status-1" } },
    });
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
      { id: "msg-normal", authorType: "dashboard_user", bodyMarkdown: "Show project status" },
    ]);
    deps.chatManagementActionService.processManagementAction.mockResolvedValue({ replyMarkdown: "status", action: null, approvalRequired: false });

    await service.postMessage("p1", {
      bodyMarkdown: "Show project status",
      metadata: { quickaction: { type: "status_report", requestId: "quickaction-status-1" } },
    });

    expect(quicksprintLauncher.launchDetachedQuicksprint).not.toHaveBeenCalled();
    expect(deps.chatManagementActionService.processManagementAction).toHaveBeenCalledTimes(1);
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

  it("runs due scheduler entries after a dashboard reply is persisted", async () => {
    deps.runDueSchedulerEntriesAfterReply = vi.fn().mockResolvedValue(undefined);
    deps.connectionChatRepository.postDashboardMessage.mockReturnValue({ id: "msg-scheduler", threadId: "t1", bodyMarkdown: "Plan the work" });
    deps.connectionChatRepository.getThread.mockReturnValue({
      id: "t1",
      projectId: "p1",
      title: "Thread",
      connectionId: null,
      runtimeState: {},
    });
    deps.projectManagementRepository.getProject.mockReturnValue({ id: "p1", name: "proj", baseDir: "/tmp" });
    deps.taskService.resolveInvocationProvider.mockReturnValue({
      provider: "codex",
      providers: { codex: { model: "gpt-5.3-codex", apiKey: "codex-key" } },
    });
    deps.connectionChatRepository.listMessages.mockReturnValue([
      { id: "msg-scheduler", authorType: "dashboard_user", bodyMarkdown: "Plan the work" },
    ]);
    deps.chatManagementActionService.processManagementAction.mockResolvedValue({
      replyMarkdown: "I will retrieve the project data now.",
      action: null,
      approvalRequired: false,
    });

    await service.postMessage("p1", { bodyMarkdown: "Plan the work" });

    expect(deps.connectionChatRepository.postSystemMessage).toHaveBeenCalledWith("p1", {
      threadId: "t1",
      bodyMarkdown: "I will retrieve the project data now.",
    });
    expect(deps.runDueSchedulerEntriesAfterReply).toHaveBeenCalledTimes(1);
    expect(deps.connectionChatRepository.postSystemMessage.mock.invocationCallOrder[0])
      .toBeLessThan(deps.runDueSchedulerEntriesAfterReply.mock.invocationCallOrder[0]);
  });

  it("stores sanitized prompt suggestions on the visible virtual reply metadata", async () => {
    deps.connectionChatRepository.postDashboardMessage.mockReturnValue({ id: "msg-suggestions", threadId: "t1", bodyMarkdown: "what next" });
    deps.connectionChatRepository.getThread.mockReturnValue({
      id: "t1",
      projectId: "p1",
      title: "Thread",
      connectionId: null,
      runtimeState: {},
    });
    deps.projectManagementRepository.getProject.mockReturnValue({ id: "p1", name: "proj", baseDir: "/tmp" });
    deps.taskService.resolveInvocationProvider.mockReturnValue({
      provider: "codex",
      providers: { codex: { model: "gpt-5.3-codex", apiKey: "codex-key" } },
    });
    deps.connectionChatRepository.listMessages.mockReturnValue([
      { id: "msg-suggestions", authorType: "dashboard_user", bodyMarkdown: "what next" },
    ]);
    deps.chatManagementActionService.processManagementAction.mockResolvedValue({
      replyMarkdown: "Here are next steps.",
      action: null,
      approvalRequired: false,
      promptSuggestions: [
        { label: "Inspect status", prompt: "Show the current project status", icon: "search", id: "status" },
      ],
    });

    await service.postMessage("p1", { bodyMarkdown: "what next" });

    expect(deps.connectionChatRepository.postSystemMessage).toHaveBeenCalledWith("p1", {
      threadId: "t1",
      bodyMarkdown: "Here are next steps.",
      metadata: {
        promptSuggestions: [
          { label: "Inspect status", prompt: "Show the current project status", icon: "search", id: "status" },
        ],
      },
    });
  });

  it("stores an agent effect alongside existing assistant reply metadata", async () => {
    deps.connectionChatRepository.postDashboardMessage.mockReturnValue({ id: "msg-effect", threadId: "t1", bodyMarkdown: "good news?" });
    deps.connectionChatRepository.getThread.mockReturnValue({
      id: "t1",
      projectId: "p1",
      title: "Thread",
      connectionId: null,
      runtimeState: {},
    });
    deps.projectManagementRepository.getProject.mockReturnValue({ id: "p1", name: "proj", baseDir: "/tmp" });
    deps.taskService.resolveInvocationProvider.mockReturnValue({
      provider: "codex",
      providers: { codex: { model: "gpt-5.3-codex", apiKey: "codex-key" } },
    });
    deps.connectionChatRepository.listMessages.mockReturnValue([
      { id: "msg-effect", authorType: "dashboard_user", bodyMarkdown: "good news?" },
    ]);
    deps.chatManagementActionService.processManagementAction.mockResolvedValue({
      replyMarkdown: "Everything passed.",
      action: null,
      approvalRequired: false,
      promptSuggestions: [{ label: "Deploy", prompt: "Deploy now" }],
      agentEffect: { emotion: "excited", animation: "hyped", caption: "All green!", durationMs: 2600 },
    });

    await service.postMessage("p1", { bodyMarkdown: "good news?" });

    expect(deps.connectionChatRepository.postSystemMessage).toHaveBeenCalledWith("p1", {
      threadId: "t1",
      bodyMarkdown: "Everything passed.",
      metadata: {
        promptSuggestions: [{ label: "Deploy", prompt: "Deploy now" }],
        agentEffect: { emotion: "excited", animation: "hyped", caption: "All green!", durationMs: 2600 },
      },
    });
  });

  it("leaves no-suggestion virtual replies without message metadata", async () => {
    deps.connectionChatRepository.postDashboardMessage.mockReturnValue({ id: "msg-no-suggestions", threadId: "t1", bodyMarkdown: "hello" });
    deps.connectionChatRepository.getThread.mockReturnValue({
      id: "t1",
      projectId: "p1",
      title: "Thread",
      connectionId: null,
      runtimeState: {},
    });
    deps.projectManagementRepository.getProject.mockReturnValue({ id: "p1", name: "proj", baseDir: "/tmp" });
    deps.taskService.resolveInvocationProvider.mockReturnValue({
      provider: "codex",
      providers: { codex: { model: "gpt-5.3-codex", apiKey: "codex-key" } },
    });
    deps.connectionChatRepository.listMessages.mockReturnValue([
      { id: "msg-no-suggestions", authorType: "dashboard_user", bodyMarkdown: "hello" },
    ]);
    deps.chatManagementActionService.processManagementAction.mockResolvedValue({
      replyMarkdown: "Plain reply",
      action: null,
      approvalRequired: false,
    });

    await service.postMessage("p1", { bodyMarkdown: "hello" });

    expect(deps.connectionChatRepository.postSystemMessage).toHaveBeenCalledWith("p1", {
      threadId: "t1",
      bodyMarkdown: "Plain reply",
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

  it("uses full Code UX MCP with scheduler for the default dashboard reply agent", async () => {
    deps.getDashboardSettings.mockReturnValue({
      agents: { routing: { dashboardReply: { agentPresetId: null } } },
      cliWorkflow: {},
    });
    deps.agentPresetSyncService.resolveDashboardReplyAgent = vi.fn().mockResolvedValue({
      id: "reply-agent",
      instructionMarkdown: "",
    });
    const globalMcpConnection = { url: "http://127.0.0.1:3000/mcp", authToken: "token" };
    deps.getMcpConnectionInfo = vi.fn().mockReturnValue(globalMcpConnection);
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
        mcpConnection: { url: "http://127.0.0.1:3000/mcp", authToken: "token", threadId: "t1" },
        mcpAgentId: "reply-agent",
        agentMcpAccess: codeUxAgentMcpAccess(["playwright"]),
        prompt: expect.stringContaining("You have the `manage_code_ux` MCP tool available"),
      }),
    );
    expect(deps.chatManagementActionService.processManagementAction).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining("You also have the `scheduler_code_ux` MCP tool available"),
      }),
    );
    expect(globalMcpConnection).toEqual({ url: "http://127.0.0.1:3000/mcp", authToken: "token" });
  });

  it("uses full Code UX MCP access for a configured dashboard reply preset", async () => {
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
        agentMcpAccess: dashboardReplyAgentMcpAccess(explicitAccess),
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
        snapshotCheckout: { branch: "stable", fallbackBranch: undefined, remoteOnly: true },
        workspaceLifecycle: "fresh",
      }),
    );
  });

  it("keeps mockup-cli dashboard chat snapshots local for local Git projects", async () => {
    deps.getDashboardSettings.mockReturnValue({
      git: { githubMode: "LOCAL", defaultBranch: "main" },
      cliWorkflow: { executionMode: "DOCKER" },
      aiProvider: {
        providers: {
          "mockup-cli": {
            provider: "mockup-cli",
            enabled: true,
            model: "default",
            apiKey: "",
            thinkingMode: "MEDIUM",
            weight: 1,
            maxConcurrentTasks: 0,
          },
        },
      },
    });
    deps.connectionChatRepository.postDashboardMessage.mockReturnValue({ id: "msg-local", threadId: "t1", bodyMarkdown: "mockup-cli:write answer.txt :: ok" });
    deps.connectionChatRepository.getThread.mockReturnValue({
      id: "t1",
      projectId: "p1",
      connectionId: null,
      runtimeState: {},
    });
    deps.projectManagementRepository.getProject.mockReturnValue({
      id: "p1",
      name: "local test project",
      baseDir: "/tmp/local-test-project",
      sourceType: "local",
      defaultBranch: "main",
    });
    deps.taskService.resolveInvocationProvider.mockReturnValue({
      provider: "mockup-cli",
      providers: {
        "mockup-cli": {
          provider: "mockup-cli",
          model: "default",
          apiKey: "",
          thinkingMode: "MEDIUM",
          maxConcurrentTasks: 0,
        },
      },
    });
    deps.connectionChatRepository.listMessages.mockReturnValue([
      { authorType: "dashboard_user", bodyMarkdown: "mockup-cli:write answer.txt :: ok" },
    ]);
    deps.chatManagementActionService.processManagementAction.mockResolvedValue({
      replyMarkdown: "local reply",
      action: null,
      approvalRequired: false,
    });

    await service.postMessage("p1", { bodyMarkdown: "mockup-cli:write answer.txt :: ok" });

    expect(deps.chatManagementActionService.processManagementAction).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "mockup-cli",
        repoPath: "/tmp/local-test-project",
        snapshotCheckout: expect.objectContaining({ branch: "main" }),
        gitPolicy: expect.objectContaining({
          githubMode: "LOCAL",
          defaultBranch: "main",
        }),
      }),
    );
    const call = deps.chatManagementActionService.processManagementAction.mock.calls[0]?.[0];
    expect(call.snapshotCheckout.remoteOnly).toBeUndefined();
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
    deps.providerRunner.runProviderForText.mockResolvedValue(providerTextResult("## Current Objective\nKeep context", "session-1"));
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

  it.each([
    ["read-only", true],
    ["read-write", false],
  ] as const)("forwards a validated %s Google Drive mount during Docker native compaction", async (accessMode, readonly) => {
    const driveDir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-chat-compact-drive-"));
    try {
      deps.getDashboardSettings.mockReturnValue({
        cliWorkflow: { executionMode: "DOCKER" },
        googleDrive: { enabled: true, hostPath: driveDir, accessMode },
      });
      deps.connectionChatRepository.getThread.mockReturnValue({
        id: "t1",
        projectId: "p1",
        title: "Thread",
        connectionId: null,
        runtimeState: { routeKind: "virtual", virtualProvider: "codex", sessionIds: ["session-1"] },
      });
      deps.connectionChatRepository.listMessages.mockReturnValue([
        { id: "m1", authorType: "dashboard_user", bodyMarkdown: "hello" },
      ]);
      deps.projectManagementRepository.getProject.mockReturnValue({ id: "p1", name: "proj", baseDir: "/tmp" });
      deps.taskService.resolveInvocationProvider.mockReturnValue({
        provider: "codex",
        providers: { codex: { model: "gpt-5.3-codex", apiKey: "key" } },
      });
      deps.executionRepository.createExecutionInvocation.mockReturnValue({ id: "exec-drive-compact" });
      deps.providerRunner.runProviderForText.mockResolvedValue(providerTextResult("Compacted", "session-1"));
      deps.connectionChatRepository.updateThread.mockImplementation((threadId: string, input: any) => ({
        id: threadId,
        projectId: "p1",
        title: "Thread",
        runtimeState: input.runtimeState,
      }));

      await service.compactThreadSession("t1");

      expect(deps.providerRunner.runProviderForText).toHaveBeenCalledWith(expect.objectContaining({
        nativeSessionOperation: "compact",
        continueSessionId: "session-1",
        workspaceLifecycle: "continue",
        googleDriveMount: {
          source: driveDir,
          destination: "/mnt/code-ux/google-drive",
          readonly,
        },
      }));
    } finally {
      await fs.rm(driveDir, { recursive: true, force: true });
    }
  });

  it.each([
    ["missing", path.join(os.tmpdir(), "code-ux-chat-compact-drive-missing")],
    ["invalid", import.meta.filename],
  ] as const)("does not forward a Google Drive mount for an %s Docker path", async (_kind, hostPath) => {
    deps.getDashboardSettings.mockReturnValue({
      cliWorkflow: { executionMode: "DOCKER" },
      googleDrive: { enabled: true, hostPath, accessMode: "read-only" },
    });
    deps.connectionChatRepository.getThread.mockReturnValue({
      id: "t1",
      projectId: "p1",
      title: "Thread",
      connectionId: null,
      runtimeState: { routeKind: "virtual", virtualProvider: "codex", sessionIds: ["session-1"] },
    });
    deps.connectionChatRepository.listMessages.mockReturnValue([{ id: "m1", bodyMarkdown: "hello" }]);
    deps.projectManagementRepository.getProject.mockReturnValue({ id: "p1", name: "proj", baseDir: "/tmp" });
    deps.taskService.resolveInvocationProvider.mockReturnValue({
      provider: "codex",
      providers: { codex: { model: "gpt-5.3-codex", apiKey: "key" } },
    });
    deps.executionRepository.createExecutionInvocation.mockReturnValue({ id: "exec-invalid-drive-compact" });
    deps.providerRunner.runProviderForText.mockResolvedValue(providerTextResult("Compacted", "session-1"));
    deps.connectionChatRepository.updateThread.mockImplementation((threadId: string, input: any) => ({
      id: threadId,
      projectId: "p1",
      runtimeState: input.runtimeState,
    }));

    await service.compactThreadSession("t1");

    expect(deps.providerRunner.runProviderForText).toHaveBeenCalledWith(expect.objectContaining({
      nativeSessionOperation: "compact",
      googleDriveMount: undefined,
    }));
  });

  it("does not forward a Google Drive mount during host-mode native compaction", async () => {
    const driveDir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-chat-host-compact-drive-"));
    try {
      deps.getDashboardSettings.mockReturnValue({
        cliWorkflow: { executionMode: "HOST" },
        googleDrive: { enabled: true, hostPath: driveDir, accessMode: "read-write" },
      });
      deps.connectionChatRepository.getThread.mockReturnValue({
        id: "t1",
        projectId: "p1",
        title: "Thread",
        connectionId: null,
        runtimeState: { routeKind: "virtual", virtualProvider: "codex", sessionIds: ["session-1"] },
      });
      deps.connectionChatRepository.listMessages.mockReturnValue([{ id: "m1", bodyMarkdown: "hello" }]);
      deps.projectManagementRepository.getProject.mockReturnValue({ id: "p1", name: "proj", baseDir: "/tmp" });
      deps.taskService.resolveInvocationProvider.mockReturnValue({
        provider: "codex",
        providers: { codex: { model: "gpt-5.3-codex", apiKey: "key" } },
      });
      deps.executionRepository.createExecutionInvocation.mockReturnValue({ id: "exec-host-drive-compact" });
      deps.providerRunner.runProviderForText.mockResolvedValue(providerTextResult("Compacted", "session-1"));
      deps.connectionChatRepository.updateThread.mockImplementation((threadId: string, input: any) => ({
        id: threadId,
        projectId: "p1",
        runtimeState: input.runtimeState,
      }));

      await service.compactThreadSession("t1");

      expect(deps.providerRunner.runProviderForText).toHaveBeenCalledWith(expect.objectContaining({
        nativeSessionOperation: "compact",
        googleDriveMount: undefined,
      }));
    } finally {
      await fs.rm(driveDir, { recursive: true, force: true });
    }
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
    deps.providerRunner.runProviderForText.mockResolvedValue(providerTextResult("## Compact Summary\nContinue from here", "qwen-native-1"));
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
