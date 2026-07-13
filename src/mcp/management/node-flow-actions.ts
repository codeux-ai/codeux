import type {
  ManageCodeUxArgs,
  ManagementResponseEnvelope,
} from "../../contracts/internal-management-types.js";
import type {
  NodeFlowGraph,
  NodeFlowJsonObject,
  NodeFlowJsonValue,
  NodeFlowNode,
  NodeFlowNodeAttemptRecord,
  NodeFlowRecord,
  NodeFlowRunRecord,
  NodeFlowRunSummaryResponse,
  NodeWidgetSchema,
} from "../../contracts/node-flow-types.js";
import type { NodeFlowService } from "../../services/node-flow-service.js";
import { getCurrentMcpAgentId } from "../../server/mcp-agent-context.js";
import {
  managementValidationError,
  parseOptionalObject,
  parseOptionalNumber,
  parseOptionalString,
  parseOptionalIntegerStrict,
  parseRequiredObject,
  parseRequiredString,
} from "./payload-parsers.js";

const SECRET_KEY_PATTERN = /(api[_-]?key|authorization|cookie|password|secret|token)/i;

export class NodeFlowActions {
  constructor(private readonly nodeFlowService: NodeFlowService) {}

  async handleNodeFlowAction(args: ManageCodeUxArgs): Promise<ManagementResponseEnvelope> {
    const payload = args.payload || {};

    switch (args.action) {
      case "list":
        return this.listFlows(payload);
      case "catalog":
        return { result: this.nodeFlowService.catalog() };
      case "get_node_definition":
        return this.getNodeDefinition(payload);
      case "create_draft":
        return await this.createDraft(payload);
      case "patch_draft":
        return await this.patchDraft(payload);
      case "validate_draft":
        return await this.validateDraft(payload);
      case "request_credential":
        return await this.requestCredential(payload);
      case "inspect_bindings":
        return await this.inspectBindings(payload);
      case "dry_run":
        return await this.dryRun(payload);
      case "publish":
        return await this.publishDraft(args, payload);
      case "compare_versions":
        return this.compareVersions(payload);
      case "rollback":
        return await this.rollback(args, payload);
      case "get":
        return await this.getFlow(payload);
      case "create":
        return await this.createFlow(payload);
      case "update":
        return await this.updateFlow(payload);
      case "delete":
        return this.deleteFlow(args, payload);
      case "validate":
        return this.validateFlow(payload);
      case "run":
        return await this.runFlow(payload);
      case "cancel":
        return this.cancelRun(payload);
      case "retry":
        return await this.retryRun(payload);
      case "list_runs":
        return this.listRuns(payload);
      case "get_run":
      case "inspect_run":
        return this.getRun(payload, args.action === "inspect_run");
      case "attach_to_agent":
      case "attach":
        return this.attachToAgent(payload);
      case "detach_from_agent":
      case "detach":
        return this.detachFromAgent(payload);
      case "create_custom_node":
        return await this.createCustomNode(payload);
      case "update_custom_node":
        return await this.updateCustomNode(payload);
      case "validate_custom_node":
        return await this.validateCustomNode(payload);
      default:
        throw new Error(`Unknown node flow action: ${args.action}`);
    }
  }

  private getNodeDefinition(payload: Record<string, unknown>): ManagementResponseEnvelope {
    const nodeType = parseRequiredString(payload, "nodeType");
    const version = parseOptionalIntegerStrict(payload, "nodeVersion", { min: 1 });
    const definition = this.nodeFlowService.nodeDefinition(nodeType, version);
    if (!definition) throw managementValidationError(`Node definition not found: ${nodeType}${version ? `@${version}` : ""}`, "nodeType");
    return { result: { definition } };
  }

  private async createDraft(payload: Record<string, unknown>): Promise<ManagementResponseEnvelope> {
    const graph = this.parseGraphWithWidgets(payload, true);
    if (!graph) throw managementValidationError("graph object is required", "graph");
    const validation = this.nodeFlowService.validate(graph);
    if (!validation.valid || !validation.graph) return { result: { status: "invalid", validationIssues: validation.errors } };
    return { result: { draft: await this.nodeFlowService.createDraft(parseRequiredString(payload, "projectId"), {
      title: parseRequiredString(payload, "name"), description: parseOptionalText(payload, "description"), graph: validation.graph,
    }) } };
  }

  private async patchDraft(payload: Record<string, unknown>): Promise<ManagementResponseEnvelope> {
    const projectId = parseRequiredString(payload, "projectId");
    const flowId = parseRequiredString(payload, "flowId");
    const draftRevision = requiredInteger(payload, "draftRevision");
    const patch = parseOptionalObject<Record<string, unknown>>(payload, "patch") ?? {};
    const graph = this.parseGraphWithWidgets(patch, false) ?? this.parseGraphWithWidgets(payload, false);
    const operations = Array.isArray(patch.operations) ? patch.operations : Array.isArray(payload.operations) ? payload.operations : undefined;
    return { result: await this.nodeFlowService.patchDraft(flowId, {
      projectId, draftRevision, graph,
      operations: operations as import("../../contracts/node-flow-types.js").NodeFlowGraphPatchOperation[] | undefined,
      title: parseOptionalString(patch, "name") ?? parseOptionalString(payload, "name"),
      description: parseOptionalText(patch, "description") ?? parseOptionalText(payload, "description"),
    }) };
  }

  private async validateDraft(payload: Record<string, unknown>): Promise<ManagementResponseEnvelope> {
    return { result: { draft: await this.nodeFlowService.validateDraft(parseRequiredString(payload, "projectId"), parseRequiredString(payload, "flowId")) } };
  }

  private async requestCredential(payload: Record<string, unknown>): Promise<ManagementResponseEnvelope> {
    return { result: { request: await this.nodeFlowService.requestCredential(parseRequiredString(payload, "projectId"), parseRequiredString(payload, "flowId"), parseRequiredString(payload, "nodeId"), parseRequiredString(payload, "slot")) } };
  }

  private async inspectBindings(payload: Record<string, unknown>): Promise<ManagementResponseEnvelope> {
    return { result: await this.nodeFlowService.inspectBindings(parseRequiredString(payload, "projectId"), parseRequiredString(payload, "flowId")) };
  }

  private async dryRun(payload: Record<string, unknown>): Promise<ManagementResponseEnvelope> {
    return { result: await this.nodeFlowService.dryRun(parseRequiredString(payload, "projectId"), parseRequiredString(payload, "flowId"), parseOptionalObject<NodeFlowJsonObject>(payload, "input") ?? {}) };
  }

  private async publishDraft(args: ManageCodeUxArgs, payload: Record<string, unknown>): Promise<ManagementResponseEnvelope> {
    const flowId = parseRequiredString(payload, "flowId");
    const draftRevision = requiredInteger(payload, "draftRevision");
    if (args.approval?.confirmed !== true) return { approvalRequired: true, approvalMessage: `Publish node flow ${flowId} draft revision ${draftRevision} after reviewing validation, credentials, capabilities, and side effects.` };
    return { result: { draft: await this.nodeFlowService.publishDraft(parseRequiredString(payload, "projectId"), flowId, draftRevision, parseOptionalString(payload, "publishedBy") ?? "project-manager-mcp") } };
  }

  private compareVersions(payload: Record<string, unknown>): ManagementResponseEnvelope {
    return { result: this.nodeFlowService.compareVersions(parseRequiredString(payload, "projectId"), parseRequiredString(payload, "flowId"), requiredInteger(payload, "fromVersion"), requiredInteger(payload, "toVersion")) };
  }

  private async rollback(args: ManageCodeUxArgs, payload: Record<string, unknown>): Promise<ManagementResponseEnvelope> {
    const flowId = parseRequiredString(payload, "flowId");
    const version = requiredInteger(payload, "version");
    if (args.approval?.confirmed !== true) return { approvalRequired: true, approvalMessage: `Create a new draft of node flow ${flowId} from version ${version}. The current draft remains in immutable history.` };
    return { result: { draft: await this.nodeFlowService.rollback(parseRequiredString(payload, "projectId"), flowId, version, requiredInteger(payload, "draftRevision")) } };
  }

  private cancelRun(payload: Record<string, unknown>): ManagementResponseEnvelope {
    return { result: { run: formatRun(this.nodeFlowService.cancelRun(parseRequiredString(payload, "projectId"), parseRequiredString(payload, "runId"))) } };
  }

  private async retryRun(payload: Record<string, unknown>): Promise<ManagementResponseEnvelope> {
    return { result: formatRunSummary(await this.nodeFlowService.retryRun(parseRequiredString(payload, "projectId"), parseRequiredString(payload, "runId"))) };
  }

  private async createCustomNode(payload: Record<string, unknown>): Promise<ManagementResponseEnvelope> {
    const node = await this.nodeFlowService.createCustomNode(parseRequiredString(payload, "projectId"), {
      nodeId: parseRequiredString(payload, "nodeId"), name: parseRequiredString(payload, "name"),
      description: parseOptionalText(payload, "description"), sourceRevision: parseRequiredString(payload, "sourceRevision"),
      createdBy: parseOptionalString(payload, "actor") ?? "project-manager-mcp",
    });
    return { result: { node } };
  }

  private async updateCustomNode(payload: Record<string, unknown>): Promise<ManagementResponseEnvelope> {
    const node = await this.nodeFlowService.updateCustomNode(
      parseRequiredString(payload, "projectId"), parseRequiredString(payload, "nodeId"),
      parseRequiredObject(payload, "manifest"), parseRequiredString(payload, "sourceRevision"),
    );
    return { result: { node } };
  }

  private async validateCustomNode(payload: Record<string, unknown>): Promise<ManagementResponseEnvelope> {
    return { result: await this.nodeFlowService.validateCustomNode(
      parseRequiredString(payload, "projectId"), parseRequiredString(payload, "nodeId"),
      parseOptionalString(payload, "actor") ?? "project-manager-mcp",
      parseOptionalString(payload, "invocationId") ?? `mcp-custom-node-${Date.now()}`,
      parseOptionalString(payload, "correlationId") ?? `mcp-custom-node-${Date.now()}`,
    ) };
  }

  private listFlows(payload: Record<string, unknown>): ManagementResponseEnvelope {
    const projectId = parseRequiredString(payload, "projectId");
    const flows = this.nodeFlowService.list(projectId).flows.map(formatFlowSummary);
    return { result: { flows } };
  }

  private async getFlow(payload: Record<string, unknown>): Promise<ManagementResponseEnvelope> {
    const flowId = parseRequiredString(payload, "flowId");
    const flow = this.requireFlow(flowId);
    this.assertProjectMatch(payload, flow);
    return {
      result: {
        flow: formatFlowForCaller(flow),
        ...(getCurrentMcpAgentId() ? { draft: await this.nodeFlowService.validateDraft(flow.projectId, flow.id) } : {}),
        agentSkills: this.nodeFlowService.listAgentSkills(flow.id),
      },
    };
  }

  private async createFlow(payload: Record<string, unknown>): Promise<ManagementResponseEnvelope> {
    const projectId = parseRequiredString(payload, "projectId");
    const graph = this.parseGraphWithWidgets(payload, true);
    if (!graph) {
      throw managementValidationError("graph object is required", "graph");
    }
    const validation = this.nodeFlowService.validate(graph);
    if (!validation.valid || !validation.graph) {
      throw validationToManagementError(validation.errors);
    }

    const flow = await this.nodeFlowService.create(projectId, {
      title: parseRequiredString(payload, "name"),
      description: parseOptionalText(payload, "description"),
      graph: validation.graph,
    });
    return { result: { flow: formatFlowForCaller(flow) } };
  }

  private async updateFlow(payload: Record<string, unknown>): Promise<ManagementResponseEnvelope> {
    const flowId = parseRequiredString(payload, "flowId");
    const graph = this.parseGraphWithWidgets(payload, false);
    const validation = graph ? this.nodeFlowService.validate(graph) : null;
    if (validation && (!validation.valid || !validation.graph)) {
      throw validationToManagementError(validation.errors);
    }

    const name = parseOptionalString(payload, "name");
    const description = parseOptionalText(payload, "description");
    const flow = await this.nodeFlowService.update(flowId, {
      ...(name !== undefined ? { title: name } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(validation?.graph ? { graph: validation.graph } : {}),
    });
    return { result: { flow: formatFlowForCaller(flow) } };
  }

  private deleteFlow(args: ManageCodeUxArgs, payload: Record<string, unknown>): ManagementResponseEnvelope {
    const flowId = parseRequiredString(payload, "flowId");
    if (args.approval?.confirmed !== true) {
      return {
        approvalRequired: true,
        approvalMessage: `Deleting node flow ${flowId} removes its versions, agent skill attachments, and run records. Call again with approval.confirmed true after human approval.`,
      };
    }

    this.nodeFlowService.delete(flowId);
    return { result: { success: true, deletedFlowId: flowId } };
  }

  private validateFlow(payload: Record<string, unknown>): ManagementResponseEnvelope {
    const graph = this.parseGraphWithWidgets(payload, false);
    if (graph) {
      return { result: this.nodeFlowService.validate(graph) };
    }

    const flowId = parseRequiredString(payload, "flowId", "flowId is required when graph is omitted");
    return { result: this.nodeFlowService.validateFlow(flowId) };
  }

  private async runFlow(payload: Record<string, unknown>): Promise<ManagementResponseEnvelope> {
    const projectId = parseRequiredString(payload, "projectId");
    const flowId = parseRequiredString(payload, "flowId");
    const input = parseOptionalObject<NodeFlowJsonObject>(payload, "input") ?? {};
    const flowVersion = parseOptionalNumber(payload, "flowVersion", 1);
    const result = await this.nodeFlowService.runFlow(projectId, flowId, input, {
      triggerType: "mcp_management",
      versionSelection: flowVersion === undefined
        ? { mode: "latest_published" }
        : { mode: "pinned", version: Math.floor(flowVersion) },
    });
    return { result: formatRunSummary(result) };
  }

  private listRuns(payload: Record<string, unknown>): ManagementResponseEnvelope {
    const flowId = parseRequiredString(payload, "flowId");
    const projectId = parseOptionalString(payload, "projectId");
    if (projectId) this.assertProjectMatch(payload, this.requireFlow(flowId));
    const runs = this.nodeFlowService.listRuns(flowId).runs.map(formatRun);
    return { result: { runs } };
  }

  private getRun(payload: Record<string, unknown>, requireProject = false): ManagementResponseEnvelope {
    const runId = parseRequiredString(payload, "runId");
    const projectId = requireProject ? parseRequiredString(payload, "projectId") : parseOptionalString(payload, "projectId");
    const run = this.nodeFlowService.getRun(runId);
    if (!run) {
      throw new Error(`Node flow run not found: ${runId}`);
    }
    if (projectId && run.projectId !== projectId) throw managementValidationError("Node flow run does not belong to the requested project.", "projectId");
    return {
      result: {
        run: formatRun(run),
        nodeRuns: this.nodeFlowService.listNodeRuns(run.id).nodeRuns.map((nodeRun) => ({
          ...nodeRun,
          input: maskJsonObject(nodeRun.input),
          output: maskJsonObject(nodeRun.output),
        })),
        attempts: this.nodeFlowService.listNodeAttempts(run.id).attempts.map(formatAttempt),
      },
    };
  }

  private attachToAgent(payload: Record<string, unknown>): ManagementResponseEnvelope {
    const flowId = parseRequiredString(payload, "flowId");
    const attachment = this.nodeFlowService.attachToAgent(flowId, {
      agentPresetId: parseRequiredString(payload, "agentPresetId"),
      skillName: parseOptionalString(payload, "skillAlias"),
      description: parseOptionalText(payload, "description"),
    });
    return { result: { attachment } };
  }

  private detachFromAgent(payload: Record<string, unknown>): ManagementResponseEnvelope {
    const flowId = parseRequiredString(payload, "flowId");
    const agentPresetId = parseRequiredString(payload, "agentPresetId");
    this.nodeFlowService.detachFromAgent(flowId, agentPresetId);
    return { result: { success: true, flowId, agentPresetId } };
  }

  private parseGraphWithWidgets(payload: Record<string, unknown>, required: boolean): NodeFlowGraph | undefined {
    const hasGraph = "graph" in payload && payload.graph !== undefined && payload.graph !== null;
    if (!hasGraph && !required) {
      return undefined;
    }
    const graph = required
      ? parseRequiredObject<NodeFlowGraph>(payload, "graph")
      : parseOptionalObject<NodeFlowGraph>(payload, "graph");
    if (!graph) {
      return undefined;
    }
    return applyWidgetsToGraph(graph, parseOptionalObject<NodeWidgetSchema | Record<string, NodeWidgetSchema>>(payload, "widgets"));
  }

  private requireFlow(flowId: string): NodeFlowRecord {
    const flow = this.nodeFlowService.get(flowId);
    if (!flow) {
      throw new Error(`Node flow not found: ${flowId}`);
    }
    return flow;
  }

  private assertProjectMatch(payload: Record<string, unknown>, flow: NodeFlowRecord): void {
    const projectId = parseOptionalString(payload, "projectId");
    if (projectId && projectId !== flow.projectId) {
      throw managementValidationError("Node flow does not belong to the requested project.", "projectId");
    }
  }
}

function requiredInteger(payload: Record<string, unknown>, key: string): number {
  const value = parseOptionalIntegerStrict(payload, key, { min: 1 });
  if (value === undefined) throw managementValidationError(`${key} is required`, key);
  return value;
}

function parseOptionalText(payload: Record<string, unknown>, key: string): string | undefined {
  if (!(key in payload)) {
    return undefined;
  }
  const value = payload[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  return typeof value === "string" ? value.trim() : undefined;
}

function validationToManagementError(errors: Array<{ field: string; message: string }>): Error {
  const first = errors[0];
  if (!first) {
    return managementValidationError("Node flow graph is invalid.", "graph");
  }
  return managementValidationError(first.message, first.field || "graph");
}

function applyWidgetsToGraph(
  graph: NodeFlowGraph,
  widgets: NodeWidgetSchema | Record<string, NodeWidgetSchema> | undefined,
): NodeFlowGraph {
  if (!widgets) {
    return graph;
  }
  if (isWidgetSchema(widgets)) {
    return { ...graph, inputSchema: widgets };
  }

  const widgetsByNode = widgets as Record<string, NodeWidgetSchema>;
  return {
    ...graph,
    nodes: graph.nodes.map((node) => {
      const widgetSchema = widgetsByNode[node.id];
      return widgetSchema ? { ...node, widgetSchema } : node;
    }),
  };
}

function isWidgetSchema(value: unknown): value is NodeWidgetSchema {
  return Boolean(value)
    && typeof value === "object"
    && !Array.isArray(value)
    && Array.isArray((value as NodeWidgetSchema).fields);
}

function formatFlowSummary(flow: NodeFlowRecord): Record<string, unknown> {
  return {
    id: flow.id,
    projectId: flow.projectId,
    name: flow.title,
    description: flow.description,
    version: flow.version,
    nodeCount: flow.graph.nodes.length,
    edgeCount: flow.graph.edges.length,
    createdAt: flow.createdAt,
    updatedAt: flow.updatedAt,
  };
}

function formatFlow(flow: NodeFlowRecord): Record<string, unknown> {
  return {
    ...formatFlowSummary(flow),
    graph: maskGraph(flow.graph),
  };
}

function formatFlowForCaller(flow: NodeFlowRecord): Record<string, unknown> {
  return getCurrentMcpAgentId() ? formatFlowSummary(flow) : formatFlow(flow);
}

function formatRun(run: NodeFlowRunRecord): Record<string, unknown> {
  return {
    ...run,
    triggerPayload: maskJsonObject(run.triggerPayload),
    input: maskJsonObject(run.input),
    output: maskJsonObject(run.output),
  };
}

export function formatRunSummary(summary: NodeFlowRunSummaryResponse): Record<string, unknown> {
  return {
    run: formatRun(summary.run),
    nodeRuns: summary.nodeRuns.map((nodeRun) => ({
      ...nodeRun,
      input: maskJsonObject(nodeRun.input),
      output: maskJsonObject(nodeRun.output),
    })),
    attempts: (summary.attempts ?? []).map(formatAttempt),
    output: maskJsonObject(summary.output),
  };
}

function formatAttempt(attempt: NodeFlowNodeAttemptRecord): Record<string, unknown> {
  return {
    id: attempt.id,
    runId: attempt.runId,
    nodeRunId: attempt.nodeRunId,
    nodeId: attempt.nodeId,
    attemptNumber: attempt.attemptNumber,
    status: attempt.status,
    executorId: attempt.executorId,
    invocationId: attempt.invocationId,
    artifactDigest: attempt.artifactDigest,
    input: maskJsonObject(attempt.input),
    output: maskJsonObject(attempt.output),
    failureClassification: attempt.failureClassification,
    retryDecision: attempt.retryDecision,
    errorMessage: attempt.errorMessage,
    startedAt: attempt.startedAt,
    finishedAt: attempt.finishedAt,
    createdAt: attempt.createdAt,
  };
}

function maskGraph(graph: NodeFlowGraph): NodeFlowGraph {
  return {
    ...graph,
    metadata: maskJsonObject(graph.metadata) ?? undefined,
    nodes: graph.nodes.map(maskNode),
  };
}

function maskNode(node: NodeFlowNode): NodeFlowNode {
  return {
    ...node,
    data: maskJsonObject(node.data) ?? undefined,
  };
}

function maskJsonObject(value: NodeFlowJsonObject | null | undefined): NodeFlowJsonObject | null {
  if (!value) {
    return value ?? null;
  }
  return maskJsonValue(value) as NodeFlowJsonObject;
}

function maskJsonValue(value: NodeFlowJsonValue, key = ""): NodeFlowJsonValue {
  if (SECRET_KEY_PATTERN.test(key)) {
    return "[REDACTED]";
  }
  if (Array.isArray(value)) {
    return value.map((entry) => maskJsonValue(entry));
  }
  if (value && typeof value === "object") {
    const masked: NodeFlowJsonObject = {};
    for (const [entryKey, entryValue] of Object.entries(value)) {
      masked[entryKey] = maskJsonValue(entryValue, entryKey);
    }
    return masked;
  }
  return value;
}
