import type {
  NodeCanvasAgentIntent,
  NodeCanvasConfigValue,
  NodeCanvasEdge,
  NodeCanvasEdgeEndpoint,
  NodeCanvasGraph,
  NodeCanvasNode,
  NodeCanvasNodeKind,
  NodeCanvasNodeMetadata,
  NodeCanvasPosition,
  NodeCanvasTaskIntent,
  NodeCanvasValidationIssue,
} from "./nodes-canvas-state.js";
import {
  deserializeNodeCanvasGraphWithMigration,
  nodesCanvasReducer,
  normalizeNodeCanvasGraph,
  validateNodeCanvasGraph,
} from "./nodes-canvas-state.js";

export type NodeCanvasAgentCommand =
  | {
      command: "add_node";
      kind: NodeCanvasNodeKind;
      label?: string;
      position?: Partial<NodeCanvasPosition>;
      metadata?: NodeCanvasNodeMetadata;
    }
  | {
      command: "patch_node";
      nodeId: string;
      label?: string;
      position?: NodeCanvasPosition;
      config?: Record<string, NodeCanvasConfigValue>;
    }
  | {
      command: "connect_ports";
      source: NodeCanvasEdgeEndpoint;
      target: NodeCanvasEdgeEndpoint;
      label?: string;
    }
  | {
      command: "delete_entities";
      nodeIds?: string[];
      edgeIds?: string[];
    }
  | {
      command: "select_entities";
      nodeIds?: string[];
      edgeIds?: string[];
      append?: boolean;
    }
  | {
      command: "replace_graph";
      serializedGraph: string;
    };

export type NodeCanvasAgentIssueCode =
  | NodeCanvasValidationIssue["code"]
  | "invalid_agent_command"
  | "invalid_agent_command_payload"
  | "unknown_agent_command";

export interface NodeCanvasAgentIssue {
  code: NodeCanvasAgentIssueCode;
  entityId: string;
  field: string;
  message: string;
}

export interface NodeCanvasAgentCommandResult {
  graph: NodeCanvasGraph;
  issues: NodeCanvasAgentIssue[];
}

export interface NodeCanvasAgentSummaryNode {
  id: string;
  kind: NodeCanvasNodeKind;
  label: string;
  position: NodeCanvasPosition;
  inputPorts: string[];
  outputPorts: string[];
  config: Array<{ id: string; value: NodeCanvasConfigValue }>;
}

export interface NodeCanvasAgentSummaryEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
}

export interface NodeCanvasAgentSummary {
  nodeCount: number;
  edgeCount: number;
  selectedNodeIds: string[];
  selectedEdgeIds: string[];
  nodes: NodeCanvasAgentSummaryNode[];
  edges: NodeCanvasAgentSummaryEdge[];
  validationBlockers: NodeCanvasAgentIssue[];
}

export interface NodeCanvasGraphEntityDiff {
  added: string[];
  removed: string[];
  changed: string[];
}

export interface NodeCanvasValidationDiff {
  before: string[];
  after: string[];
  added: string[];
  removed: string[];
}

export interface NodeCanvasGraphDiff {
  nodes: NodeCanvasGraphEntityDiff;
  edges: NodeCanvasGraphEntityDiff;
  selectionChanged: boolean;
  validationBlockers: NodeCanvasValidationDiff;
  changedEntities: string[];
}

const NODE_KINDS: readonly NodeCanvasNodeKind[] = ["trigger", "agent", "task", "condition", "output"];

export const applyNodeCanvasAgentCommand = (
  graph: NodeCanvasGraph,
  command: unknown,
): NodeCanvasAgentCommandResult => applyNodeCanvasAgentCommands(graph, [command]);

export const applyNodeCanvasAgentCommands = (
  graph: NodeCanvasGraph,
  commands: unknown,
): NodeCanvasAgentCommandResult => {
  let nextGraph = normalizeNodeCanvasGraph(graph);
  const commandIssues: NodeCanvasAgentIssue[] = [];

  if (!Array.isArray(commands)) {
    return withGraphValidation(nextGraph, [
      agentIssue("invalid_agent_command_payload", "commands", "commands", "Agent commands must be an array."),
    ]);
  }

  commands.forEach((candidate, index) => {
    const parsed = parseAgentCommand(candidate, index);
    commandIssues.push(...parsed.issues);

    if (!parsed.command) {
      return;
    }

    try {
      nextGraph = applyParsedCommand(nextGraph, parsed.command);
    } catch (error) {
      commandIssues.push(agentIssue(
        "invalid_agent_command_payload",
        commandEntityId(index),
        "command",
        error instanceof Error ? error.message : "Agent command could not be applied.",
      ));
    }
  });

  return withGraphValidation(nextGraph, commandIssues);
};

export const buildNodeCanvasAgentSummary = (graph: NodeCanvasGraph): NodeCanvasAgentSummary => {
  const normalizedGraph = normalizeNodeCanvasGraph(graph);
  return {
    nodeCount: normalizedGraph.nodes.length,
    edgeCount: normalizedGraph.edges.length,
    selectedNodeIds: [...normalizedGraph.selection.nodeIds].sort(compareStrings),
    selectedEdgeIds: [...normalizedGraph.selection.edgeIds].sort(compareStrings),
    nodes: normalizedGraph.nodes.map(summarizeNode),
    edges: normalizedGraph.edges.map(summarizeEdge),
    validationBlockers: toAgentIssues(validateNodeCanvasGraph(normalizedGraph)),
  };
};

export const diffNodeCanvasGraphs = (
  before: NodeCanvasGraph,
  after: NodeCanvasGraph,
): NodeCanvasGraphDiff => {
  const normalizedBefore = normalizeNodeCanvasGraph(before);
  const normalizedAfter = normalizeNodeCanvasGraph(after);
  const nodes = diffEntities(normalizedBefore.nodes, normalizedAfter.nodes);
  const edges = diffEntities(normalizedBefore.edges, normalizedAfter.edges);
  const beforeValidation = issueKeys(validateNodeCanvasGraph(normalizedBefore));
  const afterValidation = issueKeys(validateNodeCanvasGraph(normalizedAfter));
  const selectionChanged = stableStringify(normalizedBefore.selection) !== stableStringify(normalizedAfter.selection);
  const changedEntities = [
    ...nodes.added.map((id) => `node:${id}`),
    ...nodes.removed.map((id) => `node:${id}`),
    ...nodes.changed.map((id) => `node:${id}`),
    ...edges.added.map((id) => `edge:${id}`),
    ...edges.removed.map((id) => `edge:${id}`),
    ...edges.changed.map((id) => `edge:${id}`),
    ...(selectionChanged ? ["selection"] : []),
  ].sort(compareStrings);

  return {
    nodes,
    edges,
    selectionChanged,
    validationBlockers: {
      before: beforeValidation,
      after: afterValidation,
      added: afterValidation.filter((key) => !beforeValidation.includes(key)),
      removed: beforeValidation.filter((key) => !afterValidation.includes(key)),
    },
    changedEntities,
  };
};

const applyParsedCommand = (
  graph: NodeCanvasGraph,
  command: NodeCanvasAgentCommand,
): NodeCanvasGraph => {
  switch (command.command) {
    case "add_node":
      return nodesCanvasReducer(graph, {
        type: "add_node",
        kind: command.kind,
        label: command.label,
        position: command.position,
        metadata: command.metadata,
      });
    case "patch_node": {
      let nextGraph = graph;
      if (command.label !== undefined) {
        nextGraph = nodesCanvasReducer(nextGraph, {
          type: "update_node_label",
          nodeId: command.nodeId,
          label: command.label,
        });
      }
      if (command.position !== undefined) {
        nextGraph = nodesCanvasReducer(nextGraph, {
          type: "move_node",
          nodeId: command.nodeId,
          position: command.position,
        });
      }
      for (const [fieldId, value] of Object.entries(command.config ?? {}).sort(([left], [right]) => left.localeCompare(right))) {
        nextGraph = nodesCanvasReducer(nextGraph, {
          type: "update_node_config",
          nodeId: command.nodeId,
          fieldId,
          value,
        });
      }
      return nextGraph;
    }
    case "connect_ports":
      return nodesCanvasReducer(graph, {
        type: "connect_ports",
        source: command.source,
        target: command.target,
        label: command.label,
      });
    case "delete_entities": {
      let nextGraph = graph;
      for (const edgeId of [...(command.edgeIds ?? [])].sort(compareStrings)) {
        nextGraph = nodesCanvasReducer(nextGraph, { type: "delete_edge", edgeId });
      }
      for (const nodeId of [...(command.nodeIds ?? [])].sort(compareStrings)) {
        nextGraph = nodesCanvasReducer(nextGraph, { type: "delete_node", nodeId });
      }
      return nextGraph;
    }
    case "select_entities": {
      let nextGraph = command.append ? graph : nodesCanvasReducer(graph, { type: "clear_selection" });
      for (const nodeId of [...(command.nodeIds ?? [])].sort(compareStrings)) {
        nextGraph = nodesCanvasReducer(nextGraph, { type: "select_node", nodeId, append: true });
      }
      for (const edgeId of [...(command.edgeIds ?? [])].sort(compareStrings)) {
        nextGraph = nodesCanvasReducer(nextGraph, { type: "select_edge", edgeId, append: true });
      }
      return nextGraph;
    }
    case "replace_graph": {
      const migration = deserializeNodeCanvasGraphWithMigration(command.serializedGraph);
      return nodesCanvasReducer(graph, { type: "replace_graph", graph: migration.graph });
    }
  }
};

const parseAgentCommand = (
  value: unknown,
  index: number,
): { command: NodeCanvasAgentCommand | null; issues: NodeCanvasAgentIssue[] } => {
  const entityId = commandEntityId(index);
  if (!isRecord(value)) {
    return {
      command: null,
      issues: [agentIssue("invalid_agent_command", entityId, "command", "Agent command must be an object.")],
    };
  }
  if (!isString(value.command)) {
    return {
      command: null,
      issues: [agentIssue("invalid_agent_command", entityId, "command", "Agent command name is required.")],
    };
  }

  switch (value.command) {
    case "add_node":
      return parseAddNodeCommand(value, entityId);
    case "patch_node":
      return parsePatchNodeCommand(value, entityId);
    case "connect_ports":
      return parseConnectPortsCommand(value, entityId);
    case "delete_entities":
      return parseDeleteEntitiesCommand(value, entityId);
    case "select_entities":
      return parseSelectEntitiesCommand(value, entityId);
    case "replace_graph":
      return parseReplaceGraphCommand(value, entityId);
    default:
      return {
        command: null,
        issues: [agentIssue("unknown_agent_command", entityId, "command", `Unknown agent command "${value.command}".`)],
      };
  }
};

const parseAddNodeCommand = (
  value: Record<string, unknown>,
  entityId: string,
): { command: NodeCanvasAgentCommand | null; issues: NodeCanvasAgentIssue[] } => {
  const issues: NodeCanvasAgentIssue[] = [];
  if (!isNodeKind(value.kind)) {
    issues.push(agentIssue("invalid_agent_command_payload", entityId, "kind", "Add node command requires a valid node kind."));
  }
  const position = parsePartialPosition(value.position, entityId, issues);
  const metadata = parseMetadata(value.metadata, entityId, issues);
  const label = optionalString(value.label, entityId, "label", issues);

  if (issues.length > 0 || !isNodeKind(value.kind)) {
    return { command: null, issues };
  }

  return {
    command: {
      command: "add_node",
      kind: value.kind,
      ...(label !== undefined ? { label } : {}),
      ...(position !== undefined ? { position } : {}),
      ...(metadata !== undefined ? { metadata } : {}),
    },
    issues,
  };
};

const parsePatchNodeCommand = (
  value: Record<string, unknown>,
  entityId: string,
): { command: NodeCanvasAgentCommand | null; issues: NodeCanvasAgentIssue[] } => {
  const issues: NodeCanvasAgentIssue[] = [];
  const nodeId = requiredString(value.nodeId, entityId, "nodeId", issues);
  const label = optionalString(value.label, entityId, "label", issues);
  const position = parseRequiredPosition(value.position, entityId, issues);
  const config = parseConfigPatch(value.config, entityId, issues);

  if (label === undefined && position === undefined && config === undefined) {
    issues.push(agentIssue("invalid_agent_command_payload", entityId, "patch_node", "Patch node command must include label, position, or config."));
  }

  if (issues.length > 0 || nodeId === null) {
    return { command: null, issues };
  }

  return {
    command: {
      command: "patch_node",
      nodeId,
      ...(label !== undefined ? { label } : {}),
      ...(position !== undefined ? { position } : {}),
      ...(config !== undefined ? { config } : {}),
    },
    issues,
  };
};

const parseConnectPortsCommand = (
  value: Record<string, unknown>,
  entityId: string,
): { command: NodeCanvasAgentCommand | null; issues: NodeCanvasAgentIssue[] } => {
  const issues: NodeCanvasAgentIssue[] = [];
  const source = parseEndpoint(value.source, entityId, "source", issues);
  const target = parseEndpoint(value.target, entityId, "target", issues);
  const label = optionalString(value.label, entityId, "label", issues);

  if (issues.length > 0 || source === null || target === null) {
    return { command: null, issues };
  }

  return {
    command: {
      command: "connect_ports",
      source,
      target,
      ...(label !== undefined ? { label } : {}),
    },
    issues,
  };
};

const parseDeleteEntitiesCommand = (
  value: Record<string, unknown>,
  entityId: string,
): { command: NodeCanvasAgentCommand | null; issues: NodeCanvasAgentIssue[] } => {
  const issues: NodeCanvasAgentIssue[] = [];
  const nodeIds = parseStringArray(value.nodeIds, entityId, "nodeIds", issues);
  const edgeIds = parseStringArray(value.edgeIds, entityId, "edgeIds", issues);

  if ((nodeIds?.length ?? 0) === 0 && (edgeIds?.length ?? 0) === 0) {
    issues.push(agentIssue("invalid_agent_command_payload", entityId, "delete_entities", "Delete entities command requires nodeIds or edgeIds."));
  }

  if (issues.length > 0) {
    return { command: null, issues };
  }

  return {
    command: {
      command: "delete_entities",
      ...(nodeIds !== undefined ? { nodeIds } : {}),
      ...(edgeIds !== undefined ? { edgeIds } : {}),
    },
    issues,
  };
};

const parseSelectEntitiesCommand = (
  value: Record<string, unknown>,
  entityId: string,
): { command: NodeCanvasAgentCommand | null; issues: NodeCanvasAgentIssue[] } => {
  const issues: NodeCanvasAgentIssue[] = [];
  const nodeIds = parseStringArray(value.nodeIds, entityId, "nodeIds", issues);
  const edgeIds = parseStringArray(value.edgeIds, entityId, "edgeIds", issues);
  const append = optionalBoolean(value.append, entityId, "append", issues);

  if (issues.length > 0) {
    return { command: null, issues };
  }

  return {
    command: {
      command: "select_entities",
      ...(nodeIds !== undefined ? { nodeIds } : {}),
      ...(edgeIds !== undefined ? { edgeIds } : {}),
      ...(append !== undefined ? { append } : {}),
    },
    issues,
  };
};

const parseReplaceGraphCommand = (
  value: Record<string, unknown>,
  entityId: string,
): { command: NodeCanvasAgentCommand | null; issues: NodeCanvasAgentIssue[] } => {
  const issues: NodeCanvasAgentIssue[] = [];
  const serializedGraph = requiredString(value.serializedGraph, entityId, "serializedGraph", issues);

  if (serializedGraph !== null) {
    try {
      const parsed = JSON.parse(serializedGraph) as unknown;
      if (!isRecord(parsed) || !Array.isArray(parsed.nodes) || parsed.nodes.length === 0) {
        issues.push(agentIssue("invalid_agent_command_payload", entityId, "serializedGraph", "Serialized graph must contain nodes."));
      }
    } catch {
      issues.push(agentIssue("invalid_agent_command_payload", entityId, "serializedGraph", "Serialized graph must be valid JSON."));
    }
  }

  if (issues.length > 0 || serializedGraph === null) {
    return { command: null, issues };
  }

  return { command: { command: "replace_graph", serializedGraph }, issues };
};

const summarizeNode = (node: NodeCanvasNode): NodeCanvasAgentSummaryNode => ({
  id: node.id,
  kind: node.kind,
  label: node.label,
  position: node.position,
  inputPorts: node.inputPorts.map((port) => `${port.id}:${port.type}`).sort(compareStrings),
  outputPorts: node.outputPorts.map((port) => `${port.id}:${port.type}`).sort(compareStrings),
  config: node.config
    .map((field) => ({ id: field.id, value: field.value }))
    .sort((left, right) => left.id.localeCompare(right.id)),
});

const summarizeEdge = (edge: NodeCanvasEdge): NodeCanvasAgentSummaryEdge => ({
  id: edge.id,
  source: `${edge.source.nodeId}.${edge.source.portId}`,
  target: `${edge.target.nodeId}.${edge.target.portId}`,
  ...(edge.label ? { label: edge.label } : {}),
});

const diffEntities = <TEntity extends { id: string }>(
  before: readonly TEntity[],
  after: readonly TEntity[],
): NodeCanvasGraphEntityDiff => {
  const beforeSnapshots = entitySnapshots(before);
  const afterSnapshots = entitySnapshots(after);
  const beforeIds = [...beforeSnapshots.keys()].sort(compareStrings);
  const afterIds = [...afterSnapshots.keys()].sort(compareStrings);
  return {
    added: afterIds.filter((id) => !beforeSnapshots.has(id)),
    removed: beforeIds.filter((id) => !afterSnapshots.has(id)),
    changed: afterIds.filter((id) => {
      const beforeValue = beforeSnapshots.get(id);
      const afterValue = afterSnapshots.get(id);
      return beforeValue !== undefined && afterValue !== undefined && stableStringify(beforeValue) !== stableStringify(afterValue);
    }),
  };
};

const entitySnapshots = <TEntity extends { id: string }>(
  entities: readonly TEntity[],
): Map<string, string[]> => {
  const snapshots = new Map<string, string[]>();
  for (const entity of entities) {
    snapshots.set(entity.id, [...(snapshots.get(entity.id) ?? []), stableStringify(entity)]);
  }
  for (const [id, values] of snapshots.entries()) {
    snapshots.set(id, values.sort(compareStrings));
  }
  return snapshots;
};

const withGraphValidation = (
  graph: NodeCanvasGraph,
  commandIssues: readonly NodeCanvasAgentIssue[],
): NodeCanvasAgentCommandResult => ({
  graph,
  issues: [...commandIssues, ...toAgentIssues(validateNodeCanvasGraph(graph))].sort(compareIssues),
});

const toAgentIssues = (issues: readonly NodeCanvasValidationIssue[]): NodeCanvasAgentIssue[] => (
  issues.map((issue) => ({ ...issue }))
);

const issueKeys = (issues: readonly NodeCanvasValidationIssue[]): string[] => (
  issues.map((issue) => `${issue.code}:${issue.entityId}:${issue.field}`).sort(compareStrings)
);

const agentIssue = (
  code: NodeCanvasAgentIssueCode,
  entityId: string,
  field: string,
  message: string,
): NodeCanvasAgentIssue => ({ code, entityId, field, message });

const commandEntityId = (index: number): string => `command[${index}]`;

const parseEndpoint = (
  value: unknown,
  entityId: string,
  field: string,
  issues: NodeCanvasAgentIssue[],
): NodeCanvasEdgeEndpoint | null => {
  if (!isRecord(value)) {
    issues.push(agentIssue("invalid_agent_command_payload", entityId, field, `${field} endpoint must be an object.`));
    return null;
  }
  const nodeId = requiredString(value.nodeId, entityId, `${field}.nodeId`, issues);
  const portId = requiredString(value.portId, entityId, `${field}.portId`, issues);
  if (nodeId === null || portId === null) {
    return null;
  }
  return { nodeId, portId };
};

const parseRequiredPosition = (
  value: unknown,
  entityId: string,
  issues: NodeCanvasAgentIssue[],
): NodeCanvasPosition | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value) || !isFiniteNumber(value.x) || !isFiniteNumber(value.y)) {
    issues.push(agentIssue("invalid_agent_command_payload", entityId, "position", "Position must include finite x and y numbers."));
    return undefined;
  }
  return { x: value.x, y: value.y };
};

const parsePartialPosition = (
  value: unknown,
  entityId: string,
  issues: NodeCanvasAgentIssue[],
): Partial<NodeCanvasPosition> | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    issues.push(agentIssue("invalid_agent_command_payload", entityId, "position", "Position must be an object."));
    return undefined;
  }
  const position: Partial<NodeCanvasPosition> = {};
  if (value.x !== undefined) {
    if (!isFiniteNumber(value.x)) {
      issues.push(agentIssue("invalid_agent_command_payload", entityId, "position.x", "Position x must be a finite number."));
    } else {
      position.x = value.x;
    }
  }
  if (value.y !== undefined) {
    if (!isFiniteNumber(value.y)) {
      issues.push(agentIssue("invalid_agent_command_payload", entityId, "position.y", "Position y must be a finite number."));
    } else {
      position.y = value.y;
    }
  }
  return Object.keys(position).length > 0 ? position : undefined;
};

const parseMetadata = (
  value: unknown,
  entityId: string,
  issues: NodeCanvasAgentIssue[],
): NodeCanvasNodeMetadata | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    issues.push(agentIssue("invalid_agent_command_payload", entityId, "metadata", "Metadata must be an object."));
    return undefined;
  }
  const metadata: NodeCanvasNodeMetadata = {};
  if (value.agentIntent !== undefined) {
    if (isString(value.agentIntent)) {
      metadata.agentIntent = value.agentIntent as NodeCanvasAgentIntent;
    } else {
      issues.push(agentIssue("invalid_agent_command_payload", entityId, "metadata.agentIntent", "Agent intent must be a string."));
    }
  }
  if (value.taskIntent !== undefined) {
    if (isString(value.taskIntent)) {
      metadata.taskIntent = value.taskIntent as NodeCanvasTaskIntent;
    } else {
      issues.push(agentIssue("invalid_agent_command_payload", entityId, "metadata.taskIntent", "Task intent must be a string."));
    }
  }
  return Object.keys(metadata).length > 0 ? metadata : undefined;
};

const parseConfigPatch = (
  value: unknown,
  entityId: string,
  issues: NodeCanvasAgentIssue[],
): Record<string, NodeCanvasConfigValue> | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    issues.push(agentIssue("invalid_agent_command_payload", entityId, "config", "Config patch must be an object."));
    return undefined;
  }
  const config: Record<string, NodeCanvasConfigValue> = {};
  for (const [fieldId, fieldValue] of Object.entries(value)) {
    const parsedValue = parseConfigValue(fieldValue);
    if (parsedValue === undefined) {
      issues.push(agentIssue("invalid_agent_command_payload", entityId, `config.${fieldId}`, "Config values must be string, number, boolean, or null."));
    } else {
      config[fieldId] = parsedValue;
    }
  }
  return config;
};

const parseConfigValue = (value: unknown): NodeCanvasConfigValue | undefined => {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (isFiniteNumber(value)) {
    return value;
  }
  return undefined;
};

const parseStringArray = (
  value: unknown,
  entityId: string,
  field: string,
  issues: NodeCanvasAgentIssue[],
): string[] | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || value.some((entry) => !isString(entry))) {
    issues.push(agentIssue("invalid_agent_command_payload", entityId, field, `${field} must be an array of strings.`));
    return undefined;
  }
  return uniqueStrings(value).sort(compareStrings);
};

const requiredString = (
  value: unknown,
  entityId: string,
  field: string,
  issues: NodeCanvasAgentIssue[],
): string | null => {
  if (!isString(value)) {
    issues.push(agentIssue("invalid_agent_command_payload", entityId, field, `${field} must be a string.`));
    return null;
  }
  return value;
};

const optionalString = (
  value: unknown,
  entityId: string,
  field: string,
  issues: NodeCanvasAgentIssue[],
): string | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (!isString(value)) {
    issues.push(agentIssue("invalid_agent_command_payload", entityId, field, `${field} must be a string.`));
    return undefined;
  }
  return value;
};

const optionalBoolean = (
  value: unknown,
  entityId: string,
  field: string,
  issues: NodeCanvasAgentIssue[],
): boolean | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    issues.push(agentIssue("invalid_agent_command_payload", entityId, field, `${field} must be a boolean.`));
    return undefined;
  }
  return value;
};

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

const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

const isNodeKind = (value: unknown): value is NodeCanvasNodeKind => (
  isString(value) && NODE_KINDS.includes(value as NodeCanvasNodeKind)
);

const compareStrings = (left: string, right: string): number => left.localeCompare(right);

const compareIssues = (left: NodeCanvasAgentIssue, right: NodeCanvasAgentIssue): number => (
  left.code.localeCompare(right.code)
  || left.entityId.localeCompare(right.entityId)
  || left.field.localeCompare(right.field)
);

type StableJsonValue = string | number | boolean | null | StableJsonValue[] | { [key: string]: StableJsonValue };

const stableStringify = (value: unknown): string => JSON.stringify(toStableJson(value));

const toStableJson = (value: unknown): StableJsonValue => {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(toStableJson);
  }
  if (isRecord(value)) {
    return Object.keys(value).sort(compareStrings).reduce<{ [key: string]: StableJsonValue }>((acc, key) => {
      acc[key] = toStableJson(value[key]);
      return acc;
    }, {});
  }
  return null;
};
