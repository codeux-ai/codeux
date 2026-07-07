import { describe, expect, it, vi } from "vitest";
import type { WorkerConfig } from "../../../src/worker/worker-config.js";
import type { WorkerControlPlaneClient, LocalWorkerExecutionClient } from "../../../src/worker/index.js";
import { McpWorkerControlPlaneClient, runWorkerClient } from "../../../src/worker/index.js";
import type { WorkerTaskDispatchClaim } from "../../../src/contracts/execution-types.js";

function createConfig(overrides: Partial<WorkerConfig> = {}): WorkerConfig {
  return {
    connectionKey: "worker-1",
    displayName: "Worker 1",
    projectId: "project-1",
    projectIds: ["project-1"],
    activeProjectIds: [],
    listenTimeoutSeconds: 30,
    listenPollIntervalMs: 1,
    dispatchPollIntervalMs: 1,
    sessionPollIntervalMs: 1,
    controlPlaneUrl: "http://127.0.0.1:4445/mcp",
    controlPlaneAuthToken: "token",
    serverCommand: "node",
    serverArgs: ["dist/index.js", "--runtime-role", "worker-host"],
    ...overrides,
  };
}

function createClaim(overrides: Partial<WorkerTaskDispatchClaim> = {}): WorkerTaskDispatchClaim {
  return {
    dispatch: {
      id: "dispatch-1",
      projectId: "project-1",
      sprintId: "sprint-1",
      taskId: "task-1",
      sprintRunId: "run-1",
      connectionId: "conn-1",
      executorType: "mcp_worker",
      status: "claimed",
      priority: 1,
      queuedAt: "2026-01-01T00:00:00.000Z",
      claimedAt: "2026-01-01T00:00:01.000Z",
      startedAt: null,
      finishedAt: null,
      lastHeartbeatAt: null,
      errorMessage: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:01.000Z",
    },
    leaseToken: "lease-1",
    project: {
      id: "project-1",
      name: "Project 1",
      baseDir: "/workspace/project-1",
      sourceType: "local",
      sourceRef: "/workspace/project-1",
      defaultBranch: "main",
      featureBranchPrefix: "feat/",
    },
    sprint: {
      id: "sprint-1",
      name: "Sprint 1",
      number: 1,
      goal: "Ship it",
      featureBranch: "feat/sprint-1",
    },
    task: {
      id: "task-1",
      taskKey: "T01",
      title: "Task 1",
      promptMarkdown: "Do it",
      description: "Task description",
      priority: "high",
      dependsOnTaskIds: [],
      executorType: "mcp_worker",
    },
    executionContext: {
      repoPath: "/workspace/project-1",
      defaultBranch: "main",
      featureBranch: "feat/sprint-1",
    },
    ...overrides,
  };
}

function createClients(claims: Array<WorkerTaskDispatchClaim | null>, sessions: Array<{ id: string; state: string }>) {
  const controlPlaneClient: WorkerControlPlaneClient = {
    registerWorker: vi.fn(async () => ({})),
    pullTaskDispatch: vi.fn(async () => claims.shift() ?? null),
    updateTaskDispatch: vi.fn(async () => ({ controlAction: null })),
    close: vi.fn(async () => undefined),
  };
  const localClient: LocalWorkerExecutionClient = {
    executeWorkerDispatch: vi.fn(async () => ({ id: "session-1", provider: "codex", state: "RUNNING" })),
    getSession: vi.fn(async () => sessions.shift() ?? { id: "session-1", state: "COMPLETED" }),
    cancelLocalDispatch: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  };
  return { controlPlaneClient, localClient };
}

describe("McpWorkerControlPlaneClient", () => {
  it("sends registration payloads without auth token material", async () => {
    const callTool = vi.fn(async () => ({
      content: [{ type: "text", text: JSON.stringify({ endpoint: { id: "endpoint-1" } }) }],
    }));
    const client = new McpWorkerControlPlaneClient({ callTool });

    await client.registerWorker(createConfig({
      connectionKey: "cluster-worker",
      displayName: "Cluster Worker",
      projectIds: ["project-1", "project-2"],
      activeProjectIds: ["project-2"],
      controlPlaneAuthToken: "secret-token",
    }));

    expect(callTool).toHaveBeenCalledWith(expect.objectContaining({
      name: "register_worker_endpoint",
      arguments: expect.objectContaining({
        connectionKey: "cluster-worker",
        displayName: "Cluster Worker",
        transport: "streamable-http",
        projectIds: ["project-1", "project-2"],
        activeProjectIds: ["project-2"],
        capabilities: { canSuperviseProjects: true, canExecuteTasks: true },
      }),
    }));
    expect(JSON.stringify(callTool.mock.calls[0][0])).not.toContain("secret-token");
  });

  it("parses claim and update responses from MCP text content", async () => {
    const claim = createClaim();
    const callTool = vi.fn(async (request: { name: string }) => request.name === "pull_task_dispatch"
      ? { content: [{ type: "text", text: JSON.stringify(claim) }] }
      : { content: [{ type: "text", text: JSON.stringify({ controlAction: "cancel" }) }] });
    const client = new McpWorkerControlPlaneClient({ callTool });

    await expect(client.pullTaskDispatch({ connectionKey: "worker-1", projectId: "project-1" })).resolves.toMatchObject({
      leaseToken: "lease-1",
      dispatch: { id: "dispatch-1" },
    });
    await expect(client.updateTaskDispatch({
      connectionKey: "worker-1",
      dispatchId: "dispatch-1",
      leaseToken: "lease-1",
      state: "RUNNING",
    })).resolves.toEqual({ controlAction: "cancel", dispatch: undefined });
  });
});

describe("runWorkerClient", () => {
  it("registers, claims, executes locally, and reports running plus terminal status", async () => {
    const { controlPlaneClient, localClient } = createClients([createClaim()], [{ id: "session-1", state: "COMPLETED" }]);

    await runWorkerClient(createConfig(), {
      controlPlaneClient,
      localClient,
      sleep: async () => undefined,
      maxIterations: 1,
    });

    expect(controlPlaneClient.registerWorker).toHaveBeenCalledTimes(1);
    expect(controlPlaneClient.pullTaskDispatch).toHaveBeenCalledWith({
      connectionKey: "worker-1",
      projectId: "project-1",
      sprintId: undefined,
    });
    expect(localClient.executeWorkerDispatch).toHaveBeenCalledWith(expect.objectContaining({ leaseToken: "lease-1" }));
    expect(controlPlaneClient.updateTaskDispatch).toHaveBeenNthCalledWith(1, expect.objectContaining({
      dispatchId: "dispatch-1",
      leaseToken: "lease-1",
      state: "RUNNING",
      sessionId: "session-1",
    }));
    expect(controlPlaneClient.updateTaskDispatch).toHaveBeenNthCalledWith(2, expect.objectContaining({
      dispatchId: "dispatch-1",
      leaseToken: "lease-1",
      state: "COMPLETED",
    }));
  });

  it("polls each active project in a multi-project worker scope", async () => {
    const { controlPlaneClient, localClient } = createClients([null, null], []);

    await runWorkerClient(createConfig({
      projectIds: ["project-1", "project-2", "project-3"],
      activeProjectIds: ["project-2", "project-3"],
    }), {
      controlPlaneClient,
      localClient,
      sleep: async () => undefined,
      maxIterations: 1,
    });

    expect(controlPlaneClient.pullTaskDispatch).toHaveBeenCalledTimes(2);
    expect(controlPlaneClient.pullTaskDispatch).toHaveBeenNthCalledWith(1, expect.objectContaining({ projectId: "project-2" }));
    expect(controlPlaneClient.pullTaskDispatch).toHaveBeenNthCalledWith(2, expect.objectContaining({ projectId: "project-3" }));
    expect(localClient.executeWorkerDispatch).not.toHaveBeenCalled();
  });

  it("refuses to execute a claim without a lease token", async () => {
    const claim = createClaim({ leaseToken: "" });
    const { controlPlaneClient, localClient } = createClients([claim], []);

    await expect(runWorkerClient(createConfig(), {
      controlPlaneClient,
      localClient,
      sleep: async () => undefined,
      maxIterations: 1,
    })).rejects.toThrow(/without a lease token/);

    expect(localClient.executeWorkerDispatch).not.toHaveBeenCalled();
  });

  it("cancels local execution when the control plane returns a cancel action", async () => {
    const { controlPlaneClient, localClient } = createClients([createClaim()], []);
    vi.mocked(controlPlaneClient.updateTaskDispatch).mockResolvedValueOnce({ controlAction: "cancel" });

    await runWorkerClient(createConfig(), {
      controlPlaneClient,
      localClient,
      sleep: async () => undefined,
      maxIterations: 1,
    });

    expect(localClient.cancelLocalDispatch).toHaveBeenCalledWith("dispatch-1", expect.stringContaining("cancellation requested"));
    expect(controlPlaneClient.updateTaskDispatch).toHaveBeenLastCalledWith(expect.objectContaining({
      dispatchId: "dispatch-1",
      leaseToken: "lease-1",
      state: "FAILED",
      errorMessage: expect.stringContaining("cancellation requested"),
    }));
  });

  it("retries transient registration and update failures with bounded backoff", async () => {
    const { controlPlaneClient, localClient } = createClients([createClaim()], [{ id: "session-1", state: "COMPLETED" }]);
    vi.mocked(controlPlaneClient.registerWorker)
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce({});
    vi.mocked(controlPlaneClient.updateTaskDispatch)
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValue({ controlAction: null });
    const sleeps: number[] = [];

    await runWorkerClient(createConfig(), {
      controlPlaneClient,
      localClient,
      sleep: async (ms) => { sleeps.push(ms); },
      maxIterations: 1,
      retryBaseDelayMs: 10,
      retryMaxDelayMs: 20,
    });

    expect(controlPlaneClient.registerWorker).toHaveBeenCalledTimes(2);
    expect(controlPlaneClient.updateTaskDispatch).toHaveBeenCalledTimes(3);
    expect(sleeps).toContain(10);
    expect(localClient.executeWorkerDispatch).toHaveBeenCalledTimes(1);
  });
});
