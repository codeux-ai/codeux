export type NodeWidgetFieldType =
  | "text"
  | "textarea"
  | "number"
  | "boolean"
  | "select"
  | "json"
  | "secretRef"
  | "keyValue";

export type NodeFlowJsonPrimitive = string | number | boolean | null;
export type NodeFlowJsonValue =
  | NodeFlowJsonPrimitive
  | NodeFlowJsonValue[]
  | { [key: string]: NodeFlowJsonValue };
export type NodeFlowJsonObject = { [key: string]: NodeFlowJsonValue };

export interface NodeWidgetSelectOption {
  label: string;
  value: string | number | boolean;
}

export interface NodeWidgetField {
  id: string;
  type: NodeWidgetFieldType;
  label: string;
  description?: string;
  required?: boolean;
  placeholder?: string;
  defaultValue?: NodeFlowJsonValue;
  options?: NodeWidgetSelectOption[];
  min?: number;
  max?: number;
  step?: number;
}

export interface NodeWidgetSchema {
  fields: NodeWidgetField[];
}

export interface NodeFlowNodePosition {
  x: number;
  y: number;
}

export interface NodeFlowNode {
  id: string;
  type: string;
  title: string;
  description?: string;
  widgetSchema?: NodeWidgetSchema;
  position?: NodeFlowNodePosition;
  data?: NodeFlowJsonObject;
}

export interface NodeFlowEdge {
  id?: string;
  fromNodeId: string;
  toNodeId: string;
  fromHandle?: string;
  toHandle?: string;
}

export interface NodeFlowGraph {
  nodes: NodeFlowNode[];
  edges: NodeFlowEdge[];
  inputSchema?: NodeWidgetSchema;
  metadata?: NodeFlowJsonObject;
}

export interface NodeFlowRecord {
  id: string;
  projectId: string;
  title: string;
  description: string;
  graph: NodeFlowGraph;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface NodeFlowVersionRecord {
  id: string;
  flowId: string;
  projectId: string;
  version: number;
  title: string;
  description: string;
  graph: NodeFlowGraph;
  createdAt: string;
}

export interface CreateNodeFlowInput {
  id?: string;
  title: string;
  description?: string;
  graph: NodeFlowGraph;
}

export interface UpdateNodeFlowInput {
  title?: string;
  description?: string;
  graph?: NodeFlowGraph;
}

export interface NodeFlowValidationIssue {
  field: string;
  code: string;
  message: string;
}

export interface NodeFlowValidationResponse {
  valid: boolean;
  errors: NodeFlowValidationIssue[];
  graph?: NodeFlowGraph;
  executionOrder?: string[];
}

export interface NodeFlowSkillAttachment {
  flowId: string;
  projectId: string;
  agentPresetId: string;
  skillName: string;
  description: string;
  createdAt: string;
  updatedAt: string;
}

export interface AttachNodeFlowSkillInput {
  agentPresetId: string;
  skillName?: string;
  description?: string;
}

export type NodeFlowRunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";
export type NodeFlowNodeRunStatus = "pending" | "running" | "succeeded" | "failed" | "skipped" | "cancelled";

export interface NodeFlowRunRecord {
  id: string;
  flowId: string;
  projectId: string;
  version: number;
  status: NodeFlowRunStatus;
  triggerType: string;
  triggerPayload: NodeFlowJsonObject | null;
  input: NodeFlowJsonObject | null;
  output: NodeFlowJsonObject | null;
  errorMessage: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NodeFlowNodeRunRecord {
  id: string;
  runId: string;
  flowId: string;
  projectId: string;
  nodeId: string;
  status: NodeFlowNodeRunStatus;
  input: NodeFlowJsonObject | null;
  output: NodeFlowJsonObject | null;
  errorMessage: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NodeFlowListResponse {
  flows: NodeFlowRecord[];
}

export interface NodeFlowRunListResponse {
  runs: NodeFlowRunRecord[];
}

export interface NodeFlowNodeRunListResponse {
  nodeRuns: NodeFlowNodeRunRecord[];
}
