import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  ChatManagementActionService,
  parseProviderManagementJson,
} from "../../../src/services/chat-management-action-service.js";
import type { StructuredProviderResponseService } from "../../../src/services/structured-provider-response-service.js";
import type { ManagementToolHandler } from "../../../src/mcp/management-tool-handler.js";
import type { ExecutionRepository } from "../../../src/repositories/execution-repository.js";
import type { ProviderExecutionService } from "../../../src/services/provider-execution-service.js";
import type { DashboardSettings } from "../../../src/contracts/app-types.js";

describe("ChatManagementActionService", () => {
  let service: ChatManagementActionService;
  let structuredProviderResponseService: vitest.Mocked<StructuredProviderResponseService>;
  let providerExecutionService: vitest.Mocked<ProviderExecutionService>;
  let managementToolHandler: vitest.Mocked<ManagementToolHandler>;
  let executionRepository: vitest.Mocked<ExecutionRepository>;

  const mockSettings = { cliWorkflow: {} } as DashboardSettings;

  beforeEach(() => {
    structuredProviderResponseService = {
      executeAndParse: vi.fn(),
    } as any;

    providerExecutionService = {
      executeProvider: vi.fn(),
    } as any;

    managementToolHandler = {
      handleManageCodeUx: vi.fn(),
    } as any;

    executionRepository = {
      createExecutionInvocation: vi.fn().mockReturnValue({ id: "exec-123" }),
      appendExecutionInvocationMessage: vi.fn(),
      updateExecutionInvocation: vi.fn(),
    } as any;

    service = new ChatManagementActionService({
      structuredProviderResponseService,
      providerExecutionService,
      managementToolHandler,
      executionRepository,
    });
  });

  it("should process a valid management action proposal and execution", async () => {
    structuredProviderResponseService.executeAndParse.mockResolvedValue({
      parsed: {
        replyMarkdown: "I will update the sprint.",
        action: {
          domain: "sprints",
          action: "update_sprint",
          payload: { id: "s1" },
        },
      },
      nativeSessionId: "sess1",
      bodyMarkdown: "",
    });

    managementToolHandler.handleManageCodeUx.mockResolvedValue({
      content: [{ type: "text", text: JSON.stringify({ result: { status: "success", domain: "sprints", action: "update_sprint", message: "updated" } }) }]
    });

    const result = await service.processManagementAction({
      projectId: "proj1",
      provider: "claude-code",
      model: "claude-3",
      apiKey: "test-key",
      providerMountAuth: true,
      providerAuthPath: "~/.claude",
      sessionId: "sess1",
      settings: mockSettings,
      prompt: "Update sprint",
      repoPath: "/tmp/test-repo",
    });

    expect(result).toEqual({
      replyMarkdown: "I will update the sprint.",
      action: {
        domain: "sprints",
        action: "update_sprint",
        payload: { id: "s1" },
      },
      approvalRequired: false,
      approvalMessage: undefined,
      result: { status: "success", domain: "sprints", action: "update_sprint", message: "updated" },
      nativeSessionId: "sess1",
    });

    expect(managementToolHandler.handleManageCodeUx).toHaveBeenCalledWith({
      domain: "sprints",
      action: "update_sprint",
      payload: { id: "s1" },
    });

    expect(executionRepository.createExecutionInvocation).toHaveBeenCalled();
    expect(executionRepository.updateExecutionInvocation).toHaveBeenCalledWith("exec-123", { status: "completed", finishedAt: expect.any(String) });
    expect(structuredProviderResponseService.executeAndParse).toHaveBeenCalledWith(expect.objectContaining({
      providerMountAuth: true,
      providerAuthPath: "~/.claude",
      trackPromptInInvocation: false,
      finalizeExecutionInvocation: false,
    }));
    expect(structuredProviderResponseService.executeAndParse.mock.calls[0]?.[0].trackAssistantInInvocation).toBeUndefined();

    // Verify full conversation is tracked: user prompt, assistant response, action proposed, action result
    const calls = executionRepository.appendExecutionInvocationMessage.mock.calls;
    expect(calls[0]).toEqual(["exec-123", { role: "user", contentMarkdown: "Update sprint" }]);
    expect(calls[1]).toEqual(["exec-123", { role: "assistant", contentMarkdown: "I will update the sprint." }]);
    expect(calls[2][1].role).toBe("system");
    expect(calls[2][1].contentMarkdown).toContain("Action proposed:");
    expect(calls[3][1].role).toBe("system");
    expect(calls[3][1].contentMarkdown).toContain("Action result:");
  });

  it("should handle approval-gated actions correctly without mutating state", async () => {
    structuredProviderResponseService.executeAndParse.mockResolvedValue({
      parsed: {
        replyMarkdown: "I want to delete the project.",
        action: {
          domain: "projects",
          action: "delete_project",
          payload: { id: "p1" },
        },
      },
      nativeSessionId: "sess1",
      bodyMarkdown: "",
    });

    managementToolHandler.handleManageCodeUx.mockResolvedValue({
      content: [{ type: "text", text: JSON.stringify({ approvalRequired: true, approvalMessage: "Destructive action requires approval." }) }]
    });

    const result = await service.processManagementAction({
      projectId: "proj1",
      provider: "claude-code",
      model: "claude-3",
      apiKey: "test-key",
      sessionId: "sess1",
      settings: mockSettings,
      prompt: "Delete project",
      repoPath: "/tmp/test-repo",
    });

    expect(result).toEqual({
      replyMarkdown: "I want to delete the project.",
      action: {
        domain: "projects",
        action: "delete_project",
        payload: { id: "p1" },
      },
      approvalRequired: true,
      approvalMessage: "Destructive action requires approval.",
      result: undefined,
      nativeSessionId: "sess1",
    });
  });

  it("should dispatch custom dashboard management proposals through the management handler", async () => {
    const action = {
      domain: "custom_dashboards",
      action: "create_revision",
      payload: {
        dashboardId: "dash-1",
        manifest: {
          schemaVersion: 1,
          title: "Operations Dashboard",
          entryFile: "src/dashboard.tsx",
          filePaths: ["src/dashboard.tsx"],
        },
        fileBundle: {
          files: [
            {
              path: "src/dashboard.tsx",
              content: "export default function Dashboard() { return <main>Ops</main>; }",
            },
          ],
        },
        sourceNodeGraph: {
          nodes: [{ id: "project-status", type: "codeux_project", title: "Project Status" }],
          edges: [],
        },
        styleguide: {
          tokens: { color: "system" },
          accessibilityNotes: ["Use semantic landmarks and visible focus states."],
        },
        runtimeMetadata: {
          validationExpectations: ["Build succeeds", "Root route responds"],
        },
      },
    };

    structuredProviderResponseService.executeAndParse.mockResolvedValue({
      parsed: {
        replyMarkdown: "I created a dashboard revision and will validate it next.",
        action,
      },
      nativeSessionId: "sess1",
      bodyMarkdown: "",
    });

    managementToolHandler.handleManageCodeUx.mockResolvedValue({
      content: [{ type: "text", text: JSON.stringify({ result: { status: "success", domain: "custom_dashboards", action: "create_revision", revisionId: "rev-1" } }) }]
    });

    const result = await service.processManagementAction({
      projectId: "proj1",
      provider: "claude-code",
      model: "claude-3",
      apiKey: "test-key",
      sessionId: "sess1",
      settings: mockSettings,
      prompt: "Create an operations dashboard",
      repoPath: "/tmp/test-repo",
    });

    expect(managementToolHandler.handleManageCodeUx).toHaveBeenCalledWith(action);
    expect(result).toEqual({
      replyMarkdown: "I created a dashboard revision and will validate it next.",
      action,
      approvalRequired: false,
      approvalMessage: undefined,
      result: { status: "success", domain: "custom_dashboards", action: "create_revision", revisionId: "rev-1" },
      nativeSessionId: "sess1",
    });
  });

  it("should handle reply only (no action)", async () => {
    structuredProviderResponseService.executeAndParse.mockResolvedValue({
      parsed: {
        replyMarkdown: "Hello world",
        action: null,
      },
      nativeSessionId: "sess1",
      bodyMarkdown: "",
      hasStructuredConversation: true,
    });

    const result = await service.processManagementAction({
      projectId: "proj1",
      provider: "claude-code",
      model: "claude-3",
      apiKey: "test-key",
      sessionId: "sess1",
      settings: mockSettings,
      prompt: "Say hello",
      repoPath: "/tmp/test-repo",
    });

    expect(result.replyMarkdown).toBe("Hello world");
    expect(result.action).toBeNull();
    expect(result.approvalRequired).toBe(false);
    expect(managementToolHandler.handleManageCodeUx).not.toHaveBeenCalled();

    // The caller-owned prompt remains, while the shared provider path owns the
    // already-persisted structured assistant transcript.
    const calls = executionRepository.appendExecutionInvocationMessage.mock.calls;
    expect(calls[0]).toEqual(["exec-123", { role: "user", contentMarkdown: "Say hello" }]);
    expect(calls).toHaveLength(1);
  });

  it("should pass sanitized prompt suggestions through reply-only results", async () => {
    structuredProviderResponseService.executeAndParse.mockResolvedValue({
      parsed: {
        replyMarkdown: "Pick a next step.",
        action: null,
        promptSuggestions: [
          { label: "Inspect status", prompt: "Show the current project status", icon: "search", id: "status" },
        ],
      },
      nativeSessionId: "sess1",
      bodyMarkdown: "",
    });

    const result = await service.processManagementAction({
      projectId: "proj1",
      provider: "claude-code",
      model: "claude-3",
      apiKey: "test-key",
      sessionId: "sess1",
      settings: mockSettings,
      prompt: "What next?",
      repoPath: "/tmp/test-repo",
    });

    expect(result).toEqual({
      replyMarkdown: "Pick a next step.",
      action: null,
      approvalRequired: false,
      nativeSessionId: "sess1",
      promptSuggestions: [
        { label: "Inspect status", prompt: "Show the current project status", icon: "search", id: "status" },
      ],
    });
  });

  it("should track error in invocation on failure", async () => {
    structuredProviderResponseService.executeAndParse.mockRejectedValue(new Error("Provider timeout"));

    await expect(service.processManagementAction({
      projectId: "proj1",
      provider: "claude-code",
      model: "claude-3",
      apiKey: "test-key",
      sessionId: "sess1",
      settings: mockSettings,
      prompt: "Do something",
      repoPath: "/tmp/test-repo",
    })).rejects.toThrow("Provider timeout");

    const calls = executionRepository.appendExecutionInvocationMessage.mock.calls;
    expect(calls[0]).toEqual(["exec-123", { role: "user", contentMarkdown: "Do something" }]);
    expect(calls[1]).toEqual(["exec-123", { role: "system", contentMarkdown: "Error: Provider timeout" }]);
    expect(executionRepository.updateExecutionInvocation).toHaveBeenCalledWith("exec-123", { status: "failed", finishedAt: expect.any(String) });
  });

  it("should provide parsing logic that extracts JSON correctly", async () => {
     let parseFn: any;
     structuredProviderResponseService.executeAndParse.mockImplementation(async (args) => {
       parseFn = args.parseFn;
       return { parsed: parseFn('```json\n{"replyMarkdown": "Hi", "action": null}\n```'), nativeSessionId: null, bodyMarkdown: "" };
     });

     await service.processManagementAction({
       projectId: "proj1",
       provider: "claude-code",
       model: "claude-3",
       apiKey: "test-key",
       sessionId: "sess1",
       settings: mockSettings,
       prompt: "Say hello",
       repoPath: "/tmp/test-repo",
     });

     expect(parseFn('```json\n{"replyMarkdown": "Hi", "action": null}\n```')).toEqual({replyMarkdown: "Hi", action: null});
     expect(parseFn('{"replyMarkdown": "Hello", "action": null}')).toEqual({replyMarkdown: "Hello", action: null});
     expect(parseFn('json\n{"replyMarkdown": "Language prefix", "action": null}')).toEqual({replyMarkdown: "Language prefix", action: null});
     const providerEnvelope = JSON.stringify({
       session_id: "session-1",
       response: "```json\n{\n  \"replyMarkdown\": \"Nested hello\",\n  \"action\": null\n}\n```",
       stats: {},
     }, null, 2);
     expect(parseFn(`[setup] Bootstrap complete.\n${providerEnvelope}\nnpm notice`)).toEqual({replyMarkdown: "Nested hello", action: null});

     expect(() => parseFn('{"action": null}')).toThrow("Missing or invalid 'replyMarkdown'");
  });

  it("should parse and sanitize prompt suggestions from JSON provider replies", () => {
    const parsed = parseProviderManagementJson(JSON.stringify({
      replyMarkdown: "Here are options.",
      action: null,
      suggestions: [
        { label: "  Start sprint  ", prompt: "  Start the queued sprint  ", icon: " play ", id: " start " },
        { label: "", prompt: "Missing label" },
        { label: "Missing prompt", prompt: "   " },
        "not an object",
      ],
    }));

    expect(parsed).toEqual({
      replyMarkdown: "Here are options.",
      action: null,
      promptSuggestions: [
        { label: "Start sprint", prompt: "Start the queued sprint", icon: "play", id: "start" },
      ],
    });
  });

  it("parses a bounded agent effect without changing the visible reply", () => {
    const parsed = parseProviderManagementJson(JSON.stringify({
      replyMarkdown: "The deployment is ready.",
      action: null,
      agentEffect: {
        emotion: "excited",
        animation: "nod",
        caption: "Ready to ship!",
        durationMs: 2400,
      },
    }));

    expect(parsed).toEqual({
      replyMarkdown: "The deployment is ready.",
      action: null,
      agentEffect: {
        emotion: "excited",
        animation: "nod",
        caption: "Ready to ship!",
        durationMs: 2400,
      },
    });
  });

  it.each([
    null,
    "happy",
    { emotion: "unknown", animation: "nod", durationMs: 1000 },
    { emotion: "happy", animation: "teleport", durationMs: 1000 },
    { emotion: "happy", animation: "nod", durationMs: 499 },
    { emotion: "happy", animation: "nod", durationMs: 10_001 },
    { emotion: "happy", animation: "nod", durationMs: 1000.5 },
    { emotion: "happy", animation: "nod", durationMs: 1000, caption: "x".repeat(121) },
  ])("omits invalid agent effects while preserving the reply: %j", (agentEffect) => {
    expect(parseProviderManagementJson(JSON.stringify({
      replyMarkdown: "Still readable.",
      action: null,
      agentEffect,
    }))).toEqual({
      replyMarkdown: "Still readable.",
      action: null,
    });
  });

  it("retains a valid agent effect on action results", async () => {
    structuredProviderResponseService.executeAndParse.mockResolvedValue({
      parsed: {
        replyMarkdown: "I updated the sprint.",
        action: { domain: "sprints", action: "update_sprint", payload: { id: "s1" } },
        agentEffect: { emotion: "proud", animation: "nod", durationMs: 1800 },
      },
      nativeSessionId: "sess1",
      bodyMarkdown: "",
    });
    managementToolHandler.handleManageCodeUx.mockResolvedValue({
      content: [{ type: "text", text: JSON.stringify({ result: { status: "success" } }) }],
    });

    const result = await service.processManagementAction({
      projectId: "proj1",
      provider: "claude-code",
      model: "claude-3",
      apiKey: "test-key",
      sessionId: "sess1",
      settings: mockSettings,
      prompt: "Update sprint",
      repoPath: "/tmp/test-repo",
    });

    expect(result.agentEffect).toEqual({ emotion: "proud", animation: "nod", durationMs: 1800 });
    expect(result.action).not.toBeNull();
  });

  it("should parse promptSuggestions aliases and cap stored suggestions", () => {
    const promptSuggestions = Array.from({ length: 8 }, (_, index) => ({
      label: `Option ${index + 1}`,
      prompt: `Run option ${index + 1}`,
    }));

    const parsed = parseProviderManagementJson(JSON.stringify({
      replyMarkdown: "Choose one.",
      action: null,
      promptSuggestions,
    }));

    expect(parsed.promptSuggestions).toHaveLength(6);
    expect(parsed.promptSuggestions?.at(0)).toEqual({ label: "Option 1", prompt: "Run option 1" });
    expect(parsed.promptSuggestions?.at(5)).toEqual({ label: "Option 6", prompt: "Run option 6" });
  });

  it("should omit promptSuggestions when all suggestions are malformed", () => {
    const parsed = parseProviderManagementJson(JSON.stringify({
      replyMarkdown: "No useful options.",
      action: null,
      suggestions: [
        { label: "Missing prompt" },
        { prompt: "Missing label" },
        null,
      ],
    }));

    expect(parsed).toEqual({
      replyMarkdown: "No useful options.",
      action: null,
    });
  });

  describe("MCP-native mode", () => {
    const mcpConnection = { url: "http://127.0.0.1:4445/mcp", authToken: null };

    it("should use providerExecutionService directly when mcpConnection is provided", async () => {
      providerExecutionService.executeProvider.mockResolvedValue({
        ok: true,
        stdout: "",
        stderr: "",
        text: "Here are the sprints for your project.",
        usageTelemetry: { transcriptText: "", inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, reasoningOutputTokens: 0, totalTokens: 0, nativeSessionId: null },
        nativeSessionId: null,
      } as any);

      const result = await service.processManagementAction({
        projectId: "proj1",
        provider: "gemini",
        model: "gemini-2",
        apiKey: "test-key",
        providerMountAuth: true,
        providerAuthPath: "~/.gemini",
        sessionId: "sess1",
        continueSessionId: "sess1",
        settings: mockSettings,
        prompt: "List sprints",
        repoPath: "/tmp/test-repo",
        mcpConnection,
      });

      expect(result.replyMarkdown).toBe("Here are the sprints for your project.");
      expect(result.action).toBeNull();
      expect(result.approvalRequired).toBe(false);

      // Should NOT call structuredProviderResponseService
      expect(structuredProviderResponseService.executeAndParse).not.toHaveBeenCalled();

      // Should call providerExecutionService with mcpConnection
      expect(providerExecutionService.executeProvider).toHaveBeenCalledWith(
        expect.objectContaining({
          mcpConnection,
          expectTextOutput: true,
          provider: "gemini",
          providerMountAuth: true,
          providerAuthPath: "~/.gemini",
          continueSessionId: "sess1",
          trackPromptInInvocation: false,
          finalizeExecutionInvocation: false,
        })
      );
      expect(providerExecutionService.executeProvider.mock.calls[0]?.[0].trackAssistantInInvocation).toBeUndefined();

      // Verify tracking
      const calls = executionRepository.appendExecutionInvocationMessage.mock.calls;
      expect(calls[0]).toEqual(["exec-123", { role: "user", contentMarkdown: "List sprints" }]);
      expect(calls[1]).toEqual(["exec-123", { role: "assistant", contentMarkdown: "Here are the sprints for your project." }]);
    });

    it("extracts a valid codeux:agent fence and preserves malformed fences as readable markdown", async () => {
      providerExecutionService.executeProvider
        .mockResolvedValueOnce({
          ok: true,
          stdout: "",
          stderr: "",
          text: [
            "All done.",
            "```codeux:agent",
            JSON.stringify({ emotion: "happy", animation: "dance", caption: "Done!", durationMs: 2200 }),
            "```",
          ].join("\n"),
          usageTelemetry: { transcriptText: "", conversation: [] },
          nativeSessionId: "native-1",
        } as any)
        .mockResolvedValueOnce({
          ok: true,
          stdout: "",
          stderr: "",
          text: "Reply\n```codeux:agent\n{not json}\n```",
          usageTelemetry: { transcriptText: "", conversation: [] },
          nativeSessionId: "native-1",
        } as any);

      const args = {
        projectId: "proj1",
        provider: "gemini" as const,
        model: "gemini-2",
        apiKey: "test-key",
        sessionId: "sess1",
        settings: mockSettings,
        prompt: "Reply",
        repoPath: "/tmp/test-repo",
        mcpConnection,
      };
      const valid = await service.processManagementAction(args);
      const malformed = await service.processManagementAction(args);

      expect(valid.replyMarkdown).toBe("All done.");
      expect(valid.agentEffect).toEqual({ emotion: "happy", animation: "dance", caption: "Done!", durationMs: 2200 });
      expect(malformed.agentEffect).toBeUndefined();
      expect(malformed.replyMarkdown).toContain("```json\n{not json}\n```");
      expect(malformed.replyMarkdown).not.toContain("codeux:agent");
    });

    it("forwards LOCAL git policy for mockup-cli MCP-native chat workers", async () => {
      providerExecutionService.executeProvider.mockResolvedValue({
        ok: true,
        stdout: "",
        stderr: "",
        text: "mockup reply",
        usageTelemetry: { transcriptText: "", inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, reasoningOutputTokens: 0, totalTokens: 0, nativeSessionId: null },
        nativeSessionId: "mockup-native",
      } as any);

      await service.processManagementAction({
        projectId: "proj1",
        provider: "mockup-cli",
        model: "default",
        apiKey: "",
        sessionId: "thread-1",
        settings: mockSettings,
        prompt: "mockup-cli:write answer.txt :: ok",
        repoPath: "/tmp/local-test-repo",
        snapshotCheckout: { branch: "main" },
        gitPolicy: {
          githubMode: "LOCAL",
          defaultBranch: "main",
          githubToken: undefined,
          gitlabToken: undefined,
        },
        mcpConnection,
      });

      expect(providerExecutionService.executeProvider).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: "mockup-cli",
          snapshotCheckout: { branch: "main" },
          gitPolicy: expect.objectContaining({
            githubMode: "LOCAL",
            defaultBranch: "main",
          }),
          expectTextOutput: true,
        }),
      );
    });

    it("should handle provider failure in MCP-native mode", async () => {
      providerExecutionService.executeProvider.mockResolvedValue({
        ok: false,
        stdout: "",
        stderr: "connection refused",
        text: "",
        usageTelemetry: { transcriptText: "" },
        nativeSessionId: null,
      } as any);

      await expect(service.processManagementAction({
        projectId: "proj1",
        provider: "claude-code",
        model: "claude-3",
        apiKey: "test-key",
        sessionId: "sess1",
        settings: mockSettings,
        prompt: "Do something",
        repoPath: "/tmp/test-repo",
        mcpConnection,
      })).rejects.toThrow("Virtual claude-code worker failed: connection refused");

      expect(executionRepository.updateExecutionInvocation).toHaveBeenCalledWith("exec-123", { status: "failed", finishedAt: expect.any(String) });
    });

    it("should fall back to JSON parsing when mcpConnection is null", async () => {
      structuredProviderResponseService.executeAndParse.mockResolvedValue({
        parsed: { replyMarkdown: "Fallback reply", action: null },
        nativeSessionId: "sess1",
        bodyMarkdown: "",
      });

      const result = await service.processManagementAction({
        projectId: "proj1",
        provider: "claude-code",
        model: "claude-3",
        apiKey: "test-key",
        sessionId: "sess1",
        settings: mockSettings,
        prompt: "Say hello",
        repoPath: "/tmp/test-repo",
        mcpConnection: null,
      });

      expect(result.replyMarkdown).toBe("Fallback reply");
      expect(structuredProviderResponseService.executeAndParse).toHaveBeenCalled();
      expect(providerExecutionService.executeProvider).not.toHaveBeenCalled();
    });

    it("forwards continueSessionId in JSON parsing mode", async () => {
      structuredProviderResponseService.executeAndParse.mockResolvedValue({
        parsed: { replyMarkdown: "Continued reply", action: null },
        nativeSessionId: null,
        bodyMarkdown: "",
      });

      await service.processManagementAction({
        projectId: "proj1",
        provider: "qwen-code",
        model: "qwen3-coder-plus",
        apiKey: "test-key",
        sessionId: "thread-1",
        continueSessionId: "thread-1",
        settings: mockSettings,
        prompt: "Continue",
        repoPath: "/tmp/test-repo",
        mcpConnection: null,
      });

      expect(structuredProviderResponseService.executeAndParse).toHaveBeenCalledWith(
        expect.objectContaining({
          continueSessionId: "thread-1",
        })
      );
    });
  });
});
