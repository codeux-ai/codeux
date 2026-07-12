import {
  NODE_FLOW_SCHEMA_VERSION,
  type NodeFlowEdge,
  type NodeFlowGraph,
  type NodeFlowJsonObject,
  type NodeFlowJsonValue,
  type NodeFlowNode,
} from "../../contracts/node-flow-types.js";
import { resolveLatestNodeDefinition } from "./node-definition-registry.js";

export interface NodeFlowMigrationResult<TLegacy = unknown> {
  graph: NodeFlowGraph;
  migrated: boolean;
  legacySnapshot: TLegacy | null;
}

interface LegacyCanvasDefinition {
  type: string;
  handles: Readonly<Record<string, string>>;
}

const LEGACY_CANVAS_DEFINITIONS: Readonly<Record<string, LegacyCanvasDefinition>> = {
  trigger: { type: "input", handles: { event: "output" } },
  agent: { type: "set_fields", handles: { in: "input", agent: "output" } },
  task: { type: "template", handles: { agent: "input", task: "output" } },
  condition: { type: "condition", handles: { task: "input", pass: "true", fail: "false" } },
  output: { type: "output", handles: { result: "input" } },
};

const cloneValue = <T>(value: T): T => {
  try {
    return structuredClone(value);
  } catch {
    return value;
  }
};

export function migrateNodeFlowGraph(graph: unknown): NodeFlowMigrationResult<NodeFlowGraph> {
  if (isRecord(graph) && graph.schemaVersion === NODE_FLOW_SCHEMA_VERSION) {
    return { graph: cloneValue(graph) as unknown as NodeFlowGraph, migrated: false, legacySnapshot: null };
  }

  const legacy = isRecord(graph) ? cloneValue(graph) : { nodes: [], edges: [] };
  const rawNodes = Array.isArray(legacy.nodes) ? legacy.nodes : [];
  const nodes = rawNodes.map((node) => isRecord(node) ? migrateNode(node) : node as NodeFlowNode);
  const definitionByNode = new Map(nodes.filter(isNodeWithId).map((node) => [node.id, resolveLatestNodeDefinition(node.type)]));
  const rawEdges = Array.isArray(legacy.edges) ? legacy.edges : [];
  const edges = rawEdges.map((edge) => {
    if (!isRecord(edge)) return edge as NodeFlowEdge;
    const fromNodeId = stringValue(edge.fromNodeId);
    const toNodeId = stringValue(edge.toNodeId);
    return {
      ...edge,
      ...(trimmedString(edge.fromHandle) ? {} : { fromHandle: definitionByNode.get(fromNodeId)?.ports.find((port) => port.direction === "output")?.id }),
      ...(trimmedString(edge.toHandle) ? {} : { toHandle: definitionByNode.get(toNodeId)?.ports.find((port) => port.direction === "input")?.id }),
    } as NodeFlowEdge;
  });

  return {
    migrated: true,
    legacySnapshot: legacy as unknown as NodeFlowGraph,
    graph: {
      schemaVersion: NODE_FLOW_SCHEMA_VERSION,
      nodes,
      edges,
      ...(legacy.inputSchema !== undefined ? { inputSchema: legacy.inputSchema as NodeFlowGraph["inputSchema"] } : {}),
      ...(legacy.schemas !== undefined ? { schemas: legacy.schemas as NodeFlowGraph["schemas"] } : {}),
      ...(legacy.metadata !== undefined ? { metadata: legacy.metadata as NodeFlowGraph["metadata"] } : {}),
      ...(legacy.publication !== undefined ? { publication: legacy.publication as NodeFlowGraph["publication"] } : {}),
    },
  };
}

function migrateNode(node: Record<string, unknown>): NodeFlowNode {
  const type = stringValue(node.type);
  const definitionRef = isRecord(node.definition) ? node.definition : null;
  const definitionType = stringValue(definitionRef?.type) || type;
  const definition = resolveLatestNodeDefinition(definitionType);
  const ports = node.ports === undefined ? definition?.ports.map((port) => cloneValue(port)) ?? [] : node.ports;
  return {
    ...node,
    definition: node.definition === undefined ? { type, version: definition?.version ?? 1 } : node.definition,
    ports,
    credentialBindings: node.credentialBindings === undefined ? [] : node.credentialBindings,
    policy: node.policy === undefined ? definition ? cloneValue(definition.defaultPolicy) : {} : node.policy,
    capabilities: node.capabilities === undefined ? [...(definition?.capabilities ?? [])] : node.capabilities,
    sideEffect: node.sideEffect ?? definition?.sideEffect ?? "none",
    disabled: node.disabled ?? false,
  } as unknown as NodeFlowNode;
}

export function migrateNodeCanvasGraphV1(graph: unknown): NodeFlowMigrationResult<unknown> {
  if (isRecord(graph) && graph.schemaVersion === NODE_FLOW_SCHEMA_VERSION && Array.isArray(graph.nodes) && graph.nodes.every(isCanonicalNode)) {
    return migrateNodeFlowGraph(graph);
  }
  const legacySnapshot = cloneValue(graph);
  const legacy = isRecord(graph) ? graph : {};
  const nodeDefinitions = new Map<string, LegacyCanvasDefinition>();
  const nodes = Array.isArray(legacy.nodes) ? legacy.nodes.filter(isRecord).map((node): NodeFlowNode | null => {
    const id = stringValue(node.id);
    const legacyType = stringValue(node.kind) || stringValue(node.type);
    const mapping = LEGACY_CANVAS_DEFINITIONS[legacyType];
    if (!id || !mapping) return null;
    nodeDefinitions.set(id, mapping);
    return migrateNode({
      id,
      type: mapping.type,
      title: stringValue(node.label) || stringValue(node.title) || id,
      description: stringValue(node.description) || undefined,
      position: isPosition(node.position) ? { x: node.position.x, y: node.position.y } : undefined,
      data: canvasNodeData(node, legacyType),
      disabled: false,
    });
  }).filter((node): node is NodeFlowNode => node !== null) : [];
  const edges = Array.isArray(legacy.edges) ? legacy.edges.filter(isRecord).map((edge) => {
    const fromNodeId = endpointValue(edge.source, "nodeId");
    const toNodeId = endpointValue(edge.target, "nodeId");
    const sourceMapping = nodeDefinitions.get(fromNodeId);
    const targetMapping = nodeDefinitions.get(toNodeId);
    return {
      id: stringValue(edge.id) || undefined,
      fromNodeId,
      toNodeId,
      fromHandle: sourceMapping?.handles[endpointValue(edge.source, "portId")],
      toHandle: targetMapping?.handles[endpointValue(edge.target, "portId")],
    };
  }).filter((edge) => edge.fromNodeId && edge.toNodeId) : [];
  return {
    migrated: true,
    legacySnapshot,
    graph: {
      schemaVersion: NODE_FLOW_SCHEMA_VERSION,
      nodes,
      edges,
      metadata: {
        canvasSelection: jsonValue(legacy.selection),
        migration: { source: "browser_canvas_v1", legacySnapshot: jsonValue(legacySnapshot) },
      },
    },
  };
}

function canvasNodeData(node: Record<string, unknown>, legacyType: string): NodeFlowJsonObject {
  const configEntries = Array.isArray(node.config) ? node.config.filter(isRecord) : [];
  const config = Object.fromEntries(configEntries.map((entry) => [stringValue(entry.id), jsonValue(entry.value)]).filter(([id]) => id));
  const prompt = typeof config.prompt === "string" && config.prompt.trim() ? config.prompt : "Use the selected agent to complete the task.";
  return {
    ...(legacyType === "agent" ? { fields: { legacyAgent: cloneValue(config) } } : {}),
    ...(legacyType === "task" ? { template: prompt, outputKey: "task" } : {}),
    canvas: { kind: legacyType, config: jsonValue(node.config), values: config, metadata: jsonValue(node.metadata) },
  };
}

const jsonValue = (value: unknown): NodeFlowJsonValue => cloneValue(value ?? null) as NodeFlowJsonValue;
const endpointValue = (value: unknown, key: string): string => isRecord(value) ? stringValue(value[key]) : "";
const stringValue = (value: unknown): string => typeof value === "string" ? value : "";
const trimmedString = (value: unknown): string => stringValue(value).trim();
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const isPosition = (value: unknown): value is { x: number; y: number } => isRecord(value) && Number.isFinite(value.x) && Number.isFinite(value.y);
const isCanonicalNode = (value: unknown): boolean => isRecord(value) && isRecord(value.definition);
const isNodeWithId = (value: NodeFlowNode): value is NodeFlowNode & { id: string; type: string } => isRecord(value) && typeof value.id === "string" && typeof value.type === "string";
