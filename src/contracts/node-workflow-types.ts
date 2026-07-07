import type { ProviderId } from "./app-types.js";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export type NodeWorkflowStatus = "draft" | "active" | "archived";
export type NodeWorkflowRunStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
export type NodeWorkflowRunTrigger = "manual" | "scheduler" | "api" | "mcp" | "system";
export type NodeWorkflowStepRunStatus = "queued" | "running" | "completed" | "failed" | "skipped" | "cancelled";

export type NodeWorkflowWidgetFieldType =
  | "text"
  | "textarea"
  | "number"
  | "boolean"
  | "select"
  | "multiselect"
  | "secret"
  | "url"
  | "json"
  | "code"
  | "key_value_list"
  | "file_path"
  | "directory_path"
  | "path";

export interface NodeWorkflowWidgetOption {
  label: string;
  value: string;
  description?: string;
}

export interface NodeWorkflowWidgetValidationHints {
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  minItems?: number;
  maxItems?: number;
  allowedFileExtensions?: string[];
  language?: string;
  placeholder?: string;
}

export interface NodeWorkflowWidgetGroup {
  id: string;
  label: string;
  description?: string;
  order?: number;
}

export interface NodeWorkflowWidgetDefinition {
  key: string;
  type: NodeWorkflowWidgetFieldType;
  label: string;
  description?: string;
  defaultValue?: JsonValue;
  required?: boolean;
  options?: NodeWorkflowWidgetOption[];
  validation?: NodeWorkflowWidgetValidationHints;
  group?: NodeWorkflowWidgetGroup;
  order?: number;
  metadata?: JsonObject;
}

export type NodeWorkflowWidgetValues = Record<string, JsonValue>;

export interface NodeWorkflowPosition {
  x: number;
  y: number;
}

export interface NodeWorkflowNodeRecord {
  id: string;
  type: string;
  title: string;
  description?: string;
  widgetDefinitions: NodeWorkflowWidgetDefinition[];
  widgetValues: NodeWorkflowWidgetValues;
  position?: NodeWorkflowPosition;
  metadata?: JsonObject;
}

export interface NodeWorkflowEdgeRecord {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  label?: string;
  condition?: JsonObject;
  metadata?: JsonObject;
}

export interface NodeWorkflowRecord {
  id: string;
  projectId: string;
  name: string;
  description: string;
  status: NodeWorkflowStatus;
  version: number;
  widgetDefinitions: NodeWorkflowWidgetDefinition[];
  widgetValues: NodeWorkflowWidgetValues;
  nodes: NodeWorkflowNodeRecord[];
  edges: NodeWorkflowEdgeRecord[];
  metadata?: JsonObject;
  createdAt: string;
  updatedAt: string;
}

export interface CreateNodeWorkflowInput {
  id?: string;
  name: string;
  description?: string;
  status?: NodeWorkflowStatus;
  version?: number;
  widgetDefinitions?: NodeWorkflowWidgetDefinition[];
  widgetValues?: NodeWorkflowWidgetValues;
  nodes: NodeWorkflowNodeRecord[];
  edges?: NodeWorkflowEdgeRecord[];
  metadata?: JsonObject;
}

export interface UpdateNodeWorkflowInput {
  name?: string;
  description?: string;
  status?: NodeWorkflowStatus;
  version?: number;
  widgetDefinitions?: NodeWorkflowWidgetDefinition[];
  widgetValues?: NodeWorkflowWidgetValues;
  nodes?: NodeWorkflowNodeRecord[];
  edges?: NodeWorkflowEdgeRecord[];
  metadata?: JsonObject | null;
}

export interface NodeWorkflowAgentAttachmentRecord {
  id: string;
  projectId: string;
  workflowId: string;
  nodeId: string | null;
  agentPresetId: string | null;
  provider?: ProviderId | null;
  role: string;
  label: string;
  config: JsonObject;
  createdAt: string;
  updatedAt: string;
}

export interface AttachNodeWorkflowAgentInput {
  id?: string;
  nodeId?: string | null;
  agentPresetId?: string | null;
  provider?: ProviderId | null;
  role?: string;
  label?: string;
  config?: JsonObject;
}

export interface UpdateNodeWorkflowAgentAttachmentInput {
  nodeId?: string | null;
  agentPresetId?: string | null;
  provider?: ProviderId | null;
  role?: string;
  label?: string;
  config?: JsonObject;
}

export interface NodeWorkflowRunRecord {
  id: string;
  projectId: string;
  workflowId: string;
  status: NodeWorkflowRunStatus;
  trigger: NodeWorkflowRunTrigger;
  input: JsonObject;
  output: JsonObject | null;
  errorMessage: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateNodeWorkflowRunInput {
  id?: string;
  status?: NodeWorkflowRunStatus;
  trigger?: NodeWorkflowRunTrigger;
  input?: JsonObject;
  output?: JsonObject | null;
  errorMessage?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
}

export interface UpdateNodeWorkflowRunInput {
  status?: NodeWorkflowRunStatus;
  trigger?: NodeWorkflowRunTrigger;
  input?: JsonObject;
  output?: JsonObject | null;
  errorMessage?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
}

export interface NodeWorkflowStepRunRecord {
  id: string;
  projectId: string;
  workflowId: string;
  workflowRunId: string;
  nodeId: string;
  status: NodeWorkflowStepRunStatus;
  attempt: number;
  agentAttachmentId: string | null;
  agentPresetId: string | null;
  provider: ProviderId | null;
  input: JsonObject;
  output: JsonObject | null;
  errorMessage: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateNodeWorkflowStepRunInput {
  id?: string;
  nodeId: string;
  status?: NodeWorkflowStepRunStatus;
  attempt?: number;
  agentAttachmentId?: string | null;
  agentPresetId?: string | null;
  provider?: ProviderId | null;
  input?: JsonObject;
  output?: JsonObject | null;
  errorMessage?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
}

export interface UpdateNodeWorkflowStepRunInput {
  status?: NodeWorkflowStepRunStatus;
  attempt?: number;
  agentAttachmentId?: string | null;
  agentPresetId?: string | null;
  provider?: ProviderId | null;
  input?: JsonObject;
  output?: JsonObject | null;
  errorMessage?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
}
