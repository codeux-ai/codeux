export type CustomDashboardStatus =
  | "draft"
  | "validating"
  | "validated"
  | "published"
  | "rejected"
  | "archived";

export type CustomDashboardValidationStatus =
  | "queued"
  | "building"
  | "running"
  | "passed"
  | "failed"
  | "cancelled";

export type CustomDashboardJsonPrimitive = string | number | boolean | null;
export type CustomDashboardJsonValue =
  | CustomDashboardJsonPrimitive
  | CustomDashboardJsonValue[]
  | { [key: string]: CustomDashboardJsonValue };
export type CustomDashboardJsonObject = { [key: string]: CustomDashboardJsonValue };

export interface CustomDashboardFileBundleEntry {
  path: string;
  content: string;
  contentType?: string;
  checksum?: string;
}

export interface CustomDashboardFileBundle {
  files: CustomDashboardFileBundleEntry[];
  metadata?: CustomDashboardJsonObject;
}

export interface CustomDashboardCredentialSlot {
  slot: string;
  label: string;
  required: boolean;
  allowedKinds: string[];
  requiredCapability: string;
  metadata?: CustomDashboardJsonObject;
}

export interface CustomDashboardCredentialBinding {
  slot: string;
  credentialId: string;
  capability: string;
  bindingKey: string;
  credential: {
    id: string;
    name: string;
    kind: string;
    scope: "project" | "global";
    capabilities: string[];
    status: "active" | "revoked" | "unavailable";
    configured: boolean;
  };
}

export interface CustomDashboardRouteDefinition {
  path: string;
  label: string;
  entryFile: string;
  metadata?: CustomDashboardJsonObject;
}

export interface CustomDashboardDataSourceNode {
  id: string;
  type: string;
  title: string;
  config?: CustomDashboardJsonObject;
  credentialSlots?: CustomDashboardCredentialSlot[];
}

export interface CustomDashboardDataSourceEdge {
  id?: string;
  fromNodeId: string;
  toNodeId: string;
}

export interface CustomDashboardDataSourceNodeGraph {
  nodes: CustomDashboardDataSourceNode[];
  edges: CustomDashboardDataSourceEdge[];
  metadata?: CustomDashboardJsonObject;
}

export interface CustomDashboardManifest {
  schemaVersion: number;
  title: string;
  entryFile: string;
  filePaths: string[];
  description?: string;
  dataSources?: CustomDashboardDataSourceNodeGraph;
  metadata?: CustomDashboardJsonObject;
}

export type CustomDashboardBuildDependency =
  | "@preact/preset-vite"
  | "@preact/signals"
  | "@tailwindcss/vite"
  | "preact"
  | "tailwindcss"
  | "typescript"
  | "vite";

/**
 * Ephemeral validation input derived and controlled by the server. It is never
 * accepted as user package configuration or persisted as executable state.
 */
export interface CustomDashboardBuildManifest {
  entryFile: string;
  sourceFiles: string[];
  styleEntries: string[];
  routes: CustomDashboardRouteDefinition[];
  dependencies: Record<CustomDashboardBuildDependency, string>;
}

export interface CustomDashboardValidationIssue {
  field: string;
  code: string;
  message: string;
}

export interface CustomDashboardValidationReport {
  valid: boolean;
  summary?: string;
  issues: CustomDashboardValidationIssue[];
  metadata?: CustomDashboardJsonObject;
}

export interface CustomDashboardRecord {
  id: string;
  projectId: string;
  title: string;
  description: string;
  status: CustomDashboardStatus;
  manifest: CustomDashboardManifest;
  fileBundle: CustomDashboardFileBundle;
  sourceNodeGraph: CustomDashboardDataSourceNodeGraph;
  credentialBindings: CustomDashboardCredentialBinding[];
  routes: CustomDashboardRouteDefinition[];
  styleguide: CustomDashboardJsonObject;
  runtimeMetadata: CustomDashboardJsonObject;
  publishedRevisionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CustomDashboardRevisionRecord {
  id: string;
  dashboardId: string;
  projectId: string;
  revisionNumber: number;
  manifest: CustomDashboardManifest;
  fileBundle: CustomDashboardFileBundle;
  sourceNodeGraph: CustomDashboardDataSourceNodeGraph;
  credentialBindings: CustomDashboardCredentialBinding[];
  routes: CustomDashboardRouteDefinition[];
  styleguide: CustomDashboardJsonObject;
  validationStatus: CustomDashboardValidationStatus | null;
  validationReport: CustomDashboardValidationReport | null;
  runtimeMetadata: CustomDashboardJsonObject;
  validatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CustomDashboardValidationSessionRecord {
  id: string;
  dashboardId: string;
  revisionId: string;
  projectId: string;
  status: CustomDashboardValidationStatus;
  validationReport: CustomDashboardValidationReport | null;
  runtimeMetadata: CustomDashboardJsonObject;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCustomDashboardDraftInput {
  id?: string;
  title: string;
  description?: string;
  manifest: CustomDashboardManifest;
  fileBundle: CustomDashboardFileBundle;
  sourceNodeGraph?: CustomDashboardDataSourceNodeGraph;
  credentialBindings?: Array<Pick<CustomDashboardCredentialBinding, "slot" | "credentialId">>;
  routes?: CustomDashboardRouteDefinition[];
  styleguide?: CustomDashboardJsonObject;
  runtimeMetadata?: CustomDashboardJsonObject;
}

export interface UpdateCustomDashboardDraftInput {
  title?: string;
  description?: string;
  manifest?: CustomDashboardManifest;
  fileBundle?: CustomDashboardFileBundle;
  sourceNodeGraph?: CustomDashboardDataSourceNodeGraph;
  credentialBindings?: Array<Pick<CustomDashboardCredentialBinding, "slot" | "credentialId">>;
  routes?: CustomDashboardRouteDefinition[];
  styleguide?: CustomDashboardJsonObject;
  runtimeMetadata?: CustomDashboardJsonObject;
}

export interface CreateCustomDashboardRevisionInput {
  manifest?: CustomDashboardManifest;
  fileBundle?: CustomDashboardFileBundle;
  sourceNodeGraph?: CustomDashboardDataSourceNodeGraph;
  credentialBindings?: Array<Pick<CustomDashboardCredentialBinding, "slot" | "credentialId">>;
  routes?: CustomDashboardRouteDefinition[];
  styleguide?: CustomDashboardJsonObject;
  runtimeMetadata?: CustomDashboardJsonObject;
}

export interface CreateCustomDashboardValidationSessionInput {
  id?: string;
  status?: CustomDashboardValidationStatus;
  validationReport?: CustomDashboardValidationReport | null;
  runtimeMetadata?: CustomDashboardJsonObject;
  startedAt?: string | null;
  finishedAt?: string | null;
}

export interface UpdateCustomDashboardValidationSessionInput {
  status?: CustomDashboardValidationStatus;
  validationReport?: CustomDashboardValidationReport | null;
  runtimeMetadata?: CustomDashboardJsonObject;
  startedAt?: string | null;
  finishedAt?: string | null;
}
