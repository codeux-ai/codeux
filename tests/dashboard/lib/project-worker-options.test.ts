import { describe, expect, it } from "vitest";
import { getProjectWorkerOptions } from "../../../dashboard/src/v2/lib/project-worker-options.js";
import type {
  ExecutionDashboardSnapshot,
  ExecutionConnectionSummary,
  ExecutionAssignedWorkerSummary,
  SystemSettings,
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
    expect(result.options).toHaveLength(7);
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
    expect(result.options).toHaveLength(8);
    expect(result.options[0].isPrimary).toBe(true);
    expect(result.options[1].isPrimary).toBe(false);
  });

  it("handles offline primary not in connections", () => {
    const snapshot = { ...mockSnapshot, connections: [] };
    const result = getProjectWorkerOptions(snapshot, connectedRouting);
    expect(result.options).toHaveLength(7);
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

    expect(result.options.filter((option) => option.type === "virtual")).toHaveLength(6);
    expect(result.selectedOption).toMatchObject({
      type: "virtual",
      providerId: "gemini",
      label: "Gemini Primary",
    });
    expect(result.options[0]?.isPrimary).toBe(false);
  });

  it("handles null execution", () => {
    const result = getProjectWorkerOptions(null, {
      executionMode: "VIRTUAL",
      virtualWorkerProvider: "codex",
    });
    expect(result.options).toHaveLength(6);
    expect(result.selectedOption?.providerId).toBe("codex");
  });

  it("handles loading state", () => {
    const result = getProjectWorkerOptions(mockSnapshot, connectedRouting, true);
    expect(result.isLoading).toBe(true);
    expect(result.options).toHaveLength(7);
  });

  it("uses configured provider instance names and model metadata for available virtual workers", () => {
    const systemSettings = {
      integrations: {
        providers: {
          "codex-staging": {
            provider: "codex",
            name: "Codex Credentials",
            apiKey: "key",
            mountAuth: false,
            authPath: "~/.codex",
          },
          "qwen-code": {
            provider: "qwen-code",
            name: "Qwen Credentials",
            apiKey: "",
            mountAuth: true,
            authPath: "~/.qwen",
          },
          opencode: {
            provider: "opencode",
            name: "OpenCode Credentials",
            apiKey: "key",
            mountAuth: false,
            authPath: "~/.local/share/opencode",
          },
          antigravity: {
            provider: "antigravity",
            name: "Antigravity Credentials",
            apiKey: "key",
            mountAuth: false,
            authPath: "~/.antigravity",
          },
          gemini: {
            provider: "gemini",
            name: "Gemini Unavailable",
            apiKey: "",
            mountAuth: false,
            authPath: "~/.gemini",
          },
        },
      },
      defaults: {
        aiProvider: {
          providers: {
            "codex-staging": {
              provider: "codex",
              name: "Codex Staging",
              enabled: true,
              model: "gpt-5.4",
              weight: 50,
              thinkingMode: "HIGH",
            },
            "qwen-code": {
              provider: "qwen-code",
              name: "Qwen Primary",
              enabled: true,
              model: "qwen3-coder-plus",
              weight: 50,
              thinkingMode: "HIGH",
            },
            opencode: {
              provider: "opencode",
              name: "OpenCode Primary",
              enabled: true,
              model: "anthropic/claude-sonnet-4-5",
              weight: 50,
              thinkingMode: "HIGH",
            },
            antigravity: {
              provider: "antigravity",
              name: "Antigravity Primary",
              enabled: true,
              model: "default",
              weight: 50,
              thinkingMode: "HIGH",
            },
          },
        },
      },
    } as SystemSettings;

    const result = getProjectWorkerOptions(
      null,
      { executionMode: "VIRTUAL", virtualWorkerProvider: "codex-staging" },
      false,
      systemSettings,
    );
    const virtualOptions = result.options.filter((option) => option.type === "virtual");

    expect(virtualOptions.map((option) => option.label)).toEqual([
      "Codex Staging",
      "Qwen Primary",
      "OpenCode Primary",
      "Antigravity Primary",
    ]);
    expect(result.selectedOption).toMatchObject({
      providerConfigId: "codex-staging",
      providerId: "codex",
      iconProviderId: "codex",
      effectiveModel: "gpt-5.4",
    });
    expect(virtualOptions.some((option) => option.providerId === "gemini")).toBe(false);
  });
});
