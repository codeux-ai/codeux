import { ValidationError } from "../../repositories/repository-utils.js";
import type {
  NodeFlowEdge,
  NodeFlowGraph,
  NodeFlowJsonObject,
  NodeFlowJsonValue,
  NodeFlowNode,
  NodeFlowValidationIssue,
  NodeFlowValidationResponse,
  NodeFlowValueSchema,
  NodeWidgetField,
  NodeWidgetFieldType,
  NodeWidgetSchema,
} from "../../contracts/node-flow-types.js";
import { NODE_FLOW_SCHEMA_VERSION } from "../../contracts/node-flow-types.js";
import { migrateNodeFlowGraph } from "./node-flow-migrators.js";
import { resolveNodeDefinition } from "./node-definition-registry.js";

const MAX_GRAPH_NODES = 250;
const MAX_GRAPH_EDGES = 1_000;
const FORBIDDEN_GRAPH_KEY = /^(?:sourceCode|generatedSource|code|script|apiKey|authorization|cookie|password|secret|token)$/i;

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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

function containsForbiddenGraphValue(value: unknown, seen = new Set<object>()): boolean {
  if (Array.isArray(value)) return value.some((entry) => containsForbiddenGraphValue(entry, seen));
  if (!value || typeof value !== "object") return false;
  if (seen.has(value)) return false;
  seen.add(value);
  return Object.entries(value).some(([key, entry]) => FORBIDDEN_GRAPH_KEY.test(key) || containsForbiddenGraphValue(entry, seen));
}

function validatePolicy(
  policy: unknown,
  path: string,
  issues: NodeFlowValidationIssue[],
): void {
  if (policy === undefined) return;
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) {
    issues.push(issue(path, "invalid_policy", "Node policy must be an object."));
    return;
  }
  const typedPolicy = policy as Record<string, unknown>;
  if (typedPolicy.retry !== undefined && (!typedPolicy.retry || typeof typedPolicy.retry !== "object" || Array.isArray(typedPolicy.retry))) {
    issues.push(issue(`${path}.retry`, "invalid_retry_policy", "Retry policy must be an object."));
  }
  if (typedPolicy.timeout !== undefined && (!typedPolicy.timeout || typeof typedPolicy.timeout !== "object" || Array.isArray(typedPolicy.timeout))) {
    issues.push(issue(`${path}.timeout`, "invalid_timeout_policy", "Timeout policy must be an object."));
  }
  const retry = isRecord(typedPolicy.retry) ? typedPolicy.retry : undefined;
  const timeout = isRecord(typedPolicy.timeout) ? typedPolicy.timeout : undefined;
  if (retry && (typeof retry.maxAttempts !== "number" || !Number.isInteger(retry.maxAttempts) || retry.maxAttempts < 1 || retry.maxAttempts > 10)) {
    issues.push(issue(`${path}.retry.maxAttempts`, "invalid_retry_policy", "Retry maxAttempts must be an integer from 1 to 10."));
  }
  if (retry && (typeof retry.backoffMs !== "number" || !Number.isFinite(retry.backoffMs) || retry.backoffMs < 0 || retry.backoffMs > 300_000)) {
    issues.push(issue(`${path}.retry.backoffMs`, "invalid_retry_policy", "Retry backoffMs must be between 0 and 300000."));
  }
  if (retry?.maxBackoffMs !== undefined && (
    typeof retry.maxBackoffMs !== "number"
    || !Number.isFinite(retry.maxBackoffMs)
    || typeof retry.backoffMs !== "number"
    || retry.maxBackoffMs < retry.backoffMs
  )) {
    issues.push(issue(`${path}.retry.maxBackoffMs`, "invalid_retry_policy", "Retry maxBackoffMs must be at least backoffMs."));
  }
  if (timeout && (typeof timeout.timeoutMs !== "number" || !Number.isInteger(timeout.timeoutMs) || timeout.timeoutMs < 1 || timeout.timeoutMs > 300_000)) {
    issues.push(issue(`${path}.timeout.timeoutMs`, "invalid_timeout_policy", "Timeout must be an integer from 1 to 300000 milliseconds."));
  }
}

function validateCredentialBindings(
  bindings: unknown,
  nodePath: string,
  allowedSlots: string[],
  issues: NodeFlowValidationIssue[],
): NodeFlowNode["credentialBindings"] {
  if (bindings === undefined) return [];
  if (!Array.isArray(bindings)) {
    issues.push(issue(`${nodePath}.credentialBindings`, "invalid_credential_bindings", "Credential bindings must be an array."));
    return [];
  }
  const slots = new Set<string>();
  const normalized: NonNullable<NodeFlowNode["credentialBindings"]> = [];
  bindings.forEach((binding, index) => {
    const path = `${nodePath}.credentialBindings[${index}]`;
    if (!isRecord(binding)) {
      issues.push(issue(path, "invalid_credential_binding", "Credential binding must be an object."));
      return;
    }
    const slot = trimmedString(binding.slot);
    const credentialId = trimmedString(binding.credentialId);
    if (!slot) issues.push(issue(`${path}.slot`, "required", "Credential slot is required."));
    if (!credentialId) issues.push(issue(`${path}.credentialId`, "required", "Credential binding must reference a credential id."));
    if (slot && slots.has(slot)) issues.push(issue(`${path}.slot`, "duplicate_credential_slot", `Duplicate credential slot: ${slot}`));
    if (slot && !allowedSlots.includes(slot)) issues.push(issue(`${path}.slot`, "unknown_credential_slot", `Definition does not declare credential slot: ${slot}`));
    if (slot) slots.add(slot);
    if (slot && credentialId) normalized.push({ slot, credentialId });
  });
  return normalized;
}

function validateConfiguration(
  data: NodeFlowJsonObject,
  schema: NodeFlowValueSchema,
  nodePath: string,
  issues: NodeFlowValidationIssue[],
): void {
  const values = isPlainJsonObject(data.values) ? data.values : {};
  for (const key of schema.required ?? []) {
    const aliases = key === "template" || key === "prompt" ? ["template", "prompt"] : [key];
    const present = aliases.some((alias) => data[alias] !== undefined || values[alias] !== undefined);
    if (!present) issues.push(issue(`${nodePath}.data.${key}`, "required_configuration", `Node configuration requires ${key}.`));
  }
  for (const [key, propertySchema] of Object.entries(schema.properties ?? {})) {
    const value = data[key] ?? values[key];
    if (value !== undefined && !matchesValueSchema(value, propertySchema.type)) {
      issues.push(issue(`${nodePath}.data.${key}`, "invalid_configuration_type", `Node configuration ${key} must be ${propertySchema.type}.`));
    }
  }
}

function matchesValueSchema(value: NodeFlowJsonValue, type: NodeFlowValueSchema["type"]): boolean {
  if (type === "any") return true;
  if (type === "null") return value === null;
  if (type === "array") return Array.isArray(value);
  if (type === "object") return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  return typeof value === type;
}

const VALUE_SCHEMA_TYPES = new Set<NodeFlowValueSchema["type"]>([
  "any", "object", "array", "string", "number", "boolean", "null",
]);

function normalizeValueSchema(
  value: unknown,
  path: string,
  issues: NodeFlowValidationIssue[],
  ancestors = new Set<object>(),
): NodeFlowValueSchema | undefined {
  if (!isRecord(value)) {
    issues.push(issue(path, "invalid_value_schema", "Value schema must be an object."));
    return undefined;
  }
  if (ancestors.has(value)) {
    issues.push(issue(path, "invalid_value_schema", "Value schema cannot contain circular references."));
    return undefined;
  }
  const type = value.type;
  if (typeof type !== "string" || !VALUE_SCHEMA_TYPES.has(type as NodeFlowValueSchema["type"])) {
    issues.push(issue(`${path}.type`, "invalid_value_schema_type", "Value schema type is not supported."));
    return undefined;
  }
  const nextAncestors = new Set(ancestors).add(value);
  const normalized: NodeFlowValueSchema = { type: type as NodeFlowValueSchema["type"] };
  if (value.description !== undefined) {
    if (typeof value.description === "string") normalized.description = value.description.trim();
    else issues.push(issue(`${path}.description`, "invalid_value_schema", "Value schema description must be a string."));
  }
  if (value.required !== undefined) {
    if (!Array.isArray(value.required)) {
      issues.push(issue(`${path}.required`, "invalid_value_schema", "Value schema required must be an array of strings."));
    } else {
      const required: string[] = [];
      value.required.forEach((entry, index) => {
        const name = trimmedString(entry);
        if (!name) issues.push(issue(`${path}.required[${index}]`, "invalid_value_schema", "Required property name must be a non-empty string."));
        else required.push(name);
      });
      normalized.required = required;
    }
  }
  if (value.properties !== undefined) {
    if (!isRecord(value.properties)) {
      issues.push(issue(`${path}.properties`, "invalid_value_schema", "Value schema properties must be an object."));
    } else {
      const properties: Record<string, NodeFlowValueSchema> = {};
      for (const [key, property] of Object.entries(value.properties)) {
        const normalizedProperty = normalizeValueSchema(property, `${path}.properties.${key}`, issues, nextAncestors);
        if (normalizedProperty) properties[key] = normalizedProperty;
      }
      normalized.properties = properties;
    }
  }
  if (value.items !== undefined) {
    const items = normalizeValueSchema(value.items, `${path}.items`, issues, nextAncestors);
    if (items) normalized.items = items;
  }
  return normalized;
}

function normalizeNode(rawNode: unknown, index: number, issues: NodeFlowValidationIssue[]): NodeFlowNode | null {
  const nodePath = `nodes[${index}]`;
  if (!isRecord(rawNode)) {
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

  const widgetSchema = normalizeWidgetSchema(rawNode.widgetSchema as NodeWidgetSchema | undefined, `${nodePath}.widgetSchema`, issues);
  const position = isRecord(rawNode.position)
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

  const rawDefinitionRef = rawNode.definition === undefined ? { type, version: 1 } : rawNode.definition;
  let definitionType: string | null = null;
  let definitionVersion: number | null = null;
  if (!isRecord(rawDefinitionRef)) {
    issues.push(issue(`${nodePath}.definition`, "invalid_definition_reference", "Node definition reference must be an object."));
  } else {
    definitionType = trimmedString(rawDefinitionRef.type);
    if (!definitionType) issues.push(issue(`${nodePath}.definition.type`, "required", "Node definition type is required."));
    if (typeof rawDefinitionRef.version !== "number" || !Number.isInteger(rawDefinitionRef.version) || rawDefinitionRef.version < 1) {
      issues.push(issue(`${nodePath}.definition.version`, "invalid_definition_version", "Node definition version must be a positive integer."));
    } else {
      definitionVersion = rawDefinitionRef.version;
    }
  }
  const definition = definitionType && definitionVersion ? resolveNodeDefinition(definitionType, definitionVersion) : null;
  if (definitionType && definitionType !== type) {
    issues.push(issue(`${nodePath}.definition.type`, "definition_type_mismatch", "Node type must match its definition reference."));
  }
  if (definitionType && definitionVersion && !definition) {
    issues.push(issue(`${nodePath}.definition`, "unknown_node_definition", `Unknown node definition: ${definitionType}@${definitionVersion}`));
  }
  if (definition && rawNode.sideEffect !== undefined && rawNode.sideEffect !== definition.sideEffect) {
    issues.push(issue(`${nodePath}.sideEffect`, "definition_metadata_mismatch", "Node side effect must match its definition."));
  }
  let suppliedCapabilities: string[] | undefined;
  if (rawNode.capabilities !== undefined) {
    if (!Array.isArray(rawNode.capabilities) || rawNode.capabilities.some((capability) => typeof capability !== "string")) {
      issues.push(issue(`${nodePath}.capabilities`, "invalid_capabilities", "Node capabilities must be an array of strings."));
    } else {
      suppliedCapabilities = rawNode.capabilities;
      if (definition && [...suppliedCapabilities].sort().join("\0") !== [...definition.capabilities].sort().join("\0")) {
        issues.push(issue(`${nodePath}.capabilities`, "definition_metadata_mismatch", "Node capabilities must match its definition."));
      }
    }
  }
  const rawPorts = rawNode.ports === undefined ? definition?.ports ?? [] : rawNode.ports;
  if (!Array.isArray(rawPorts)) {
    issues.push(issue(`${nodePath}.ports`, "invalid_ports", "Node ports must be an array."));
  }
  const ports: NonNullable<NodeFlowNode["ports"]> = [];
  const portIds = new Set<string>();
  (Array.isArray(rawPorts) ? rawPorts : []).forEach((port, portIndex) => {
    const portPath = `${nodePath}.ports[${portIndex}]`;
    if (!isRecord(port)) {
      issues.push(issue(portPath, "invalid_port", "Port must be an object."));
      return;
    }
    const portId = trimmedString(port.id);
    if (!portId) issues.push(issue(`${portPath}.id`, "required", "Port id is required."));
    if (portId && portIds.has(portId)) issues.push(issue(`${portPath}.id`, "duplicate_port_id", `Duplicate port id: ${portId}`));
    if (portId) portIds.add(portId);
    const direction = port.direction;
    if (direction !== "input" && direction !== "output") issues.push(issue(`${portPath}.direction`, "invalid_port_direction", "Port direction must be input or output."));
    const schema = normalizeValueSchema(port.schema, `${portPath}.schema`, issues);
    const cardinality = port.cardinality;
    if (cardinality !== undefined && cardinality !== "one" && cardinality !== "many") {
      issues.push(issue(`${portPath}.cardinality`, "invalid_port_cardinality", "Port cardinality must be one or many."));
    }
    if (portId && (direction === "input" || direction === "output") && schema) {
      ports.push({
        id: portId,
        direction,
        schema,
        ...(port.required !== undefined ? { required: Boolean(port.required) } : {}),
        ...(cardinality === "one" || cardinality === "many" ? { cardinality } : {}),
      });
    }
  });
  validatePolicy(rawNode.policy, `${nodePath}.policy`, issues);
  const credentialBindings = validateCredentialBindings(rawNode.credentialBindings, nodePath, definition?.credentials.map((credential) => credential.slot) ?? [], issues);
  if (rawNode.data && containsForbiddenGraphValue(rawNode.data)) {
    issues.push(issue(`${nodePath}.data`, "unsafe_graph_data", "Graph data cannot contain raw secrets or custom source code."));
  }
  if (definition) validateConfiguration(isPlainJsonObject(rawNode.data) ? rawNode.data : {}, definition.configurationSchema, nodePath, issues);

  return {
    id,
    type,
    title: title ?? id,
    ...(rawNode.description !== undefined ? { description: String(rawNode.description).trim() } : {}),
    ...(widgetSchema ? { widgetSchema } : {}),
    ...(position ? { position } : {}),
    ...(rawNode.data !== undefined && isPlainJsonObject(rawNode.data) ? { data: rawNode.data } : {}),
    definition: { type: definitionType ?? type, version: definitionVersion ?? 1 },
    ports,
    credentialBindings,
    policy: isRecord(rawNode.policy) ? rawNode.policy as NodeFlowNode["policy"] : definition?.defaultPolicy ?? {},
    capabilities: definition?.capabilities ?? suppliedCapabilities ?? [],
    sideEffect: definition?.sideEffect ?? (typeof rawNode.sideEffect === "string" ? rawNode.sideEffect as NodeFlowNode["sideEffect"] : "none"),
    disabled: typeof rawNode.disabled === "boolean" ? rawNode.disabled : false,
  };
}

function normalizeEdge(rawEdge: unknown, index: number, issues: NodeFlowValidationIssue[]): NodeFlowEdge | null {
  const edgePath = `edges[${index}]`;
  if (!isRecord(rawEdge)) {
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

  const ready = nodes.filter((node) => inDegree.get(node.id) === 0).map((node) => node.id).sort();
  const order: string[] = [];
  while (ready.length > 0) {
    const nodeId = ready.shift()!;
    order.push(nodeId);
    for (const nextId of [...(outgoing.get(nodeId) ?? [])].sort()) {
      const nextInDegree = (inDegree.get(nextId) ?? 0) - 1;
      inDegree.set(nextId, nextInDegree);
      if (nextInDegree === 0) {
        ready.push(nextId);
        ready.sort();
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

  const migration = migrateNodeFlowGraph(graph);
  const rawGraph = migration.graph;
  if (!Array.isArray(rawGraph.nodes)) {
    issues.push(issue("nodes", "required", "Node flow graph requires a nodes array."));
  }
  if (!Array.isArray(rawGraph.edges)) {
    issues.push(issue("edges", "required", "Node flow graph requires an edges array."));
  }
  if (Array.isArray(rawGraph.nodes) && rawGraph.nodes.length > MAX_GRAPH_NODES) {
    issues.push(issue("nodes", "graph_limit_exceeded", `Node flow graph supports at most ${MAX_GRAPH_NODES} nodes.`));
  }
  if (Array.isArray(rawGraph.edges) && rawGraph.edges.length > MAX_GRAPH_EDGES) {
    issues.push(issue("edges", "graph_limit_exceeded", `Node flow graph supports at most ${MAX_GRAPH_EDGES} edges.`));
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
    const source = nodes.find((node) => node.id === edge.fromNodeId);
    const target = nodes.find((node) => node.id === edge.toNodeId);
    if (source && edge.fromHandle && !source.ports?.some((port) => port.id === edge.fromHandle && port.direction === "output")) {
      issues.push(issue(`edges[${index}].fromHandle`, "invalid_source_port", `Source port does not exist or is not an output: ${edge.fromHandle}`));
    }
    if (target && edge.toHandle && !target.ports?.some((port) => port.id === edge.toHandle && port.direction === "input")) {
      issues.push(issue(`edges[${index}].toHandle`, "invalid_target_port", `Target port does not exist or is not an input: ${edge.toHandle}`));
    }
  });

  const inputSchema = normalizeWidgetSchema(rawGraph.inputSchema, "inputSchema", issues);
  let schemas: NodeFlowGraph["schemas"] | undefined;
  if (rawGraph.schemas !== undefined) {
    if (!isRecord(rawGraph.schemas)) {
      issues.push(issue("schemas", "invalid_schemas", "Node flow schemas must be an object."));
    } else {
      const input = rawGraph.schemas.input === undefined
        ? undefined
        : normalizeValueSchema(rawGraph.schemas.input, "schemas.input", issues);
      const output = rawGraph.schemas.output === undefined
        ? undefined
        : normalizeValueSchema(rawGraph.schemas.output, "schemas.output", issues);
      schemas = { ...(input ? { input } : {}), ...(output ? { output } : {}) };
    }
  }
  if (rawGraph.metadata !== undefined && !isPlainJsonObject(rawGraph.metadata)) {
    issues.push(issue("metadata", "invalid_metadata", "Node flow graph metadata must be a JSON object."));
  }
  if (rawGraph.metadata && containsForbiddenGraphValue(rawGraph.metadata)) {
    issues.push(issue("metadata", "unsafe_graph_metadata", "Graph metadata cannot contain raw secrets or custom source code."));
  }
  const publication = validatePublication(rawGraph.publication, issues);

  const normalizedGraph: NodeFlowGraph = {
    schemaVersion: NODE_FLOW_SCHEMA_VERSION,
    nodes,
    edges,
    ...(inputSchema ? { inputSchema } : {}),
    ...(schemas ? { schemas } : {}),
    ...(rawGraph.metadata !== undefined && isPlainJsonObject(rawGraph.metadata) ? { metadata: rawGraph.metadata } : {}),
    ...(publication ? { publication } : {}),
  };
  const executionOrder = computeExecutionOrder(nodes, edges, issues);
  const valid = issues.length === 0;
  return {
    valid,
    errors: issues,
    ...(valid ? { graph: normalizedGraph, executionOrder } : {}),
  };
}

function validatePublication(
  publication: unknown,
  issues: NodeFlowValidationIssue[],
): NodeFlowGraph["publication"] | undefined {
  if (publication === undefined) return undefined;
  if (!isRecord(publication)) {
    issues.push(issue("publication", "invalid_publication", "Publication metadata must be an object."));
    return undefined;
  }
  const publicationId = trimmedString(publication.publicationId);
  const publishedBy = trimmedString(publication.publishedBy);
  const publishedAt = trimmedString(publication.publishedAt);
  const sourceVersion = publication.sourceVersion;
  if (!publicationId) issues.push(issue("publication.publicationId", "required", "Publication id is required."));
  if (!publishedBy) issues.push(issue("publication.publishedBy", "required", "Publication author is required."));
  if (!publishedAt || !Number.isFinite(Date.parse(publishedAt))) {
    issues.push(issue("publication.publishedAt", "invalid_publication", "Publication timestamp must be ISO-compatible."));
  }
  if (typeof sourceVersion !== "number" || !Number.isInteger(sourceVersion) || sourceVersion < 1) {
    issues.push(issue("publication.sourceVersion", "invalid_publication", "Publication sourceVersion must be a positive integer."));
  }
  if (!publicationId || !publishedBy || !publishedAt || typeof sourceVersion !== "number" || !Number.isInteger(sourceVersion) || sourceVersion < 1) {
    return undefined;
  }
  return { publicationId, publishedBy, publishedAt, sourceVersion };
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
