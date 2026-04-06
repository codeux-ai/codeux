import { describe, it, expect, vi, beforeEach } from "vitest";
import { ChatManagementActionService } from "../../../src/services/chat-management-action-service.js";
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
      handleManageSprintOs: vi.fn(),
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

    managementToolHandler.handleManageSprintOs.mockResolvedValue({
      content: [{ type: "text", text: JSON.stringify({ result: { status: "success", domain: "sprints", action: "update_sprint", message: "updated" } }) }]
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
    });

    expect(managementToolHandler.handleManageSprintOs).toHaveBeenCalledWith({
      domain: "sprints",
      action: "update_sprint",
      payload: { id: "s1" },
    });

    expect(executionRepository.createExecutionInvocation).toHaveBeenCalled();
    expect(executionRepository.updateExecutionInvocation).toHaveBeenCalledWith("exec-123", { status: "completed", finishedAt: expect.any(String) });

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

    managementToolHandler.handleManageSprintOs.mockResolvedValue({
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
    expect(managementToolHandler.handleManageSprintOs).not.toHaveBeenCalled();

    // Verify prompt and response are tracked even without an action
    const calls = executionRepository.appendExecutionInvocationMessage.mock.calls;
    expect(calls[0]).toEqual(["exec-123", { role: "user", contentMarkdown: "Say hello" }]);
    expect(calls[1]).toEqual(["exec-123", { role: "assistant", contentMarkdown: "Hello world" }]);
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

     expect(() => parseFn('{"action": null}')).toThrow("Missing or invalid 'replyMarkdown'");
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
        sessionId: "sess1",
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
        })
      );

      // Verify tracking
      const calls = executionRepository.appendExecutionInvocationMessage.mock.calls;
      expect(calls[0]).toEqual(["exec-123", { role: "user", contentMarkdown: "List sprints" }]);
      expect(calls[1]).toEqual(["exec-123", { role: "assistant", contentMarkdown: "Here are the sprints for your project." }]);
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
  });
});
