import type { NodeDefinitionManifest } from "./node-definition-types.js";
import type { NodeFlowJsonObject, NodeFlowJsonValue, NodeFlowValueSchema } from "./node-flow-types.js";

export const CUSTOM_NODE_SCHEMA_VERSION = 1 as const;
export const CUSTOM_NODE_FEATURE_FLAG = "CODE_UX_CUSTOM_NODES_ENABLED" as const;

export type CustomNodeLifecycleStatus = "draft" | "validating" | "passed" | "failed" | "published";
export type CustomNodeCapability =
  | "network.http"
  | "credentials.read"
  | "temporary-storage.write"
  | "artifacts.write"
  | "clock.read";

export interface CustomNodeCredentialSlot {
  slot: string;
  label: string;
  required: boolean;
  allowedKinds: string[];
  requiredCapability: string;
}

export interface CustomNodeResourceLimits {
  cpu: number;
  memoryMb: number;
  pids: number;
  timeoutMs: number;
  maxOutputBytes: number;
  scratchMb: number;
}

export interface CustomNodeHttpPolicy {
  allowedHosts: string[];
  allowedPorts?: number[];
  maxRequests: number;
  timeoutMs: number;
  maxResponseBytes: number;
}

export interface CustomNodeManifest {
  schemaVersion: typeof CUSTOM_NODE_SCHEMA_VERSION;
  id: string;
  nodeType: string;
  version: number;
  name: string;
  description: string;
  entrypoint: "dist/index.js";
  inputSchema: NodeFlowValueSchema;
  outputSchema: NodeFlowValueSchema;
  configurationSchema: NodeFlowValueSchema;
  capabilities: CustomNodeCapability[];
  credentials: CustomNodeCredentialSlot[];
  resources: CustomNodeResourceLimits;
  http?: CustomNodeHttpPolicy;
}

export interface CustomNodeLogger {
  debug(message: string, fields?: NodeFlowJsonObject): void;
  info(message: string, fields?: NodeFlowJsonObject): void;
  warn(message: string, fields?: NodeFlowJsonObject): void;
  error(message: string, fields?: NodeFlowJsonObject): void;
}

export interface CustomNodeHttpRequest {
  url: string;
  method?: "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE";
  headers?: Record<string, string>;
  body?: string;
}

export interface CustomNodeHttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface CustomNodeArtifactWriter {
  write(name: string, content: string | Uint8Array, mediaType: string): Promise<{ name: string; digest: string; size: number }>;
}

/** The only authority exposed to generated code. Implementations are supplied by the isolated runner. */
export interface NodeExecutionContext {
  input: Readonly<NodeFlowJsonObject>;
  config: Readonly<NodeFlowJsonObject>;
  correlationId: string;
  invocationId: string;
  signal: AbortSignal;
  logger: CustomNodeLogger;
  clock: { now(): string };
  http: { request(request: CustomNodeHttpRequest): Promise<CustomNodeHttpResponse> };
  credentials: { get(slot: string): Promise<string> };
  temporaryStorage: {
    read(path: string): Promise<Uint8Array | null>;
    write(path: string, content: string | Uint8Array): Promise<void>;
  };
  artifacts: CustomNodeArtifactWriter;
}

export type CustomNodeHandler = (context: NodeExecutionContext) => Promise<NodeFlowJsonObject>;

export interface CustomNodeValidationIssue {
  check: string;
  code: string;
  message: string;
}

export interface CustomNodeValidationCheck {
  name: string;
  passed: boolean;
  durationMs: number;
  details?: string;
}

export interface CustomNodeValidationReport {
  valid: boolean;
  checks: CustomNodeValidationCheck[];
  issues: CustomNodeValidationIssue[];
  validatedAt: string;
}

export interface CustomNodeDependency {
  name: string;
  version: string;
  integrity?: string;
}

export interface CustomNodeArtifact {
  digest: string;
  nodeId: string;
  projectId: string;
  version: number;
  sourceRevision: string;
  buildDigest: string;
  runtimeImageDigest: string;
  dependencies: CustomNodeDependency[];
  validationReport: CustomNodeValidationReport;
  createdBy: string;
  invocationId: string;
  correlationId: string;
  capabilities: CustomNodeCapability[];
  manifest: CustomNodeManifest;
  createdAt: string;
}

export interface CustomNodeRecord {
  id: string;
  projectId: string;
  status: CustomNodeLifecycleStatus;
  sourceRevision: string;
  manifest: CustomNodeManifest;
  validationReport: CustomNodeValidationReport | null;
  artifactDigest: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface CustomNodePublication {
  id: string;
  nodeId: string;
  projectId: string;
  nodeType: string;
  version: number;
  artifactDigest: string;
  publishedBy: string;
  publishedAt: string;
}

export interface CustomNodeExecutionRequest {
  projectId: string;
  nodeType: string;
  version: number;
  input: NodeFlowJsonObject;
  config: NodeFlowJsonObject;
  credentialBindings: Record<string, string>;
  workspaceId: string;
  invocationId: string;
  correlationId: string;
  signal?: AbortSignal;
}

export interface CustomNodeExecutionResult {
  output: NodeFlowJsonObject;
  artifactDigest: string;
  logs: string;
  diagnostics: string;
}

export interface CreateCustomNodeDraftInput {
  manifest: CustomNodeManifest;
  sourceRevision: string;
  createdBy: string;
}

export function customNodeDefinitionFromArtifact(artifact: CustomNodeArtifact): NodeDefinitionManifest {
  const { manifest } = artifact;
  return {
    type: manifest.nodeType,
    version: manifest.version,
    executable: true,
    executionKind: "custom",
    configurationSchema: manifest.configurationSchema,
    ui: {
      label: manifest.name,
      description: manifest.description,
      category: "custom",
      widgetSchema: { fields: [] },
    },
    ports: [
      { id: "input", direction: "input", schema: manifest.inputSchema, cardinality: "many" },
      { id: "output", direction: "output", schema: manifest.outputSchema, cardinality: "one" },
    ],
    credentials: manifest.credentials.map((slot) => ({
      slot: slot.slot,
      label: slot.label,
      required: slot.required,
      allowedKinds: [...slot.allowedKinds],
    })),
    capabilities: [...manifest.capabilities],
    sideEffect: manifest.capabilities.includes("network.http") ? "external" : "none",
    defaultPolicy: { retry: { maxAttempts: 1, backoffMs: 0 }, timeout: { timeoutMs: manifest.resources.timeoutMs } },
    documentation: "docs/architecture/custom-nodes.md",
    deprecation: { deprecated: false },
  };
}

export function isNodeFlowJsonObject(value: NodeFlowJsonValue): value is NodeFlowJsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
