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
});
