import { describe, expect, it, vi } from "vitest";
import { AgentToolHandler } from "../../../src/mcp/agent-tool-handler.js";

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
      sprintOrchestrator: { execute: vi.fn() } as any,
      taskService: { createTaskAgentSession } as any,
      getDashboardSettings: () => ({ git: { sprintBranchScheme: "feature/sprint{sprint}-implementation" } }) as any,
      formatSprintBranch: (scheme: string | undefined, sprint: number) => (scheme || "feature/sprint{sprint}-implementation").replace("{sprint}", String(sprint)),
      getConsecutiveFailures: () => 0,
      setConsecutiveFailures: vi.fn(),
      getMaxFailures: () => 5,
      waitForSessionCompletion: vi.fn(),
    });

    const response = await handler.handleTaskAgent({
      prompt: "do work",
      source_id: "123",
      repo_path: "/tmp/repo",
      wait: false,
    });

    const parsed = JSON.parse(response.content[0].text as string);
    expect(parsed.id).toBe("sessions/new");
    expect(parsed.hasPullRequest).toBe(true);
    expect(parsed.pullRequests).toEqual([{ url: "https://example.com/pr/new" }]);
    expect(parsed.prompt).toBeUndefined();
  });
});
