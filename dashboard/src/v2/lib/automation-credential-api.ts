import type {
  AutomationCredentialBinding,
  AutomationCredentialCompatibilityAssessment,
  AutomationCredentialMetadata,
  BindAutomationCredentialInput,
  CreateAutomationCredentialInput,
  CredentialBackendHealth,
  PromoteAutomationCredentialInput,
  ReplaceAutomationCredentialSecretInput,
  RestrictAutomationCredentialInput,
  RevokeAutomationCredentialInput,
  TestAutomationCredentialInput,
  UpdateAutomationCredentialMetadataInput,
} from "../../../../src/contracts/automation-credential-types.js";
import { fetchJson } from "../../lib/api/fetch-json.js";

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});
const base = (projectId: string) => `/api/projects/${encodeURIComponent(projectId)}/credentials`;
const credential = (projectId: string, id: string) => `${base(projectId)}/${encodeURIComponent(id)}`;

export const fetchCredentialHealth = (): Promise<CredentialBackendHealth> => fetchJson("/api/credentials/health");
export const fetchAutomationCredentials = (projectId: string): Promise<AutomationCredentialMetadata[]> => fetchJson(base(projectId));
export const createAutomationCredential = (projectId: string, input: CreateAutomationCredentialInput): Promise<AutomationCredentialMetadata> => fetchJson(base(projectId), json("POST", input));
export const updateAutomationCredential = (projectId: string, id: string, input: UpdateAutomationCredentialMetadataInput): Promise<AutomationCredentialMetadata> => fetchJson(credential(projectId, id), json("PATCH", input));
export const bindAutomationCredential = (projectId: string, id: string, input: BindAutomationCredentialInput): Promise<AutomationCredentialBinding> => fetchJson(`${credential(projectId, id)}/bind`, json("POST", input));
export const assessAutomationCredentialCompatibility = (projectId: string, id: string, input: { allowedKinds: string[]; requiredCapabilities: string[] }): Promise<AutomationCredentialCompatibilityAssessment> => fetchJson(`${credential(projectId, id)}/compatibility`, json("POST", input));
export const testAutomationCredential = (projectId: string, id: string, input: TestAutomationCredentialInput): Promise<AutomationCredentialMetadata> => fetchJson(`${credential(projectId, id)}/test`, json("POST", input));
export const rotateAutomationCredential = (projectId: string, id: string, input: ReplaceAutomationCredentialSecretInput): Promise<AutomationCredentialMetadata> => fetchJson(`${credential(projectId, id)}/rotate`, json("POST", input));
export const replaceAutomationCredential = (projectId: string, id: string, input: ReplaceAutomationCredentialSecretInput): Promise<AutomationCredentialMetadata> => fetchJson(`${credential(projectId, id)}/replace`, json("POST", input));
export const revokeAutomationCredential = (projectId: string, id: string, input: RevokeAutomationCredentialInput): Promise<AutomationCredentialMetadata> => fetchJson(`${credential(projectId, id)}/revoke`, json("POST", input));
export const promoteAutomationCredential = (projectId: string, id: string, input: PromoteAutomationCredentialInput): Promise<AutomationCredentialMetadata> => fetchJson(`${credential(projectId, id)}/promote`, json("POST", input));
export const restrictAutomationCredential = (projectId: string, id: string, input: RestrictAutomationCredentialInput): Promise<AutomationCredentialMetadata> => fetchJson(`${credential(projectId, id)}/restrict`, json("POST", input));
