import { randomUUID } from "crypto";
import { normalizeNodeFlowGraph } from "../domain/node-flows/node-flow-validation.js";
import { ValidationError, EntityNotFoundError } from "../repositories/repository-utils.js";
import { DEFAULT_DASHBOARD_SETTINGS } from "../repositories/settings-defaults.js";
import type { NodeFlowRepository } from "../repositories/node-flow-repository.js";
import type { ExecutionRepository } from "../repositories/execution-repository.js";
import type { ProjectManagementRepository } from "../repositories/project-management-repository.js";
import type { SettingsRepository } from "../repositories/settings-repository.js";
import type { ProviderExecutionService } from "./provider-execution-service.js";
import type { CliProviderId } from "../infrastructure/providers/cli/provider-command-specs.js";
import type { ProviderRunResult } from "../infrastructure/providers/cli/provider-runner.js";
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

const SUPPORTED_NODE_TYPES = new Set(["input", "set_fields", "template", "provider_prompt", "http_request", "output"]);
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
}

interface RuntimeContext {
  projectId: string;
  flowId: string;
  runId: string;
  graph: NodeFlowGraph;
  order: string[];
  input: NodeFlowJsonObject;
  outputs: Map<string, NodeFlowJsonObject>;
  predecessors: Map<string, string[]>;
  descendants: Map<string, Set<string>>;
  options: RunNodeFlowOptions;
}

interface NodeExecutionResult {
  output: NodeFlowJsonObject;
  invocationId?: string | null;
}

export class NodeFlowRuntimeService {
  constructor(private readonly deps: NodeFlowRuntimeDeps) {}

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

    const { graph, executionOrder } = normalizeNodeFlowGraph(flow.graph);
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
      contentMarkdown: `Node flow run started for flow ${flow.id} at version ${flow.version}.`,
      metadata: {
        flowId: flow.id,
        flowVersion: flow.version,
      },
    });

    const run = this.deps.nodeFlowRepository.createRun({
      flowId: flow.id,
      projectId,
      version: flow.version,
      status: "running",
      executionInvocationId: parentInvocation.id,
      triggerType: options.triggerType,
      triggerPayload: options.triggerPayload ? maskSecrets(options.triggerPayload) : null,
      input: sanitizedInput,
      startedAt,
    });

    const context: RuntimeContext = {
      projectId,
      flowId: flow.id,
      runId: run.id,
      graph,
      order: executionOrder,
      input,
      outputs: new Map(),
      predecessors: buildPredecessors(graph),
      descendants: buildDescendants(graph),
      options,
    };

    const blockedNodes = new Set<string>();
    let terminalStatus: NodeFlowRunRecord["status"] = "succeeded";
    let terminalError: string | null = null;

    for (const nodeId of executionOrder) {
      const node = graph.nodes.find((candidate) => candidate.id === nodeId);
      if (!node) {
        continue;
      }
      if (options.signal?.aborted) {
        terminalStatus = "cancelled";
        terminalError = "Node flow run was cancelled.";
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

      const nodeRun = this.deps.nodeFlowRepository.createNodeRun({
        runId: run.id,
        flowId: flow.id,
        projectId,
        nodeId: node.id,
        status: "running",
        input: maskSecrets(this.buildNodeInput(context, node.id)),
        startedAt: new Date().toISOString(),
      });

      try {
        const result = await this.executeNode(context, node, nodeRun);
        context.outputs.set(node.id, result.output);
        this.deps.nodeFlowRepository.updateNodeRun(nodeRun.id, {
          status: "succeeded",
          executionInvocationId: result.invocationId ?? nodeRun.executionInvocationId,
          output: maskSecrets(result.output),
          finishedAt: new Date().toISOString(),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const continueOnError = node.data?.continueOnError === true;
        const failureOutput = { error: message };
        context.outputs.set(node.id, failureOutput);
        this.deps.nodeFlowRepository.updateNodeRun(nodeRun.id, {
          status: options.signal?.aborted ? "cancelled" : "failed",
          output: maskSecrets(failureOutput),
          errorMessage: message,
          finishedAt: new Date().toISOString(),
        });
        if (!continueOnError) {
          terminalStatus = "failed";
          terminalError ??= message;
          for (const descendant of context.descendants.get(node.id) ?? []) {
            blockedNodes.add(descendant);
          }
        }
      }
    }

    const output = this.buildFlowOutput(context);
    const finishedAt = new Date().toISOString();
    const updatedRun = this.deps.nodeFlowRepository.updateRun(run.id, {
      status: terminalStatus,
      output: maskSecrets(output),
      errorMessage: terminalError,
      finishedAt,
    });
    this.deps.executionRepository.updateExecutionInvocation(parentInvocation.id, {
      status: terminalStatus === "succeeded" ? "completed" : terminalStatus,
      errorMessage: terminalError,
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

    return {
      run: updatedRun,
      nodeRuns: this.deps.nodeFlowRepository.listNodeRuns(run.id),
      output: updatedRun.output,
    };
  }

  private requireSupportedNodes(graph: NodeFlowGraph): void {
    const unsupported = graph.nodes.filter((node) => !SUPPORTED_NODE_TYPES.has(node.type));
    if (unsupported.length > 0) {
      throw new ValidationError(`Unsupported node flow node type: ${unsupported[0]!.type}.`);
    }
  }

  private async executeNode(
    context: RuntimeContext,
    node: NodeFlowNode,
    nodeRun: NodeFlowNodeRunRecord,
  ): Promise<NodeExecutionResult> {
    if (EXTERNALLY_OBSERVABLE_NODE_TYPES.has(node.type)) {
      const invocation = this.deps.executionRepository.createExecutionInvocation({
        projectId: context.projectId,
        skipValidation: true,
        type: "node_flow_node",
        status: "running",
        startedAt: new Date().toISOString(),
      });
      this.deps.nodeFlowRepository.updateNodeRun(nodeRun.id, { executionInvocationId: invocation.id });
      try {
        const result = node.type === "provider_prompt"
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
        throw new ValidationError(`Unsupported node flow node type: ${node.type}.`);
    }
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
    const result = await this.deps.providerExecutionService.executeProvider({
      projectId: context.projectId,
      purpose: "dashboard_reply",
      type: "node_flow_node",
      provider: providerSettings.provider as CliProviderId,
      maxConcurrentTasks: providerSettings.maxConcurrentTasks,
      prompt,
      model: readString(config.model) ?? providerSettings.model,
      apiKey: providerSettings.apiKey,
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
      const response = await fetch(url, {
        method,
        headers,
        body: buildHttpBody(method, headers, config.body),
        signal: controller.signal,
      });
      const contentType = response.headers.get("content-type") ?? "";
      const body = contentType.includes("application/json")
        ? await response.json() as NodeFlowJsonValue
        : await response.text();
      if (!response.ok) {
        throw new Error(`HTTP node ${node.id} failed with ${response.status} ${response.statusText}.`);
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

function providerFailureMessage(result: ProviderRunResult): string {
  const output = [result.stderr, result.stdout]
    .map((stream) => stream?.trim())
    .filter(Boolean)
    .join("\n");
  return output || `Provider exited with code ${result.code}.`;
}
