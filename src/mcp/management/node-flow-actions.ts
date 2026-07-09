import type {
  ManageCodeUxArgs,
  ManagementResponseEnvelope,
} from "../../contracts/internal-management-types.js";
import type {
  NodeFlowGraph,
  NodeFlowJsonObject,
  NodeFlowJsonValue,
  NodeFlowNode,
  NodeFlowRecord,
  NodeFlowRunRecord,
  NodeFlowRunSummaryResponse,
  NodeWidgetSchema,
} from "../../contracts/node-flow-types.js";
import type { NodeFlowService } from "../../services/node-flow-service.js";
import {
  managementValidationError,
  parseOptionalObject,
  parseOptionalString,
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
      case "get":
        return this.getFlow(payload);
      case "create":
        return this.createFlow(payload);
      case "update":
        return this.updateFlow(payload);
      case "delete":
        return this.deleteFlow(args, payload);
      case "validate":
        return this.validateFlow(payload);
      case "run":
        return await this.runFlow(payload);
      case "list_runs":
        return this.listRuns(payload);
      case "get_run":
        return this.getRun(payload);
      case "attach_to_agent":
        return this.attachToAgent(payload);
      case "detach_from_agent":
        return this.detachFromAgent(payload);
      default:
        throw new Error(`Unknown node flow action: ${args.action}`);
    }
  }

  private listFlows(payload: Record<string, unknown>): ManagementResponseEnvelope {
    const projectId = parseRequiredString(payload, "projectId");
    const flows = this.nodeFlowService.list(projectId).flows.map(formatFlowSummary);
    return { result: { flows } };
  }

  private getFlow(payload: Record<string, unknown>): ManagementResponseEnvelope {
    const flowId = parseRequiredString(payload, "flowId");
    const flow = this.requireFlow(flowId);
    this.assertProjectMatch(payload, flow);
    return {
      result: {
        flow: formatFlow(flow),
        agentSkills: this.nodeFlowService.listAgentSkills(flow.id),
      },
    };
  }

  private createFlow(payload: Record<string, unknown>): ManagementResponseEnvelope {
    const projectId = parseRequiredString(payload, "projectId");
    const graph = this.parseGraphWithWidgets(payload, true);
    if (!graph) {
      throw managementValidationError("graph object is required", "graph");
    }
    const validation = this.nodeFlowService.validate(graph);
    if (!validation.valid || !validation.graph) {
      throw validationToManagementError(validation.errors);
    }

    const flow = this.nodeFlowService.create(projectId, {
      title: parseRequiredString(payload, "name"),
      description: parseOptionalText(payload, "description"),
      graph: validation.graph,
    });
    return { result: { flow: formatFlow(flow) } };
  }

  private updateFlow(payload: Record<string, unknown>): ManagementResponseEnvelope {
    const flowId = parseRequiredString(payload, "flowId");
    const graph = this.parseGraphWithWidgets(payload, false);
    const validation = graph ? this.nodeFlowService.validate(graph) : null;
    if (validation && (!validation.valid || !validation.graph)) {
      throw validationToManagementError(validation.errors);
    }

    const name = parseOptionalString(payload, "name");
    const description = parseOptionalText(payload, "description");
    const flow = this.nodeFlowService.update(flowId, {
      ...(name !== undefined ? { title: name } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(validation?.graph ? { graph: validation.graph } : {}),
    });
    return { result: { flow: formatFlow(flow) } };
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
    const result = await this.nodeFlowService.runFlow(projectId, flowId, input, {
      triggerType: "mcp_management",
    });
    return { result: formatRunSummary(result) };
  }

  private listRuns(payload: Record<string, unknown>): ManagementResponseEnvelope {
    const flowId = parseRequiredString(payload, "flowId");
    const runs = this.nodeFlowService.listRuns(flowId).runs.map(formatRun);
    return { result: { runs } };
  }

  private getRun(payload: Record<string, unknown>): ManagementResponseEnvelope {
    const runId = parseRequiredString(payload, "runId");
    const run = this.nodeFlowService.getRun(runId);
    if (!run) {
      throw new Error(`Node flow run not found: ${runId}`);
    }
    return {
      result: {
        run: formatRun(run),
        nodeRuns: this.nodeFlowService.listNodeRuns(run.id).nodeRuns.map((nodeRun) => ({
          ...nodeRun,
          input: maskJsonObject(nodeRun.input),
          output: maskJsonObject(nodeRun.output),
        })),
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

function formatRun(run: NodeFlowRunRecord): Record<string, unknown> {
  return {
    ...run,
    triggerPayload: maskJsonObject(run.triggerPayload),
    input: maskJsonObject(run.input),
    output: maskJsonObject(run.output),
  };
}

function formatRunSummary(summary: NodeFlowRunSummaryResponse): Record<string, unknown> {
  return {
    run: formatRun(summary.run),
    nodeRuns: summary.nodeRuns.map((nodeRun) => ({
      ...nodeRun,
      input: maskJsonObject(nodeRun.input),
      output: maskJsonObject(nodeRun.output),
    })),
    output: maskJsonObject(summary.output),
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
