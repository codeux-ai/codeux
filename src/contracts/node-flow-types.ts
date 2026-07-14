import type { AutomationCredentialCompatibilityIssue } from "./automation-credential-types.js";

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

export type AutomationApprovalStatus = "pending" | "approved" | "rejected" | "expired";

export interface AutomationApprovalRecord {
  id: string;
  projectId: string;
  flowId: string;
  runId: string;
  nodeId: string;
  logicalItem: string;
  status: AutomationApprovalStatus;
  request: NodeFlowJsonObject;
  decision: NodeFlowJsonObject | null;
  requestedAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

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

export type NodeFlowGraphPatchOperation =
  | { op: "upsert_node"; node: NodeFlowNode }
  | { op: "remove_node"; nodeId: string }
  | { op: "upsert_edge"; edge: NodeFlowEdge }
  | { op: "remove_edge"; edgeId?: string; fromNodeId?: string; toNodeId?: string }
  | { op: "set_input_schema"; inputSchema: NodeWidgetSchema | null }
  | { op: "set_metadata"; metadata: NodeFlowJsonObject | null };

export interface PatchNodeFlowDraftInput {
  projectId: string;
  draftRevision: number;
  graph?: NodeFlowGraph;
  operations?: NodeFlowGraphPatchOperation[];
  title?: string;
  description?: string;
}

export interface NodeFlowConcurrencyConflict {
  code: "draft_revision_conflict";
  flowId: string;
  expectedDraftRevision: number;
  actualDraftRevision: number;
  message: string;
}

export interface NodeFlowPolicyFinding {
  severity: "info" | "warning" | "error";
  code: string;
  nodeId?: string;
  message: string;
}

export interface NodeFlowRequiredCredential {
  nodeId: string;
  slot: string;
  allowedKinds: string[];
  requiredCapabilities: string[];
  required: boolean;
  credentialId: string | null;
  status: "bound" | "missing" | "denied";
  backendReady: boolean | null;
  configured: boolean | null;
  active: boolean | null;
  projectAccess: boolean | null;
  kindAllowed: boolean | null;
  capabilitiesAllowed: boolean | null;
  missingCapabilities: string[];
  compatibilityIssues: AutomationCredentialCompatibilityIssue[];
}

export interface NodeFlowCredentialRequestResult extends NodeFlowRequiredCredential {
  requestStatus: "already_bound" | "requested";
  /** This compatibility endpoint never writes or replaces a graph credential binding. */
  persistence: "none";
  bindingChanged: false;
}

export interface NodeFlowDraftReview {
  flowId: string;
  projectId: string;
  name: string;
  description: string;
  draftRevision: number;
  nodeCount: number;
  edgeCount: number;
  valid: boolean;
  validationIssues: NodeFlowValidationIssue[];
  policyFindings: NodeFlowPolicyFinding[];
  requiredCredentials: NodeFlowRequiredCredential[];
  requestedCapabilities: string[];
  sideEffectDiffs: Array<{ nodeId: string; sideEffect: NodeFlowSideEffect; description: string }>;
  publishedVersion: number | null;
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
  logicalItem: string;
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
  logicalItem: string;
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
  logicalItem?: string;
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
