export type AutomationCredentialScope = "project" | "global";
export type AutomationCredentialStatus = "active" | "revoked" | "unavailable";
export type AutomationCredentialCapability = "read" | "write" | "admin" | string;

export interface AutomationCredentialMetadata {
  id: string;
  name: string;
  kind: string;
  scope: AutomationCredentialScope;
  projectId: string | null;
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

export interface CreateAutomationCredentialInput {
  name: string;
  kind: string;
  value: string;
  scope?: AutomationCredentialScope;
  allowedProjectIds?: string[];
  capabilities?: AutomationCredentialCapability[];
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
  capability: AutomationCredentialCapability;
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
