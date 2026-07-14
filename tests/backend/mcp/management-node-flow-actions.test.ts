import { describe, expect, it, vi } from "vitest";
import { ManagementToolHandler } from "../../../src/mcp/management-tool-handler.js";
import type { NodeFlowGraph, NodeFlowNodeAttemptRecord, NodeFlowRecord } from "../../../src/contracts/node-flow-types.js";
import { runWithMcpAgentContext } from "../../../src/server/mcp-agent-context.js";

const validGraph: NodeFlowGraph = {
  nodes: [
    { id: "input", type: "input", title: "Input", data: { apiToken: "secret-token", visible: "ok" } },
    { id: "output", type: "output", title: "Output" },
  ],
  edges: [{ fromNodeId: "input", toNodeId: "output" }],
};

const flowRecord = (overrides: Partial<NodeFlowRecord> = {}): NodeFlowRecord => ({
  id: "flow-1",
  projectId: "project-1",
  title: "Flow",
  description: "Flow description",
  graph: validGraph,
  version: 1,
  createdAt: "2026-07-07T00:00:00.000Z",
  updatedAt: "2026-07-07T00:00:00.000Z",
  ...overrides,
});

const attemptRecord = (overrides: Partial<NodeFlowNodeAttemptRecord> = {}): NodeFlowNodeAttemptRecord => ({
  id: "attempt-1",
  runId: "run-1",
  nodeRunId: "node-run-1",
  nodeId: "provider",
  attemptNumber: 1,
  status: "succeeded",
  executorId: "executor-1",
  invocationId: "invocation-1",
  artifactDigest: "sha256:artifact-1",
  input: { prompt: "Ship", apiKey: "secret-canary" },
  output: { result: "done", authorization: "secret-canary" },
  credentialIds: ["credential-1"],
  failureClassification: null,
  retryDecision: "stop",
  errorMessage: null,
  startedAt: "2026-07-07T00:00:00.000Z",
  finishedAt: "2026-07-07T00:00:01.000Z",
  createdAt: "2026-07-07T00:00:00.000Z",
  ...overrides,
});

const createHandler = (nodeFlowService: Record<string, unknown>): ManagementToolHandler => new ManagementToolHandler({
  projectManagementRepository: {},
  sprintPreviewService: {},
  executionRepository: {},
  getDashboardSettings: () => ({}),
  executionControlService: {},
  taskRerunService: {},
  settingsRepository: {},
  chatProviderRepository: {},
  agentPresetSyncService: {},
  memoryService: {},
  memoryPromotionService: {},
  embeddingModelManager: {},
  skillService: {},
  nodeFlowService,
  knowledgeService: {},
  planningAgentService: {},
  sprintIssueService: {},
} as any);

const parseResponse = (response: { content: Array<{ text: string }> }): Record<string, any> =>
  JSON.parse(response.content[0].text) as Record<string, any>;

describe("manage_node_flows", () => {
  it("returns validation failure envelopes before creating malformed graphs", async () => {
    const nodeFlowService = {
      validate: vi.fn(() => ({
        valid: false,
        errors: [{ field: "nodes", code: "required", message: "Node flow graph requires at least one node." }],
      })),
      create: vi.fn(),
    };
    const handler = createHandler(nodeFlowService);

    const response = await handler.handleManageNodeFlows({
      action: "create",
      projectId: "project-1",
      name: "Bad flow",
      graph: { nodes: [], edges: [] },
    });
    const parsed = parseResponse(response);

    expect(response.isError).toBe(true);
    expect(parsed.result).toMatchObject({
      status: "error",
      domain: "node_flows",
      action: "create",
      message: "Node flow graph requires at least one node.",
      errorType: "validation",
      field: "nodes",
    });
    expect(nodeFlowService.create).not.toHaveBeenCalled();
  });

  it("delegates runs to the node-flow runtime service through NodeFlowService", async () => {
    const persistedAttempt = {
      ...attemptRecord(),
      customSource: "custom-source-canary",
      sourceRevision: "source-revision-canary",
    };
    const nodeFlowService = {
      runFlow: vi.fn(async () => ({
        run: {
          id: "run-1",
          flowId: "flow-1",
          projectId: "project-1",
          version: 1,
          status: "succeeded",
          executionInvocationId: "xi-flow",
          triggerType: "mcp_management",
          triggerPayload: null,
          input: { prompt: "Ship", apiKey: "[REDACTED]" },
          output: { ok: true },
          errorMessage: null,
          startedAt: "2026-07-07T00:00:00.000Z",
          finishedAt: "2026-07-07T00:00:01.000Z",
          createdAt: "2026-07-07T00:00:00.000Z",
          updatedAt: "2026-07-07T00:00:01.000Z",
        },
        nodeRuns: [],
        attempts: [persistedAttempt],
        output: { ok: true },
      })),
    };
    const handler = createHandler(nodeFlowService);

    const response = await handler.handleManageNodeFlows({
      action: "run",
      projectId: "project-1",
      flowId: "flow-1",
      input: { prompt: "Ship" },
    });
    const parsed = parseResponse(response);

    expect(nodeFlowService.runFlow).toHaveBeenCalledWith("project-1", "flow-1", { prompt: "Ship" }, {
      triggerType: "mcp_management",
      versionSelection: { mode: "latest_published" },
    });
    expect(parsed.result.run.id).toBe("run-1");
    expect(parsed.result.output).toEqual({ ok: true });
    expect(parsed.result.attempts[0]).toMatchObject({
      attemptNumber: 1,
      status: "succeeded",
      executorId: "executor-1",
      invocationId: "invocation-1",
      artifactDigest: "sha256:artifact-1",
      input: { prompt: "Ship", apiKey: "[REDACTED]" },
      output: { result: "done", authorization: "[REDACTED]" },
      retryDecision: "stop",
    });
    expect(JSON.stringify(parsed)).not.toContain("secret-canary");
    expect(JSON.stringify(parsed)).not.toContain("custom-source-canary");
    expect(parsed.result.attempts[0]).not.toHaveProperty("credentialIds");
    expect(parsed.result.attempts[0]).not.toHaveProperty("customSource");
    expect(parsed.result.attempts[0]).not.toHaveProperty("sourceRevision");
  });

  it("inspects durable retries, terminal failures, and attention-required attempt decisions", async () => {
    const attempts = [
      attemptRecord({
        id: "attempt-1",
        attemptNumber: 1,
        status: "failed",
        failureClassification: "transient",
        retryDecision: "retry",
        invocationId: "invocation-retry-1",
        artifactDigest: null,
        output: null,
        errorMessage: "Service temporarily unavailable",
      }),
      attemptRecord({
        id: "attempt-2",
        attemptNumber: 2,
        status: "failed",
        failureClassification: "permanent",
        retryDecision: "stop",
        invocationId: "invocation-retry-2",
        artifactDigest: "sha256:failure-artifact",
        errorMessage: "Request failed",
      }),
      attemptRecord({
        id: "attempt-3",
        nodeId: "external-write",
        nodeRunId: "node-run-2",
        attemptNumber: 1,
        status: "failed",
        failureClassification: "unknown_side_effect",
        retryDecision: "attention_required",
        invocationId: "invocation-attention-1",
        artifactDigest: null,
        errorMessage: "External outcome is unknown",
      }),
    ];
    const nodeFlowService = {
      getRun: vi.fn(() => ({
        id: "run-1",
        projectId: "project-1",
        triggerPayload: null,
        input: { password: "secret-canary" },
        output: null,
      })),
      listNodeRuns: vi.fn(() => ({ nodeRuns: [] })),
      listNodeAttempts: vi.fn(() => ({ attempts })),
    };
    const handler = createHandler(nodeFlowService);

    const response = await handler.handleManageNodeFlows({
      action: "inspect_run",
      projectId: "project-1",
      runId: "run-1",
    });
    const parsed = parseResponse(response);

    expect(nodeFlowService.listNodeAttempts).toHaveBeenCalledWith("run-1");
    expect(parsed.result.attempts).toEqual(expect.arrayContaining([
      expect.objectContaining({ attemptNumber: 1, failureClassification: "transient", retryDecision: "retry", invocationId: "invocation-retry-1" }),
      expect.objectContaining({ attemptNumber: 2, failureClassification: "permanent", retryDecision: "stop", invocationId: "invocation-retry-2", artifactDigest: "sha256:failure-artifact" }),
      expect.objectContaining({ failureClassification: "unknown_side_effect", retryDecision: "attention_required", invocationId: "invocation-attention-1" }),
    ]));
    expect(parsed.result.run.input.password).toBe("[REDACTED]");
    expect(JSON.stringify(parsed)).not.toContain("secret-canary");
    expect(parsed.result.attempts.every((attempt: Record<string, unknown>) => !("credentialIds" in attempt))).toBe(true);
  });

  it("requires exact approval before deleting a flow", async () => {
    const nodeFlowService = {
      delete: vi.fn(),
    };
    const handler = createHandler(nodeFlowService);

    let response = await handler.handleManageNodeFlows({
      action: "delete",
      flowId: "flow-1",
      approval: { confirmed: true },
    });
    let parsed = parseResponse(response);
    expect(parsed.approvalRequired).toBe(true);
    expect(nodeFlowService.delete).not.toHaveBeenCalled();

    response = await handler.handleManageNodeFlows({ action: "delete", flowId: "flow-1" });
    parsed = parseResponse(response);
    expect(parsed.approvalRequired).toBe(true);

    response = await handler.handleManageNodeFlows({
      action: "delete",
      flowId: "flow-1",
      approval: { confirmed: true },
    });
    parsed = parseResponse(response);

    expect(parsed.result).toEqual({ success: true, deletedFlowId: "flow-1" });
    expect(nodeFlowService.delete).toHaveBeenCalledWith("flow-1");
  });

  it("attaches and detaches node-flow skills for agent presets", async () => {
    const nodeFlowService = {
      attachToAgent: vi.fn(() => ({
        flowId: "flow-1",
        projectId: "project-1",
        agentPresetId: "agent-1",
        skillName: "Review flow",
        description: "Runs review automation",
        createdAt: "2026-07-07T00:00:00.000Z",
        updatedAt: "2026-07-07T00:00:00.000Z",
      })),
      detachFromAgent: vi.fn(),
    };
    const handler = createHandler(nodeFlowService);

    const attachResponse = await handler.handleManageNodeFlows({
      action: "attach_to_agent",
      flowId: "flow-1",
      agentPresetId: "agent-1",
      skillAlias: " Review flow ",
      description: " Runs review automation ",
    });
    const detachResponse = await handler.handleManageNodeFlows({
      action: "detach_from_agent",
      flowId: "flow-1",
      agentPresetId: "agent-1",
    });

    expect(nodeFlowService.attachToAgent).toHaveBeenCalledWith("flow-1", {
      agentPresetId: "agent-1",
      skillName: "Review flow",
      description: "Runs review automation",
    });
    expect(parseResponse(attachResponse).result.attachment.skillName).toBe("Review flow");
    expect(nodeFlowService.detachFromAgent).toHaveBeenCalledWith("flow-1", "agent-1");
    expect(parseResponse(detachResponse).result).toEqual({
      success: true,
      flowId: "flow-1",
      agentPresetId: "agent-1",
    });
  });

  it("masks secret-shaped graph data in MCP flow responses", async () => {
    const nodeFlowService = {
      get: vi.fn(() => flowRecord()),
      listAgentSkills: vi.fn(() => []),
      validateDraft: vi.fn(() => ({ publishedVersion: 1, requiredCredentials: [] })),
    };
    const handler = createHandler(nodeFlowService);

    const response = await handler.handleManageNodeFlows({ action: "get", flowId: "flow-1" });
    const parsed = parseResponse(response);

    expect(parsed.result.flow.graph.nodes[0].data).toEqual({
      apiToken: "[REDACTED]",
      visible: "ok",
    });

    const agentResponse = await runWithMcpAgentContext("agent-1", "thread-1", () =>
      handler.handleManageNodeFlows({ action: "get", flowId: "flow-1" }));
    expect(parseResponse(agentResponse).result.flow).not.toHaveProperty("graph");
  });

  it("returns governed draft conflicts and structured dry-run findings", async () => {
    const nodeFlowService = {
      patchDraft: vi.fn(() => ({ conflict: { code: "draft_revision_conflict", expectedDraftRevision: 1, actualDraftRevision: 2 } })),
      dryRun: vi.fn(() => ({ status: "blocked", validationIssues: [], policyFindings: [{ code: "missing_credential" }], requiredCredentials: [{ status: "missing" }], result: { executed: false } })),
    };
    const handler = createHandler(nodeFlowService);
    const conflict = parseResponse(await handler.handleManageNodeFlows({ action: "patch_draft", projectId: "project-1", flowId: "flow-1", draftRevision: 1, operations: [{ op: "set_metadata", metadata: {} }] }));
    const dryRun = parseResponse(await handler.handleManageNodeFlows({ action: "dry_run", projectId: "project-1", flowId: "flow-1", input: { token: "never-returned" } }));
    expect(conflict.result.conflict).toMatchObject({ code: "draft_revision_conflict", actualDraftRevision: 2 });
    expect(dryRun.result).toMatchObject({ status: "blocked", result: { executed: false } });
  });

  it("requires exact approval for publish and rollback", async () => {
    const nodeFlowService = { publishDraft: vi.fn(() => ({ draftRevision: 2 })), rollback: vi.fn(() => ({ draftRevision: 3 })) };
    const handler = createHandler(nodeFlowService);
    const publishArgs = { action: "publish" as const, projectId: "project-1", flowId: "flow-1", draftRevision: 2, approval: { confirmed: true } };
    expect(parseResponse(await handler.handleManageNodeFlows(publishArgs)).approvalRequired).toBe(true);
    expect(parseResponse(await handler.handleManageNodeFlows(publishArgs)).result.draft.draftRevision).toBe(2);
    const rollbackArgs = { action: "rollback" as const, projectId: "project-1", flowId: "flow-1", draftRevision: 2, version: 1, approval: { confirmed: true } };
    expect(parseResponse(await handler.handleManageNodeFlows(rollbackArgs)).approvalRequired).toBe(true);
    expect(parseResponse(await handler.handleManageNodeFlows(rollbackArgs)).result.draft.draftRevision).toBe(3);
  });

  it("validates required optimistic and operational fields", async () => {
    const handler = createHandler({});
    const patch = await handler.handleManageNodeFlows({ action: "patch_draft", projectId: "project-1", flowId: "flow-1" });
    const cancel = await handler.handleManageNodeFlows({ action: "cancel", projectId: "project-1" });
    expect(parseResponse(patch).result).toMatchObject({ errorType: "validation", field: "draftRevision" });
    expect(parseResponse(cancel).result).toMatchObject({ errorType: "validation", field: "runId" });
  });

  it("executes an attached flow with authenticated agent and conversation metadata", async () => {
    const runFlow = vi.fn(async () => ({ run: { id: "run-1", triggerPayload: null, input: null, output: { ok: true } }, nodeRuns: [], attempts: [attemptRecord()], output: { ok: true } }));
    const handler = createHandler({
      listAgentSkillsForAgent: () => [{ flowId: "flow-1", skillName: "Review", description: "" }],
      get: () => ({ id: "flow-1", projectId: "project-1", graph: { nodes: [], edges: [] } }),
      validateDraft: () => ({ publishedVersion: 1, requiredCredentials: [] }),
      runFlow,
    });
    const response = await runWithMcpAgentContext("agent-1", "thread-1", () => handler.handleRunAttachedFlow({ projectId: "project-1", flowId: "flow-1", input: { prompt: "review" } }));
    expect(parseResponse(response).result.run.id).toBe("run-1");
    expect(parseResponse(response).result.attempts[0]).toMatchObject({ invocationId: "invocation-1", executorId: "executor-1" });
    expect(JSON.stringify(parseResponse(response))).not.toContain("secret-canary");
    expect(parseResponse(response).result.attempts[0]).not.toHaveProperty("credentialIds");
    expect(runFlow).toHaveBeenCalledWith("project-1", "flow-1", { prompt: "review" }, expect.objectContaining({
      triggerPayload: expect.objectContaining({ initiatingAgentId: "agent-1", conversationId: "thread-1" }),
    }));
  });
});
