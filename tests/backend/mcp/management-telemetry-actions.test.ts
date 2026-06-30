import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleTelemetryActions } from "../../../src/mcp/management/telemetry-actions.js";
import type { ExecutionRepository } from "../../../src/repositories/execution-repository.js";

describe("management-telemetry-actions", () => {
  let mockExecutionRepository: vi.Mocked<ExecutionRepository>;

  beforeEach(() => {
    mockExecutionRepository = {
      getProjectExecutionSnapshot: vi.fn(),
      getProjectStatsSnapshot: vi.fn(),
      listSprintRuns: vi.fn(),
      listTaskDispatches: vi.fn(),
      listExecutionInvocations: vi.fn(),
      listExecutionInvocationMessages: vi.fn(),
    } as unknown as vi.Mocked<ExecutionRepository>;
  });

  it("should get_project_execution_snapshot", async () => {
    mockExecutionRepository.getProjectExecutionSnapshot.mockResolvedValueOnce({ sprints: [] } as any);
    const result = await handleTelemetryActions(
      { domain: "telemetry", action: "get_project_execution_snapshot", payload: { projectId: "proj-1" } },
      mockExecutionRepository
    );
    expect(mockExecutionRepository.getProjectExecutionSnapshot).toHaveBeenCalledWith("proj-1");
    expect(result.result).toBeDefined();
    expect((result.result as any).data.sprints).toBeDefined();
  });

  it("should list_sprint_runs with compact mapping", async () => {
    const mockRuns = [
      { id: "run-1", sprintId: "sprint-1", status: "completed", createdAt: "2024-01-01", updatedAt: "2024-01-02", extraField: "should-be-omitted" }
    ];
    mockExecutionRepository.listSprintRuns.mockResolvedValueOnce(mockRuns as any);

    const result = await handleTelemetryActions(
      { domain: "telemetry", action: "list_sprint_runs", payload: { projectId: "proj-1", sprintId: "sprint-1" } },
      mockExecutionRepository
    );
    expect(mockExecutionRepository.listSprintRuns).toHaveBeenCalledWith("proj-1", "sprint-1");
    expect(result.result).toBeDefined();
    const data = (result.result as any).data;
    expect(data.length).toBe(1);
    expect(data[0].extraField).toBeUndefined();
    expect(data[0].id).toBe("run-1");
  });

  it("should list_execution_invocations with compact mapping", async () => {
    const mockInvocations = [
      { id: "inv-1", type: "chat", status: "success", provider: "openai", messageCount: 5, lastMessageAt: "2024-01-01", createdAt: "2024-01-01", extraField: "omit-me" }
    ];
    mockExecutionRepository.listExecutionInvocations.mockResolvedValueOnce(mockInvocations as any);

    const result = await handleTelemetryActions(
      { domain: "telemetry", action: "list_execution_invocations", payload: { projectId: "proj-1", sprintId: "sprint-1" } },
      mockExecutionRepository
    );
    expect(mockExecutionRepository.listExecutionInvocations).toHaveBeenCalledWith({ projectId: "proj-1", taskRunId: undefined });
    expect(result.result).toBeDefined();
    const data = (result.result as any).data;
    expect(data[0].extraField).toBeUndefined();
    expect(data[0].id).toBe("inv-1");
  });

  it("should get_project_stats_snapshot", async () => {
    mockExecutionRepository.getProjectStatsSnapshot.mockResolvedValueOnce({ totals: {} } as any);
    const result = await handleTelemetryActions(
      { domain: "telemetry", action: "get_project_stats_snapshot", payload: { projectId: "proj-1" } },
      mockExecutionRepository
    );
    expect(mockExecutionRepository.getProjectStatsSnapshot).toHaveBeenCalledWith("proj-1");
    expect((result.result as any).data.totals).toBeDefined();
  });

  it("should list_task_dispatches with compact mapping", async () => {
    mockExecutionRepository.listTaskDispatches.mockResolvedValueOnce([
      { id: "d-1", taskId: "t-1", status: "running", createdAt: "a", updatedAt: "b", secret: "x" },
    ] as any);
    const result = await handleTelemetryActions(
      { domain: "telemetry", action: "list_task_dispatches", payload: { projectId: "p", sprintId: "s", taskId: "t" } },
      mockExecutionRepository
    );
    expect(mockExecutionRepository.listTaskDispatches).toHaveBeenCalledWith({ projectId: "p", sprintId: "s", taskId: "t" });
    const data = (result.result as any).data;
    expect(data[0]).toEqual({ id: "d-1", taskId: "t-1", status: "running", assignedWorkerId: null, createdAt: "a", updatedAt: "b" });
  });

  it("should list_execution_invocation_messages with compact mapping", async () => {
    mockExecutionRepository.listExecutionInvocationMessages.mockResolvedValueOnce([
      { id: "m-1", invocationId: "inv-1", role: "assistant", createdAt: "a", body: "ignored" },
    ] as any);
    const result = await handleTelemetryActions(
      { domain: "telemetry", action: "list_execution_invocation_messages", payload: { invocationId: "inv-1" } },
      mockExecutionRepository
    );
    expect(mockExecutionRepository.listExecutionInvocationMessages).toHaveBeenCalledWith("inv-1");
    const data = (result.result as any).data;
    expect(data[0]).toEqual({ id: "m-1", invocationId: "inv-1", role: "assistant", hasToolCalls: false, createdAt: "a" });
  });

  it.each([
    ["get_project_execution_snapshot", {}, /Missing required 'projectId'/],
    ["get_project_stats_snapshot", {}, /Missing required 'projectId'/],
    ["list_sprint_runs", { projectId: "p" }, /Missing required 'projectId' or 'sprintId'/],
    ["list_task_dispatches", { projectId: "p", sprintId: "s" }, /Missing required 'projectId', 'sprintId', or 'taskId'/],
    ["list_execution_invocations", {}, /Missing required 'projectId'/],
    ["list_execution_invocation_messages", {}, /Missing required 'invocationId'/],
  ])("wraps validation failures for %s", async (action, payload, matcher) => {
    await expect(
      handleTelemetryActions({ domain: "telemetry", action, payload } as any, mockExecutionRepository),
    ).rejects.toThrow(matcher);
  });

  it("wraps the error with the telemetry action prefix", async () => {
    await expect(
      handleTelemetryActions({ domain: "telemetry", action: "list_sprint_runs", payload: {} } as any, mockExecutionRepository),
    ).rejects.toThrow(/Telemetry action 'list_sprint_runs' failed:/);
  });

  it("throws for an unknown telemetry action", async () => {
    await expect(
      handleTelemetryActions({ domain: "telemetry", action: "nope", payload: {} } as any, mockExecutionRepository),
    ).rejects.toThrow(/Unknown telemetry action: nope/);
  });
});
