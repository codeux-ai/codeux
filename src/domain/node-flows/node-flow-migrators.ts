import {
  NODE_FLOW_SCHEMA_VERSION,
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

const cloneJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export function migrateNodeFlowGraph(graph: unknown): NodeFlowMigrationResult<NodeFlowGraph> {
  if (isRecord(graph) && graph.schemaVersion === NODE_FLOW_SCHEMA_VERSION) {
    return { graph: cloneJson(graph as unknown as NodeFlowGraph), migrated: false, legacySnapshot: null };
  }

  const legacy = isRecord(graph) ? cloneJson(graph as unknown as NodeFlowGraph) : { nodes: [], edges: [] };
  const nodes = Array.isArray(legacy.nodes) ? legacy.nodes.map(migrateNode) : [];
  const definitionByNode = new Map(nodes.map((node) => [node.id, resolveLatestNodeDefinition(node.type)]));
  const edges = Array.isArray(legacy.edges) ? legacy.edges.map((edge) => ({
    ...edge,
    ...(edge.fromHandle ? {} : { fromHandle: definitionByNode.get(edge.fromNodeId)?.ports.find((port) => port.direction === "output")?.id }),
    ...(edge.toHandle ? {} : { toHandle: definitionByNode.get(edge.toNodeId)?.ports.find((port) => port.direction === "input")?.id }),
  })) : [];

  return {
    migrated: true,
    legacySnapshot: legacy,
    graph: {
      schemaVersion: NODE_FLOW_SCHEMA_VERSION,
      nodes,
      edges,
      ...(legacy.inputSchema ? { inputSchema: legacy.inputSchema } : {}),
      ...(legacy.schemas ? { schemas: legacy.schemas } : {}),
      ...(legacy.metadata ? { metadata: legacy.metadata } : {}),
      ...(legacy.publication ? { publication: legacy.publication } : {}),
    },
  };
}

function migrateNode(node: NodeFlowNode): NodeFlowNode {
  const definition = node.definition
    ? resolveLatestNodeDefinition(node.definition.type)
    : resolveLatestNodeDefinition(node.type);
  return {
    ...node,
    definition: node.definition ?? { type: node.type, version: definition?.version ?? 1 },
    ports: node.ports ?? definition?.ports.map((port) => cloneJson(port)) ?? [],
    credentialBindings: node.credentialBindings ?? [],
    policy: node.policy ?? (definition ? cloneJson(definition.defaultPolicy) : {}),
    capabilities: node.capabilities ?? [...(definition?.capabilities ?? [])],
    sideEffect: node.sideEffect ?? definition?.sideEffect ?? "none",
    disabled: node.disabled ?? false,
  };
}

export function migrateNodeCanvasGraphV1(graph: unknown): NodeFlowMigrationResult<unknown> {
  if (isRecord(graph) && graph.schemaVersion === NODE_FLOW_SCHEMA_VERSION && Array.isArray(graph.nodes) && graph.nodes.every(isCanonicalNode)) {
    return migrateNodeFlowGraph(graph);
  }
  const legacySnapshot = cloneJson(graph);
  const legacy = isRecord(graph) ? graph : {};
  const nodes = Array.isArray(legacy.nodes) ? legacy.nodes.filter(isRecord).map((node): NodeFlowNode => ({
    id: stringValue(node.id),
    type: stringValue(node.kind) || stringValue(node.type),
    title: stringValue(node.label) || stringValue(node.title) || stringValue(node.id),
    description: stringValue(node.description) || undefined,
    position: isPosition(node.position) ? { x: node.position.x, y: node.position.y } : undefined,
    definition: { type: stringValue(node.kind) || stringValue(node.type), version: 1 },
    ports: [...readPorts(node.inputPorts, "input"), ...readPorts(node.outputPorts, "output")],
    data: canvasNodeData(node),
    credentialBindings: [], policy: {}, capabilities: [], sideEffect: "none", disabled: false,
  })).filter((node) => node.id && node.type) : [];
  const edges = Array.isArray(legacy.edges) ? legacy.edges.filter(isRecord).map((edge) => ({
    id: stringValue(edge.id) || undefined,
    fromNodeId: endpointValue(edge.source, "nodeId"),
    toNodeId: endpointValue(edge.target, "nodeId"),
    fromHandle: endpointValue(edge.source, "portId") || undefined,
    toHandle: endpointValue(edge.target, "portId") || undefined,
  })).filter((edge) => edge.fromNodeId && edge.toNodeId) : [];
  return {
    migrated: true,
    legacySnapshot,
    graph: { schemaVersion: NODE_FLOW_SCHEMA_VERSION, nodes, edges, metadata: { canvasSelection: jsonValue(legacy.selection) } },
  };
}

function readPorts(value: unknown, direction: "input" | "output") {
  return Array.isArray(value) ? value.filter(isRecord).map((port) => ({
    id: stringValue(port.id), direction, schema: { type: "any" as const }, required: port.required === true,
  })).filter((port) => port.id) : [];
}

function canvasNodeData(node: Record<string, unknown>): NodeFlowJsonObject {
  const config = Array.isArray(node.config) ? Object.fromEntries(node.config.filter(isRecord).map((entry) => [stringValue(entry.id), jsonValue(entry.value)]).filter(([id]) => id)) : {};
  return { config, canvasMetadata: jsonValue(node.metadata) };
}

const jsonValue = (value: unknown): NodeFlowJsonValue => JSON.parse(JSON.stringify(value ?? null)) as NodeFlowJsonValue;
const endpointValue = (value: unknown, key: string): string => isRecord(value) ? stringValue(value[key]) : "";
const stringValue = (value: unknown): string => typeof value === "string" ? value : "";
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const isPosition = (value: unknown): value is { x: number; y: number } => isRecord(value) && Number.isFinite(value.x) && Number.isFinite(value.y);
const isCanonicalNode = (value: unknown): boolean => isRecord(value) && isRecord(value.definition);
