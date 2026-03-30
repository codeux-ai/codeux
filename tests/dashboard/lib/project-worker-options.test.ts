import { describe, expect, it } from "vitest";
import { getProjectWorkerOptions } from "../../../dashboard/src/v2/lib/project-worker-options.js";
import type {
  ExecutionDashboardSnapshot,
  ExecutionConnectionSummary,
  ExecutionAssignedWorkerSummary,
} from "../../../dashboard/src/types.js";

const connectedRouting = {
  executionMode: "CONNECTED_MCP" as const,
  virtualWorkerProvider: "codex" as const,
};

describe("project-worker-options", () => {
  const mockConnection: ExecutionConnectionSummary = {
    id: "conn-1",
    connectionKey: "key-1",
    displayName: "Worker 1",
    role: "worker",
    transport: "mcp",
    status: "online",
    model: "gpt-4",
    instruction: null,
    labels: [],
    listenMode: false,
    machineName: null,
    platform: null,
    arch: null,
    localExecutionRuntime: null,
    lastHeartbeatAt: null,
    projectIds: [],
    activeProjectIds: [],
    tasksRunCount: 0,
    threadCount: 0,
    messageCount: 0,
    pendingInboxCount: 0,
    activeDispatchCount: 0,
  };

  const mockPrimary: ExecutionAssignedWorkerSummary = {
    assignmentId: "as-1",
    workerEndpointId: "we-1",
    workerEndpointKey: "wk-1",
    workerEndpointType: "mcp",
    workerDisplayName: "Worker 1",
    connectionId: "conn-1",
    connectionKey: "key-1",
    transport: "mcp",
    assignmentRole: "primary",
    status: "active",
    assignedAt: "2023-01-01T00:00:00Z",
    lastAffinityAt: "2023-01-01T00:00:00Z",
    workerStatus: "online",
    canSuperviseProjects: true,
    canExecuteTasks: true,
  };

  const mockSnapshot: ExecutionDashboardSnapshot = {
    projectId: "p1",
    projectName: "Project 1",
    sprintRuns: [],
    taskDispatches: [],
    connections: [mockConnection],
    primaryAssignedWorker: mockPrimary,
    overflowAssignedWorkers: [],
    attentionItems: [],
    recentEvents: [],
    updatedAt: "2023-01-01T00:00:00Z",
  };

  it("derives options correctly when primary is in connections", () => {
    const result = getProjectWorkerOptions(mockSnapshot, connectedRouting);
    expect(result.options).toHaveLength(4);
    expect(result.options[0].id).toBe("we-1");
    expect(result.options[0].isPrimary).toBe(true);
    expect(result.options[0].workerEndpointId).toBe("we-1");
    expect(result.options[0].connectionId).toBe("conn-1");
    expect(result.selectedOption?.id).toBe("we-1");
    expect(result.hasConnections).toBe(true);
  });

  it("handles multiple connections", () => {
    const conn2 = { ...mockConnection, id: "conn-2", displayName: "Worker 2" };
    const snapshot = { ...mockSnapshot, connections: [mockConnection, conn2] };
    const result = getProjectWorkerOptions(snapshot, connectedRouting);
    expect(result.options).toHaveLength(5);
    expect(result.options[0].isPrimary).toBe(true);
    expect(result.options[1].isPrimary).toBe(false);
  });

  it("handles offline primary not in connections", () => {
    const snapshot = { ...mockSnapshot, connections: [] };
    const result = getProjectWorkerOptions(snapshot, connectedRouting);
    expect(result.options).toHaveLength(4);
    expect(result.options[0].isPrimary).toBe(true);
    expect(result.options[0].label).toBe("Worker 1");
    expect(result.options[0].type).toBe("endpoint");
    expect(result.hasConnections).toBe(false);
  });

  it("always includes virtual workers and selects the active virtual provider", () => {
    const result = getProjectWorkerOptions(mockSnapshot, {
      executionMode: "VIRTUAL",
      virtualWorkerProvider: "gemini",
    });

    expect(result.options.filter((option) => option.type === "virtual")).toHaveLength(3);
    expect(result.selectedOption).toMatchObject({
      type: "virtual",
      providerId: "gemini",
      label: "Virtual Gemini Worker",
    });
    expect(result.options[0]?.isPrimary).toBe(false);
  });

  it("handles null execution", () => {
    const result = getProjectWorkerOptions(null, {
      executionMode: "VIRTUAL",
      virtualWorkerProvider: "codex",
    });
    expect(result.options).toHaveLength(3);
    expect(result.selectedOption?.providerId).toBe("codex");
  });

  it("handles loading state", () => {
    const result = getProjectWorkerOptions(mockSnapshot, connectedRouting, true);
    expect(result.isLoading).toBe(true);
    expect(result.options).toHaveLength(4);
  });
});
