import { randomUUID } from "crypto";
import { normalizeNodeFlowGraph } from "../domain/node-flows/node-flow-validation.js";
import { resolveNodeDefinition } from "../domain/node-flows/node-definition-registry.js";
import { ValidationError, EntityNotFoundError } from "../repositories/repository-utils.js";
import { DEFAULT_DASHBOARD_SETTINGS } from "../repositories/settings-defaults.js";
import type { NodeFlowRepository } from "../repositories/node-flow-repository.js";
import type { ExecutionRepository } from "../repositories/execution-repository.js";
import type { ProjectManagementRepository } from "../repositories/project-management-repository.js";
import type { SettingsRepository } from "../repositories/settings-repository.js";
import type { ProviderExecutionService } from "./provider-execution-service.js";
import type { CliProviderId } from "../infrastructure/providers/cli/provider-command-specs.js";
import type { ProviderRunResult } from "../infrastructure/providers/cli/provider-runner.js";
import type { CredentialBroker } from "./credentials/credential-broker.js";
import { NodeFlowPublicationService } from "./node-flows/node-flow-publication-service.js";
import { NodeFlowQueueService } from "./node-flows/node-flow-queue-service.js";
import { NodeFlowAttemptService } from "./node-flows/node-flow-attempt-service.js";
import { NodeFlowLeaseService } from "./node-flows/node-flow-lease-service.js";
import { EgressPolicyService } from "./node-flows/egress-policy-service.js";
import { BuiltinExecutors, MAX_FOREACH_CONCURRENCY } from "./node-flows/builtins/builtin-executors.js";
import type { ApprovalService } from "./node-flows/approval-service.js";
import { ApprovalRequiredError } from "./node-flows/approval-service.js";
import { UnknownSideEffectOutcomeError, type OutboxService } from "./node-flows/outbox-service.js";
import type { CustomNodeRuntimeService } from "./custom-nodes/custom-node-runtime-service.js";
import type { AutomationAuditExportService } from "./automation-audit-export-service.js";
import type { NodeFlowFailureClassification } from "../contracts/node-flow-execution-policy-types.js";
import { buildProviderInvocationWorkspaceOptions } from "../infrastructure/providers/cli/invocation-workspace-preparer.js";
import type {
  DashboardSettings,
  ProviderId,
  ProviderSettings,
} from "../contracts/app-types.js";
import type {
  NodeFlowGraph,
  NodeFlowJsonObject,
  NodeFlowJsonValue,
  NodeFlowNode,
  NodeFlowNodeRunRecord,
  NodeFlowPublicationRecord,
  NodeFlowRunRecord,
  NodeFlowRunSummaryResponse,
  RunNodeFlowOptions,
} from "../contracts/node-flow-types.js";

const EXTERNALLY_OBSERVABLE_NODE_TYPES = new Set(["provider_prompt", "http_request"]);
const CLI_PROVIDER_IDS = new Set<ProviderId>(["gemini", "codex", "claude-code", "qwen-code", "opencode", "antigravity", "mockup-cli"]);
const SECRET_KEY_PATTERN = /(api[_-]?key|authorization|cookie|password|secret|token)/i;
const MAX_HTTP_TIMEOUT_MS = 60_000;
const DEFAULT_HTTP_TIMEOUT_MS = 30_000;

interface NodeFlowRuntimeDeps {
  nodeFlowRepository: NodeFlowRepository;
  executionRepository: ExecutionRepository;
  projectManagementRepository: ProjectManagementRepository;
  settingsRepository: SettingsRepository;
  providerExecutionService?: ProviderExecutionService;
  getDashboardSettings?: (projectId: string) => DashboardSettings;
  credentialBroker?: CredentialBroker;
  egressPolicyService?: EgressPolicyService;
  approvalService?: ApprovalService;
  outboxService?: OutboxService;
  customNodeRuntimeService?: CustomNodeRuntimeService;
  auditService?: AutomationAuditExportService;
}

interface RuntimeContext {
  projectId: string;
  flowId: string;
  runId: string;
  graph: NodeFlowGraph;
  order: string[];
  input: NodeFlowJsonObject;
  outputs: Map<string, NodeFlowJsonObject>;
  selectedPorts: Map<string, Set<string>>;
  predecessors: Map<string, string[]>;
  descendants: Map<string, Set<string>>;
  options: RunNodeFlowOptions;
  executorId: string;
  currentAttemptId?: string;
  publicationId: string;
  subflowDepth: number;
  resolvedCredentialValues: string[];
  logicalItem: string;
  item?: NodeFlowJsonValue;
  itemIndex?: number;
}

interface NodeExecutionResult {
  output: NodeFlowJsonObject;
  invocationId?: string | null;
  selectedPorts?: string[];
}

export class NodeFlowRuntimeService {
  private readonly egressPolicyService: EgressPolicyService;
  private readonly builtins: BuiltinExecutors;

  constructor(private readonly deps: NodeFlowRuntimeDeps) {
    this.egressPolicyService = deps.egressPolicyService ?? new EgressPolicyService();
    this.builtins = new BuiltinExecutors({
      approvalService: deps.approvalService,
      outboxService: deps.outboxService,
      executeSubflow: async ({ projectId, flowId, input, depth, signal }) => {
        const summary = await this.runFlow(projectId, flowId, input, { signal, subflowDepth: depth, triggerType: "subflow" });
        if (summary.run.status !== "succeeded") {
          throw new Error(summary.run.errorMessage ?? `Subflow ${flowId} ended with status ${summary.run.status}.`);
        }
        return summary.output ?? {};
      },
    });
  }

  requestCancellation(runId: string): NodeFlowRunRecord {
    const requested = this.deps.nodeFlowRepository.requestCancellation(runId);
    return requested.status === "approval_waiting" ? this.terminateCancelledRun(requested).run : requested;
  }

  async runFlow(
    projectId: string,
    flowId: string,
    input: NodeFlowJsonObject = {},
    options: RunNodeFlowOptions = {},
  ): Promise<NodeFlowRunSummaryResponse> {
    const flow = this.deps.nodeFlowRepository.getFlow(flowId);
    if (!flow) {
      throw new EntityNotFoundError(`Node flow not found: ${flowId}`);
    }
    if (flow.projectId !== projectId) {
      throw new ValidationError("Node flow does not belong to the requested project.");
    }

    const selection = options.versionSelection ?? { mode: "latest_published" };
    const publication = new NodeFlowPublicationService(this.deps.nodeFlowRepository).resolve(flow.id, selection);
    const { graph, executionOrder } = normalizeNodeFlowGraph(publication.graph);
    this.requireSupportedNodes(graph);
    const sanitizedInput = maskSecrets(input);
    const startedAt = new Date().toISOString();
    const parentInvocation = this.deps.executionRepository.createExecutionInvocation({
      projectId,
      skipValidation: true,
      type: "node_flow",
      status: "running",
      startedAt,
    });
    this.deps.executionRepository.appendExecutionInvocationMessage(parentInvocation.id, {
      role: "system",
      contentMarkdown: `Node flow run started for flow ${flow.id} at published version ${publication.version}.`,
      metadata: {
        flowId: flow.id,
        flowVersion: publication.version,
        publicationId: publication.id,
      },
    });

    const run = this.deps.nodeFlowRepository.createRun({
      flowId: flow.id,
      projectId,
      version: publication.version,
      publicationId: publication.id,
      policy: publication.policy,
      status: "queued",
      executionInvocationId: parentInvocation.id,
      triggerType: options.triggerType,
      triggerPayload: options.triggerPayload ? maskSecrets(options.triggerPayload) : null,
      input: sanitizedInput,
      startedAt: null,
    });
    this.deps.auditService?.recordSystem({ action: "automation.run.started", resourceType: "node_flow_run", resourceId: run.id, projectId, outcome: "succeeded", metadata: { flowId: flow.id, publicationId: publication.id, version: publication.version, triggerType: options.triggerType ?? "manual" } });
    return await this.executeRun(run, publication, graph, executionOrder, input, options, "queued");
  }

  async resumeRun(
    projectId: string,
    runId: string,
    options: Pick<RunNodeFlowOptions, "signal" | "executorId"> = {},
  ): Promise<NodeFlowRunSummaryResponse> {
    const run = this.deps.nodeFlowRepository.getRun(runId);
    if (!run) throw new EntityNotFoundError(`Node flow run not found: ${runId}`);
    if (run.projectId !== projectId) throw new ValidationError("Node flow run does not belong to the requested project.");
    if (run.status !== "queued") return this.summarizeRun(run.id);
    const publication = new NodeFlowPublicationService(this.deps.nodeFlowRepository).resolve(run.flowId, {
      mode: "pinned",
      version: run.version,
    });
    if (run.publicationId && publication.id !== run.publicationId) {
      throw new ValidationError("The recoverable run no longer matches its pinned publication.");
    }
    const { graph, executionOrder } = normalizeNodeFlowGraph(publication.graph);
    this.requireSupportedNodes(graph);
    return await this.executeRun(run, publication, graph, executionOrder, run.input ?? {}, options, "queued");
  }

  async resumeApproval(projectId: string, approvalId: string, expectedRunId?: string, options: Pick<RunNodeFlowOptions, "signal" | "executorId"> = {}): Promise<NodeFlowRunSummaryResponse> {
    if (!this.deps.approvalService) throw new ValidationError("Approval service is not configured.");
    const approval = this.deps.approvalService.get(approvalId);
    if (!approval) throw new EntityNotFoundError(`Automation approval not found: ${approvalId}`);
    const run = this.deps.nodeFlowRepository.getRun(approval.runId);
    if (!run) throw new EntityNotFoundError(`Node flow run not found: ${approval.runId}`);
    if (expectedRunId && run.id !== expectedRunId) throw new ValidationError("Approval does not belong to the requested node flow run.");
    if (run.projectId !== projectId) throw new ValidationError("Node flow run does not belong to the requested project.");
    if (run.flowId !== approval.flowId || run.projectId !== approval.projectId) {
      throw new ValidationError("Approval scope does not match its node flow run.");
    }
    if (run.status !== "approval_waiting") return this.summarizeRun(run.id);
    const waitingNode = this.deps.nodeFlowRepository.listNodeRuns(run.id)
      .find((candidate) => candidate.status === "approval_waiting" && candidate.nodeId === approval.nodeId
        && (candidate.logicalItem === approval.logicalItem || candidate.logicalItem === "default"));
    if (!waitingNode) {
      throw new ValidationError("Approval does not match the governed node currently waiting in this run.");
    }
    if (approval.status === "pending") throw new ValidationError(`Approval ${approval.id} is still pending.`);
    if (approval.status === "rejected" || approval.status === "expired") {
      return this.terminateApprovalRun(run, approval.nodeId, approval.logicalItem, approval.status);
    }
    if (run.cancelRequestedAt) return this.terminateCancelledRun(run);
    const publication = new NodeFlowPublicationService(this.deps.nodeFlowRepository).resolve(run.flowId, { mode: "pinned", version: run.version });
    if (run.publicationId && publication.id !== run.publicationId) {
      throw new ValidationError("The waiting run no longer matches its pinned publication.");
    }
    const { graph, executionOrder } = normalizeNodeFlowGraph(publication.graph);
    this.requireSupportedNodes(graph);
    return await this.executeRun(run, publication, graph, executionOrder, run.input ?? {}, options, "approval_waiting");
  }

  private async executeRun(
    run: NodeFlowRunRecord,
    publication: NodeFlowPublicationRecord,
    graph: NodeFlowGraph,
    executionOrder: string[],
    input: NodeFlowJsonObject,
    options: RunNodeFlowOptions,
    claimFrom: "queued" | "approval_waiting",
  ): Promise<NodeFlowRunSummaryResponse> {
    const projectId = run.projectId;
    const flowId = run.flowId;
    const parentInvocationId = run.executionInvocationId;
    if (!parentInvocationId) throw new ValidationError(`Node flow run ${run.id} has no parent execution invocation.`);
    const executorId = options.executorId?.trim() || `node-flow-runtime:${process.pid}:${randomUUID()}`;
    const claimedRun = claimFrom === "queued"
      ? new NodeFlowQueueService(this.deps.nodeFlowRepository).claim(run, executorId)
      : this.deps.nodeFlowRepository.claimApprovalWaitingRun(run.id, executorId, publication.policy.leaseDurationMs);
    if (!claimedRun) return this.summarizeRun(run.id);
    const leaseService = new NodeFlowLeaseService(this.deps.nodeFlowRepository);
    const heartbeatTimer = setInterval(() => {
      leaseService.heartbeat(claimedRun.id, executorId, publication.policy.leaseDurationMs);
    }, publication.policy.heartbeatIntervalMs);
    heartbeatTimer.unref?.();

    const context: RuntimeContext = {
      projectId,
      flowId,
      runId: claimedRun.id,
      graph,
      order: executionOrder,
      input,
      outputs: new Map(),
      selectedPorts: new Map(),
      predecessors: buildPredecessors(graph),
      descendants: buildDescendants(graph),
      options,
      executorId,
      publicationId: publication.id,
      subflowDepth: options.subflowDepth ?? 0,
      resolvedCredentialValues: [],
      logicalItem: "default",
    };

    const persistedNodeRuns = this.deps.nodeFlowRepository.listNodeRuns(run.id);
    const persistedByNode = new Map<string, NodeFlowNodeRunRecord>();
    for (const persisted of persistedNodeRuns) persistedByNode.set(nodeRunKey(persisted.nodeId, persisted.logicalItem), persisted);
    for (const node of graph.nodes) {
      const persisted = persistedByNode.get(nodeRunKey(node.id, "default"));
      if (!persisted?.output || !["succeeded", "failed"].includes(persisted.status)) continue;
      context.outputs.set(node.id, persisted.output);
      const selectedPorts = inferSelectedPorts(node, persisted.output);
      if (selectedPorts) context.selectedPorts.set(node.id, selectedPorts);
    }

    const blockedNodes = new Set<string>();
    const fanoutHandledNodes = new Set<string>();
    let terminalStatus: NodeFlowRunRecord["status"] = "succeeded";
    let terminalError: string | null = null;

    for (let nodeIndex = 0; nodeIndex < executionOrder.length; nodeIndex += 1) {
      const nodeId = executionOrder[nodeIndex]!;
      const node = graph.nodes.find((candidate) => candidate.id === nodeId);
      if (!node) {
        continue;
      }
      const persistedNodeRun = persistedByNode.get(nodeRunKey(node.id, "default"));
      if (fanoutHandledNodes.has(node.id)) continue;
      if (persistedNodeRun && ["succeeded", "failed", "skipped", "cancelled"].includes(persistedNodeRun.status)) {
        if (node.type === "foreach" && persistedNodeRun.status === "succeeded") {
          const fanout = await this.executeForeachFanout(context, node, publication, persistedNodeRun.output ?? {}, persistedNodeRuns);
          if (fanout.handled) {
            for (const descendant of context.descendants.get(node.id) ?? []) fanoutHandledNodes.add(descendant);
            terminalStatus = fanout.status;
            terminalError = fanout.error;
            if (terminalStatus !== "succeeded") break;
          }
        }
        continue;
      }
      if (options.signal?.aborted || this.deps.nodeFlowRepository.getRun(run.id)?.cancelRequestedAt) {
        terminalStatus = "cancelled";
        terminalError ??= "Node flow run was cancelled.";
        await this.persistSkippedNode(context, node, "cancelled", terminalError);
        for (const remainingNodeId of executionOrder.slice(executionOrder.indexOf(nodeId) + 1)) {
          const remaining = graph.nodes.find((candidate) => candidate.id === remainingNodeId);
          if (remaining) {
            await this.persistSkippedNode(context, remaining, "cancelled", terminalError);
          }
        }
        break;
      }
      if (blockedNodes.has(node.id)) {
        await this.persistSkippedNode(context, node, "skipped", "Skipped because an upstream node failed.");
        continue;
      }
      if (this.isInactiveBranch(context, node.id)) {
        await this.persistSkippedNode(context, node, "skipped", "Skipped because its incoming branch was not selected.");
        continue;
      }
      if (node.disabled) {
        await this.persistSkippedNode(context, node, "skipped", "Skipped because the node is disabled.");
        continue;
      }

      const nodeInput = maskSecrets(this.buildNodeInput(context, node.id));
      const resumableNodeRun = persistedNodeRun && ["running", "retry_waiting", "approval_waiting"].includes(persistedNodeRun.status);
      const nodeRun = resumableNodeRun
        ? this.deps.nodeFlowRepository.updateNodeRun(persistedNodeRun.id, { status: "running", errorMessage: null })
        : this.deps.nodeFlowRepository.createNodeRun({
          runId: run.id,
          flowId,
          projectId,
          nodeId: node.id,
          logicalItem: context.logicalItem,
          status: "running",
          input: nodeInput,
          startedAt: new Date().toISOString(),
        });

      const attemptService = new NodeFlowAttemptService(this.deps.nodeFlowRepository);
      const retryPolicy = {
        ...publication.policy.retry,
        ...(node.policy?.retry ?? {}),
      };
      let executionAttempt = 0;
      let waitingAttempt = this.deps.nodeFlowRepository.listNodeAttempts(run.id)
        .find((candidate) => candidate.nodeRunId === nodeRun.id && candidate.status === "approval_waiting");
      let interruptedAttempt = this.deps.nodeFlowRepository.listNodeAttempts(run.id)
        .find((candidate) => candidate.nodeRunId === nodeRun.id && candidate.status === "running" && candidate.invocationId === null);
      while (executionAttempt < retryPolicy.maxAttempts) {
        executionAttempt += 1;
        clearResolvedCredentials(context);
        const attempt = waitingAttempt
          ? this.deps.nodeFlowRepository.updateNodeAttempt(waitingAttempt.id, { status: "running", errorMessage: null, finishedAt: null })
          : interruptedAttempt
            ? this.deps.nodeFlowRepository.updateNodeAttempt(interruptedAttempt.id, { status: "running", errorMessage: null, finishedAt: null })
            : attemptService.start(nodeRun, executorId, nodeInput, (node.credentialBindings ?? []).map((binding) => binding.credentialId));
        waitingAttempt = undefined;
        interruptedAttempt = undefined;
        context.currentAttemptId = attempt.id;
        const timeoutMs = node.policy?.timeout?.timeoutMs ?? publication.policy.defaultTimeoutMs;
        const timeoutController = new AbortController();
        const parentAbort = (): void => timeoutController.abort(options.signal?.reason);
        options.signal?.addEventListener("abort", parentAbort, { once: true });
        const timeout = setTimeout(() => timeoutController.abort(new Error(`Node ${node.id} timed out after ${timeoutMs}ms.`)), timeoutMs);
        const previousOptions = context.options;
        context.options = { ...options, signal: timeoutController.signal };
        try {
        const result = await this.executeNode(context, node, nodeRun);
        const safeOutput = redactCredentialJson(result.output, context.resolvedCredentialValues);
        context.outputs.set(node.id, safeOutput);
        if (result.selectedPorts) context.selectedPorts.set(node.id, new Set(result.selectedPorts));
        attemptService.succeed(attempt, safeOutput, result.invocationId);
        this.deps.auditService?.recordSystem({ action: "automation.attempt.succeeded", resourceType: "node_flow_attempt", resourceId: attempt.id,
          projectId: context.projectId, outcome: "succeeded", metadata: { runId: context.runId, flowId: context.flowId, nodeId: node.id,
            logicalItem: context.logicalItem, attemptNumber: attempt.attemptNumber } });
        this.deps.auditService?.recordSystem({ action: "automation.attempt.succeeded", resourceType: "node_flow_attempt", resourceId: attempt.id, projectId, outcome: "succeeded", metadata: { runId: run.id, flowId, nodeId: node.id, attemptNumber: attempt.attemptNumber } });
        this.deps.nodeFlowRepository.updateNodeRun(nodeRun.id, {
          status: "succeeded",
          executionInvocationId: result.invocationId ?? nodeRun.executionInvocationId,
          output: safeOutput,
          finishedAt: new Date().toISOString(),
        });
        if (node.type === "foreach") {
          const fanout = await this.executeForeachFanout(context, node, publication, safeOutput, persistedNodeRuns);
          if (fanout.handled) {
            for (const descendant of context.descendants.get(node.id) ?? []) fanoutHandledNodes.add(descendant);
            terminalStatus = fanout.status;
            terminalError = fanout.error;
          }
        }
        break;
      } catch (error) {
        const message = redactCredentialText(error instanceof Error ? error.message : String(error), context.resolvedCredentialValues);
        const classification = classifyFailure(error, options.signal?.aborted === true, timeoutController.signal.aborted);
        if (error instanceof ApprovalRequiredError) {
          this.deps.nodeFlowRepository.updateNodeAttempt(attempt.id, { status: "approval_waiting", errorMessage: message, retryDecision: null, finishedAt: null });
          this.deps.nodeFlowRepository.updateNodeRun(nodeRun.id, {
            status: "approval_waiting", errorMessage: message, finishedAt: null,
          });
          terminalStatus = "approval_waiting";
          terminalError = message;
          break;
        }
        this.deps.auditService?.recordSystem({ action: "automation.attempt.failed", resourceType: "node_flow_attempt", resourceId: attempt.id, projectId, outcome: "failed", metadata: { runId: run.id, flowId, nodeId: node.id, attemptNumber: attempt.attemptNumber, classification } });
        const wasCancelled = classification === "cancelled";
        const retryable = retryPolicy.retryableClasses.includes(classification) && executionAttempt < retryPolicy.maxAttempts;
        attemptService.fail(attempt, classification, message, retryable, this.deps.nodeFlowRepository.listNodeAttempts(run.id).find((candidate) => candidate.id === attempt.id)?.invocationId);
        if (retryable) {
          this.deps.nodeFlowRepository.updateNodeRun(nodeRun.id, { status: "retry_waiting", errorMessage: message });
          await delay(retryDelay(retryPolicy.backoffMs, retryPolicy.maxBackoffMs ?? retryPolicy.backoffMs, retryPolicy.jitterRatio ?? 0, executionAttempt), options.signal);
          this.deps.nodeFlowRepository.updateNodeRun(nodeRun.id, { status: "running", errorMessage: null });
          continue;
        }
        const continueOnError = node.data?.continueOnError === true;
        const failureOutput = { error: message };
        context.outputs.set(node.id, failureOutput);
        this.deps.nodeFlowRepository.updateNodeRun(nodeRun.id, {
          status: wasCancelled ? "cancelled" : "failed",
          output: maskSecrets(failureOutput),
          errorMessage: message,
          finishedAt: new Date().toISOString(),
        });
        if (classification === "unknown_side_effect") {
          terminalStatus = "attention_required";
          terminalError = message;
        } else if (wasCancelled) {
          terminalStatus = "cancelled";
          terminalError ??= message || "Node flow run was cancelled.";
          for (const remainingNodeId of executionOrder.slice(nodeIndex + 1)) {
            const remaining = graph.nodes.find((candidate) => candidate.id === remainingNodeId);
            if (remaining) {
              await this.persistSkippedNode(context, remaining, "cancelled", terminalError);
            }
          }
          break;
        }
        if (!continueOnError) {
          terminalStatus = "failed";
          terminalError ??= message;
          for (const descendant of context.descendants.get(node.id) ?? []) {
            blockedNodes.add(descendant);
          }
        }
        break;
      } finally {
        clearTimeout(timeout);
        options.signal?.removeEventListener("abort", parentAbort);
        context.options = previousOptions;
        clearResolvedCredentials(context);
      }
      }
      if (terminalStatus === "cancelled" || terminalStatus === "attention_required" || terminalStatus === "approval_waiting") {
        break;
      }
    }

    const output = this.buildFlowOutput(context);
    const finishedAt = terminalStatus === "approval_waiting" ? null : new Date().toISOString();
    const updatedRun = this.deps.nodeFlowRepository.updateRun(run.id, {
      status: terminalStatus,
      output: maskSecrets(output),
      errorMessage: terminalError,
      finishedAt,
      leaseOwner: null,
      leaseExpiresAt: null,
    });
    this.deps.executionRepository.updateExecutionInvocation(parentInvocationId, {
      status: terminalStatus === "succeeded" ? "completed" : terminalStatus === "approval_waiting" ? "running" : terminalStatus === "cancelled" ? "cancelled" : "failed",
      errorMessage: terminalStatus === "approval_waiting" ? null : terminalError,
      finishedAt,
    });
    this.deps.executionRepository.appendExecutionInvocationMessage(parentInvocationId, {
      role: terminalStatus === "succeeded" ? "assistant" : "system",
      contentMarkdown: terminalStatus === "succeeded"
        ? "Node flow run completed."
        : `Node flow run ${terminalStatus}: ${terminalError ?? "No error message."}`,
      metadata: {
        flowId,
        runId: run.id,
        status: terminalStatus,
      },
    });
    this.deps.auditService?.recordSystem({ action: terminalStatus === "approval_waiting" ? "automation.run.approval_waiting" : "automation.run.finished", resourceType: "node_flow_run", resourceId: run.id, projectId, outcome: terminalStatus === "succeeded" || terminalStatus === "approval_waiting" ? "succeeded" : "failed", metadata: { flowId, publicationId: publication.id, status: terminalStatus } });

    clearInterval(heartbeatTimer);
    return {
      run: updatedRun,
      nodeRuns: this.deps.nodeFlowRepository.listNodeRuns(run.id),
      attempts: this.deps.nodeFlowRepository.listNodeAttempts(run.id),
      output: updatedRun.output,
    };
  }

  private async executeForeachFanout(
    parent: RuntimeContext,
    foreachNode: NodeFlowNode,
    publication: NodeFlowPublicationRecord,
    foreachOutput: NodeFlowJsonObject,
    persistedNodeRuns: NodeFlowNodeRunRecord[],
  ): Promise<{ handled: boolean; status: NodeFlowRunRecord["status"]; error: string | null }> {
    const items = Array.isArray(foreachOutput.items) ? foreachOutput.items : [];
    if (items.length === 0) return { handled: false, status: "succeeded", error: null };
    const rawConcurrency = Number(readNodeConfig(foreachNode).concurrency ?? 1);
    const concurrency = Math.max(1, Math.min(MAX_FOREACH_CONCURRENCY, Number.isFinite(rawConcurrency) ? Math.floor(rawConcurrency) : 1));
    const descendantIds = parent.descendants.get(foreachNode.id) ?? new Set<string>();
    const order = parent.order.filter((nodeId) => descendantIds.has(nodeId));
    const itemOutputs: Array<Map<string, NodeFlowJsonObject> | undefined> = new Array(items.length);
    const outcomes = await mapWithConcurrency(items, concurrency, async (item, index) => {
      const logicalItem = `${foreachNode.id}:${index}`;
      const context: RuntimeContext = {
        ...parent,
        outputs: new Map(parent.outputs),
        selectedPorts: new Map([...parent.selectedPorts].map(([nodeId, ports]) => [nodeId, new Set(ports)])),
        options: { ...parent.options },
        currentAttemptId: undefined,
        resolvedCredentialValues: [],
        logicalItem,
        item,
        itemIndex: index,
      };
      context.outputs.set(foreachNode.id, { item, index, count: items.length, logicalItem });
      context.selectedPorts.set(foreachNode.id, new Set(["items"]));
      const persistedByNode = new Map(persistedNodeRuns
        .filter((record) => record.logicalItem === logicalItem)
        .map((record) => [record.nodeId, record]));
      for (const record of persistedByNode.values()) {
        if (record.output && ["succeeded", "failed"].includes(record.status)) {
          context.outputs.set(record.nodeId, record.output);
          const node = context.graph.nodes.find((candidate) => candidate.id === record.nodeId);
          const selectedPorts = node ? inferSelectedPorts(node, record.output) : null;
          if (selectedPorts) context.selectedPorts.set(record.nodeId, selectedPorts);
        }
      }
      const blocked = new Set<string>();
      let itemError = [...persistedByNode.values()].find((record) => record.status === "failed"
        && context.graph.nodes.find((node) => node.id === record.nodeId)?.data?.continueOnError !== true)?.errorMessage ?? null;
      for (const nodeId of order) {
        const node = context.graph.nodes.find((candidate) => candidate.id === nodeId);
        if (!node) continue;
        const persisted = persistedByNode.get(node.id);
        if (persisted && ["succeeded", "failed", "skipped", "cancelled"].includes(persisted.status)) continue;
        if (context.options.signal?.aborted || this.deps.nodeFlowRepository.getRun(context.runId)?.cancelRequestedAt) {
          await this.persistSkippedNode(context, node, "cancelled", "Node flow run was cancelled.");
          return { status: "cancelled" as const, error: "Node flow run was cancelled." };
        }
        if (blocked.has(node.id)) {
          await this.persistSkippedNode(context, node, "skipped", "Skipped because this logical item's upstream node failed.");
          continue;
        }
        if (this.isInactiveBranch(context, node.id)) {
          await this.persistSkippedNode(context, node, "skipped", "Skipped because this logical item's incoming branch was not selected.");
          continue;
        }
        if (node.disabled) {
          await this.persistSkippedNode(context, node, "skipped", "Skipped because the node is disabled.");
          continue;
        }
        const result = await this.executeLogicalItemNode(context, node, publication, persisted);
        if (result.status === "approval_waiting" || result.status === "attention_required" || result.status === "cancelled") {
          return result;
        }
        if (result.status === "failed" && node.data?.continueOnError !== true) {
          itemError ??= result.error;
          for (const descendant of context.descendants.get(node.id) ?? []) blocked.add(descendant);
        }
      }
      itemOutputs[index] = context.outputs;
      return { status: itemError ? "failed" as const : "succeeded" as const, error: itemError };
    });

    for (const nodeId of order) {
      const values = itemOutputs.map((outputs) => outputs?.get(nodeId) ?? null);
      parent.outputs.set(nodeId, { items: values, count: items.length });
    }
    const priority: NodeFlowRunRecord["status"][] = ["attention_required", "cancelled", "approval_waiting", "failed"];
    const terminal = priority.find((status) => outcomes.some((outcome) => outcome.status === status));
    const error = outcomes.find((outcome) => outcome.status === terminal)?.error ?? null;
    return { handled: true, status: terminal ?? "succeeded", error };
  }

  private async executeLogicalItemNode(
    context: RuntimeContext,
    node: NodeFlowNode,
    publication: NodeFlowPublicationRecord,
    persisted?: NodeFlowNodeRunRecord,
  ): Promise<{ status: NodeFlowRunRecord["status"]; error: string | null }> {
    const nodeInput = maskSecrets(this.buildNodeInput(context, node.id));
    const resumable = persisted && ["running", "retry_waiting", "approval_waiting"].includes(persisted.status);
    const nodeRun = resumable
      ? this.deps.nodeFlowRepository.updateNodeRun(persisted.id, { status: "running", input: nodeInput, errorMessage: null })
      : this.deps.nodeFlowRepository.createNodeRun({ runId: context.runId, flowId: context.flowId, projectId: context.projectId,
        nodeId: node.id, logicalItem: context.logicalItem, status: "running", input: nodeInput, startedAt: new Date().toISOString() });
    const attemptService = new NodeFlowAttemptService(this.deps.nodeFlowRepository);
    const retryPolicy = { ...publication.policy.retry, ...(node.policy?.retry ?? {}) };
    let executionAttempt = this.deps.nodeFlowRepository.listNodeAttempts(context.runId)
      .filter((attempt) => attempt.nodeRunId === nodeRun.id && attempt.status !== "approval_waiting" && !(attempt.status === "running" && attempt.invocationId === null)).length;
    let waitingAttempt = this.deps.nodeFlowRepository.listNodeAttempts(context.runId)
      .find((attempt) => attempt.nodeRunId === nodeRun.id && attempt.status === "approval_waiting");
    let interruptedAttempt = this.deps.nodeFlowRepository.listNodeAttempts(context.runId)
      .find((attempt) => attempt.nodeRunId === nodeRun.id && attempt.status === "running" && attempt.invocationId === null);
    while (executionAttempt < retryPolicy.maxAttempts) {
      executionAttempt += 1;
      clearResolvedCredentials(context);
      const attempt = waitingAttempt
        ? this.deps.nodeFlowRepository.updateNodeAttempt(waitingAttempt.id, { status: "running", errorMessage: null, finishedAt: null })
        : interruptedAttempt
          ? this.deps.nodeFlowRepository.updateNodeAttempt(interruptedAttempt.id, { status: "running", errorMessage: null, finishedAt: null })
          : attemptService.start(nodeRun, context.executorId, nodeInput, (node.credentialBindings ?? []).map((binding) => binding.credentialId));
      waitingAttempt = undefined;
      interruptedAttempt = undefined;
      context.currentAttemptId = attempt.id;
      const timeoutMs = node.policy?.timeout?.timeoutMs ?? publication.policy.defaultTimeoutMs;
      const timeoutController = new AbortController();
      const parentAbort = (): void => timeoutController.abort(context.options.signal?.reason);
      context.options.signal?.addEventListener("abort", parentAbort, { once: true });
      const timeout = setTimeout(() => timeoutController.abort(new Error(`Node ${node.id} timed out after ${timeoutMs}ms.`)), timeoutMs);
      const previousOptions = context.options;
      context.options = { ...context.options, signal: timeoutController.signal };
      try {
        const result = await this.executeNode(context, node, nodeRun);
        const safeOutput = redactCredentialJson(result.output, context.resolvedCredentialValues);
        context.outputs.set(node.id, safeOutput);
        if (result.selectedPorts) context.selectedPorts.set(node.id, new Set(result.selectedPorts));
        attemptService.succeed(attempt, safeOutput, result.invocationId);
        this.deps.nodeFlowRepository.updateNodeRun(nodeRun.id, { status: "succeeded", executionInvocationId: result.invocationId ?? nodeRun.executionInvocationId,
          output: safeOutput, finishedAt: new Date().toISOString() });
        return { status: "succeeded", error: null };
      } catch (error) {
        const message = redactCredentialText(error instanceof Error ? error.message : String(error), context.resolvedCredentialValues);
        const classification = classifyFailure(error, previousOptions.signal?.aborted === true, timeoutController.signal.aborted);
        if (error instanceof ApprovalRequiredError) {
          this.deps.nodeFlowRepository.updateNodeAttempt(attempt.id, { status: "approval_waiting", errorMessage: message, retryDecision: null, finishedAt: null });
          this.deps.nodeFlowRepository.updateNodeRun(nodeRun.id, { status: "approval_waiting", errorMessage: message, finishedAt: null });
          return { status: "approval_waiting", error: message };
        }
        this.deps.auditService?.recordSystem({ action: "automation.attempt.failed", resourceType: "node_flow_attempt", resourceId: attempt.id,
          projectId: context.projectId, outcome: "failed", metadata: { runId: context.runId, flowId: context.flowId, nodeId: node.id,
            logicalItem: context.logicalItem, attemptNumber: attempt.attemptNumber, classification } });
        const retryable = retryPolicy.retryableClasses.includes(classification) && executionAttempt < retryPolicy.maxAttempts;
        const invocationId = this.deps.nodeFlowRepository.listNodeAttempts(context.runId).find((candidate) => candidate.id === attempt.id)?.invocationId;
        attemptService.fail(attempt, classification, message, retryable, invocationId);
        if (retryable) {
          this.deps.nodeFlowRepository.updateNodeRun(nodeRun.id, { status: "retry_waiting", errorMessage: message });
          await delay(retryDelay(retryPolicy.backoffMs, retryPolicy.maxBackoffMs ?? retryPolicy.backoffMs, retryPolicy.jitterRatio ?? 0, executionAttempt), previousOptions.signal);
          this.deps.nodeFlowRepository.updateNodeRun(nodeRun.id, { status: "running", errorMessage: null });
          continue;
        }
        const status = classification === "unknown_side_effect" ? "attention_required" : classification === "cancelled" ? "cancelled" : "failed";
        const failureOutput = { error: message };
        context.outputs.set(node.id, failureOutput);
        this.deps.nodeFlowRepository.updateNodeRun(nodeRun.id, { status: status === "attention_required" ? "attention_required" : status,
          output: maskSecrets(failureOutput), errorMessage: message, finishedAt: new Date().toISOString() });
        return { status, error: message };
      } finally {
        clearTimeout(timeout);
        previousOptions.signal?.removeEventListener("abort", parentAbort);
        context.options = previousOptions;
        clearResolvedCredentials(context);
      }
    }
    return { status: "failed", error: `Logical item ${context.logicalItem} exhausted its retry budget.` };
  }

  private terminateApprovalRun(run: NodeFlowRunRecord, nodeId: string, logicalItem: string, status: "rejected" | "expired"): NodeFlowRunSummaryResponse {
    const message = `Approval for node ${nodeId} was ${status}.`;
    const nodeRun = this.deps.nodeFlowRepository.listNodeRuns(run.id).find((candidate) => candidate.nodeId === nodeId && (candidate.logicalItem === logicalItem || candidate.logicalItem === "default") && candidate.status === "approval_waiting");
    if (nodeRun) this.deps.nodeFlowRepository.updateNodeRun(nodeRun.id, { status: "failed", errorMessage: message, finishedAt: new Date().toISOString() });
    const attempt = this.deps.nodeFlowRepository.listNodeAttempts(run.id).find((candidate) => candidate.nodeId === nodeId && (candidate.logicalItem === logicalItem || candidate.logicalItem === "default") && candidate.status === "approval_waiting");
    if (attempt) this.deps.nodeFlowRepository.updateNodeAttempt(attempt.id, { status: "failed", failureClassification: "permanent", retryDecision: "stop", errorMessage: message, finishedAt: new Date().toISOString() });
    for (const waitingNode of this.deps.nodeFlowRepository.listNodeRuns(run.id).filter((candidate) => candidate.status === "approval_waiting" && candidate.id !== nodeRun?.id)) {
      this.deps.nodeFlowRepository.updateNodeRun(waitingNode.id, { status: "cancelled", errorMessage: message, finishedAt: new Date().toISOString() });
    }
    for (const waitingAttempt of this.deps.nodeFlowRepository.listNodeAttempts(run.id).filter((candidate) => candidate.status === "approval_waiting" && candidate.id !== attempt?.id)) {
      this.deps.nodeFlowRepository.updateNodeAttempt(waitingAttempt.id, { status: "cancelled", failureClassification: "cancelled", retryDecision: "stop", errorMessage: message, finishedAt: new Date().toISOString() });
    }
    const updated = this.deps.nodeFlowRepository.updateRun(run.id, { status: "failed", errorMessage: message, finishedAt: new Date().toISOString(), leaseOwner: null, leaseExpiresAt: null });
    if (updated.executionInvocationId) this.deps.executionRepository.updateExecutionInvocation(updated.executionInvocationId, { status: "failed", errorMessage: message, finishedAt: updated.finishedAt });
    return this.summarizeRun(updated.id);
  }

  private terminateCancelledRun(run: NodeFlowRunRecord): NodeFlowRunSummaryResponse {
    const message = "Node flow run was cancelled while waiting for approval.";
    for (const nodeRun of this.deps.nodeFlowRepository.listNodeRuns(run.id).filter((candidate) => candidate.status === "approval_waiting")) {
      this.deps.nodeFlowRepository.updateNodeRun(nodeRun.id, { status: "cancelled", errorMessage: message, finishedAt: new Date().toISOString() });
    }
    for (const attempt of this.deps.nodeFlowRepository.listNodeAttempts(run.id).filter((candidate) => candidate.status === "approval_waiting")) {
      this.deps.nodeFlowRepository.updateNodeAttempt(attempt.id, { status: "cancelled", failureClassification: "cancelled", retryDecision: "stop", errorMessage: message, finishedAt: new Date().toISOString() });
    }
    const updated = this.deps.nodeFlowRepository.updateRun(run.id, { status: "cancelled", errorMessage: message, finishedAt: new Date().toISOString(), leaseOwner: null, leaseExpiresAt: null });
    if (updated.executionInvocationId) this.deps.executionRepository.updateExecutionInvocation(updated.executionInvocationId, { status: "cancelled", errorMessage: message, finishedAt: updated.finishedAt });
    return this.summarizeRun(updated.id);
  }

  private summarizeRun(runId: string): NodeFlowRunSummaryResponse {
    const run = this.deps.nodeFlowRepository.getRun(runId);
    if (!run) throw new EntityNotFoundError(`Node flow run not found: ${runId}`);
    return { run, nodeRuns: this.deps.nodeFlowRepository.listNodeRuns(runId), attempts: this.deps.nodeFlowRepository.listNodeAttempts(runId), output: run.output };
  }

  private requireSupportedNodes(graph: NodeFlowGraph): void {
    const unsupported = graph.nodes.filter((node) => {
      const reference = node.definition ?? { type: node.type, version: 1 };
      return resolveNodeDefinition(reference.type, reference.version)?.executable !== true;
    });
    if (unsupported.length > 0) {
      throw new ValidationError(`Unsupported node flow node type: ${unsupported[0]!.type}.`);
    }
  }

  private async executeNode(
    context: RuntimeContext,
    node: NodeFlowNode,
    nodeRun: NodeFlowNodeRunRecord,
  ): Promise<NodeExecutionResult> {
    const reference = node.definition ?? { type: node.type, version: 1 };
    const definition = resolveNodeDefinition(reference.type, reference.version);
    if (EXTERNALLY_OBSERVABLE_NODE_TYPES.has(node.type) || definition?.executionKind === "custom") {
      const invocation = this.deps.executionRepository.createExecutionInvocation({
        projectId: context.projectId,
        skipValidation: true,
        type: "node_flow_node",
        status: "running",
        startedAt: new Date().toISOString(),
      });
      this.deps.nodeFlowRepository.updateNodeRun(nodeRun.id, { executionInvocationId: invocation.id });
      if (context.currentAttemptId) {
        this.deps.nodeFlowRepository.updateNodeAttempt(context.currentAttemptId, { invocationId: invocation.id });
      }
      try {
        const result = definition?.executionKind === "custom"
          ? await this.executeCustomNode(context, node, invocation.id, reference.type, reference.version)
          : node.type === "provider_prompt"
            ? await this.executeProviderPromptNode(context, node, invocation.id)
            : await this.executeHttpRequestNode(context, node, invocation.id);
        this.deps.executionRepository.updateExecutionInvocation(invocation.id, {
          status: "completed",
          finishedAt: new Date().toISOString(),
        });
        return {
          ...result,
          output: redactCredentialJson(result.output, context.resolvedCredentialValues),
          invocationId: invocation.id,
        };
      } catch (error) {
        const message = redactCredentialText(error instanceof Error ? error.message : String(error), context.resolvedCredentialValues);
        this.deps.executionRepository.clearExecutionInvocationMessages(invocation.id);
        this.deps.executionRepository.updateExecutionInvocation(invocation.id, {
          status: context.options.signal?.aborted ? "cancelled" : "failed",
          errorMessage: message,
          lastErrorMessage: message,
          finishedAt: new Date().toISOString(),
        });
        this.deps.executionRepository.appendExecutionInvocationMessage(invocation.id, {
          role: "system",
          contentMarkdown: `Node ${node.id} failed: ${message}`,
          metadata: { flowId: context.flowId, runId: context.runId, nodeId: node.id },
        });
        throw error;
      }
    }

    switch (node.type) {
      case "input":
        return { output: { ...context.input } };
      case "set_fields":
        return { output: this.executeSetFieldsNode(context, node) };
      case "template":
        return { output: this.executeTemplateNode(context, node) };
      case "output":
        return { output: this.executeOutputNode(context, node) };
      default:
        return this.builtins.execute(node.type, {
          projectId: context.projectId, flowId: context.flowId, publicationId: context.publicationId,
          runId: context.runId, nodeId: node.id,
          config: evaluateTemplates(readNodeConfig(node), context) as NodeFlowJsonObject,
          upstream: this.buildUpstreamObject(context, node.id), flowInput: context.input,
          signal: context.options.signal, subflowDepth: context.subflowDepth,
          logicalItem: context.logicalItem,
          redactJson: (value) => redactCredentialJson(value, context.resolvedCredentialValues),
          redactText: (value) => redactCredentialText(value, context.resolvedCredentialValues),
        });
    }
  }

  private async executeCustomNode(
    context: RuntimeContext,
    node: NodeFlowNode,
    invocationId: string,
    nodeType: string,
    version: number,
  ): Promise<NodeExecutionResult> {
    if (!this.deps.customNodeRuntimeService) throw new ValidationError("Custom node runtime service is not configured.");
    const result = await this.deps.customNodeRuntimeService.execute({
      projectId: context.projectId,
      nodeType,
      version,
      input: this.buildNodeInput(context, node.id),
      config: evaluateTemplates(readNodeConfig(node), context) as NodeFlowJsonObject,
      credentialBindings: Object.fromEntries((node.credentialBindings ?? []).map((binding) => [binding.slot, binding.credentialId])),
      workspaceId: context.runId,
      invocationId,
      correlationId: context.runId,
      signal: context.options.signal,
    });
    if (context.currentAttemptId) {
      this.deps.nodeFlowRepository.updateNodeAttempt(context.currentAttemptId, { artifactDigest: result.artifactDigest });
    }
    this.deps.executionRepository.appendExecutionInvocationMessage(invocationId, {
      role: "assistant",
      contentMarkdown: "Custom node container execution completed.",
      metadata: { flowId: context.flowId, runId: context.runId, nodeId: node.id, artifactDigest: result.artifactDigest },
    });
    return { output: result.output };
  }

  private executeSetFieldsNode(context: RuntimeContext, node: NodeFlowNode): NodeFlowJsonObject {
    const config = readNodeConfig(node);
    const base = readBoolean(config.replace) ? {} : this.firstUpstreamObject(context, node.id);
    const fields = readJsonObject(config.fields) ?? readJsonObject(config.values) ?? {};
    return {
      ...base,
      ...(evaluateTemplates(fields, context) as NodeFlowJsonObject),
    };
  }

  private executeTemplateNode(context: RuntimeContext, node: NodeFlowNode): NodeFlowJsonObject {
    const config = readNodeConfig(node);
    const template = readString(config.template) ?? readString(config.prompt);
    if (!template) {
      throw new ValidationError(`Template node ${node.id} requires a template value.`);
    }
    const outputKey = readString(config.outputKey) ?? "text";
    return { [outputKey]: renderTemplate(template, context) };
  }

  private async executeProviderPromptNode(
    context: RuntimeContext,
    node: NodeFlowNode,
    invocationId: string,
  ): Promise<NodeExecutionResult> {
    if (!this.deps.providerExecutionService) {
      throw new ValidationError("Provider execution service is not configured for node flow runtime.");
    }
    const config = readNodeConfig(node);
    const promptTemplate = readString(config.prompt) ?? readString(config.template);
    if (!promptTemplate) {
      throw new ValidationError(`Provider prompt node ${node.id} requires a prompt value.`);
    }
    const providerSettings = this.resolveProviderSettings(context.projectId, config);
    const boundCredential = await this.resolveNodeCredential(context, node, "provider");
    if (!CLI_PROVIDER_IDS.has(providerSettings.provider)) {
      throw new ValidationError(`Provider prompt node ${node.id} requires a CLI provider.`);
    }
    const project = this.deps.projectManagementRepository.getProject(context.projectId);
    if (!project) {
      throw new EntityNotFoundError(`Project not found: ${context.projectId}`);
    }
    const prompt = renderTemplate(promptTemplate, context);
    this.deps.executionRepository.appendExecutionInvocationMessage(invocationId, {
      role: "system",
      contentMarkdown: `Node flow provider prompt started for node ${node.id}.`,
      metadata: { flowId: context.flowId, runId: context.runId, nodeId: node.id },
    });
    const settings = this.deps.getDashboardSettings?.(context.projectId)
      ?? this.deps.settingsRepository.resolveProjectDashboardSettings(context.projectId).settings
      ?? DEFAULT_DASHBOARD_SETTINGS;
    const defaultBranch = settings.git.defaultBranch?.trim() || project.defaultBranch?.trim() || "main";
    const result = await this.deps.providerExecutionService.executeProvider({
      projectId: context.projectId,
      purpose: "dashboard_reply",
      type: "node_flow_node",
      provider: providerSettings.provider as CliProviderId,
      maxConcurrentTasks: providerSettings.maxConcurrentTasks,
      prompt,
      model: readString(config.model) ?? providerSettings.model,
      apiKey: boundCredential ?? providerSettings.apiKey,
      apiKeyCredentialRef: boundCredential ? null : providerSettings.apiKeyCredentialRef,
      providerMountAuth: providerSettings.mountAuth,
      providerAuthPath: providerSettings.authPath,
      providerConfigMode: providerSettings.providerConfigMode,
      providerConfigPath: providerSettings.providerConfigPath,
      customBaseUrl: providerSettings.customBaseUrl,
      customModel: providerSettings.customModel,
      qwenAuthMode: providerSettings.qwenAuthMode,
      qwenRegion: providerSettings.qwenRegion,
      qwenBaseUrl: providerSettings.qwenBaseUrl,
      qwenEnvKey: providerSettings.qwenEnvKey,
      qwenModelId: providerSettings.qwenModelId,
      qwenProtocol: providerSettings.qwenProtocol,
      qwenAdditionalModelProviders: providerSettings.qwenAdditionalModelProviders,
      openCodeAuthMode: providerSettings.openCodeAuthMode,
      openCodeProviderId: providerSettings.openCodeProviderId,
      openCodeModelId: providerSettings.openCodeModelId,
      openCodeBaseUrl: providerSettings.openCodeBaseUrl,
      openCodeEnvKey: providerSettings.openCodeEnvKey,
      openCodePackage: providerSettings.openCodePackage,
      sessionId: `node-flow-${context.runId}-${node.id}-${randomUUID().slice(0, 8)}`,
      workflowSettings: settings.cliWorkflow,
      repoPath: project.baseDir,
      cwd: readString(config.cwd) ?? project.baseDir,
      ...buildProviderInvocationWorkspaceOptions({
        workflowSettings: settings.cliWorkflow,
        gitPolicy: {
          githubMode: settings.git.githubMode,
          defaultBranch,
          githubToken: settings.git.githubToken,
          gitlabToken: settings.git.gitlabToken,
        },
      }),
      signal: context.options.signal,
      githubTokenCredentialRef: settings.git.githubTokenCredentialRef,
      gitlabTokenCredentialRef: settings.git.gitlabTokenCredentialRef,
      invocationId,
      expectTextOutput: true,
      trackPromptInInvocation: false,
      trackAssistantInInvocation: false,
      finalizeExecutionInvocation: false,
      onActivity: () => undefined,
      redactTextForPersistence: (value) => redactCredentialText(value, context.resolvedCredentialValues),
      redactJsonForPersistence: (value) => {
        if (!value) return null;
        return readJsonObject(redactCredentialJson(toJsonValue(value), context.resolvedCredentialValues));
      },
    });
    this.redactProviderInvocationUsage(invocationId, result, context.resolvedCredentialValues);
    if (!result.ok) {
      throw new Error(redactCredentialText(providerFailureMessage(result), context.resolvedCredentialValues));
    }
    const text = redactCredentialText(
      result.text ?? result.stdout ?? result.usageTelemetry.transcriptText ?? "",
      context.resolvedCredentialValues,
    );
    this.deps.executionRepository.appendExecutionInvocationMessage(invocationId, {
      role: "assistant",
      contentMarkdown: "Node flow provider prompt completed.",
      metadata: { flowId: context.flowId, runId: context.runId, nodeId: node.id },
    });
    return {
      output: {
        text,
        nativeSessionId: result.nativeSessionId
          ? redactCredentialText(result.nativeSessionId, context.resolvedCredentialValues)
          : result.nativeSessionId,
      },
      invocationId,
    };
  }

  private async executeHttpRequestNode(
    context: RuntimeContext,
    node: NodeFlowNode,
    invocationId: string,
  ): Promise<NodeExecutionResult> {
    const config = evaluateTemplates(readNodeConfig(node), context) as NodeFlowJsonObject;
    const method = (readString(config.method) ?? "GET").toUpperCase();
    if (!/^(GET|POST|PUT|PATCH|DELETE|HEAD)$/.test(method)) {
      throw new ValidationError(`HTTP node ${node.id} has unsupported method: ${method}.`);
    }
    const urlValue = readString(config.url);
    if (!urlValue) {
      throw new ValidationError(`HTTP node ${node.id} requires a URL.`);
    }
    const url = new URL(urlValue);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new ValidationError(`HTTP node ${node.id} URL must use http or https.`);
    }
    const query = readJsonObject(config.query);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (Array.isArray(value)) {
          for (const entry of value) {
            url.searchParams.append(key, String(entry));
          }
        } else if (value !== null) {
          url.searchParams.set(key, String(value));
        }
      }
    }
    const headers = normalizeHeaders(readJsonObject(config.headers));
    const boundCredential = await this.resolveNodeCredential(context, node, "auth");
    const credentialHeaders = boundCredential ? { authorization: boundCredential } : undefined;
    const timeoutMs = normalizeTimeout(config.timeout ?? config.timeoutMs);
    const controller = new AbortController();
    const abortListener = (): void => controller.abort(context.options.signal?.reason);
    context.options.signal?.addEventListener("abort", abortListener, { once: true });
    const timeout = setTimeout(() => controller.abort(new Error(`HTTP node ${node.id} timed out after ${timeoutMs}ms.`)), timeoutMs);
    this.deps.executionRepository.appendExecutionInvocationMessage(invocationId, {
      role: "system",
      contentMarkdown: `HTTP ${method} ${redactUrl(url)}`,
      metadata: { flowId: context.flowId, runId: context.runId, nodeId: node.id },
    });
    try {
      const response = await this.egressPolicyService.request({
        url,
        method,
        headers,
        credentialHeaders,
        body: buildHttpBody(method, headers, config.body),
        signal: controller.signal,
        rateLimitKey: `${context.projectId}:${url.hostname}`,
        policy: {
          allowHttp: config.allowHttp === true,
          allowedHosts: readStringArray(config.allowedHosts),
          allowedPorts: readNumberArray(config.allowedPorts),
          maxRedirects: readOptionalNumber(config.maxRedirects),
          maxResponseBytes: readOptionalNumber(config.maxResponseBytes),
          allowedContentTypes: readStringArray(config.allowedContentTypes),
          timeoutMs,
          maxRetries: readOptionalNumber(config.maxRetries),
          requestsPerMinute: readOptionalNumber(config.requestsPerMinute),
        },
      });
      const body = response.contentType.includes("application/json")
        ? response.json() as NodeFlowJsonValue
        : response.text();
      if (!response.ok) {
        throw new Error(`HTTP node ${node.id} failed with status ${response.status}.`);
      }
      const safeBody = redactCredentialJson(toJsonValue(body), context.resolvedCredentialValues);
      const responsePath = readString(config.responsePath) ?? readString(config.extractJsonPath);
      const extracted = responsePath ? readPath(safeBody, responsePath) : safeBody;
      return {
        output: {
          status: response.status,
          ok: response.ok,
          body: safeBody,
          extracted: toJsonValue(extracted),
        },
        invocationId,
      };
    } catch (error) {
      const message = redactCredentialText(
        error instanceof Error ? error.message : `HTTP node ${node.id} request failed.`,
        context.resolvedCredentialValues,
      );
      if (controller.signal.aborted) throw new Error(message || `HTTP node ${node.id} timed out.`);
      if (error instanceof Error && message === error.message) throw error;
      throw new Error(message);
    } finally {
      clearTimeout(timeout);
      context.options.signal?.removeEventListener("abort", abortListener);
    }
  }

  private async resolveNodeCredential(context: RuntimeContext,node:NodeFlowNode,slot:string):Promise<string|undefined>{
    const binding=node.credentialBindings?.find((candidate)=>candidate.slot===slot);
    if (!binding) return undefined;
    if (!this.deps.credentialBroker) throw new ValidationError("Credential broker is not configured for node flow runtime.");
    const resolved=await this.deps.credentialBroker.resolveCredentialId({projectId:context.projectId,credentialId:binding.credentialId,bindingKey:`${context.flowId}:${node.id}:${slot}`,capability:"read",workspaceId:context.runId});
    if (resolved.value) context.resolvedCredentialValues.push(resolved.value);
    return resolved.value;
  }

  private executeOutputNode(context: RuntimeContext, node: NodeFlowNode): NodeFlowJsonObject {
    const config = readNodeConfig(node);
    const valuePath = readString(config.path) ?? readString(config.valuePath);
    if (valuePath) {
      return { value: toJsonValue(readPath(contextToObject(context), valuePath)) };
    }
    const fields = readJsonObject(config.fields);
    if (fields) {
      return evaluateTemplates(fields, context) as NodeFlowJsonObject;
    }
    return this.firstUpstreamObject(context, node.id);
  }

  private buildNodeInput(context: RuntimeContext, nodeId: string): NodeFlowJsonObject {
    const upstream = Object.fromEntries(
      (context.predecessors.get(nodeId) ?? []).map((id) => [id, context.outputs.get(id) ?? {}]),
    );
    return {
      flowInput: context.input,
      upstream,
      nodes: Object.fromEntries(context.outputs),
      ...(context.itemIndex === undefined ? {} : { item: context.item ?? null, itemIndex: context.itemIndex, logicalItem: context.logicalItem }),
    };
  }

  private buildUpstreamObject(context: RuntimeContext, nodeId: string): NodeFlowJsonObject {
    return Object.fromEntries((context.predecessors.get(nodeId) ?? [])
      .filter((id) => context.outputs.has(id)).map((id) => [id, context.outputs.get(id) ?? {}]));
  }

  private isInactiveBranch(context: RuntimeContext, nodeId: string): boolean {
    const incoming = context.graph.edges.filter((edge) => edge.toNodeId === nodeId);
    if (incoming.length === 0) return false;
    return !incoming.some((edge) => {
      if (!context.outputs.has(edge.fromNodeId)) return false;
      const selected = context.selectedPorts.get(edge.fromNodeId);
      return !selected || !edge.fromHandle || selected.has(edge.fromHandle);
    });
  }

  private firstUpstreamObject(context: RuntimeContext, nodeId: string): NodeFlowJsonObject {
    const predecessorIds = context.predecessors.get(nodeId) ?? [];
    if (predecessorIds.length === 1) {
      return { ...(context.outputs.get(predecessorIds[0]!) ?? {}) };
    }
    if (predecessorIds.length > 1) {
      return Object.fromEntries(predecessorIds.map((id) => [id, context.outputs.get(id) ?? {}]));
    }
    return {};
  }

  private buildFlowOutput(context: RuntimeContext): NodeFlowJsonObject {
    const outputNodes = context.graph.nodes.filter((node) => node.type === "output" && context.outputs.has(node.id));
    if (outputNodes.length === 1) {
      return context.outputs.get(outputNodes[0]!.id) ?? {};
    }
    if (outputNodes.length > 1) {
      return Object.fromEntries(outputNodes.map((node) => [node.id, context.outputs.get(node.id) ?? {}]));
    }
    const lastNodeId = [...context.outputs.keys()].at(-1);
    return lastNodeId ? context.outputs.get(lastNodeId) ?? {} : {};
  }

  private async persistSkippedNode(
    context: RuntimeContext,
    node: NodeFlowNode,
    status: "skipped" | "cancelled",
    message: string,
  ): Promise<void> {
    this.deps.nodeFlowRepository.createNodeRun({
      runId: context.runId,
      flowId: context.flowId,
      projectId: context.projectId,
      nodeId: node.id,
      logicalItem: context.logicalItem,
      status,
      input: maskSecrets(this.buildNodeInput(context, node.id)),
      errorMessage: message,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    });
  }

  private resolveProviderSettings(projectId: string, config: NodeFlowJsonObject): ProviderSettings {
    const settings = this.deps.getDashboardSettings?.(projectId)
      ?? this.deps.settingsRepository.resolveProjectDashboardSettings(projectId).settings
      ?? DEFAULT_DASHBOARD_SETTINGS;
    const providerConfigId = readString(config.providerConfigId)
      ?? readString(config.provider)
      ?? settings.workers.virtualWorkerProvider
      ?? settings.aiProvider.provider
      ?? "codex";
    const providerSettings = settings.aiProvider.providers[providerConfigId];
    if (!providerSettings) {
      throw new ValidationError(`Provider prompt node references unknown provider config: ${providerConfigId}.`);
    }
    return providerSettings;
  }

  private redactProviderInvocationUsage(
    invocationId: string,
    result: ProviderRunResult,
    credentials: readonly string[],
  ): void {
    const providerInvocationId = this.deps.executionRepository.getExecutionInvocation(invocationId)?.providerInvocationId;
    if (!providerInvocationId) return;
    const rawUsageJson = result.usageTelemetry.rawUsageJson
      ? redactCredentialJson(toJsonValue(result.usageTelemetry.rawUsageJson), credentials)
      : null;
    this.deps.executionRepository.updateProviderInvocationUsage(providerInvocationId, {
      nativeSessionId: result.nativeSessionId
        ? redactCredentialText(result.nativeSessionId, credentials)
        : result.nativeSessionId,
      rawUsageJson: readJsonObject(rawUsageJson),
    });
  }
}

function readNodeConfig(node: NodeFlowNode): NodeFlowJsonObject {
  const defaults = Object.fromEntries(
    (node.widgetSchema?.fields ?? [])
      .filter((field) => field.defaultValue !== undefined)
      .map((field) => [field.id, field.defaultValue as NodeFlowJsonValue]),
  );
  const data = node.data ?? {};
  const values = readJsonObject(data.values);
  return {
    ...defaults,
    ...data,
    ...(values ?? {}),
  };
}

function buildPredecessors(graph: NodeFlowGraph): Map<string, string[]> {
  const predecessors = new Map(graph.nodes.map((node) => [node.id, [] as string[]]));
  for (const edge of graph.edges) {
    predecessors.get(edge.toNodeId)?.push(edge.fromNodeId);
  }
  return predecessors;
}

function buildDescendants(graph: NodeFlowGraph): Map<string, Set<string>> {
  const outgoing = new Map(graph.nodes.map((node) => [node.id, [] as string[]]));
  for (const edge of graph.edges) {
    outgoing.get(edge.fromNodeId)?.push(edge.toNodeId);
  }
  return new Map(graph.nodes.map((node) => {
    const descendants = new Set<string>();
    const queue = [...(outgoing.get(node.id) ?? [])];
    while (queue.length > 0) {
      const next = queue.shift()!;
      if (descendants.has(next)) {
        continue;
      }
      descendants.add(next);
      queue.push(...(outgoing.get(next) ?? []));
    }
    return [node.id, descendants];
  }));
}

function inferSelectedPorts(node: NodeFlowNode, output: NodeFlowJsonObject): Set<string> | null {
  if (node.type === "condition" && typeof output.matched === "boolean") return new Set([output.matched ? "true" : "false"]);
  if (node.type === "switch" && typeof output.selectedCase === "string") return new Set([output.selectedCase]);
  if (node.type === "approval" && output.approved === true) return new Set(["approved"]);
  if (node.type === "foreach" && Array.isArray(output.items)) return new Set([output.items.length > 0 ? "items" : "empty"]);
  return null;
}

function renderTemplate(template: string, context: RuntimeContext): string {
  const source = contextToObject(context);
  return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, rawPath: string) => {
    const value = readPath(source, rawPath.trim());
    if (value === undefined || value === null) {
      return "";
    }
    return typeof value === "string" ? value : JSON.stringify(value);
  });
}

function evaluateTemplates(value: NodeFlowJsonValue, context: RuntimeContext): NodeFlowJsonValue {
  if (typeof value === "string") {
    return renderTemplate(value, context);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => evaluateTemplates(entry, context));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, evaluateTemplates(entry, context)]),
    );
  }
  return value;
}

function contextToObject(context: RuntimeContext): NodeFlowJsonObject {
  return {
    input: context.input,
    nodes: Object.fromEntries(context.outputs),
    ...(context.itemIndex === undefined ? {} : { item: context.item ?? null, itemIndex: context.itemIndex, logicalItem: context.logicalItem }),
  };
}

function nodeRunKey(nodeId: string, logicalItem: string): string {
  return `${nodeId}\0${logicalItem}`;
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  worker: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const runners = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(values[index]!, index);
    }
  });
  await Promise.all(runners);
  return results;
}

function readPath(value: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((current, segment) => {
    if (current === undefined || current === null) {
      return undefined;
    }
    if (Array.isArray(current)) {
      const index = Number(segment);
      return Number.isInteger(index) ? current[index] : undefined;
    }
    if (typeof current === "object") {
      return (current as Record<string, unknown>)[segment];
    }
    return undefined;
  }, value);
}

function readJsonObject(value: unknown): NodeFlowJsonObject | null {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    ? value as NodeFlowJsonObject
    : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readBoolean(value: unknown): boolean {
  return value === true;
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0).map((entry) => entry.trim());
}

function readNumberArray(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const values = value.map(Number).filter((entry) => Number.isInteger(entry) && entry > 0 && entry <= 65_535);
  return values.length > 0 ? values : undefined;
}

function readOptionalNumber(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function toJsonValue(value: unknown): NodeFlowJsonValue {
  if (value === undefined) {
    return null;
  }
  return JSON.parse(JSON.stringify(value)) as NodeFlowJsonValue;
}

function maskSecrets<T extends NodeFlowJsonValue>(value: T): T;
function maskSecrets(value: NodeFlowJsonObject): NodeFlowJsonObject;
function maskSecrets(value: NodeFlowJsonValue): NodeFlowJsonValue {
  if (Array.isArray(value)) {
    return value.map((entry) => maskSecrets(entry));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        SECRET_KEY_PATTERN.test(key) ? "[REDACTED]" : maskSecrets(entry),
      ]),
    );
  }
  return value;
}

function redactCredentialText(value: string, credentials: readonly string[]): string {
  let redacted = value;
  for (const credential of [...credentials].filter(Boolean).sort((left, right) => right.length - left.length)) {
    redacted = redacted.split(credential).join("[REDACTED]");
  }
  return redacted;
}

function redactCredentialJson<T extends NodeFlowJsonValue>(value: T, credentials: readonly string[]): T;
function redactCredentialJson(value: NodeFlowJsonObject, credentials: readonly string[]): NodeFlowJsonObject;
function redactCredentialJson(value: NodeFlowJsonValue, credentials: readonly string[]): NodeFlowJsonValue {
  const masked = maskSecrets(value);
  if (typeof masked === "string") return redactCredentialText(masked, credentials);
  if (Array.isArray(masked)) return masked.map((entry) => redactCredentialJson(entry, credentials));
  if (masked && typeof masked === "object") {
    return Object.fromEntries(
      Object.entries(masked).map(([key, entry]) => [key, redactCredentialJson(entry, credentials)]),
    );
  }
  return masked;
}

function clearResolvedCredentials(context: RuntimeContext): void {
  for (let index = 0; index < context.resolvedCredentialValues.length; index += 1) {
    context.resolvedCredentialValues[index] = "";
  }
  context.resolvedCredentialValues.length = 0;
}

function normalizeHeaders(headers: NodeFlowJsonObject | null): Record<string, string> {
  if (!headers) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key, value === null ? "" : String(value)]),
  );
}

function normalizeTimeout(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_HTTP_TIMEOUT_MS;
  }
  return Math.min(MAX_HTTP_TIMEOUT_MS, Math.floor(parsed));
}

function buildHttpBody(method: string, headers: Record<string, string>, body: NodeFlowJsonValue | undefined): BodyInit | undefined {
  if (body === undefined || method === "GET" || method === "HEAD") {
    return undefined;
  }
  if (typeof body === "string") {
    return body;
  }
  const hasContentType = Object.keys(headers).some((key) => key.toLowerCase() === "content-type");
  if (!hasContentType) {
    headers["content-type"] = "application/json";
  }
  return JSON.stringify(body);
}

function redactUrl(url: URL): string {
  const clone = new URL(url.toString());
  for (const key of [...clone.searchParams.keys()]) {
    if (SECRET_KEY_PATTERN.test(key)) {
      clone.searchParams.set(key, "[REDACTED]");
    }
  }
  return clone.toString();
}

function classifyFailure(error: unknown, parentAborted: boolean, attemptAborted: boolean): NodeFlowFailureClassification {
  if (parentAborted) return "cancelled";
  const message = error instanceof Error ? error.message : String(error);
  if (attemptAborted || /timed? out|timeout/i.test(message)) return "timeout";
  if (error instanceof UnknownSideEffectOutcomeError) return "unknown_side_effect";
  if (/quota|rate.?limit|429/i.test(message)) return "quota";
  if (/credential|secret|access denied/i.test(message)) return "credential";
  if (error instanceof ValidationError || /requires|unsupported|must /i.test(message)) return "validation";
  if (/ECONNRESET|ECONNREFUSED|temporar|unavailable|502|503|504/i.test(message)) return "transient";
  return "permanent";
}

function retryDelay(baseMs: number, maxMs: number, jitterRatio: number, attemptNumber: number): number {
  const exponential = Math.min(maxMs, Math.max(0, baseMs) * (2 ** Math.max(0, attemptNumber - 1)));
  const jitter = exponential * Math.max(0, Math.min(1, jitterRatio));
  return Math.max(0, Math.round(exponential - jitter + (Math.random() * jitter * 2)));
}

async function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    const abort = (): void => { clearTimeout(timer); reject(new Error("Node flow run was cancelled.")); };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function providerFailureMessage(result: ProviderRunResult): string {
  const output = [result.stderr, result.stdout]
    .map((stream) => stream?.trim())
    .filter(Boolean)
    .join("\n");
  return output || `Provider exited with code ${result.code}.`;
}
