import { describe, expect, it, vi } from "vitest";
import { AgentToolHandler } from "../../../src/mcp/agent-tool-handler.js";
import { registerMcpRequestHandlers } from "../../../src/server/mcp-request-router.js";
import { CallToolRequestSchema, ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";

describe("AgentToolHandler", () => {
  it("returns compact task_agent response when wait is false", async () => {
    const createTaskAgentSession = vi.fn().mockResolvedValue({
      id: "sessions/new",
      name: "sessions/new",
      title: "Task",
      state: "RUNNING",
      provider: "jules",
      prompt: "very large prompt",
      outputs: [{ pullRequest: { url: "https://example.com/pr/new" } }],
    });

    const handler = new AgentToolHandler({
      sprintOrchestrator: { execute: vi.fn() } as unknown as import("../../../src/sprint/sprint-orchestrator.js").SprintOrchestrator,
      taskService: { createTaskAgentSession } as unknown as import("../../../src/services/task-service.js").TaskService,
      getDashboardSettings: () => ({ git: { sprintBranchScheme: "feature/sprint{sprint}-implementation" } }) as unknown as import("../../../src/contracts/app-types.js").DashboardSettings,
      formatSprintBranch: (scheme: string | undefined, sprint: number) => (scheme || "feature/sprint{sprint}-implementation").replace("{sprint}", String(sprint)),
      getConsecutiveFailures: () => 0,
      setConsecutiveFailures: vi.fn(),
      getMaxFailures: () => 5,
      waitForSessionCompletion: vi.fn(),
    });

    const response = await handler.handleTaskAgent({
      prompt: "do work",
      source_id: "123",
      wait: false,
    });

    const parsed = JSON.parse(response.content[0].text as string);
    expect(parsed.id).toBe("sessions/new");
    expect(parsed.hasPullRequest).toBe(true);
    expect(parsed.pullRequests).toEqual([{ url: "https://example.com/pr/new" }]);
    expect(parsed.prompt).toBeUndefined();
    expect(createTaskAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        repo_path: process.cwd(),
      })
    );
  });
});

describe("AgentToolHandler validation", () => {
  it("rejects malformed payloads with ErrorCode.InvalidParams before handler dispatch", async () => {
    let handlerCalled = false;
    const handler = new AgentToolHandler({} as any);
    handler.handleTaskAgent = vi.fn().mockImplementation(async () => {
      handlerCalled = true;
      return {};
    });

    const mockServer = {
      setRequestHandler: vi.fn(),
    };

    registerMcpRequestHandlers({
      server: mockServer as any,
      coreToolHandler: {} as any,
      agentToolHandler: handler,
      getDashboardSettings: () => ({ mcpTools: [{ name: "task_agent", enabled: true }] }) as any,
      formatError: (e) => {
        if (e instanceof McpError) throw e;
        return { content: [{ type: "text", text: "err" }], isError: true };
      },
    });

    const callHandlerArgs = mockServer.setRequestHandler.mock.calls.find(
      (args) => args[0] === CallToolRequestSchema
    );
    expect(callHandlerArgs).toBeDefined();

    const callHandler = callHandlerArgs![1];

    // Missing required 'prompt'
    try {
      await callHandler({
        method: "tools/call",
        params: {
          name: "task_agent",
          arguments: { title: "123" }
        }
      }, {} as any);
      expect.fail("Expected McpError to be thrown");
    } catch (e: any) {
      if (!(e instanceof McpError)) {
        console.error(e);
      }
      expect(e).toBeInstanceOf(McpError);
      expect(e.code).toBe(ErrorCode.InvalidParams);
      expect(e.message).toContain("must have required property 'prompt'");
    }

    expect(handlerCalled).toBe(false);
  });
});
