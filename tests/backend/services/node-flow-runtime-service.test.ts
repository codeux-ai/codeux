import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { AppDbStorage } from "../../../src/repositories/app-db-storage.js";
import { ExecutionRepository } from "../../../src/repositories/execution-repository.js";
import { NodeFlowRepository } from "../../../src/repositories/node-flow-repository.js";
import { ProjectManagementRepository } from "../../../src/repositories/project-management-repository.js";
import { SettingsRepository } from "../../../src/repositories/settings-repository.js";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../../src/repositories/settings-defaults.js";
import { NodeFlowRuntimeService } from "../../../src/services/node-flow-runtime-service.js";
import type { ProviderExecutionService } from "../../../src/services/provider-execution-service.js";
import type { NodeFlowGraph } from "../../../src/contracts/node-flow-types.js";
import type { CredentialBroker } from "../../../src/services/credentials/credential-broker.js";
import { EgressPolicyService } from "../../../src/services/node-flows/egress-policy-service.js";
import { AutomationApprovalRepository } from "../../../src/repositories/automation-approval-repository.js";
import { AutomationOutboxRepository } from "../../../src/repositories/automation-outbox-repository.js";
import { ApprovalService } from "../../../src/services/node-flows/approval-service.js";
import { MockSideEffectProvider, OutboxService, type SideEffectProvider } from "../../../src/services/node-flows/outbox-service.js";
import { AutomationAuditExportService } from "../../../src/services/automation-audit-export-service.js";
import { resolveNodeDefinition } from "../../../src/domain/node-flows/node-definition-registry.js";

const tempDirs: string[] = [];

async function createRuntime(providerExecutionService?: Partial<ProviderExecutionService>,credentialBroker?:Partial<CredentialBroker>, egressPolicyService?: EgressPolicyService, sideEffectProvider?: SideEffectProvider): Promise<{
  dir: string;
  storage: AppDbStorage;
  projectRepository: ProjectManagementRepository;
  nodeFlowRepository: NodeFlowRepository;
  executionRepository: ExecutionRepository;
  auditService: AutomationAuditExportService;
  runtime: NodeFlowRuntimeService;
  approvalService?: ApprovalService;
  outboxRepository?: AutomationOutboxRepository;
}> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "node-flow-runtime-"));
  tempDirs.push(dir);
  const storage = new AppDbStorage(path.join(dir, "app.db"));
  const projectRepository = new ProjectManagementRepository(storage);
  const nodeFlowRepository = new NodeFlowRepository(storage);
  const executionRepository = new ExecutionRepository(storage);
  const approvalService = sideEffectProvider ? new ApprovalService(new AutomationApprovalRepository(storage)) : undefined;
  const outboxRepository = sideEffectProvider ? new AutomationOutboxRepository(storage) : undefined;
  const auditService = new AutomationAuditExportService(storage);
  const runtime = new NodeFlowRuntimeService({
    nodeFlowRepository,
    executionRepository,
    projectManagementRepository: projectRepository,
    settingsRepository: new SettingsRepository(path.join(dir, "settings.db")),
    providerExecutionService: providerExecutionService as ProviderExecutionService | undefined,
    credentialBroker: credentialBroker as CredentialBroker | undefined,
    egressPolicyService,
    approvalService,
    outboxService: sideEffectProvider && outboxRepository ? new OutboxService(outboxRepository, sideEffectProvider) : undefined,
    auditService,
    getDashboardSettings: () => DEFAULT_DASHBOARD_SETTINGS,
  });
  return { dir, storage, projectRepository, nodeFlowRepository, executionRepository, auditService, runtime, approvalService, outboxRepository };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("NodeFlowRuntimeService", () => {
  it("resumes an approval-gated email send on the pinned run exactly once across restart and repeated decisions", async () => {
    const firstProvider = new MockSideEffectProvider();
    const setup = await createRuntime(undefined, undefined, undefined, firstProvider);
    const project = setup.projectRepository.createProject({ name: "Approval Project", sourceType: "local", sourceRef: setup.dir });
    const flow = setup.nodeFlowRepository.createFlow(project.id, { title: "Approved email", graph: {
      nodes: [
        { id: "input", type: "input", title: "Input" },
        { id: "send", type: "email_send", title: "Send", data: { to: "ops@example.test", subject: "Release", body: "Ready", logicalItem: "release-email" } },
        { id: "output", type: "output", title: "Output" },
      ],
      edges: [{ fromNodeId: "input", toNodeId: "send" }, { fromNodeId: "send", toNodeId: "output" }],
    } });

    const waiting = await setup.runtime.runFlow(project.id, flow.id, { release: "v1" });
    expect(waiting.run.status).toBe("approval_waiting");
    expect(waiting.attempts).toHaveLength(2);
    expect(waiting.attempts?.find((attempt) => attempt.nodeId === "send")).toMatchObject({ attemptNumber: 1, status: "approval_waiting" });
    expect(firstProvider.sends).toHaveLength(0);
    expect(setup.outboxRepository?.listForRun(waiting.run.id)).toHaveLength(0);

    const approval = setup.approvalService!.listForRun(waiting.run.id)[0]!;
    setup.approvalService!.approve(approval.id, "operator", { ticket: "change-1" });
    const restartedProvider = new MockSideEffectProvider();
    const restartedRuntime = new NodeFlowRuntimeService({
      nodeFlowRepository: new NodeFlowRepository(setup.storage),
      executionRepository: new ExecutionRepository(setup.storage),
      projectManagementRepository: new ProjectManagementRepository(setup.storage),
      settingsRepository: new SettingsRepository(path.join(setup.dir, "settings-restarted.db")),
      approvalService: new ApprovalService(new AutomationApprovalRepository(setup.storage)),
      outboxService: new OutboxService(new AutomationOutboxRepository(setup.storage), restartedProvider),
      getDashboardSettings: () => DEFAULT_DASHBOARD_SETTINGS,
    });

    const concurrent = await Promise.all([
      restartedRuntime.resumeApproval(project.id, approval.id, waiting.run.id),
      restartedRuntime.resumeApproval(project.id, approval.id, waiting.run.id),
    ]);
    const completed = concurrent.find((result) => result.run.status === "succeeded")!;
    const repeated = await restartedRuntime.resumeApproval(project.id, approval.id, waiting.run.id);
    expect(completed.run).toMatchObject({ id: waiting.run.id, publicationId: waiting.run.publicationId, status: "succeeded" });
    expect(repeated.run.status).toBe("succeeded");
    expect(completed.attempts?.find((attempt) => attempt.nodeId === "send")).toMatchObject({ attemptNumber: 1, status: "succeeded" });
    expect(completed.attempts?.filter((attempt) => attempt.nodeId === "send")).toHaveLength(1);
    expect(restartedProvider.sends).toHaveLength(1);
    expect(new AutomationOutboxRepository(setup.storage).listForRun(waiting.run.id)).toHaveLength(1);
  });

  it.each(["rejected", "expired"] as const)("terminates a %s waiting approval durably", async (decision) => {
    const provider = new MockSideEffectProvider();
    const setup = await createRuntime(undefined, undefined, undefined, provider);
    const project = setup.projectRepository.createProject({ name: `Approval ${decision}`, sourceType: "local", sourceRef: setup.dir });
    const flow = setup.nodeFlowRepository.createFlow(project.id, { title: "Approval", graph: { nodes: [{ id: "approval", type: "approval", title: "Approval" }], edges: [] } });
    const waiting = await setup.runtime.runFlow(project.id, flow.id, {});
    const approval = setup.approvalService!.listForRun(waiting.run.id)[0]!;
    if (decision === "rejected") setup.approvalService!.reject(approval.id, "operator");
    else {
      setup.storage.getDatabase().prepare("UPDATE automation_approvals SET expires_at = ? WHERE id = ?").run("2020-01-01T00:00:00.000Z", approval.id);
      setup.approvalService!.get(approval.id);
    }
    const result = await setup.runtime.resumeApproval(project.id, approval.id, waiting.run.id);
    expect(result.run).toMatchObject({ id: waiting.run.id, status: "failed" });
    expect(result.run.errorMessage).toContain(decision);
    expect(result.attempts?.[0]).toMatchObject({ status: "failed", retryDecision: "stop" });
    expect(provider.sends).toHaveLength(0);
  });

  it("does not resume an approval that is still pending", async () => {
    const setup = await createRuntime(undefined, undefined, undefined, new MockSideEffectProvider());
    const project = setup.projectRepository.createProject({ name: "Pending Approval", sourceType: "local", sourceRef: setup.dir });
    const flow = setup.nodeFlowRepository.createFlow(project.id, { title: "Approval", graph: { nodes: [{ id: "approval", type: "approval", title: "Approval" }], edges: [] } });
    const waiting = await setup.runtime.runFlow(project.id, flow.id, {});
    const approval = setup.approvalService!.listForRun(waiting.run.id)[0]!;
    await expect(setup.runtime.resumeApproval(project.id, approval.id, waiting.run.id)).rejects.toThrow(/still pending/i);
    expect(setup.nodeFlowRepository.getRun(waiting.run.id)?.status).toBe("approval_waiting");
  });

  it("cancels a waiting approval without leaving an active node attempt", async () => {
    const setup = await createRuntime(undefined, undefined, undefined, new MockSideEffectProvider());
    const project = setup.projectRepository.createProject({ name: "Cancelled Approval", sourceType: "local", sourceRef: setup.dir });
    const flow = setup.nodeFlowRepository.createFlow(project.id, { title: "Approval", graph: { nodes: [{ id: "approval", type: "approval", title: "Approval" }], edges: [] } });
    const waiting = await setup.runtime.runFlow(project.id, flow.id, {});
    const cancelled = setup.runtime.requestCancellation(waiting.run.id);
    expect(cancelled.status).toBe("cancelled");
    expect(setup.nodeFlowRepository.listNodeRuns(waiting.run.id)[0]?.status).toBe("cancelled");
    expect(setup.nodeFlowRepository.listNodeAttempts(waiting.run.id)[0]?.status).toBe("cancelled");
  });
  it("persists unselected condition branches as skipped while the selected branch runs", async () => {
    const { dir, projectRepository, nodeFlowRepository, runtime } = await createRuntime();
    const project = projectRepository.createProject({ name: "Branch Project", sourceType: "local", sourceRef: dir });
    const flow = nodeFlowRepository.createFlow(project.id, { title: "Branch", graph: {
      nodes: [
        { id: "condition", type: "condition", title: "Condition", data: { path: "input.enabled" } },
        { id: "yes", type: "set_fields", title: "Yes", data: { fields: { branch: "yes" } } },
        { id: "no", type: "set_fields", title: "No", data: { fields: { branch: "no" } } },
        { id: "merge", type: "merge", title: "Merge", data: { strategy: "object" } },
        { id: "output", type: "output", title: "Output" },
      ],
      edges: [
        { fromNodeId: "condition", fromHandle: "true", toNodeId: "yes" },
        { fromNodeId: "condition", fromHandle: "false", toNodeId: "no" },
        { fromNodeId: "yes", toNodeId: "merge" }, { fromNodeId: "no", toNodeId: "merge" },
        { fromNodeId: "merge", toNodeId: "output" },
      ],
    } });
    const result = await runtime.runFlow(project.id, flow.id, { enabled: true });
    expect(result.run.status).toBe("succeeded");
    expect(result.nodeRuns.find((node) => node.nodeId === "no")?.status).toBe("skipped");
    expect(result.output).toMatchObject({ branch: "yes" });
  });

  it("executes an explicitly pinned publication while latest selection follows the newest publication", async () => {
    const { dir, projectRepository, nodeFlowRepository, runtime } = await createRuntime();
    const project = projectRepository.createProject({ name: "Version Project", sourceType: "local", sourceRef: dir });
    const flow = nodeFlowRepository.createFlow(project.id, { title: "Versioned", graph: { nodes: [{ id: "set", type: "set_fields", title: "Set", data: { fields: { release: "v1" } } }], edges: [] } });
    nodeFlowRepository.updateFlow(flow.id, { graph: { nodes: [{ id: "set", type: "set_fields", title: "Set", data: { fields: { release: "v2" } } }], edges: [] } });

    const pinned = await runtime.runFlow(project.id, flow.id, {}, { versionSelection: { mode: "pinned", version: 1 } });
    const latest = await runtime.runFlow(project.id, flow.id, {}, { versionSelection: { mode: "latest_published" } });

    expect(pinned.run.version).toBe(1);
    expect(pinned.output).toEqual({ release: "v1" });
    expect(latest.run.version).toBe(2);
    expect(latest.output).toEqual({ release: "v2" });
  });

  it("retries classified transient failures and persists redacted numbered attempts", async () => {
    const executeProvider = vi.fn()
      .mockRejectedValueOnce(new Error("503 temporarily unavailable"))
      .mockResolvedValue({ ok: true, stdout: "ok", stderr: "", code: 0, text: "ok", nativeSessionId: null, usageTelemetry: { transcriptText: "ok", inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0, totalTokens: 0, usageSource: "reported", rawUsageJson: null } });
    const { dir, projectRepository, nodeFlowRepository, runtime } = await createRuntime({ executeProvider } as Partial<ProviderExecutionService>);
    const project = projectRepository.createProject({ name: "Retry Project", sourceType: "local", sourceRef: dir });
    const flow = nodeFlowRepository.createFlow(project.id, { title: "Retry", graph: { nodes: [{ id: "prompt", type: "provider_prompt", title: "Prompt", data: { provider: "mockup-cli", prompt: "{{input.apiToken}}" }, policy: { retry: { maxAttempts: 2, backoffMs: 0, maxBackoffMs: 0 } } }], edges: [] } });

    const result = await runtime.runFlow(project.id, flow.id, { apiToken: "never-store" });

    expect(result.run.status).toBe("succeeded");
    expect(executeProvider).toHaveBeenCalledTimes(2);
    expect(result.attempts?.map((attempt) => [attempt.attemptNumber, attempt.retryDecision])).toEqual([[1, "retry"], [2, "stop"]]);
    expect(JSON.stringify(result.attempts)).not.toContain("never-store");
  });

  it("propagates node timeouts to the executor and classifies the attempt", async () => {
    const executeProvider = vi.fn().mockImplementation(({ signal }: { signal?: AbortSignal }) => new Promise((_resolve, reject) => {
      signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
    }));
    const { dir, projectRepository, nodeFlowRepository, runtime } = await createRuntime({ executeProvider } as Partial<ProviderExecutionService>);
    const project = projectRepository.createProject({ name: "Timeout Project", sourceType: "local", sourceRef: dir });
    const flow = nodeFlowRepository.createFlow(project.id, { title: "Timeout", graph: { nodes: [{ id: "prompt", type: "provider_prompt", title: "Prompt", data: { provider: "mockup-cli", prompt: "wait" }, policy: { timeout: { timeoutMs: 5 } } }], edges: [] } });

    const result = await runtime.runFlow(project.id, flow.id, {});

    expect(result.run.status).toBe("failed");
    expect(result.attempts?.[0]).toMatchObject({ failureClassification: "timeout", retryDecision: "stop" });
  });

  it("executes deterministic nodes in topological order and persists the succeeded run", async () => {
    const { dir, projectRepository, nodeFlowRepository, runtime } = await createRuntime();
    const project = projectRepository.createProject({ name: "Runtime Project", sourceType: "local", sourceRef: dir });
    const graph: NodeFlowGraph = {
      nodes: [
        { id: "input", type: "input", title: "Input" },
        { id: "set", type: "set_fields", title: "Set", data: { fields: { greeting: "Hello {{input.name}}" } } },
        { id: "template", type: "template", title: "Template", data: { template: "{{nodes.set.greeting}}", outputKey: "message" } },
        { id: "output", type: "output", title: "Output" },
      ],
      edges: [
        { fromNodeId: "input", toNodeId: "set" },
        { fromNodeId: "set", toNodeId: "template" },
        { fromNodeId: "template", toNodeId: "output" },
      ],
    };
    const flow = nodeFlowRepository.createFlow(project.id, { title: "Greeting", graph });

    const result = await runtime.runFlow(project.id, flow.id, { name: "Ada" });

    expect(result.run.status).toBe("succeeded");
    expect(result.output).toEqual({ message: "Hello Ada" });
    expect(result.nodeRuns.map((nodeRun) => nodeRun.nodeId)).toEqual(["input", "set", "template", "output"]);
    expect(result.nodeRuns.every((nodeRun) => nodeRun.status === "succeeded")).toBe(true);
    expect(result.run.executionInvocationId).toMatch(/^xi_/);
  });

  it("uses ProviderExecutionService for provider_prompt nodes and links the node invocation", async () => {
    const executeProvider = vi.fn().mockResolvedValue({
      ok: true,
      stdout: "provider stdout",
      stderr: "",
      code: 0,
      text: "provider answer",
      nativeSessionId: "native-1",
      usageTelemetry: {
        transcriptText: "provider answer",
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        reasoningOutputTokens: 0,
        totalTokens: 0,
        usageSource: "reported",
        rawUsageJson: null,
      },
    });
    const resolveCredentialId=vi.fn().mockResolvedValue({credentialId:"credential-1",value:"bound-secret",version:1});
    const { dir, projectRepository, nodeFlowRepository, executionRepository, runtime } = await createRuntime({ executeProvider } as Partial<ProviderExecutionService>,{resolveCredentialId});
    const project = projectRepository.createProject({ name: "Provider Project", sourceType: "local", sourceRef: dir });
    const flow = nodeFlowRepository.createFlow(project.id, {
      title: "Provider",
      graph: {
        nodes: [
          { id: "input", type: "input", title: "Input" },
          { id: "prompt", type: "provider_prompt", title: "Prompt", data: { provider: "mockup-cli", prompt: "Answer {{input.question}}" }, credentialBindings: [{slot:"provider",credentialId:"credential-1"}] },
          { id: "output", type: "output", title: "Output" },
        ],
        edges: [
          { fromNodeId: "input", toNodeId: "prompt" },
          { fromNodeId: "prompt", toNodeId: "output" },
        ],
      },
    });

    const result = await runtime.runFlow(project.id, flow.id, { question: "now" });

    expect(executeProvider).toHaveBeenCalledWith(expect.objectContaining({
      type: "node_flow_node",
      provider: "mockup-cli",
      prompt: "Answer now",
      apiKey: "bound-secret",
      invocationId: expect.stringMatching(/^xi_/),
      trackPromptInInvocation: false,
      trackAssistantInInvocation: false,
    }));
    expect(resolveCredentialId).toHaveBeenCalledWith(expect.objectContaining({projectId:project.id,credentialId:"credential-1",bindingKey:`${flow.id}:prompt:provider`,requiredCapabilities:["read"],allowedKinds:["provider"]}));
    const promptRun = result.nodeRuns.find((nodeRun) => nodeRun.nodeId === "prompt");
    expect(promptRun?.executionInvocationId).toMatch(/^xi_/);
    expect(promptRun?.output).toMatchObject({ text: "provider answer", nativeSessionId: "native-1" });
    expect(executionRepository.getExecutionInvocation(promptRun!.executionInvocationId!)?.type).toBe("node_flow_node");
  });

  it.each([
    "Credential is not active.",
    "Credential is outside the project scope.",
    "Credential kind is not approved for this consumer.",
    "Credential does not approve every required capability.",
    "Credential encrypted state or key custody is unavailable.",
  ])("fails a changed credential policy before invoking the provider executor: %s", async (denial) => {
    const executeProvider = vi.fn();
    const resolveCredentialId = vi.fn().mockRejectedValue(new Error(denial));
    const { dir, projectRepository, nodeFlowRepository, runtime } = await createRuntime(
      { executeProvider } as Partial<ProviderExecutionService>,
      { resolveCredentialId },
    );
    const project = projectRepository.createProject({ name: "Credential Denial Project", sourceType: "local", sourceRef: dir });
    const flow = nodeFlowRepository.createFlow(project.id, { title: "Credential denial", graph: {
      nodes: [{
        id: "prompt",
        type: "provider_prompt",
        title: "Prompt",
        data: { provider: "mockup-cli", prompt: "Answer" },
        credentialBindings: [{ slot: "provider", credentialId: "credential-1" }],
      }],
      edges: [],
    } });

    const result = await runtime.runFlow(project.id, flow.id, {});

    expect(result.run.status).toBe("failed");
    expect(result.run.errorMessage).toContain(denial);
    expect(resolveCredentialId).toHaveBeenCalledTimes(1);
    expect(executeProvider).not.toHaveBeenCalled();
  });

  it("re-evaluates definition capabilities after publication and before the secret read", async () => {
    const executeProvider = vi.fn();
    const resolveCredentialId = vi.fn().mockRejectedValue(new Error("Credential capability changed after review."));
    const { dir, projectRepository, nodeFlowRepository, runtime } = await createRuntime(
      { executeProvider } as Partial<ProviderExecutionService>,
      { resolveCredentialId },
    );
    const project = projectRepository.createProject({ name: "Policy Change Project", sourceType: "local", sourceRef: dir });
    const flow = nodeFlowRepository.createFlow(project.id, { title: "Policy change", graph: {
      nodes: [{
        id: "prompt",
        type: "provider_prompt",
        title: "Prompt",
        data: { provider: "mockup-cli", prompt: "Answer" },
        credentialBindings: [{ slot: "provider", credentialId: "credential-1" }],
      }],
      edges: [],
    } });
    const requirement = resolveNodeDefinition("provider_prompt", 1)!.credentials[0]!;
    const originalCapabilities = requirement.requiredCapabilities;
    requirement.requiredCapabilities = ["provider.execute"];
    try {
      const result = await runtime.runFlow(project.id, flow.id, {});
      expect(result.run.status).toBe("failed");
      expect(resolveCredentialId).toHaveBeenCalledWith(expect.objectContaining({
        allowedKinds: ["provider"],
        requiredCapabilities: ["provider.execute"],
      }));
      expect(executeProvider).not.toHaveBeenCalled();
    } finally {
      requirement.requiredCapabilities = originalCapabilities;
    }
  });

  it("fails a newly required slot before resolving or invoking the provider", async () => {
    const executeProvider = vi.fn();
    const resolveCredentialId = vi.fn();
    const { dir, projectRepository, nodeFlowRepository, runtime } = await createRuntime(
      { executeProvider } as Partial<ProviderExecutionService>,
      { resolveCredentialId },
    );
    const project = projectRepository.createProject({ name: "Required Runtime Slot Project", sourceType: "local", sourceRef: dir });
    const flow = nodeFlowRepository.createFlow(project.id, { title: "Required at runtime", graph: {
      nodes: [{ id: "prompt", type: "provider_prompt", title: "Prompt", data: { provider: "mockup-cli", prompt: "Answer" } }],
      edges: [],
    } });
    const requirement = resolveNodeDefinition("provider_prompt", 1)!.credentials[0]!;
    const originalRequired = requirement.required;
    requirement.required = true;
    try {
      const result = await runtime.runFlow(project.id, flow.id, {});
      expect(result.run.status).toBe("failed");
      expect(result.run.errorMessage).toMatch(/requires credential slot provider/i);
      expect(resolveCredentialId).not.toHaveBeenCalled();
      expect(executeProvider).not.toHaveBeenCalled();
    } finally {
      requirement.required = originalRequired;
    }
  });

  it("redacts a resolved credential echoed by provider output and retry errors from every runtime record", async () => {
    const credentialCanary = "CODEUX_PROVIDER_CANARY_X9Q7";
    const persistedBoundaryValues: unknown[] = [];
    let providerAttempt = 0;
    const providerResult = {
        ok: true,
        stdout: `stdout ${credentialCanary}`,
        stderr: "",
        code: 0,
        text: `answer ${credentialCanary}`,
        nativeSessionId: `session-${credentialCanary}`,
        usageTelemetry: {
          transcriptText: `transcript ${credentialCanary}`,
          inputTokens: 0,
          cachedInputTokens: 0,
          outputTokens: 0,
          reasoningOutputTokens: 0,
          totalTokens: 0,
          usageSource: "reported",
          rawUsageJson: { echoed: credentialCanary },
        },
      };
    const executeProvider = vi.fn().mockImplementation(async (args: {
      redactTextForPersistence?: (value: string) => string;
      redactJsonForPersistence?: (value: Record<string, unknown>) => Record<string, unknown> | null;
      onActivity?: (description: string) => void;
    }) => {
      providerAttempt += 1;
      persistedBoundaryValues.push(
        args.redactTextForPersistence?.(`retry ${credentialCanary}`),
        args.redactJsonForPersistence?.({ echoed: credentialCanary }),
        typeof args.onActivity,
      );
      if (providerAttempt === 1) throw new Error(`503 retry echoed ${credentialCanary}`);
      return providerResult;
    });
    const resolveCredentialId = vi.fn().mockResolvedValue({
      credentialId: "credential-provider",
      value: credentialCanary,
      version: 3,
    });
    const { dir, projectRepository, nodeFlowRepository, executionRepository, auditService, runtime } = await createRuntime(
      { executeProvider } as Partial<ProviderExecutionService>,
      { resolveCredentialId },
    );
    const project = projectRepository.createProject({ name: "Provider Canary Project", sourceType: "local", sourceRef: dir });
    const flow = nodeFlowRepository.createFlow(project.id, {
      title: "Provider canary",
      graph: {
        nodes: [{
          id: "prompt",
          type: "provider_prompt",
          title: "Prompt",
          data: { provider: "mockup-cli", prompt: "Answer safely" },
          credentialBindings: [{ slot: "provider", credentialId: "credential-provider" }],
          policy: { retry: { maxAttempts: 2, backoffMs: 0, maxBackoffMs: 0 } },
        }],
        edges: [],
      },
    });

    const result = await runtime.runFlow(project.id, flow.id, {});
    const invocations = executionRepository.listExecutionInvocations({ projectId: project.id, limit: 20 });
    const invocationMessages = invocations.flatMap((invocation) => executionRepository.listExecutionInvocationMessages(invocation.id));
    const persisted = JSON.stringify({
      summary: result,
      attempts: nodeFlowRepository.listNodeAttempts(result.run.id),
      invocations,
      invocationMessages,
      audit: auditService.list({ projectId: project.id }),
      logs: invocationMessages,
      diagnostics: result.nodeRuns.map((nodeRun) => ({ output: nodeRun.output, error: nodeRun.errorMessage })),
    });

    expect(executeProvider).toHaveBeenCalledTimes(2);
    expect(persistedBoundaryValues).toEqual([
      "retry [REDACTED]", { echoed: "[REDACTED]" }, "function",
      "retry [REDACTED]", { echoed: "[REDACTED]" }, "function",
    ]);
    expect(result.output).toMatchObject({ text: "answer [REDACTED]", nativeSessionId: "session-[REDACTED]" });
    expect(result.attempts?.[0]).toMatchObject({
      credentialIds: ["credential-provider"],
      errorMessage: "503 retry echoed [REDACTED]",
      retryDecision: "retry",
    });
    expect(persisted).not.toContain(credentialCanary);
    expect(persisted).toContain("credential-provider");
  });

  it("executes governed HTTP request nodes with query, body, timeout, and JSON response extraction", async () => {
      const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { message: "hello" } }), {
        status: 200, headers: { "content-type": "application/json" },
      }));
      const egressPolicyService = new EgressPolicyService({ fetch: fetchMock, lookup: async () => [{ address: "8.8.8.8", family: 4 }] });
      const { dir, projectRepository, nodeFlowRepository, runtime } = await createRuntime(undefined, undefined, egressPolicyService);
      const project = projectRepository.createProject({ name: "HTTP Project", sourceType: "local", sourceRef: dir });
      const flow = nodeFlowRepository.createFlow(project.id, {
        title: "HTTP",
        graph: {
          nodes: [
            {
              id: "http",
              type: "http_request",
              title: "HTTP",
              data: {
                method: "POST",
                url: "https://api.example.test/ok",
                query: { name: "Ada" },
                body: { ok: true },
                timeout: 1000,
                responsePath: "data.message",
              },
            },
          ],
          edges: [],
        },
      });

      const result = await runtime.runFlow(project.id, flow.id, {});

      expect(result.run.status).toBe("succeeded");
      expect(result.output).toMatchObject({ status: 200, extracted: "hello" });
      expect(result.nodeRuns[0]?.executionInvocationId).toMatch(/^xi_/);
      expect(fetchMock).toHaveBeenCalledWith(expect.objectContaining({ search: "?name=Ada" }), expect.objectContaining({ redirect: "manual" }));
  });

  it("redacts a resolved HTTP credential echoed by the mock boundary from bodies and persisted diagnostics", async () => {
    const credentialCanary = "CODEUX_HTTP_CANARY_X9Q7";
    const fetchMock = vi.fn().mockImplementation(async (_url: URL, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ authorization: credentialCanary });
      return new Response(JSON.stringify({ echoed: credentialCanary, detail: `Authorization: ${credentialCanary}` }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const egressPolicyService = new EgressPolicyService({ fetch: fetchMock, lookup: async () => [{ address: "8.8.8.8", family: 4 }] });
    const resolveCredentialId = vi.fn().mockResolvedValue({
      credentialId: "credential-http",
      value: credentialCanary,
      version: 2,
    });
    const { dir, projectRepository, nodeFlowRepository, executionRepository, auditService, runtime } = await createRuntime(
      undefined,
      { resolveCredentialId },
      egressPolicyService,
    );
    const project = projectRepository.createProject({ name: "HTTP Canary Project", sourceType: "local", sourceRef: dir });
    const flow = nodeFlowRepository.createFlow(project.id, {
      title: "HTTP canary",
      graph: {
        nodes: [{
          id: "http",
          type: "http_request",
          title: "HTTP",
          data: { method: "GET", url: "https://api.example.test/echo" },
          credentialBindings: [{ slot: "auth", credentialId: "credential-http" }],
        }],
        edges: [],
      },
    });

    const result = await runtime.runFlow(project.id, flow.id, {});
    const invocations = executionRepository.listExecutionInvocations({ projectId: project.id, limit: 20 });
    const invocationMessages = invocations.flatMap((invocation) => executionRepository.listExecutionInvocationMessages(invocation.id));
    const persisted = JSON.stringify({
      summary: result,
      attempts: nodeFlowRepository.listNodeAttempts(result.run.id),
      invocations,
      invocationMessages,
      audit: auditService.list({ projectId: project.id }),
      logs: invocationMessages,
      diagnostics: result.nodeRuns.map((nodeRun) => ({ output: nodeRun.output, error: nodeRun.errorMessage })),
    });

    expect(result.output).toMatchObject({
      body: { echoed: "[REDACTED]", detail: "Authorization: [REDACTED]" },
      extracted: { echoed: "[REDACTED]", detail: "Authorization: [REDACTED]" },
    });
    expect(result.attempts?.[0]?.credentialIds).toEqual(["credential-http"]);
    expect(persisted).not.toContain(credentialCanary);
    expect(persisted).toContain("credential-http");
  });

  it("fails HTTP nodes clearly and skips downstream nodes without continueOnError", async () => {
    const { dir, projectRepository, nodeFlowRepository, runtime } = await createRuntime();
    const project = projectRepository.createProject({ name: "HTTP Failure Project", sourceType: "local", sourceRef: dir });
    const flow = nodeFlowRepository.createFlow(project.id, {
      title: "HTTP failure",
      graph: {
        nodes: [
          { id: "http", type: "http_request", title: "HTTP", data: { method: "GET", url: "ftp://example.test/file" } },
          { id: "output", type: "output", title: "Output" },
        ],
        edges: [{ fromNodeId: "http", toNodeId: "output" }],
      },
    });

    const result = await runtime.runFlow(project.id, flow.id, {});

    expect(result.run.status).toBe("failed");
    expect(result.run.errorMessage).toMatch(/http or https/i);
    expect(result.nodeRuns.map((nodeRun) => [nodeRun.nodeId, nodeRun.status])).toEqual([
      ["http", "failed"],
      ["output", "skipped"],
    ]);
  });

  it("continues downstream from failed nodes that opt into continueOnError", async () => {
    const { dir, projectRepository, nodeFlowRepository, runtime } = await createRuntime();
    const project = projectRepository.createProject({ name: "Continue Project", sourceType: "local", sourceRef: dir });
    const flow = nodeFlowRepository.createFlow(project.id, {
      title: "Continue",
      graph: {
        nodes: [
          { id: "http", type: "http_request", title: "HTTP", data: { method: "GET", url: "ftp://example.test/file", continueOnError: true } },
          { id: "set", type: "set_fields", title: "Set", data: { fields: { recovered: "{{nodes.http.error}}" } } },
          { id: "output", type: "output", title: "Output" },
        ],
        edges: [
          { fromNodeId: "http", toNodeId: "set" },
          { fromNodeId: "set", toNodeId: "output" },
        ],
      },
    });

    const result = await runtime.runFlow(project.id, flow.id, {});

    expect(result.run.status).toBe("succeeded");
    expect(result.nodeRuns.map((nodeRun) => [nodeRun.nodeId, nodeRun.status])).toEqual([
      ["http", "failed"],
      ["set", "succeeded"],
      ["output", "succeeded"],
    ]);
    expect(result.output?.recovered).toMatch(/http or https/i);
  });

  it("preserves cancelled run status when an abort is observed during node execution", async () => {
    const controller = new AbortController();
    const executeProvider = vi.fn().mockImplementation(() => {
      controller.abort("test_cancel");
      throw new Error("provider cancelled");
    });
    const { dir, projectRepository, nodeFlowRepository, executionRepository, runtime } = await createRuntime({ executeProvider } as Partial<ProviderExecutionService>);
    const project = projectRepository.createProject({ name: "Cancelled Project", sourceType: "local", sourceRef: dir });
    const flow = nodeFlowRepository.createFlow(project.id, {
      title: "Cancelled",
      graph: {
        nodes: [
          { id: "input", type: "input", title: "Input" },
          { id: "prompt", type: "provider_prompt", title: "Prompt", data: { provider: "mockup-cli", prompt: "Answer {{input.question}}" } },
          { id: "output", type: "output", title: "Output" },
        ],
        edges: [
          { fromNodeId: "input", toNodeId: "prompt" },
          { fromNodeId: "prompt", toNodeId: "output" },
        ],
      },
    });

    const result = await runtime.runFlow(project.id, flow.id, { question: "now" }, { signal: controller.signal });

    expect(result.run.status).toBe("cancelled");
    expect(result.run.errorMessage).toBe("provider cancelled");
    expect(result.nodeRuns.map((nodeRun) => [nodeRun.nodeId, nodeRun.status])).toEqual([
      ["input", "succeeded"],
      ["prompt", "cancelled"],
      ["output", "cancelled"],
    ]);
    expect(executionRepository.getExecutionInvocation(result.run.executionInvocationId!)?.status).toBe("cancelled");
  });

  it("masks secrets in run payloads, node payloads, and invocation messages", async () => {
    const { dir, projectRepository, nodeFlowRepository, executionRepository, runtime } = await createRuntime();
    const project = projectRepository.createProject({ name: "Secret Project", sourceType: "local", sourceRef: dir });
    const flow = nodeFlowRepository.createFlow(project.id, {
      title: "Secrets",
      graph: {
        nodes: [
          { id: "input", type: "input", title: "Input" },
          { id: "output", type: "output", title: "Output" },
        ],
        edges: [{ fromNodeId: "input", toNodeId: "output" }],
      },
    });

    const result = await runtime.runFlow(project.id, flow.id, { apiToken: "secret-token", visible: "ok" }, {
      triggerPayload: { authorization: "Bearer secret-token" },
    });

    expect(result.run.input).toEqual({ apiToken: "[REDACTED]", visible: "ok" });
    expect(result.run.triggerPayload).toEqual({ authorization: "[REDACTED]" });
    expect(result.output).toEqual({ apiToken: "[REDACTED]", visible: "ok" });
    expect(result.nodeRuns[0]?.output).toEqual({ apiToken: "[REDACTED]", visible: "ok" });
    const messages = executionRepository.listExecutionInvocationMessages(result.run.executionInvocationId!);
    expect(JSON.stringify(messages)).not.toContain("secret-token");
  });

  it.each([
    { items: [] as number[], expectedItems: 0, expectedEmpty: "succeeded", expectedWorker: ["default"] },
    { items: [7], expectedItems: 1, expectedEmpty: "skipped", expectedWorker: ["foreach:0"] },
    { items: [1, 2, 3], expectedItems: 3, expectedEmpty: "skipped", expectedWorker: ["foreach:0", "foreach:1", "foreach:2"] },
  ])("executes zero, one, and many Foreach items durably: $items", async ({ items, expectedItems, expectedEmpty, expectedWorker }) => {
    const { dir, projectRepository, nodeFlowRepository, runtime } = await createRuntime();
    const project = projectRepository.createProject({ name: "Foreach cardinality", sourceType: "local", sourceRef: dir });
    const flow = nodeFlowRepository.createFlow(project.id, { title: "Foreach cardinality", graph: {
      nodes: [
        { id: "foreach", type: "foreach", title: "Foreach", data: { path: "input.items", concurrency: 2 } },
        { id: "worker", type: "set_fields", title: "Worker", data: { fields: { value: "{{item}}", index: "{{itemIndex}}" } } },
        { id: "empty", type: "set_fields", title: "Empty", data: { fields: { empty: true } } },
        { id: "output", type: "output", title: "Output" },
      ],
      edges: [
        { fromNodeId: "foreach", fromHandle: "items", toNodeId: "worker" },
        { fromNodeId: "foreach", fromHandle: "empty", toNodeId: "empty" },
        { fromNodeId: "worker", toNodeId: "output" },
        { fromNodeId: "empty", toNodeId: "output" },
      ],
    } });

    const result = await runtime.runFlow(project.id, flow.id, { items });
    const workerRuns = result.nodeRuns.filter((record) => record.nodeId === "worker");
    expect(result.run.status).toBe("succeeded");
    expect(workerRuns.map((record) => record.logicalItem)).toEqual(expectedWorker);
    expect(workerRuns.filter((record) => record.status === "succeeded")).toHaveLength(expectedItems);
    expect(result.nodeRuns.find((record) => record.nodeId === "empty")?.status).toBe(expectedEmpty);
    if (items.length > 0) {
      expect(workerRuns.map((record) => record.input?.item)).toEqual(items);
      expect(result.attempts?.filter((attempt) => attempt.nodeId === "worker").map((attempt) => [attempt.logicalItem, attempt.attemptNumber]))
        .toEqual(expectedWorker.map((logicalItem) => [logicalItem, 1]));
    }
  });

  it("bounds Foreach concurrency and isolates per-item retries and failures", async () => {
    let active = 0;
    let maximumActive = 0;
    const attempts = new Map<string, number>();
    const executeProvider = vi.fn().mockImplementation(async ({ prompt }: { prompt: string }) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
      const count = (attempts.get(prompt) ?? 0) + 1;
      attempts.set(prompt, count);
      if (prompt === "2" && count === 1) throw new Error("503 retry item two");
      if (prompt === "3") throw new Error("permanent item three");
      return { ok: true, stdout: prompt, stderr: "", code: 0, text: prompt, nativeSessionId: null,
        usageTelemetry: { transcriptText: prompt, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0, totalTokens: 0, usageSource: "reported", rawUsageJson: null } };
    });
    const { dir, projectRepository, nodeFlowRepository, runtime } = await createRuntime({ executeProvider } as Partial<ProviderExecutionService>);
    const project = projectRepository.createProject({ name: "Foreach concurrency", sourceType: "local", sourceRef: dir });
    const flow = nodeFlowRepository.createFlow(project.id, { title: "Foreach concurrency", graph: {
      nodes: [
        { id: "foreach", type: "foreach", title: "Foreach", data: { path: "input.items", concurrency: 2 } },
        { id: "prompt", type: "provider_prompt", title: "Prompt", data: { provider: "mockup-cli", prompt: "{{item}}" },
          policy: { retry: { maxAttempts: 2, backoffMs: 0, maxBackoffMs: 0 } } },
      ],
      edges: [{ fromNodeId: "foreach", fromHandle: "items", toNodeId: "prompt" }],
    } });

    const result = await runtime.runFlow(project.id, flow.id, { items: [1, 2, 3, 4] });
    expect(result.run.status).toBe("failed");
    expect(maximumActive).toBe(2);
    expect(result.nodeRuns.filter((record) => record.nodeId === "prompt" && record.status === "succeeded")).toHaveLength(3);
    expect(result.attempts?.filter((attempt) => attempt.logicalItem === "foreach:1").map((attempt) => attempt.attemptNumber)).toEqual([1, 2]);
    expect(result.attempts?.filter((attempt) => attempt.logicalItem === "foreach:2")).toHaveLength(1);
  });

  it("cancels active logical items and persists their cancellation identity", async () => {
    const controller = new AbortController();
    const executeProvider = vi.fn().mockImplementation(async () => {
      controller.abort("cancel foreach");
      throw new Error("foreach provider cancelled");
    });
    const { dir, projectRepository, nodeFlowRepository, runtime } = await createRuntime({ executeProvider } as Partial<ProviderExecutionService>);
    const project = projectRepository.createProject({ name: "Foreach cancellation", sourceType: "local", sourceRef: dir });
    const flow = nodeFlowRepository.createFlow(project.id, { title: "Foreach cancellation", graph: {
      nodes: [
        { id: "foreach", type: "foreach", title: "Foreach", data: { path: "input.items" } },
        { id: "prompt", type: "provider_prompt", title: "Prompt", data: { provider: "mockup-cli", prompt: "{{item}}" } },
      ], edges: [{ fromNodeId: "foreach", fromHandle: "items", toNodeId: "prompt" }],
    } });
    const result = await runtime.runFlow(project.id, flow.id, { items: [1] }, { signal: controller.signal });
    expect(result.run.status).toBe("cancelled");
    expect(result.nodeRuns.find((record) => record.nodeId === "prompt")).toMatchObject({ logicalItem: "foreach:0", status: "cancelled" });
    expect(result.attempts?.find((attempt) => attempt.nodeId === "prompt")).toMatchObject({ logicalItem: "foreach:0", failureClassification: "cancelled" });
  });

  it("recovers approval-gated Foreach sends without duplicate side effects", async () => {
    const initialProvider = new MockSideEffectProvider();
    const setup = await createRuntime(undefined, undefined, undefined, initialProvider);
    const project = setup.projectRepository.createProject({ name: "Foreach approval recovery", sourceType: "local", sourceRef: setup.dir });
    const flow = setup.nodeFlowRepository.createFlow(project.id, { title: "Foreach sends", graph: {
      nodes: [
        { id: "foreach", type: "foreach", title: "Foreach", data: { path: "input.items", concurrency: 2 } },
        { id: "send", type: "email_send", title: "Send", data: { to: "ops@example.test", subject: "Item {{item}}", body: "Body {{item}}" } },
      ], edges: [{ fromNodeId: "foreach", fromHandle: "items", toNodeId: "send" }],
    } });
    const waiting = await setup.runtime.runFlow(project.id, flow.id, { items: ["a", "b"] });
    const approvals = setup.approvalService!.listForRun(waiting.run.id);
    expect(waiting.run.status).toBe("approval_waiting");
    expect(approvals.map((approval) => approval.logicalItem).sort()).toEqual(["foreach:0", "foreach:1"]);
    for (const approval of approvals) setup.approvalService!.approve(approval.id, "operator");

    const restartedProvider = new MockSideEffectProvider();
    const restartedRuntime = new NodeFlowRuntimeService({
      nodeFlowRepository: new NodeFlowRepository(setup.storage), executionRepository: new ExecutionRepository(setup.storage),
      projectManagementRepository: new ProjectManagementRepository(setup.storage), settingsRepository: new SettingsRepository(path.join(setup.dir, "foreach-restart.db")),
      approvalService: new ApprovalService(new AutomationApprovalRepository(setup.storage)),
      outboxService: new OutboxService(new AutomationOutboxRepository(setup.storage), restartedProvider), getDashboardSettings: () => DEFAULT_DASHBOARD_SETTINGS,
    });
    const completed = await restartedRuntime.resumeApproval(project.id, approvals[0]!.id, waiting.run.id);
    const replay = await restartedRuntime.resumeApproval(project.id, approvals[0]!.id, waiting.run.id);
    expect(completed.run.status).toBe("succeeded");
    expect(replay.run.status).toBe("succeeded");
    expect(restartedProvider.sends).toHaveLength(2);
    expect(new Set(new AutomationOutboxRepository(setup.storage).listForRun(waiting.run.id).map((record) => record.idempotencyKey)).size).toBe(2);
    expect(completed.attempts?.filter((attempt) => attempt.nodeId === "send").map((attempt) => [attempt.logicalItem, attempt.attemptNumber]))
      .toEqual([["foreach:0", 1], ["foreach:1", 1]]);
  });
});
