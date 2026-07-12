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

function cloneUntrusted<T>(value: T, seen = new WeakMap<object, unknown>()): T {
  if (!value || typeof value !== "object") return value;
  const cached = seen.get(value);
  if (cached !== undefined) return cached as T;
  if (Array.isArray(value)) {
    const clone: unknown[] = [];
    seen.set(value, clone);
    value.forEach((entry) => clone.push(cloneUntrusted(entry, seen)));
    return clone as T;
  }
  const clone: Record<string, unknown> = {};
  seen.set(value, clone);
  Object.entries(value).forEach(([key, entry]) => {
    clone[key] = cloneUntrusted(entry, seen);
  });
  return clone as T;
}

export function migrateNodeFlowGraph(graph: unknown): NodeFlowMigrationResult<NodeFlowGraph> {
  if (isRecord(graph) && graph.schemaVersion === NODE_FLOW_SCHEMA_VERSION) {
    return { graph: cloneUntrusted(graph) as unknown as NodeFlowGraph, migrated: false, legacySnapshot: null };
  }

  const legacy = isRecord(graph) ? cloneUntrusted(graph) : {};
  const nodes = Array.isArray(legacy.nodes)
    ? legacy.nodes.map((node) => isRecord(node) ? migrateNode(node) : node)
    : legacy.nodes;
  const definitionByNode = new Map(
    (Array.isArray(nodes) ? nodes : [])
      .filter(isRecord)
      .map((node) => [stringValue(node.id), resolveLatestNodeDefinition(stringValue(node.type))]),
  );
  const edges = Array.isArray(legacy.edges) ? legacy.edges.map((edge) => {
    if (!isRecord(edge)) return edge;
    const fromNodeId = stringValue(edge.fromNodeId);
    const toNodeId = stringValue(edge.toNodeId);
    return {
      ...edge,
      ...(edge.fromHandle ? {} : { fromHandle: definitionByNode.get(fromNodeId)?.ports.find((port) => port.direction === "output")?.id }),
      ...(edge.toHandle ? {} : { toHandle: definitionByNode.get(toNodeId)?.ports.find((port) => port.direction === "input")?.id }),
    };
  }) : legacy.edges;

  return {
    migrated: true,
    legacySnapshot: legacy as unknown as NodeFlowGraph,
    graph: {
      schemaVersion: NODE_FLOW_SCHEMA_VERSION,
      nodes,
      edges,
      ...(legacy.inputSchema !== undefined ? { inputSchema: legacy.inputSchema } : {}),
      ...(legacy.schemas !== undefined ? { schemas: legacy.schemas } : {}),
      ...(legacy.metadata !== undefined ? { metadata: legacy.metadata } : {}),
      ...(legacy.publication !== undefined ? { publication: legacy.publication } : {}),
    } as unknown as NodeFlowGraph,
  };
}

function migrateNode(node: Record<string, unknown>): NodeFlowNode {
  const definition = isRecord(node.definition)
    ? resolveLatestNodeDefinition(stringValue(node.definition.type))
    : resolveLatestNodeDefinition(stringValue(node.type));
  return {
    ...node as unknown as NodeFlowNode,
    definition: node.definition !== undefined
      ? node.definition as NodeFlowNode["definition"]
      : { type: stringValue(node.type), version: definition?.version ?? 1 },
    ports: node.ports !== undefined
      ? node.ports as NodeFlowNode["ports"]
      : definition?.ports.map((port) => cloneUntrusted(port)) ?? [],
    credentialBindings: node.credentialBindings !== undefined ? node.credentialBindings : [],
    policy: node.policy !== undefined
      ? node.policy as NodeFlowNode["policy"]
      : definition ? cloneUntrusted(definition.defaultPolicy) : {},
    capabilities: node.capabilities !== undefined ? node.capabilities : [...(definition?.capabilities ?? [])],
    sideEffect: node.sideEffect !== undefined ? node.sideEffect : definition?.sideEffect ?? "none",
    disabled: node.disabled !== undefined ? node.disabled : false,
  } as NodeFlowNode;
}

export function migrateNodeCanvasGraphV1(graph: unknown): NodeFlowMigrationResult<unknown> {
  if (isRecord(graph) && graph.schemaVersion === NODE_FLOW_SCHEMA_VERSION && Array.isArray(graph.nodes) && graph.nodes.every(isCanonicalNode)) {
    return migrateNodeFlowGraph(graph);
  }
  const legacySnapshot = cloneUntrusted(graph);
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
    graph: { schemaVersion: NODE_FLOW_SCHEMA_VERSION, nodes, edges, metadata: { canvasSelection: untrustedJsonValue(legacy.selection) } },
  };
}

function readPorts(value: unknown, direction: "input" | "output") {
  return Array.isArray(value) ? value.filter(isRecord).map((port) => ({
    id: stringValue(port.id), direction, schema: { type: "any" as const }, required: port.required === true,
  })).filter((port) => port.id) : [];
}

function canvasNodeData(node: Record<string, unknown>): NodeFlowJsonObject {
  const config = Array.isArray(node.config) ? Object.fromEntries(node.config.filter(isRecord).map((entry) => [stringValue(entry.id), untrustedJsonValue(entry.value)]).filter(([id]) => id)) : {};
  return { config, canvasMetadata: untrustedJsonValue(node.metadata) };
}

const untrustedJsonValue = (value: unknown): NodeFlowJsonValue => cloneUntrusted(value ?? null) as NodeFlowJsonValue;
const endpointValue = (value: unknown, key: string): string => isRecord(value) ? stringValue(value[key]) : "";
const stringValue = (value: unknown): string => typeof value === "string" ? value : "";
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const isPosition = (value: unknown): value is { x: number; y: number } => isRecord(value) && Number.isFinite(value.x) && Number.isFinite(value.y);
const isCanonicalNode = (value: unknown): boolean => isRecord(value) && isRecord(value.definition);
