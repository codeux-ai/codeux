import type {
  NodeFlowGraph,
  NodeFlowJsonObject,
  NodeFlowJsonValue,
  NodeFlowNode,
  NodeFlowRecord,
  NodeFlowRunRecord,
  NodeFlowValidationResponse,
  NodeWidgetField,
  NodeWidgetSchema,
} from "../types.js";
import type { DashboardLocale } from "../i18n/locales.js";
import {
  translateNodesMessage,
  translateNodesPlural,
  translateNodesStatus,
} from "../i18n/messages/nodes.js";

export const NODE_FLOW_NODE_WIDTH = 220;
export const NODE_FLOW_NODE_HEIGHT = 116;
export const NODE_FLOW_GRID_X = 300;
export const NODE_FLOW_GRID_Y = 168;

export interface NodeFlowCanvasNode extends NodeFlowNode {
  position: { x: number; y: number };
}

export interface NodeFlowCanvasGraph extends Omit<NodeFlowGraph, "nodes"> {
  nodes: NodeFlowCanvasNode[];
}

export interface NodeFlowSummary {
  id: string;
  title: string;
  description: string;
  nodeCount: number;
  edgeCount: number;
  versionLabel: string;
  updatedLabel: string;
}

export interface ValidationBadgeViewModel {
  tone: "neutral" | "success" | "warning" | "danger";
  label: string;
  title: string;
}

export const createDefaultNodeFlowGraph = (): NodeFlowGraph => ({
  nodes: [
    {
      id: "trigger",
      type: "input",
      title: "Run Input",
      description: "Receives dashboard input.",
      position: { x: 56, y: 96 },
      widgetSchema: {
        fields: [
          {
            id: "label",
            type: "text",
            label: "Run label",
            defaultValue: "Manual run",
          },
        ],
      },
      data: { label: "Manual run" },
    },
  ],
  edges: [],
  inputSchema: {
    fields: [
      {
        id: "payload",
        type: "json",
        label: "Payload",
        defaultValue: {},
      },
    ],
  },
});

export const layoutNodeFlowGraph = (graph: NodeFlowGraph): NodeFlowCanvasGraph => {
  const incomingCounts = new Map(graph.nodes.map((node) => [node.id, 0]));
  graph.edges.forEach((edge) => {
    incomingCounts.set(edge.toNodeId, (incomingCounts.get(edge.toNodeId) ?? 0) + 1);
  });

  const placed = new Map<string, { x: number; y: number }>();
  const depthByNode = new Map<string, number>();
  const visit = (nodeId: string, seen = new Set<string>()): number => {
    if (depthByNode.has(nodeId)) {
      return depthByNode.get(nodeId)!;
    }
    if (seen.has(nodeId)) {
      return 0;
    }
    const upstream = graph.edges.filter((edge) => edge.toNodeId === nodeId).map((edge) => edge.fromNodeId);
    const depth = upstream.length === 0 ? 0 : 1 + Math.max(...upstream.map((upstreamId) => visit(upstreamId, new Set([...seen, nodeId]))));
    depthByNode.set(nodeId, depth);
    return depth;
  };

  const columnCounts = new Map<number, number>();
  const nodes = graph.nodes.map((node, index): NodeFlowCanvasNode => {
    if (node.position) {
      placed.set(node.id, node.position);
      return { ...node, position: node.position };
    }
    const depth = visit(node.id);
    const row = columnCounts.get(depth) ?? 0;
    columnCounts.set(depth, row + 1);
    const position = {
      x: 56 + depth * NODE_FLOW_GRID_X,
      y: 64 + row * NODE_FLOW_GRID_Y + (incomingCounts.get(node.id) === 0 && index > 0 ? 48 : 0),
    };
    placed.set(node.id, position);
    return { ...node, position };
  });

  return {
    ...graph,
    nodes,
  };
};

export const summarizeNodeFlow = (
  flow: NodeFlowRecord,
  locale: DashboardLocale = "en",
): NodeFlowSummary => ({
  id: flow.id,
  title: flow.title,
  description: flow.description || `${translateNodesPlural(locale, "nodeCount", flow.graph.nodes.length)}, ${translateNodesPlural(locale, "edgeCount", flow.graph.edges.length)}`,
  nodeCount: flow.graph.nodes.length,
  edgeCount: flow.graph.edges.length,
  versionLabel: `v${flow.version}`,
  updatedLabel: formatRelativeDate(flow.updatedAt, locale),
});

export const getValidationBadgeState = (
  validation: NodeFlowValidationResponse | null,
  dirty: boolean,
  locale: DashboardLocale = "en",
): ValidationBadgeViewModel => {
  if (dirty) {
    return { tone: "warning", label: translateNodesMessage(locale, "unsaved"), title: translateNodesMessage(locale, "unsavedTitle") };
  }
  if (!validation) {
    return { tone: "neutral", label: translateNodesMessage(locale, "unvalidated"), title: translateNodesMessage(locale, "unvalidatedTitle") };
  }
  if (validation.valid) {
    return { tone: "success", label: translateNodesMessage(locale, "valid"), title: translateNodesMessage(locale, "validTitle") };
  }
  return {
    tone: "danger",
    label: translateNodesPlural(locale, "issueCount", validation.errors.length),
    title: validation.errors[0]?.message ?? translateNodesMessage(locale, "validationFallback"),
  };
};

export const getWidgetFieldDefaultValue = (field: NodeWidgetField): NodeFlowJsonValue => {
  if (field.defaultValue !== undefined) {
    return field.defaultValue;
  }
  if (field.type === "number") {
    return field.min ?? 0;
  }
  if (field.type === "boolean") {
    return false;
  }
  if (field.type === "select") {
    return field.options?.[0]?.value ?? "";
  }
  if (field.type === "json") {
    return {};
  }
  if (field.type === "keyValue") {
    return {};
  }
  return "";
};

export const applyWidgetDefaults = (
  schema: NodeWidgetSchema | undefined,
  values: NodeFlowJsonObject | undefined | null,
): NodeFlowJsonObject => {
  const next: NodeFlowJsonObject = { ...(values ?? {}) };
  for (const field of schema?.fields ?? []) {
    if (next[field.id] === undefined) {
      next[field.id] = getWidgetFieldDefaultValue(field);
    }
  }
  return next;
};

export const updateNodeInGraph = (
  graph: NodeFlowGraph,
  nodeId: string,
  update: Partial<NodeFlowNode>,
): NodeFlowGraph => ({
  ...graph,
  nodes: graph.nodes.map((node) => node.id === nodeId ? { ...node, ...update } : node),
});

export const isNodeFlowDirty = (
  original: NodeFlowRecord | null,
  draftTitle: string,
  draftDescription: string,
  draftGraph: NodeFlowGraph,
): boolean => {
  if (!original) {
    return true;
  }
  return original.title !== draftTitle
    || original.description !== draftDescription
    || stableStringify(original.graph) !== stableStringify(draftGraph);
};

export const buildValidationMessagesByField = (
  validation: NodeFlowValidationResponse | null,
): Map<string, string[]> => {
  const messages = new Map<string, string[]>();
  for (const error of validation?.errors ?? []) {
    const existing = messages.get(error.field) ?? [];
    existing.push(error.message);
    messages.set(error.field, existing);
  }
  return messages;
};

export const redactNodeFlowSecrets = (value: NodeFlowJsonValue): NodeFlowJsonValue => {
  if (Array.isArray(value)) {
    return value.map(redactNodeFlowSecrets);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const next: NodeFlowJsonObject = {};
  for (const [key, entry] of Object.entries(value)) {
    next[key] = /secret|token|password|api[_-]?key/i.test(key) ? "[redacted]" : redactNodeFlowSecrets(entry);
  }
  return next;
};

export const formatNodeFlowRunStatus = (
  run: NodeFlowRunRecord,
  locale: DashboardLocale = "en",
): string => {
  const timing = run.finishedAt || run.startedAt || run.createdAt;
  return `${translateNodesStatus(locale, run.status)} · ${formatRelativeDate(timing, locale)}`;
};

export const stableStringify = (value: NodeFlowJsonValue | NodeFlowGraph | null | undefined): string => {
  return JSON.stringify(sortJsonValue(value as NodeFlowJsonValue | undefined));
};

const sortJsonValue = (value: NodeFlowJsonValue | undefined): NodeFlowJsonValue | undefined => {
  if (Array.isArray(value)) {
    return value.map((entry) => sortJsonValue(entry) as NodeFlowJsonValue);
  }
  if (value && typeof value === "object") {
    return Object.keys(value).sort().reduce<NodeFlowJsonObject>((acc, key) => {
      acc[key] = sortJsonValue((value as NodeFlowJsonObject)[key]) as NodeFlowJsonValue;
      return acc;
    }, {});
  }
  return value;
};

const formatRelativeDate = (iso: string, locale: DashboardLocale): string => {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) {
    return translateNodesMessage(locale, "unknown");
  }
  return date.toLocaleString(locale, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};
