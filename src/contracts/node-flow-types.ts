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

export const NODE_FLOW_SCHEMA_VERSION = 2 as const;
export type NodeFlowSchemaVersion = typeof NODE_FLOW_SCHEMA_VERSION;

export type NodeFlowPortDirection = "input" | "output";
export type NodeFlowPortCardinality = "one" | "many";
export type NodeFlowSideEffect = "none" | "read" | "write" | "external";

export interface NodeFlowValueSchema {
  type: "any" | "object" | "array" | "string" | "number" | "boolean" | "null";
  description?: string;
  required?: string[];
  properties?: Record<string, NodeFlowValueSchema>;
  items?: NodeFlowValueSchema;
}

export interface NodeFlowDefinitionReference {
  type: string;
  version: number;
}

export interface NodeFlowPort {
  id: string;
  direction: NodeFlowPortDirection;
  schema: NodeFlowValueSchema;
  required?: boolean;
  cardinality?: NodeFlowPortCardinality;
}

export interface NodeFlowCredentialBinding {
  slot: string;
  credentialId: string;
}

export interface NodeFlowRetryPolicy {
  maxAttempts: number;
  backoffMs: number;
  maxBackoffMs?: number;
}

export interface NodeFlowTimeoutPolicy {
  timeoutMs: number;
}

export interface NodeFlowExecutionPolicy {
  retry?: NodeFlowRetryPolicy;
  timeout?: NodeFlowTimeoutPolicy;
}

export interface NodeFlowPublicationMetadata {
  publicationId: string;
  publishedAt: string;
  publishedBy: string;
  sourceVersion: number;
}

export interface NodeFlowSchemas {
  input?: NodeFlowValueSchema;
  output?: NodeFlowValueSchema;
}

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
  definition?: NodeFlowDefinitionReference;
  ports?: NodeFlowPort[];
  credentialBindings?: NodeFlowCredentialBinding[];
  policy?: NodeFlowExecutionPolicy;
  capabilities?: string[];
  sideEffect?: NodeFlowSideEffect;
  disabled?: boolean;
}

export interface NodeFlowEdge {
  id?: string;
  fromNodeId: string;
  toNodeId: string;
  fromHandle?: string;
  toHandle?: string;
}

export interface NodeFlowGraph {
  schemaVersion?: NodeFlowSchemaVersion;
  nodes: NodeFlowNode[];
  edges: NodeFlowEdge[];
  inputSchema?: NodeWidgetSchema;
  schemas?: NodeFlowSchemas;
  metadata?: NodeFlowJsonObject;
  publication?: Readonly<NodeFlowPublicationMetadata>;
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

export interface NodeFlowPublicationRecord {
  id: string;
  flowId: string;
  projectId: string;
  version: number;
  graph: NodeFlowGraph;
  policy: import("./node-flow-execution-policy-types.js").NodeFlowExecutionPolicySnapshot;
  publishedBy: string;
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

export type NodeFlowRunStatus =
  | "queued" | "running" | "approval_waiting" | "retry_waiting"
  | "attention_required" | "succeeded" | "failed" | "cancelled";
export type NodeFlowNodeRunStatus =
  | "pending" | "running" | "approval_waiting" | "retry_waiting" | "attention_required"
  | "succeeded" | "failed" | "skipped" | "cancelled";

export interface NodeFlowRunRecord {
  id: string;
  flowId: string;
  projectId: string;
  version: number;
  publicationId: string | null;
  status: NodeFlowRunStatus;
  policy: import("./node-flow-execution-policy-types.js").NodeFlowExecutionPolicySnapshot;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  heartbeatAt: string | null;
  cancelRequestedAt: string | null;
  executionInvocationId: string | null;
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
  executionInvocationId: string | null;
  input: NodeFlowJsonObject | null;
  output: NodeFlowJsonObject | null;
  errorMessage: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NodeFlowNodeAttemptRecord {
  id: string;
  runId: string;
  nodeRunId: string;
  nodeId: string;
  attemptNumber: number;
  status: NodeFlowNodeRunStatus;
  executorId: string;
  invocationId: string | null;
  artifactDigest: string | null;
  input: NodeFlowJsonObject | null;
  output: NodeFlowJsonObject | null;
  credentialIds: string[];
  failureClassification: import("./node-flow-execution-policy-types.js").NodeFlowFailureClassification | null;
  retryDecision: "retry" | "stop" | "attention_required" | null;
  errorMessage: string | null;
  startedAt: string;
  finishedAt: string | null;
  createdAt: string;
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

export interface CreateNodeFlowRunInput {
  flowId: string;
  projectId: string;
  version: number;
  publicationId?: string | null;
  policy?: import("./node-flow-execution-policy-types.js").NodeFlowExecutionPolicySnapshot;
  status?: NodeFlowRunStatus;
  executionInvocationId?: string | null;
  triggerType?: string;
  triggerPayload?: NodeFlowJsonObject | null;
  input?: NodeFlowJsonObject | null;
  output?: NodeFlowJsonObject | null;
  errorMessage?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
}

export interface UpdateNodeFlowRunInput {
  status?: NodeFlowRunStatus;
  executionInvocationId?: string | null;
  output?: NodeFlowJsonObject | null;
  errorMessage?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  leaseOwner?: string | null;
  leaseExpiresAt?: string | null;
  heartbeatAt?: string | null;
  cancelRequestedAt?: string | null;
}

export interface CreateNodeFlowNodeRunInput {
  runId: string;
  flowId: string;
  projectId: string;
  nodeId: string;
  status?: NodeFlowNodeRunStatus;
  executionInvocationId?: string | null;
  input?: NodeFlowJsonObject | null;
  output?: NodeFlowJsonObject | null;
  errorMessage?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
}

export interface UpdateNodeFlowNodeRunInput {
  status?: NodeFlowNodeRunStatus;
  executionInvocationId?: string | null;
  input?: NodeFlowJsonObject | null;
  output?: NodeFlowJsonObject | null;
  errorMessage?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
}

export interface RunNodeFlowOptions {
  triggerType?: string;
  triggerPayload?: NodeFlowJsonObject;
  signal?: AbortSignal;
  versionSelection?: import("./node-flow-execution-policy-types.js").NodeFlowVersionSelection;
  /** Internal recursion guard propagated only by Execute Subflow. */
  subflowDepth?: number;
  executorId?: string;
}

export interface NodeFlowRunSummaryResponse {
  run: NodeFlowRunRecord;
  nodeRuns: NodeFlowNodeRunRecord[];
  attempts?: NodeFlowNodeAttemptRecord[];
  output: NodeFlowJsonObject | null;
}
