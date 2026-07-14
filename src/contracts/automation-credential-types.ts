export type AutomationCredentialScope = "project" | "global";
export type AutomationCredentialStatus = "active" | "revoked" | "unavailable";
export type AutomationCredentialCapability = "read" | "write" | "admin" | string;

export interface AutomationCredentialMetadata {
  id: string;
  name: string;
  kind: string;
  scope: AutomationCredentialScope;
  projectId: string | null;
  /** Project whose credential administrators may mutate this record. */
  managementProjectId: string | null;
  allowedProjectIds: string[];
  capabilities: AutomationCredentialCapability[];
  status: AutomationCredentialStatus;
  configured: boolean;
  keyId: string;
  keyVersion: number;
  version: number;
  lastValidatedAt: string | null;
  validationStatus: "untested" | "valid" | "invalid" | "unavailable";
  createdAt: string;
  updatedAt: string;
}

/** Secret-bearing fields in this contract are write-only and must never be serialized in a response. */
export interface CreateAutomationCredentialInput {
  name: string;
  kind: string;
  value: string;
  scope: AutomationCredentialScope;
  allowedProjectIds: string[];
  capabilities: AutomationCredentialCapability[];
}

export interface UpdateAutomationCredentialMetadataInput {
  name: string;
  expectedVersion: number;
}

export interface ReplaceAutomationCredentialSecretInput {
  value: string;
  expectedVersion: number;
}

export type RotateAutomationCredentialSecretInput = ReplaceAutomationCredentialSecretInput;

export interface PromoteAutomationCredentialInput {
  allowedProjectIds: string[];
  expectedVersion: number;
  confirmScopeExpansion: boolean;
}

export interface RestrictAutomationCredentialInput {
  allowedProjectIds: string[];
  capabilities: AutomationCredentialCapability[];
  expectedVersion: number;
}

export interface TestAutomationCredentialInput {
  expectedVersion: number;
}

export interface RevokeAutomationCredentialInput {
  expectedVersion: number;
}

export interface BindAutomationCredentialInput {
  bindingKey: string;
  requiredCapabilities: AutomationCredentialCapability[];
}

export interface AutomationCredentialCompatibilityInput {
  projectId: string;
  allowedKinds: string[];
  requiredCapabilities: AutomationCredentialCapability[];
}

export type AutomationCredentialCompatibilityIssue =
  | "backend_unavailable"
  | "backend_insecure"
  | "not_configured"
  | "not_active"
  | "project_access_denied"
  | "kind_not_allowed"
  | "capability_missing";

export interface AutomationCredentialCompatibilityAssessment {
  credentialId: string;
  projectId: string;
  compatible: boolean;
  backendReady: boolean;
  configured: boolean;
  active: boolean;
  projectAccess: boolean;
  kindAllowed: boolean;
  capabilitiesAllowed: boolean;
  missingCapabilities: AutomationCredentialCapability[];
  issues: AutomationCredentialCompatibilityIssue[];
  metadata: AutomationCredentialMetadata | null;
}

export interface AutomationCredentialBinding {
  id: string;
  credentialId: string;
  projectId: string;
  bindingKey: string;
  requiredCapabilities: AutomationCredentialCapability[];
  createdAt: string;
  updatedAt: string;
}

export type CredentialAccessOutcome = "granted" | "denied";
export interface AutomationCredentialAccessEvent {
  id: string;
  credentialId: string | null;
  projectId: string;
  bindingKey: string | null;
  capability: string | null;
  operation: string;
  outcome: CredentialAccessOutcome;
  reason: string | null;
  createdAt: string;
}

export interface AutomationCredentialRotation {
  id: string;
  credentialId: string;
  fromVersion: number;
  toVersion: number;
  keyId: string;
  keyVersion: number;
  rotatedAt: string;
}

export interface CredentialResolutionRequest {
  projectId: string;
  bindingKey: string;
  requiredCapabilities: AutomationCredentialCapability[];
  allowedKinds: string[];
  workspaceId: string;
}

export interface ResolvedCredential {
  credentialId: string;
  value: string;
  version: number;
}

export interface CredentialBackendHealth {
  available: boolean;
  secure: boolean;
  provider: string;
  keyId: string | null;
  keyVersion: number | null;
  reason?: string;
}
