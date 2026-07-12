import type { NodeFlowGraph, NodeFlowJsonObject, NodeFlowJsonValue } from "../../../../src/contracts/node-flow-types.js";

export type NodeCanvasNodeKind = "trigger" | "agent" | "task" | "condition" | "output";
export type NodeCanvasPortDirection = "input" | "output";
export type NodeCanvasPortType = "control" | "agent" | "task" | "condition" | "result" | "data";
export type NodeCanvasConfigFieldType = "text" | "textarea" | "number" | "boolean" | "select";
export type NodeCanvasConfigValue = string | number | boolean | null;
export type NodeCanvasAgentIntent = "plan" | "implement" | "review" | "qa";
export type NodeCanvasTaskIntent = "feature" | "refactor" | "test" | "docs" | "ops";

export interface NodeCanvasPosition {
  x: number;
  y: number;
}

export interface NodeCanvasPort {
  id: string;
  label: string;
  direction: NodeCanvasPortDirection;
  type: NodeCanvasPortType;
  required?: boolean;
}

export type NodeCanvasInputPort = NodeCanvasPort & { direction: "input" };
export type NodeCanvasOutputPort = NodeCanvasPort & { direction: "output" };

export interface NodeCanvasConfigField {
  id: string;
  label: string;
  type: NodeCanvasConfigFieldType;
  required?: boolean;
  value: NodeCanvasConfigValue;
  options?: readonly string[];
}

export interface NodeCanvasNodeMetadata {
  agentIntent?: NodeCanvasAgentIntent;
  taskIntent?: NodeCanvasTaskIntent;
}

export interface NodeCanvasNode {
  id: string;
  kind: NodeCanvasNodeKind;
  label: string;
  description: string;
  position: NodeCanvasPosition;
  inputPorts: NodeCanvasInputPort[];
  outputPorts: NodeCanvasOutputPort[];
  config: NodeCanvasConfigField[];
  metadata: NodeCanvasNodeMetadata;
}

export interface NodeCanvasEdgeEndpoint {
  nodeId: string;
  portId: string;
}

export interface NodeCanvasEdge {
  id: string;
  source: NodeCanvasEdgeEndpoint;
  target: NodeCanvasEdgeEndpoint;
  label?: string;
}

export interface NodeCanvasSelectionState {
  nodeIds: string[];
  edgeIds: string[];
}

export interface NodeCanvasGraph {
  schemaVersion?: 2;
  nodes: NodeCanvasNode[];
  edges: NodeCanvasEdge[];
  selection: NodeCanvasSelectionState;
}

export interface NodeCanvasGraphMigrationResult {
  graph: NodeCanvasGraph;
  migrated: boolean;
  legacySnapshot: unknown | null;
}

export type NodeCanvasValidationIssueCode =
  | "duplicate_node_id"
  | "missing_edge_source_node"
  | "missing_edge_target_node"
  | "missing_edge_source_port"
  | "missing_edge_target_port"
  | "self_connection"
  | "incompatible_port_direction"
  | "incompatible_port_type"
  | "empty_required_label"
  | "invalid_agent_intent"
  | "invalid_task_intent";

export interface NodeCanvasValidationIssue {
  code: NodeCanvasValidationIssueCode;
  entityId: string;
  field: string;
  message: string;
}

export type NodesCanvasAction =
  | {
      type: "add_node";
      kind: NodeCanvasNodeKind;
      label?: string;
      position?: Partial<NodeCanvasPosition>;
      metadata?: NodeCanvasNodeMetadata;
    }
  | {
      type: "connect_ports";
      source: NodeCanvasEdgeEndpoint;
      target: NodeCanvasEdgeEndpoint;
      label?: string;
    }
  | { type: "update_node_label"; nodeId: string; label: string }
  | { type: "update_node_config"; nodeId: string; fieldId: string; value: NodeCanvasConfigValue }
  | { type: "move_node"; nodeId: string; position: NodeCanvasPosition }
  | { type: "delete_node"; nodeId: string }
  | { type: "delete_edge"; edgeId: string }
  | { type: "select_node"; nodeId: string; append?: boolean }
  | { type: "select_edge"; edgeId: string; append?: boolean }
  | { type: "clear_selection" }
  | { type: "replace_graph"; graph: NodeCanvasGraph };

const NODE_CANVAS_COLUMN_WIDTH = 300;
const NODE_CANVAS_ROW_HEIGHT = 160;
const NODE_CANVAS_START_X = 80;
const NODE_CANVAS_START_Y = 80;

const NODE_KINDS: readonly NodeCanvasNodeKind[] = ["trigger", "agent", "task", "condition", "output"];
const AGENT_INTENTS: readonly NodeCanvasAgentIntent[] = ["plan", "implement", "review", "qa"];
const TASK_INTENTS: readonly NodeCanvasTaskIntent[] = ["feature", "refactor", "test", "docs", "ops"];

interface CanonicalCanvasDefinition {
  type: string;
  handles: Readonly<Record<string, string>>;
}

const CANONICAL_CANVAS_DEFINITIONS: Readonly<Record<NodeCanvasNodeKind, CanonicalCanvasDefinition>> = {
  trigger: { type: "input", handles: { event: "output" } },
  agent: { type: "set_fields", handles: { in: "input", agent: "output" } },
  task: { type: "template", handles: { agent: "input", task: "output" } },
  condition: { type: "condition", handles: { task: "input", pass: "true", fail: "false" } },
  output: { type: "output", handles: { result: "input" } },
};

interface NodeTemplate {
  label: string;
  description: string;
  inputPorts: NodeCanvasInputPort[];
  outputPorts: NodeCanvasOutputPort[];
  config: NodeCanvasConfigField[];
  metadata: NodeCanvasNodeMetadata;
}

const NODE_TEMPLATES: Record<NodeCanvasNodeKind, NodeTemplate> = {
  trigger: {
    label: "Project Trigger",
    description: "Starts the workflow from a manual or scheduled event.",
    inputPorts: [],
    outputPorts: [{ id: "event", label: "Event", direction: "output", type: "control", required: true }],
    config: [
      { id: "source", label: "Source", type: "select", required: true, value: "manual", options: ["manual", "schedule"] },
    ],
    metadata: {},
  },
  agent: {
    label: "Agent Router",
    description: "Chooses the agent role that should handle downstream tasks.",
    inputPorts: [{ id: "in", label: "In", direction: "input", type: "control", required: true }],
    outputPorts: [{ id: "agent", label: "Agent", direction: "output", type: "agent", required: true }],
    config: [
      { id: "agentPresetId", label: "Agent preset", type: "text", value: null },
      { id: "routingMode", label: "Routing mode", type: "select", required: true, value: "auto", options: ["auto", "fixed"] },
    ],
    metadata: { agentIntent: "implement" },
  },
  task: {
    label: "Task Draft",
    description: "Creates or updates a concrete implementation task.",
    inputPorts: [{ id: "agent", label: "Agent", direction: "input", type: "agent", required: true }],
    outputPorts: [{ id: "task", label: "Task", direction: "output", type: "task", required: true }],
    config: [
      { id: "title", label: "Task title", type: "text", required: true, value: "Implement scoped change" },
      { id: "prompt", label: "Prompt", type: "textarea", required: true, value: "Use the selected agent to complete the task." },
    ],
    metadata: { taskIntent: "feature" },
  },
  condition: {
    label: "Quality Gate",
    description: "Branches the workflow based on validation or review state.",
    inputPorts: [{ id: "task", label: "Task", direction: "input", type: "task", required: true }],
    outputPorts: [
      { id: "pass", label: "Pass", direction: "output", type: "condition", required: true },
      { id: "fail", label: "Fail", direction: "output", type: "condition", required: true },
    ],
    config: [
      { id: "expression", label: "Expression", type: "text", required: true, value: "checks.passed === true" },
    ],
    metadata: {},
  },
  output: {
    label: "Workflow Output",
    description: "Collects the final graph result for the run panel.",
    inputPorts: [{ id: "result", label: "Result", direction: "input", type: "condition", required: true }],
    outputPorts: [],
    config: [
      { id: "summary", label: "Summary", type: "textarea", value: "Return merged task status and validation output." },
    ],
    metadata: {},
  },
};

export const createInitialNodeCanvasGraph = (): NodeCanvasGraph => {
  const nodes: NodeCanvasNode[] = [
    createNodeCanvasNode("trigger", { id: "trigger-1", position: { x: 80, y: 120 } }),
    createNodeCanvasNode("agent", { id: "agent-1", position: { x: 380, y: 120 } }),
    createNodeCanvasNode("task", { id: "task-1", position: { x: 680, y: 120 } }),
    createNodeCanvasNode("condition", { id: "condition-1", position: { x: 980, y: 120 } }),
    createNodeCanvasNode("output", { id: "output-1", position: { x: 1280, y: 120 } }),
  ];

  return normalizeNodeCanvasGraph({
    schemaVersion: 2,
    nodes,
    edges: [
      createNodeCanvasEdge("edge-trigger-1-event-agent-1-in", "trigger-1", "event", "agent-1", "in"),
      createNodeCanvasEdge("edge-agent-1-agent-task-1-agent", "agent-1", "agent", "task-1", "agent"),
      createNodeCanvasEdge("edge-task-1-task-condition-1-task", "task-1", "task", "condition-1", "task"),
      createNodeCanvasEdge("edge-condition-1-pass-output-1-result", "condition-1", "pass", "output-1", "result"),
    ],
    selection: { nodeIds: ["trigger-1"], edgeIds: [] },
  });
};

export const createNodeCanvasNode = (
  kind: NodeCanvasNodeKind,
  options: {
    id?: string;
    label?: string;
    description?: string;
    position?: NodeCanvasPosition;
    metadata?: NodeCanvasNodeMetadata;
  } = {},
): NodeCanvasNode => {
  const template = NODE_TEMPLATES[kind];
  return {
    id: options.id ?? `${kind}-1`,
    kind,
    label: options.label ?? template.label,
    description: options.description ?? template.description,
    position: options.position ?? { x: NODE_CANVAS_START_X, y: NODE_CANVAS_START_Y },
    inputPorts: template.inputPorts.map(clonePort),
    outputPorts: template.outputPorts.map(clonePort),
    config: template.config.map(cloneConfigField),
    metadata: normalizeMetadata({ ...template.metadata, ...options.metadata }),
  };
};

export const connectNodeCanvasPorts = (
  graph: NodeCanvasGraph,
  source: NodeCanvasEdgeEndpoint,
  target: NodeCanvasEdgeEndpoint,
  label?: string,
): NodeCanvasGraph => {
  const edge = createNodeCanvasEdge(
    nextEdgeId(graph, source, target),
    source.nodeId,
    source.portId,
    target.nodeId,
    target.portId,
    label,
  );
  return normalizeNodeCanvasGraph({ ...graph, edges: [...graph.edges, edge] });
};

export const updateNodeCanvasLabel = (
  graph: NodeCanvasGraph,
  nodeId: string,
  label: string,
): NodeCanvasGraph => normalizeNodeCanvasGraph({
  ...graph,
  nodes: graph.nodes.map((node) => node.id === nodeId ? { ...node, label } : node),
});

export const updateNodeCanvasConfigValue = (
  graph: NodeCanvasGraph,
  nodeId: string,
  fieldId: string,
  value: NodeCanvasConfigValue,
): NodeCanvasGraph => normalizeNodeCanvasGraph({
  ...graph,
  nodes: graph.nodes.map((node) => node.id === nodeId
    ? {
        ...node,
        config: node.config.map((field) => field.id === fieldId ? { ...field, value } : field),
      }
    : node),
});

export const deleteNodeCanvasNode = (graph: NodeCanvasGraph, nodeId: string): NodeCanvasGraph => normalizeNodeCanvasGraph({
  ...graph,
  nodes: graph.nodes.filter((node) => node.id !== nodeId),
  edges: graph.edges.filter((edge) => edge.source.nodeId !== nodeId && edge.target.nodeId !== nodeId),
  selection: {
    nodeIds: graph.selection.nodeIds.filter((selectedId) => selectedId !== nodeId),
    edgeIds: graph.selection.edgeIds,
  },
});

export const deleteNodeCanvasEdge = (graph: NodeCanvasGraph, edgeId: string): NodeCanvasGraph => normalizeNodeCanvasGraph({
  ...graph,
  edges: graph.edges.filter((edge) => edge.id !== edgeId),
  selection: {
    nodeIds: graph.selection.nodeIds,
    edgeIds: graph.selection.edgeIds.filter((selectedId) => selectedId !== edgeId),
  },
});

export const selectNodeCanvasEntities = (
  graph: NodeCanvasGraph,
  selection: Partial<NodeCanvasSelectionState>,
  append = false,
): NodeCanvasGraph => {
  const nodeIds = append
    ? uniqueStrings([...graph.selection.nodeIds, ...(selection.nodeIds ?? [])])
    : selection.nodeIds ?? [];
  const edgeIds = append
    ? uniqueStrings([...graph.selection.edgeIds, ...(selection.edgeIds ?? [])])
    : selection.edgeIds ?? [];
  return normalizeNodeCanvasGraph({ ...graph, selection: { nodeIds, edgeIds } });
};

export const layoutNodeCanvasGraph = (graph: NodeCanvasGraph): NodeCanvasGraph => {
  const orderedNodes = [...graph.nodes].sort(compareById);
  const nodesById = new Map(orderedNodes.map((node) => [node.id, node]));
  const incomingById = new Map<string, NodeCanvasEdge[]>();
  const depthById = new Map<string, number>();

  for (const edge of graph.edges) {
    const incoming = incomingById.get(edge.target.nodeId) ?? [];
    incoming.push(edge);
    incomingById.set(edge.target.nodeId, incoming);
  }

  const readDepth = (nodeId: string, path: ReadonlySet<string>): number => {
    const cached = depthById.get(nodeId);
    if (cached !== undefined) {
      return cached;
    }
    if (path.has(nodeId)) {
      return 0;
    }
    const incoming = incomingById.get(nodeId) ?? [];
    const upstreamDepths = incoming
      .filter((edge) => nodesById.has(edge.source.nodeId))
      .map((edge) => readDepth(edge.source.nodeId, new Set([...path, nodeId])));
    const depth = upstreamDepths.length === 0 ? 0 : Math.max(...upstreamDepths) + 1;
    depthById.set(nodeId, depth);
    return depth;
  };

  const rowByDepth = new Map<number, number>();
  const nodes = orderedNodes.map((node) => {
    const depth = readDepth(node.id, new Set());
    const row = rowByDepth.get(depth) ?? 0;
    rowByDepth.set(depth, row + 1);
    return {
      ...node,
      position: {
        x: NODE_CANVAS_START_X + depth * NODE_CANVAS_COLUMN_WIDTH,
        y: NODE_CANVAS_START_Y + row * NODE_CANVAS_ROW_HEIGHT,
      },
    };
  });

  return normalizeNodeCanvasGraph({ ...graph, nodes });
};

export const nodesCanvasReducer = (
  graph: NodeCanvasGraph,
  action: NodesCanvasAction,
): NodeCanvasGraph => {
  switch (action.type) {
    case "add_node": {
      const id = nextNodeId(graph, action.kind);
      const position = action.position
        ? {
            x: finiteOrDefault(action.position.x, defaultPositionForIndex(graph.nodes.length).x),
            y: finiteOrDefault(action.position.y, defaultPositionForIndex(graph.nodes.length).y),
          }
        : defaultPositionForIndex(graph.nodes.length);
      const node = createNodeCanvasNode(action.kind, {
        id,
        label: action.label,
        position,
        metadata: action.metadata,
      });
      return normalizeNodeCanvasGraph({
        ...graph,
        nodes: [...graph.nodes, node],
        selection: { nodeIds: [id], edgeIds: [] },
      });
    }
    case "connect_ports":
      return connectNodeCanvasPorts(graph, action.source, action.target, action.label);
    case "update_node_label":
      return updateNodeCanvasLabel(graph, action.nodeId, action.label);
    case "update_node_config":
      return updateNodeCanvasConfigValue(graph, action.nodeId, action.fieldId, action.value);
    case "move_node":
      return normalizeNodeCanvasGraph({
        ...graph,
        nodes: graph.nodes.map((node) => node.id === action.nodeId ? { ...node, position: action.position } : node),
      });
    case "delete_node":
      return deleteNodeCanvasNode(graph, action.nodeId);
    case "delete_edge":
      return deleteNodeCanvasEdge(graph, action.edgeId);
    case "select_node":
      return selectNodeCanvasEntities(graph, { nodeIds: [action.nodeId], edgeIds: action.append ? undefined : [] }, action.append);
    case "select_edge":
      return selectNodeCanvasEntities(graph, { nodeIds: action.append ? undefined : [], edgeIds: [action.edgeId] }, action.append);
    case "clear_selection":
      return normalizeNodeCanvasGraph({ ...graph, selection: { nodeIds: [], edgeIds: [] } });
    case "replace_graph":
      return normalizeNodeCanvasGraph(action.graph);
  }
};

export const validateNodeCanvasGraph = (graph: NodeCanvasGraph): NodeCanvasValidationIssue[] => {
  const issues: NodeCanvasValidationIssue[] = [];
  const seenNodeIds = new Set<string>();
  const duplicateNodeIds = new Set<string>();
  const nodeById = new Map<string, NodeCanvasNode>();

  for (const node of graph.nodes) {
    if (seenNodeIds.has(node.id)) {
      duplicateNodeIds.add(node.id);
      issues.push(issue("duplicate_node_id", node.id, "nodes", `Node id "${node.id}" is duplicated.`));
    } else {
      seenNodeIds.add(node.id);
      nodeById.set(node.id, node);
    }

    if (!node.label.trim()) {
      issues.push(issue("empty_required_label", node.id, "label", "Node label is required."));
    }

    for (const field of node.config) {
      if (field.required && typeof field.value === "string" && !field.value.trim()) {
        issues.push(issue("empty_required_label", node.id, `config.${field.id}`, `${field.label} is required.`));
      } else if (field.required && field.value === null) {
        issues.push(issue("empty_required_label", node.id, `config.${field.id}`, `${field.label} is required.`));
      }
    }

    if (node.metadata.agentIntent !== undefined && !isAgentIntent(node.metadata.agentIntent)) {
      issues.push(issue("invalid_agent_intent", node.id, "metadata.agentIntent", "Agent intent metadata is invalid."));
    }
    if (node.metadata.taskIntent !== undefined && !isTaskIntent(node.metadata.taskIntent)) {
      issues.push(issue("invalid_task_intent", node.id, "metadata.taskIntent", "Task intent metadata is invalid."));
    }
  }

  for (const edge of graph.edges) {
    const sourceNode = nodeById.get(edge.source.nodeId);
    const targetNode = nodeById.get(edge.target.nodeId);

    if (!sourceNode || duplicateNodeIds.has(edge.source.nodeId)) {
      issues.push(issue("missing_edge_source_node", edge.id, "source.nodeId", "Edge source node is missing."));
      continue;
    }
    if (!targetNode || duplicateNodeIds.has(edge.target.nodeId)) {
      issues.push(issue("missing_edge_target_node", edge.id, "target.nodeId", "Edge target node is missing."));
      continue;
    }
    if (edge.source.nodeId === edge.target.nodeId) {
      issues.push(issue("self_connection", edge.id, "target.nodeId", "Edge cannot connect a node to itself."));
    }

    const sourcePort = [...sourceNode.inputPorts, ...sourceNode.outputPorts].find((port) => port.id === edge.source.portId);
    const targetPort = [...targetNode.inputPorts, ...targetNode.outputPorts].find((port) => port.id === edge.target.portId);

    if (!sourcePort) {
      issues.push(issue("missing_edge_source_port", edge.id, "source.portId", "Edge source port is missing."));
      continue;
    }
    if (!targetPort) {
      issues.push(issue("missing_edge_target_port", edge.id, "target.portId", "Edge target port is missing."));
      continue;
    }
    if (sourcePort.direction !== "output" || targetPort.direction !== "input") {
      issues.push(issue("incompatible_port_direction", edge.id, "source.portId", "Edges must connect output ports to input ports."));
    }
    if (!arePortTypesCompatible(sourcePort.type, targetPort.type)) {
      issues.push(issue("incompatible_port_type", edge.id, "target.portId", "Connected ports are not compatible."));
    }
  }

  return issues.sort((left, right) => {
    const codeCompare = left.code.localeCompare(right.code);
    if (codeCompare !== 0) {
      return codeCompare;
    }
    return left.entityId.localeCompare(right.entityId) || left.field.localeCompare(right.field);
  });
};

export const serializeNodeCanvasGraph = (graph: NodeCanvasGraph): string => (
  JSON.stringify(toStableJson(toCanonicalNodeFlowGraph(graph)), null, 2)
);

export const toCanonicalNodeFlowGraph = (graph: NodeCanvasGraph, legacySnapshot?: unknown): NodeFlowGraph => {
  const normalized = normalizeNodeCanvasGraph(graph);
  return {
    schemaVersion: 2,
    nodes: normalized.nodes.map(toCanonicalNode),
    edges: normalized.edges.map((edge) => {
      const source = normalized.nodes.find((node) => node.id === edge.source.nodeId);
      const target = normalized.nodes.find((node) => node.id === edge.target.nodeId);
      return {
        id: edge.id,
        fromNodeId: edge.source.nodeId,
        toNodeId: edge.target.nodeId,
        ...(source ? { fromHandle: CANONICAL_CANVAS_DEFINITIONS[source.kind].handles[edge.source.portId] } : {}),
        ...(target ? { toHandle: CANONICAL_CANVAS_DEFINITIONS[target.kind].handles[edge.target.portId] } : {}),
      };
    }),
    metadata: {
      canvasSelection: normalized.selection as unknown as NodeFlowJsonObject,
      ...(legacySnapshot !== undefined ? {
        migration: {
          source: "browser_canvas_v1",
          legacySnapshot: toStableJson(cloneStableValue(legacySnapshot)) as NodeFlowJsonValue,
        },
      } : {}),
    },
  };
};

const toCanonicalNode = (node: NodeCanvasNode): NodeFlowGraph["nodes"][number] => {
  const definition = CANONICAL_CANVAS_DEFINITIONS[node.kind];
  const config = Object.fromEntries(node.config.map((field) => [field.id, field.value]));
  const prompt = typeof config.prompt === "string" && config.prompt.trim()
    ? config.prompt
    : "Use the selected agent to complete the task.";
  return {
    id: node.id,
    type: definition.type,
    title: node.label,
    description: node.description,
    position: node.position,
    definition: { type: definition.type, version: 1 },
    disabled: false,
    data: {
      ...(node.kind === "agent" ? { fields: { legacyAgent: config } } : {}),
      ...(node.kind === "task" ? { template: prompt, outputKey: "task" } : {}),
      canvas: {
        kind: node.kind,
        config: toStableJson(node.config) as NodeFlowJsonValue,
        values: toStableJson(config) as NodeFlowJsonValue,
        metadata: toStableJson(node.metadata) as NodeFlowJsonValue,
      },
    },
  };
};

export const deserializeNodeCanvasGraph = (serialized: string): NodeCanvasGraph => {
  return deserializeNodeCanvasGraphWithMigration(serialized).graph;
};

export const deserializeNodeCanvasGraphWithMigration = (serialized: string): NodeCanvasGraphMigrationResult => {
  try {
    const parsed: unknown = JSON.parse(serialized);
    return migrateNodeCanvasGraph(parsed);
  } catch {
    return { graph: createInitialNodeCanvasGraph(), migrated: false, legacySnapshot: null };
  }
};

export const migrateNodeCanvasGraph = (input: unknown): NodeCanvasGraphMigrationResult => {
  const migrated = !isRecord(input) || input.schemaVersion !== 2;
  return {
    graph: normalizeNodeCanvasGraph(input),
    migrated,
    legacySnapshot: migrated ? cloneStableValue(input) : null,
  };
};

export const normalizeNodeCanvasGraph = (input: unknown): NodeCanvasGraph => {
  if (!isRecord(input)) {
    return createInitialNodeCanvasGraph();
  }

  const parsedNodes = Array.isArray(input.nodes)
    ? input.nodes.map(parseNode).filter((node): node is NodeCanvasNode => node !== null)
    : [];

  if (parsedNodes.length === 0) {
    return createInitialNodeCanvasGraph();
  }

  const rawParsedEdges = Array.isArray(input.edges)
    ? input.edges.map(parseEdge).filter((edge): edge is NodeCanvasEdge => edge !== null)
    : [];
  const nodeById = new Map(parsedNodes.map((node) => [node.id, node]));
  const parsedEdges = rawParsedEdges.map((edge) => normalizeCanvasEdgeHandles(edge, nodeById));

  const validNodeIds = new Set(parsedNodes.map((node) => node.id));
  const canvasSelection = isRecord(input.metadata) ? input.metadata.canvasSelection : undefined;
  const parsedSelection = parseSelection(input.selection ?? canvasSelection, validNodeIds, new Set(parsedEdges.map((edge) => edge.id)));

  return {
    schemaVersion: 2,
    nodes: parsedNodes.sort(compareById),
    edges: parsedEdges.sort(compareById),
    selection: parsedSelection,
  };
};

const cloneStableValue = (value: unknown): unknown => structuredClone(value);

const createNodeCanvasEdge = (
  id: string,
  sourceNodeId: string,
  sourcePortId: string,
  targetNodeId: string,
  targetPortId: string,
  label?: string,
): NodeCanvasEdge => ({
  id,
  source: { nodeId: sourceNodeId, portId: sourcePortId },
  target: { nodeId: targetNodeId, portId: targetPortId },
  ...(label ? { label } : {}),
});

const clonePort = <TPort extends NodeCanvasPort>(port: TPort): TPort => ({ ...port });

const cloneConfigField = (field: NodeCanvasConfigField): NodeCanvasConfigField => ({
  ...field,
  options: field.options ? [...field.options] : undefined,
});

const issue = (
  code: NodeCanvasValidationIssueCode,
  entityId: string,
  field: string,
  message: string,
): NodeCanvasValidationIssue => ({ code, entityId, field, message });

const nextNodeId = (graph: NodeCanvasGraph, kind: NodeCanvasNodeKind): string => {
  const used = new Set(graph.nodes.map((node) => node.id));
  let index = 1;
  while (used.has(`${kind}-${index}`)) {
    index += 1;
  }
  return `${kind}-${index}`;
};

const nextEdgeId = (
  graph: NodeCanvasGraph,
  source: NodeCanvasEdgeEndpoint,
  target: NodeCanvasEdgeEndpoint,
): string => {
  const base = `edge-${source.nodeId}-${source.portId}-${target.nodeId}-${target.portId}`;
  const used = new Set(graph.edges.map((edge) => edge.id));
  if (!used.has(base)) {
    return base;
  }
  let index = 2;
  while (used.has(`${base}-${index}`)) {
    index += 1;
  }
  return `${base}-${index}`;
};

const defaultPositionForIndex = (index: number): NodeCanvasPosition => ({
  x: NODE_CANVAS_START_X + (index % 4) * NODE_CANVAS_COLUMN_WIDTH,
  y: NODE_CANVAS_START_Y + Math.floor(index / 4) * NODE_CANVAS_ROW_HEIGHT,
});

const finiteOrDefault = (value: number | undefined, fallback: number): number => (
  typeof value === "number" && Number.isFinite(value) ? value : fallback
);

const compareById = <T extends { id: string }>(left: T, right: T): number => left.id.localeCompare(right.id);

const uniqueStrings = (values: readonly string[]): string[] => {
  const seen = new Set<string>();
  const next: string[] = [];
  for (const value of values) {
    if (!seen.has(value)) {
      seen.add(value);
      next.push(value);
    }
  }
  return next;
};

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === "object" && value !== null && !Array.isArray(value)
);

const isString = (value: unknown): value is string => typeof value === "string";

const isNodeKind = (value: unknown): value is NodeCanvasNodeKind => isString(value) && NODE_KINDS.includes(value as NodeCanvasNodeKind);
const isAgentIntent = (value: unknown): value is NodeCanvasAgentIntent => isString(value) && AGENT_INTENTS.includes(value as NodeCanvasAgentIntent);
const isTaskIntent = (value: unknown): value is NodeCanvasTaskIntent => isString(value) && TASK_INTENTS.includes(value as NodeCanvasTaskIntent);

const normalizeMetadata = (metadata: NodeCanvasNodeMetadata): NodeCanvasNodeMetadata => ({
  ...(metadata.agentIntent !== undefined ? { agentIntent: metadata.agentIntent } : {}),
  ...(metadata.taskIntent !== undefined ? { taskIntent: metadata.taskIntent } : {}),
});

const parseNode = (value: unknown): NodeCanvasNode | null => {
  const canvasData = isRecord(value) ? readCanonicalCanvasData(value.data) : null;
  const kindValue = isRecord(value) ? value.kind ?? canvasData?.kind ?? value.type : undefined;
  if (!isRecord(value) || !isString(value.id) || !isNodeKind(kindValue)) {
    return null;
  }
  const template = createNodeCanvasNode(kindValue, { id: value.id });
  const position = isRecord(value.position)
    ? {
        x: finiteOrDefault(typeof value.position.x === "number" ? value.position.x : undefined, template.position.x),
        y: finiteOrDefault(typeof value.position.y === "number" ? value.position.y : undefined, template.position.y),
      }
    : template.position;

  const canonicalPorts = Array.isArray(value.ports) ? value.ports : undefined;
  return {
    ...template,
    label: isString(value.label) ? value.label : isString(value.title) ? value.title : template.label,
    description: isString(value.description) ? value.description : template.description,
    position,
    inputPorts: parsePorts(value.inputPorts ?? canonicalPorts?.filter((port) => isRecord(port) && port.direction === "input"), "input", template.inputPorts),
    outputPorts: parsePorts(value.outputPorts ?? canonicalPorts?.filter((port) => isRecord(port) && port.direction === "output"), "output", template.outputPorts),
    config: parseConfig(value.config ?? canvasData?.config, template.config),
    metadata: parseMetadata(value.metadata ?? canvasData?.metadata),
  };
};

const readCanonicalCanvasData = (value: unknown): Record<string, unknown> | null => {
  if (!isRecord(value) || !isRecord(value.canvas)) return null;
  return value.canvas;
};

const parsePorts = <TDirection extends NodeCanvasPortDirection>(
  value: unknown,
  expectedDirection: TDirection,
  fallback: readonly (NodeCanvasPort & { direction: TDirection })[],
): (NodeCanvasPort & { direction: TDirection })[] => {
  if (!Array.isArray(value)) {
    return fallback.map(clonePort);
  }
  const ports = value
    .map((entry) => parsePort(entry, expectedDirection))
    .filter((port): port is NodeCanvasPort & { direction: TDirection } => port !== null);
  return ports.length > 0 ? ports : fallback.map(clonePort);
};

const parsePort = <TDirection extends NodeCanvasPortDirection>(
  value: unknown,
  expectedDirection: TDirection,
): (NodeCanvasPort & { direction: TDirection }) | null => {
  if (!isRecord(value) || !isString(value.id)) {
    return null;
  }
  const canonicalDescription = isRecord(value.schema) && isString(value.schema.description) ? value.schema.description : undefined;
  const portType = isString(value.type) ? value.type : canonicalDescription ?? "data";
  if (!["control", "agent", "task", "condition", "result", "data"].includes(portType)) {
    return null;
  }
  return {
    id: value.id,
    label: isString(value.label) ? value.label : value.id,
    direction: expectedDirection,
    type: portType as NodeCanvasPortType,
    ...(typeof value.required === "boolean" ? { required: value.required } : {}),
  };
};

const parseConfig = (
  value: unknown,
  fallback: readonly NodeCanvasConfigField[],
): NodeCanvasConfigField[] => {
  if (!Array.isArray(value)) {
    return fallback.map(cloneConfigField);
  }
  const fields = value.map(parseConfigField).filter((field): field is NodeCanvasConfigField => field !== null);
  return fields.length > 0 ? fields : fallback.map(cloneConfigField);
};

const parseConfigField = (value: unknown): NodeCanvasConfigField | null => {
  if (!isRecord(value) || !isString(value.id) || !isString(value.label) || !isString(value.type)) {
    return null;
  }
  if (!["text", "textarea", "number", "boolean", "select"].includes(value.type)) {
    return null;
  }
  return {
    id: value.id,
    label: value.label,
    type: value.type as NodeCanvasConfigFieldType,
    required: typeof value.required === "boolean" ? value.required : undefined,
    value: parseConfigValue(value.value),
    options: Array.isArray(value.options) ? value.options.filter(isString) : undefined,
  };
};

const parseConfigValue = (value: unknown): NodeCanvasConfigValue => {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return null;
};

const parseMetadata = (value: unknown): NodeCanvasNodeMetadata => {
  if (!isRecord(value)) {
    return {};
  }
  return {
    ...(isString(value.agentIntent) ? { agentIntent: value.agentIntent as NodeCanvasAgentIntent } : {}),
    ...(isString(value.taskIntent) ? { taskIntent: value.taskIntent as NodeCanvasTaskIntent } : {}),
  };
};

const parseEdge = (value: unknown): NodeCanvasEdge | null => {
  if (!isRecord(value) || !isString(value.id)) {
    return null;
  }
  const sourceNodeId = isRecord(value.source) ? value.source.nodeId : value.fromNodeId;
  const sourcePortId = isRecord(value.source) ? value.source.portId : value.fromHandle;
  const targetNodeId = isRecord(value.target) ? value.target.nodeId : value.toNodeId;
  const targetPortId = isRecord(value.target) ? value.target.portId : value.toHandle;
  if (!isString(sourceNodeId) || !isString(sourcePortId) || !isString(targetNodeId) || !isString(targetPortId)) {
    return null;
  }
  return {
    id: value.id,
    source: { nodeId: sourceNodeId, portId: sourcePortId },
    target: { nodeId: targetNodeId, portId: targetPortId },
    ...(isString(value.label) ? { label: value.label } : {}),
  };
};

const normalizeCanvasEdgeHandles = (
  edge: NodeCanvasEdge,
  nodeById: ReadonlyMap<string, NodeCanvasNode>,
): NodeCanvasEdge => {
  const source = nodeById.get(edge.source.nodeId);
  const target = nodeById.get(edge.target.nodeId);
  const legacyHandle = (node: NodeCanvasNode | undefined, handle: string): string => {
    if (!node) return handle;
    const ports = [...node.inputPorts, ...node.outputPorts];
    if (ports.some((port) => port.id === handle)) return handle;
    return Object.entries(CANONICAL_CANVAS_DEFINITIONS[node.kind].handles)
      .find(([, canonical]) => canonical === handle)?.[0] ?? handle;
  };
  return {
    ...edge,
    source: { ...edge.source, portId: legacyHandle(source, edge.source.portId) },
    target: { ...edge.target, portId: legacyHandle(target, edge.target.portId) },
  };
};

const parseSelection = (
  value: unknown,
  nodeIds: ReadonlySet<string>,
  edgeIds: ReadonlySet<string>,
): NodeCanvasSelectionState => {
  if (!isRecord(value)) {
    return { nodeIds: [], edgeIds: [] };
  }
  return {
    nodeIds: Array.isArray(value.nodeIds) ? uniqueStrings(value.nodeIds.filter(isString)).filter((id) => nodeIds.has(id)) : [],
    edgeIds: Array.isArray(value.edgeIds) ? uniqueStrings(value.edgeIds.filter(isString)).filter((id) => edgeIds.has(id)) : [],
  };
};

const arePortTypesCompatible = (source: NodeCanvasPortType, target: NodeCanvasPortType): boolean => {
  if (source === target) {
    return true;
  }
  return source === "condition" && target === "result";
};

type StableJsonValue = string | number | boolean | null | StableJsonValue[] | { [key: string]: StableJsonValue };

const toStableJson = (value: unknown): StableJsonValue => {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(toStableJson);
  }
  if (isRecord(value)) {
    return Object.keys(value).sort().reduce<{ [key: string]: StableJsonValue }>((acc, key) => {
      acc[key] = toStableJson(value[key]);
      return acc;
    }, {});
  }
  return null;
};
