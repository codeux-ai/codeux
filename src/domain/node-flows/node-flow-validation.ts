import { ValidationError } from "../../repositories/repository-utils.js";
import type {
  NodeFlowEdge,
  NodeFlowGraph,
  NodeFlowJsonValue,
  NodeFlowNode,
  NodeFlowValidationIssue,
  NodeFlowValidationResponse,
  NodeWidgetField,
  NodeWidgetFieldType,
  NodeWidgetSchema,
} from "../../contracts/node-flow-types.js";

const WIDGET_FIELD_TYPES = new Set<NodeWidgetFieldType>([
  "text",
  "textarea",
  "number",
  "boolean",
  "select",
  "json",
  "secretRef",
  "keyValue",
]);

export class NodeFlowValidationError extends ValidationError {
  readonly details: NodeFlowValidationIssue[];

  constructor(message: string, details: NodeFlowValidationIssue[]) {
    super(message);
    this.name = "ValidationError";
    this.details = details;
  }
}

export interface NormalizedNodeFlowValidation {
  graph: NodeFlowGraph;
  executionOrder: string[];
}

function issue(field: string, code: string, message: string): NodeFlowValidationIssue {
  return { field, code, message };
}

function trimmedString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isJsonValue(value: unknown, seen = new Set<object>()): value is NodeFlowJsonValue {
  if (value === null) {
    return true;
  }
  const valueType = typeof value;
  if (valueType === "string" || valueType === "boolean") {
    return true;
  }
  if (valueType === "number") {
    return Number.isFinite(value);
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return false;
    }
    seen.add(value);
    return value.every((entry) => isJsonValue(entry, seen));
  }
  if (valueType === "object") {
    const objectValue = value as Record<string, unknown>;
    if (seen.has(objectValue)) {
      return false;
    }
    seen.add(objectValue);
    return Object.entries(objectValue).every(([key, entry]) => (
      typeof key === "string" && isJsonValue(entry, seen)
    ));
  }
  return false;
}

function isPlainJsonObject(value: unknown): value is Record<string, NodeFlowJsonValue> {
  return Boolean(value)
    && typeof value === "object"
    && !Array.isArray(value)
    && isJsonValue(value);
}

function validateDefaultValue(
  field: NodeWidgetField,
  fieldPath: string,
  issues: NodeFlowValidationIssue[],
): NodeFlowJsonValue | undefined {
  if (field.defaultValue === undefined) {
    return undefined;
  }
  if (!isJsonValue(field.defaultValue)) {
    issues.push(issue(`${fieldPath}.defaultValue`, "unsafe_default", "Widget defaultValue must be JSON-serializable and finite."));
    return undefined;
  }

  const value = field.defaultValue;
  if ((field.type === "text" || field.type === "textarea" || field.type === "secretRef") && typeof value !== "string") {
    issues.push(issue(`${fieldPath}.defaultValue`, "invalid_default_type", `${field.type} defaultValue must be a string.`));
    return undefined;
  }
  if (field.type === "number" && (typeof value !== "number" || !Number.isFinite(value))) {
    issues.push(issue(`${fieldPath}.defaultValue`, "invalid_default_type", "number defaultValue must be a finite number."));
    return undefined;
  }
  if (field.type === "boolean" && typeof value !== "boolean") {
    issues.push(issue(`${fieldPath}.defaultValue`, "invalid_default_type", "boolean defaultValue must be a boolean."));
    return undefined;
  }
  if (field.type === "select") {
    const optionValues = (field.options ?? []).map((option) => option.value);
    const matchesOption = optionValues.some((optionValue) => optionValue === value);
    if (!matchesOption) {
      issues.push(issue(`${fieldPath}.defaultValue`, "invalid_select_default", "select defaultValue must match one of the option values."));
      return undefined;
    }
  }
  if (field.type === "keyValue") {
    const isStringRecord = Boolean(value)
      && typeof value === "object"
      && !Array.isArray(value)
      && Object.values(value as Record<string, unknown>).every((entry) => typeof entry === "string");
    if (!isStringRecord) {
      issues.push(issue(`${fieldPath}.defaultValue`, "invalid_default_type", "keyValue defaultValue must be an object with string values."));
      return undefined;
    }
  }

  return value;
}

function normalizeWidgetSchema(
  schema: NodeWidgetSchema | undefined,
  schemaPath: string,
  issues: NodeFlowValidationIssue[],
): NodeWidgetSchema | undefined {
  if (schema === undefined) {
    return undefined;
  }
  if (!schema || typeof schema !== "object" || !Array.isArray(schema.fields)) {
    issues.push(issue(schemaPath, "invalid_widget_schema", "Widget schema must include a fields array."));
    return { fields: [] };
  }

  const fieldIds = new Set<string>();
  const normalizedFields: NodeWidgetField[] = [];
  schema.fields.forEach((rawField, index) => {
    const fieldPath = `${schemaPath}.fields[${index}]`;
    if (!rawField || typeof rawField !== "object" || Array.isArray(rawField)) {
      issues.push(issue(fieldPath, "invalid_widget_field", "Widget field must be an object."));
      return;
    }
    const field = rawField as NodeWidgetField;
    const id = trimmedString(field.id);
    const label = trimmedString(field.label);
    const type = field.type;
    if (!id) {
      issues.push(issue(`${fieldPath}.id`, "required", "Widget field id is required."));
      return;
    }
    if (fieldIds.has(id)) {
      issues.push(issue(`${fieldPath}.id`, "duplicate_widget_field_id", `Duplicate widget field id: ${id}`));
    }
    fieldIds.add(id);
    if (!label) {
      issues.push(issue(`${fieldPath}.label`, "required", `Widget field ${id} requires a label.`));
    }
    if (!WIDGET_FIELD_TYPES.has(type)) {
      issues.push(issue(`${fieldPath}.type`, "invalid_widget_field_type", `Widget field ${id} has unsupported type: ${String(type)}`));
      return;
    }

    const normalizedField: NodeWidgetField = {
      id,
      type,
      label: label ?? id,
      ...(field.description !== undefined ? { description: String(field.description).trim() } : {}),
      ...(field.required !== undefined ? { required: Boolean(field.required) } : {}),
      ...(field.placeholder !== undefined ? { placeholder: String(field.placeholder).trim() } : {}),
    };

    if (type === "select") {
      if (!Array.isArray(field.options) || field.options.length === 0) {
        issues.push(issue(`${fieldPath}.options`, "required", `select widget field ${id} requires at least one option.`));
        normalizedField.options = [];
      } else {
        normalizedField.options = field.options.map((option, optionIndex) => {
          const optionPath = `${fieldPath}.options[${optionIndex}]`;
          const optionLabel = trimmedString(option?.label);
          if (!optionLabel) {
            issues.push(issue(`${optionPath}.label`, "required", `select option ${optionIndex + 1} for field ${id} requires a label.`));
          }
          if (
            !option
            || !["string", "number", "boolean"].includes(typeof option.value)
            || (typeof option.value === "number" && !Number.isFinite(option.value))
          ) {
            issues.push(issue(`${optionPath}.value`, "invalid_option_value", `select option ${optionIndex + 1} for field ${id} requires a string, number, or boolean value.`));
          }
          return {
            label: optionLabel ?? String(option?.value ?? optionIndex),
            value: typeof option?.value === "number" && !Number.isFinite(option.value) ? String(optionIndex) : option?.value as string | number | boolean,
          };
        });
      }
    }

    if (field.min !== undefined) {
      if (typeof field.min === "number" && Number.isFinite(field.min)) {
        normalizedField.min = field.min;
      } else {
        issues.push(issue(`${fieldPath}.min`, "invalid_number", `Widget field ${id} min must be a finite number.`));
      }
    }
    if (field.max !== undefined) {
      if (typeof field.max === "number" && Number.isFinite(field.max)) {
        normalizedField.max = field.max;
      } else {
        issues.push(issue(`${fieldPath}.max`, "invalid_number", `Widget field ${id} max must be a finite number.`));
      }
    }
    if (field.step !== undefined) {
      if (typeof field.step === "number" && Number.isFinite(field.step) && field.step > 0) {
        normalizedField.step = field.step;
      } else {
        issues.push(issue(`${fieldPath}.step`, "invalid_number", `Widget field ${id} step must be a positive finite number.`));
      }
    }

    const defaultValue = validateDefaultValue(field, fieldPath, issues);
    if (defaultValue !== undefined) {
      normalizedField.defaultValue = defaultValue;
    }
    normalizedFields.push(normalizedField);
  });

  return { fields: normalizedFields };
}

function normalizeNode(rawNode: NodeFlowNode, index: number, issues: NodeFlowValidationIssue[]): NodeFlowNode | null {
  const nodePath = `nodes[${index}]`;
  if (!rawNode || typeof rawNode !== "object" || Array.isArray(rawNode)) {
    issues.push(issue(nodePath, "invalid_node", "Node must be an object."));
    return null;
  }
  const id = trimmedString(rawNode.id);
  const type = trimmedString(rawNode.type);
  const title = trimmedString(rawNode.title);
  if (!id) {
    issues.push(issue(`${nodePath}.id`, "required", "Node id is required."));
  }
  if (!type) {
    issues.push(issue(`${nodePath}.type`, "required", "Node type is required."));
  }
  if (!title) {
    issues.push(issue(`${nodePath}.title`, "required", "Node title is required."));
  }
  if (!id || !type) {
    return null;
  }

  const widgetSchema = normalizeWidgetSchema(rawNode.widgetSchema, `${nodePath}.widgetSchema`, issues);
  const position = rawNode.position
    && typeof rawNode.position.x === "number"
    && Number.isFinite(rawNode.position.x)
    && typeof rawNode.position.y === "number"
    && Number.isFinite(rawNode.position.y)
    ? { x: rawNode.position.x, y: rawNode.position.y }
    : undefined;
  if (rawNode.position !== undefined && !position) {
    issues.push(issue(`${nodePath}.position`, "invalid_position", `Node ${id} position must include finite x and y numbers.`));
  }
  if (rawNode.data !== undefined && !isPlainJsonObject(rawNode.data)) {
    issues.push(issue(`${nodePath}.data`, "invalid_data", `Node ${id} data must be a JSON object.`));
  }

  return {
    id,
    type,
    title: title ?? id,
    ...(rawNode.description !== undefined ? { description: String(rawNode.description).trim() } : {}),
    ...(widgetSchema ? { widgetSchema } : {}),
    ...(position ? { position } : {}),
    ...(rawNode.data !== undefined && isPlainJsonObject(rawNode.data) ? { data: rawNode.data } : {}),
  };
}

function normalizeEdge(rawEdge: NodeFlowEdge, index: number, issues: NodeFlowValidationIssue[]): NodeFlowEdge | null {
  const edgePath = `edges[${index}]`;
  if (!rawEdge || typeof rawEdge !== "object" || Array.isArray(rawEdge)) {
    issues.push(issue(edgePath, "invalid_edge", "Edge must be an object."));
    return null;
  }
  const fromNodeId = trimmedString(rawEdge.fromNodeId);
  const toNodeId = trimmedString(rawEdge.toNodeId);
  if (!fromNodeId) {
    issues.push(issue(`${edgePath}.fromNodeId`, "required", "Edge fromNodeId is required."));
  }
  if (!toNodeId) {
    issues.push(issue(`${edgePath}.toNodeId`, "required", "Edge toNodeId is required."));
  }
  if (!fromNodeId || !toNodeId) {
    return null;
  }
  return {
    ...(rawEdge.id !== undefined ? { id: String(rawEdge.id).trim() || undefined } : {}),
    fromNodeId,
    toNodeId,
    ...(rawEdge.fromHandle !== undefined ? { fromHandle: String(rawEdge.fromHandle).trim() } : {}),
    ...(rawEdge.toHandle !== undefined ? { toHandle: String(rawEdge.toHandle).trim() } : {}),
  };
}

function computeExecutionOrder(
  nodes: NodeFlowNode[],
  edges: NodeFlowEdge[],
  issues: NodeFlowValidationIssue[],
): string[] {
  const inDegree = new Map(nodes.map((node) => [node.id, 0]));
  const outgoing = new Map(nodes.map((node) => [node.id, [] as string[]]));
  for (const edge of edges) {
    outgoing.get(edge.fromNodeId)?.push(edge.toNodeId);
    inDegree.set(edge.toNodeId, (inDegree.get(edge.toNodeId) ?? 0) + 1);
  }

  const ready = nodes.filter((node) => inDegree.get(node.id) === 0).map((node) => node.id);
  const order: string[] = [];
  while (ready.length > 0) {
    const nodeId = ready.shift()!;
    order.push(nodeId);
    for (const nextId of outgoing.get(nodeId) ?? []) {
      const nextInDegree = (inDegree.get(nextId) ?? 0) - 1;
      inDegree.set(nextId, nextInDegree);
      if (nextInDegree === 0) {
        ready.push(nextId);
      }
    }
  }

  if (order.length !== nodes.length) {
    const cyclicNodeIds = nodes
      .filter((node) => (inDegree.get(node.id) ?? 0) > 0)
      .map((node) => node.id)
      .join(", ");
    issues.push(issue("edges", "cycle_detected", `Node flow graph must be acyclic. Cycle includes: ${cyclicNodeIds}`));
  }

  return order;
}

export function validateNodeFlowGraph(graph: unknown): NodeFlowValidationResponse {
  const issues: NodeFlowValidationIssue[] = [];
  if (!graph || typeof graph !== "object" || Array.isArray(graph)) {
    return {
      valid: false,
      errors: [issue("graph", "invalid_graph", "Node flow graph must be an object.")],
    };
  }

  const rawGraph = graph as NodeFlowGraph;
  if (!Array.isArray(rawGraph.nodes)) {
    issues.push(issue("nodes", "required", "Node flow graph requires a nodes array."));
  }
  if (!Array.isArray(rawGraph.edges)) {
    issues.push(issue("edges", "required", "Node flow graph requires an edges array."));
  }

  const nodes = Array.isArray(rawGraph.nodes)
    ? rawGraph.nodes.map((node, index) => normalizeNode(node, index, issues)).filter((node): node is NodeFlowNode => Boolean(node))
    : [];
  const edges = Array.isArray(rawGraph.edges)
    ? rawGraph.edges.map((edge, index) => normalizeEdge(edge, index, issues)).filter((edge): edge is NodeFlowEdge => Boolean(edge))
    : [];

  if (nodes.length === 0) {
    issues.push(issue("nodes", "required", "Node flow graph requires at least one node."));
  }

  const nodeIds = new Set<string>();
  for (const node of nodes) {
    if (nodeIds.has(node.id)) {
      issues.push(issue("nodes", "duplicate_node_id", `Duplicate node id: ${node.id}`));
    }
    nodeIds.add(node.id);
  }

  edges.forEach((edge, index) => {
    if (!nodeIds.has(edge.fromNodeId)) {
      issues.push(issue(`edges[${index}].fromNodeId`, "invalid_edge_endpoint", `Edge source node does not exist: ${edge.fromNodeId}`));
    }
    if (!nodeIds.has(edge.toNodeId)) {
      issues.push(issue(`edges[${index}].toNodeId`, "invalid_edge_endpoint", `Edge target node does not exist: ${edge.toNodeId}`));
    }
  });

  const inputSchema = normalizeWidgetSchema(rawGraph.inputSchema, "inputSchema", issues);
  if (rawGraph.metadata !== undefined && !isPlainJsonObject(rawGraph.metadata)) {
    issues.push(issue("metadata", "invalid_metadata", "Node flow graph metadata must be a JSON object."));
  }

  const normalizedGraph: NodeFlowGraph = {
    nodes,
    edges,
    ...(inputSchema ? { inputSchema } : {}),
    ...(rawGraph.metadata !== undefined && isPlainJsonObject(rawGraph.metadata) ? { metadata: rawGraph.metadata } : {}),
  };
  const executionOrder = computeExecutionOrder(nodes, edges, issues);
  const valid = issues.length === 0;
  return {
    valid,
    errors: issues,
    ...(valid ? { graph: normalizedGraph, executionOrder } : {}),
  };
}

export function normalizeNodeFlowGraph(graph: unknown): NormalizedNodeFlowValidation {
  const result = validateNodeFlowGraph(graph);
  if (!result.valid || !result.graph || !result.executionOrder) {
    const message = result.errors.length === 1
      ? result.errors[0]!.message
      : `Node flow graph validation failed with ${result.errors.length} errors.`;
    throw new NodeFlowValidationError(message, result.errors);
  }
  return {
    graph: result.graph,
    executionOrder: result.executionOrder,
  };
}
