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
import { BuiltinExecutors } from "./node-flows/builtins/builtin-executors.js";
import type { ApprovalService } from "./node-flows/approval-service.js";
import { ApprovalRequiredError } from "./node-flows/approval-service.js";
import type { OutboxService } from "./node-flows/outbox-service.js";
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
    return this.deps.nodeFlowRepository.requestCancellation(runId);
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
    const executorId = options.executorId?.trim() || `node-flow-runtime:${process.pid}:${randomUUID()}`;
    const claimedRun = new NodeFlowQueueService(this.deps.nodeFlowRepository).claim(run, executorId);
    const leaseService = new NodeFlowLeaseService(this.deps.nodeFlowRepository);
    const heartbeatTimer = setInterval(() => {
      leaseService.heartbeat(claimedRun.id, executorId, publication.policy.leaseDurationMs);
    }, publication.policy.heartbeatIntervalMs);
    heartbeatTimer.unref?.();

    const context: RuntimeContext = {
      projectId,
      flowId: flow.id,
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
    };

    const blockedNodes = new Set<string>();
    let terminalStatus: NodeFlowRunRecord["status"] = "succeeded";
    let terminalError: string | null = null;

    for (let nodeIndex = 0; nodeIndex < executionOrder.length; nodeIndex += 1) {
      const nodeId = executionOrder[nodeIndex]!;
      const node = graph.nodes.find((candidate) => candidate.id === nodeId);
      if (!node) {
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
      const nodeRun = this.deps.nodeFlowRepository.createNodeRun({
        runId: run.id,
        flowId: flow.id,
        projectId,
        nodeId: node.id,
        status: "running",
        input: nodeInput,
        startedAt: new Date().toISOString(),
      });

      const attemptService = new NodeFlowAttemptService(this.deps.nodeFlowRepository);
      const retryPolicy = {
        ...publication.policy.retry,
        ...(node.policy?.retry ?? {}),
      };
      let attemptNumber = 0;
      while (attemptNumber < retryPolicy.maxAttempts) {
        attemptNumber += 1;
        const attempt = attemptService.start(nodeRun, executorId, nodeInput, (node.credentialBindings ?? []).map((binding) => binding.credentialId));
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
        context.outputs.set(node.id, result.output);
        if (result.selectedPorts) context.selectedPorts.set(node.id, new Set(result.selectedPorts));
        attemptService.succeed(attempt, maskSecrets(result.output), result.invocationId);
        this.deps.auditService?.recordSystem({ action: "automation.attempt.succeeded", resourceType: "node_flow_attempt", resourceId: attempt.id, projectId, outcome: "succeeded", metadata: { runId: run.id, flowId: flow.id, nodeId: node.id, attemptNumber } });
        this.deps.nodeFlowRepository.updateNodeRun(nodeRun.id, {
          status: "succeeded",
          executionInvocationId: result.invocationId ?? nodeRun.executionInvocationId,
          output: maskSecrets(result.output),
          finishedAt: new Date().toISOString(),
        });
        clearTimeout(timeout); options.signal?.removeEventListener("abort", parentAbort); context.options = previousOptions;
        break;
      } catch (error) {
        clearTimeout(timeout); options.signal?.removeEventListener("abort", parentAbort); context.options = previousOptions;
        const message = error instanceof Error ? error.message : String(error);
        const classification = classifyFailure(error, options.signal?.aborted === true, timeoutController.signal.aborted);
        this.deps.auditService?.recordSystem({ action: "automation.attempt.failed", resourceType: "node_flow_attempt", resourceId: attempt.id, projectId, outcome: "failed", metadata: { runId: run.id, flowId: flow.id, nodeId: node.id, attemptNumber, classification } });
        if (error instanceof ApprovalRequiredError) {
          attemptService.fail(attempt, "permanent", message, false);
          this.deps.nodeFlowRepository.updateNodeRun(nodeRun.id, {
            status: "approval_waiting", errorMessage: message, finishedAt: null,
          });
          terminalStatus = "approval_waiting";
          terminalError = message;
          break;
        }
        const wasCancelled = classification === "cancelled";
        const retryable = retryPolicy.retryableClasses.includes(classification) && attemptNumber < retryPolicy.maxAttempts;
        attemptService.fail(attempt, classification, message, retryable, this.deps.nodeFlowRepository.listNodeAttempts(run.id).find((candidate) => candidate.id === attempt.id)?.invocationId);
        if (retryable) {
          this.deps.nodeFlowRepository.updateNodeRun(nodeRun.id, { status: "retry_waiting", errorMessage: message });
          await delay(retryDelay(retryPolicy.backoffMs, retryPolicy.maxBackoffMs ?? retryPolicy.backoffMs, retryPolicy.jitterRatio ?? 0, attemptNumber), options.signal);
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
    this.deps.executionRepository.updateExecutionInvocation(parentInvocation.id, {
      status: terminalStatus === "succeeded" ? "completed" : terminalStatus === "attention_required" ? "failed" : terminalStatus === "approval_waiting" ? "running" : terminalStatus,
      errorMessage: terminalStatus === "approval_waiting" ? null : terminalError,
      finishedAt,
    });
    this.deps.executionRepository.appendExecutionInvocationMessage(parentInvocation.id, {
      role: terminalStatus === "succeeded" ? "assistant" : "system",
      contentMarkdown: terminalStatus === "succeeded"
        ? "Node flow run completed."
        : `Node flow run ${terminalStatus}: ${terminalError ?? "No error message."}`,
      metadata: {
        flowId: flow.id,
        runId: run.id,
        status: terminalStatus,
      },
    });
    this.deps.auditService?.recordSystem({ action: "automation.run.finished", resourceType: "node_flow_run", resourceId: run.id, projectId, outcome: terminalStatus === "succeeded" ? "succeeded" : "failed", metadata: { flowId: flow.id, publicationId: publication.id, status: terminalStatus } });

    clearInterval(heartbeatTimer);
    return {
      run: updatedRun,
      nodeRuns: this.deps.nodeFlowRepository.listNodeRuns(run.id),
      attempts: this.deps.nodeFlowRepository.listNodeAttempts(run.id),
      output: updatedRun.output,
    };
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
        return { ...result, invocationId: invocation.id };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.deps.executionRepository.updateExecutionInvocation(invocation.id, {
          status: context.options.signal?.aborted ? "cancelled" : "failed",
          errorMessage: message,
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
      invocationId,
      expectTextOutput: true,
      trackPromptInInvocation: false,
      trackAssistantInInvocation: false,
      finalizeExecutionInvocation: false,
    });
    if (!result.ok) {
      throw new Error(providerFailureMessage(result));
    }
    const text = result.text ?? result.stdout ?? result.usageTelemetry.transcriptText ?? "";
    this.deps.executionRepository.appendExecutionInvocationMessage(invocationId, {
      role: "assistant",
      contentMarkdown: "Node flow provider prompt completed.",
      metadata: { flowId: context.flowId, runId: context.runId, nodeId: node.id },
    });
    return {
      output: {
        text,
        nativeSessionId: result.nativeSessionId,
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
      const responsePath = readString(config.responsePath) ?? readString(config.extractJsonPath);
      const extracted = responsePath ? readPath(body, responsePath) : body;
      return {
        output: {
          status: response.status,
          ok: response.ok,
          body: toJsonValue(body),
          extracted: toJsonValue(extracted),
        },
        invocationId,
      };
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(error instanceof Error ? error.message : `HTTP node ${node.id} timed out.`);
      }
      throw error;
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
  };
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
